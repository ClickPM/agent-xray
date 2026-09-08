// Source 源码快照的写路径(R-SOURCE):三段式发布 begin → put → commit。
//
// 【为什么是三段而不是一次整包】整个收录集合约 300 个文件 / 3 MB,一次请求装不下(MCP 请求体 8 MiB 是附件的额度,
// 且管理端上下文也不该被灌满);而每次发版真正变化的通常只有几个文件。所以:
//   1. `begin` 带 manifest(path + sha256 + bytes + lines)建 staging 行,并把 **current 里 (path, sha256) 相同**的文件内容直接复制过来,
//      回给脚本「还缺哪些」;
//   2. `put` 分批(≤ 512 KB)只补缺的那些,服务端现算 sha256 必须等于 manifest 声明值;
//   3. `commit` 在一个事务里核完 manifest 每一项都有内容 → 翻 current → 删其余快照。
// 读面只查 `status = 'current'`,永远读不到半成品;current 至多一行由部分唯一索引兜住。
//
// 【同 sha 重发 = 幂等】脚本在 `dev.ps1 ship` 里自动跑,重跑必须无害:begin 遇到该 sha 已是 current 时什么都不动、
// 回 alreadyCurrent;commit 同理回 unchanged。
//
// 【本文件只用 shared/source-pack.ts 的判据】不碰文件系统、不执行任何内容;NotFoundError / ConflictError 由 tools 层整形成可读的一句话。
import type { Transaction } from "encore.dev/storage/sqldb";
import { safeErrorText } from "../shared/redact";
import {
  checkSourceContent,
  MAX_SOURCE_BATCH_BYTES,
  MAX_SOURCE_BATCH_FILES,
  SourcePackError,
  validateSourceManifest,
  type SourceManifestInput,
} from "../shared/source-pack";
import { db } from "./db";
import { ConflictError, NotFoundError } from "./store";

const ms = (col: string, alias: string) =>
  `(extract(epoch FROM ${col}) * 1000)::double precision AS "${alias}"`;

async function inTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  const tx = await db.begin();
  try {
    const out = await fn(tx);
    await tx.commit();
    return out;
  } catch (err) {
    await tx.rollback().catch((e) => console.error(`source tx rollback failed: ${safeErrorText(e)}`));
    throw err;
  }
}

/** 三段都在同一把事务级 advisory lock 下:两个发布并发(比如 ship 与手动补发撞上)不会交错写同一份 staging。 */
const SOURCE_LOCK = 0x73726331; // 'src1',本库内唯一即可
async function lockSource(tx: Transaction): Promise<void> {
  await tx.rawExec(`SELECT pg_advisory_xact_lock($1)`, SOURCE_LOCK);
}

function packErrorToConflict(err: unknown): never {
  // 校验失败是所有者(或脚本)改一下输入就能解决的事,按业务冲突回可读的一句话
  if (err instanceof SourcePackError) throw new ConflictError(err.message);
  throw err;
}

export interface BeginResult {
  sha: string;
  total: number;
  /** 从 current 复制过来、不必再上传的文件数 */
  reused: number;
  /** 还缺内容的路径(脚本按它分批 put) */
  missing: string[];
  /** 该 sha 已经是 current:什么都没动,commit 也会是 unchanged */
  alreadyCurrent: boolean;
}

/**
 * 建 / 重建 staging 快照。同 sha 重 begin = 清掉旧 staging 行重来(上一次中途失败的残留不会污染这一次)。
 */
export async function beginSnapshot(sha: string, files: SourceManifestInput[]): Promise<BeginResult> {
  let entries;
  try {
    entries = validateSourceManifest(files);
  } catch (err) {
    packErrorToConflict(err);
  }
  const totalBytes = entries.reduce((a, f) => a + f.bytes, 0);

  return inTransaction(async (tx) => {
    await lockSource(tx);
    const current = await tx.rawQueryRow<{ sha: string }>(`SELECT sha FROM source_snapshots WHERE status = 'current'`);
    if (current?.sha === sha) {
      return { sha, total: entries.length, reused: entries.length, missing: [], alreadyCurrent: true };
    }
    await tx.rawExec(
      `INSERT INTO source_snapshots (sha, status, file_count, total_bytes, created_at, published_at)
       VALUES ($1, 'staging', $2, $3, now(), NULL)
       ON CONFLICT (sha) DO UPDATE
          SET status = 'staging', file_count = EXCLUDED.file_count, total_bytes = EXCLUDED.total_bytes,
              created_at = now(), published_at = NULL`,
      sha,
      entries.length,
      totalBytes,
    );
    await tx.rawExec(`DELETE FROM source_files WHERE sha = $1`, sha);
    // 逐条插入并顺手从 current 复制同 (path, sha256) 的内容;没有 current 时子查询回 NULL,全部待上传
    for (const f of entries) {
      await tx.rawExec(
        `INSERT INTO source_files (sha, path, kind, sha256, bytes, lines, content)
         VALUES ($1, $2, $3, $4, $5, $6,
                 (SELECT c.content FROM source_files c
                    JOIN source_snapshots s ON s.sha = c.sha AND s.status = 'current'
                   WHERE c.path = $2 AND c.sha256 = $4 AND c.content IS NOT NULL
                   LIMIT 1))`,
        sha,
        f.path,
        f.kind,
        f.sha256,
        f.bytes,
        f.lines,
      );
    }
    const missing = await tx.rawQueryAll<{ path: string }>(
      `SELECT path FROM source_files WHERE sha = $1 AND content IS NULL ORDER BY path COLLATE "C"`,
      sha,
    );
    return {
      sha,
      total: entries.length,
      reused: entries.length - missing.length,
      missing: missing.map((m) => m.path),
      alreadyCurrent: false,
    };
  });
}

export interface PutResult {
  sha: string;
  stored: number;
  /** 本批之后还缺内容的文件数 */
  pending: number;
}

/**
 * 补一批内容。只收 manifest 里的 path;服务端现算的 sha256 必须等于 manifest 声明值,否则整批拒(事务回滚)。
 * 已有内容的 path 再传一次:哈希相同则覆盖(幂等),不同则拒。
 */
export async function putFiles(sha: string, files: Array<{ path: string; content: string }>): Promise<PutResult> {
  if (files.length === 0) throw new ConflictError("files 不能为空");
  if (files.length > MAX_SOURCE_BATCH_FILES) throw new ConflictError(`一批最多 ${MAX_SOURCE_BATCH_FILES} 个文件`);
  const facts = new Map<string, ReturnType<typeof checkSourceContent>>();
  let batchBytes = 0;
  try {
    for (const f of files) {
      if (facts.has(f.path)) throw new SourcePackError(`同一批里路径重复:${f.path}`);
      const fx = checkSourceContent(f.path, f.content);
      batchBytes += fx.bytes;
      if (batchBytes > MAX_SOURCE_BATCH_BYTES) throw new SourcePackError(`一批内容超过 ${MAX_SOURCE_BATCH_BYTES} 字节,分小一点再传`);
      facts.set(f.path, fx);
    }
  } catch (err) {
    packErrorToConflict(err);
  }

  return inTransaction(async (tx) => {
    await lockSource(tx);
    const snap = await tx.rawQueryRow<{ status: string }>(`SELECT status FROM source_snapshots WHERE sha = $1`, sha);
    if (!snap) throw new NotFoundError(`快照 ${sha.slice(0, 7)} 不存在,先 source_snapshot_begin`);
    if (snap.status === "current") throw new ConflictError(`快照 ${sha.slice(0, 7)} 已经是 current,不接受再上传`);
    for (const f of files) {
      const fx = facts.get(f.path)!;
      const row = await tx.rawQueryRow<{ sha256: string; bytes: number; lines: number }>(
        `SELECT sha256, bytes, lines FROM source_files WHERE sha = $1 AND path = $2`,
        sha,
        f.path,
      );
      if (!row) throw new ConflictError(`${f.path} 不在 manifest 里(source_snapshot_begin 时没有声明它)`);
      // 【三个内容事实都核,不只核哈希】(codex 首轮 P2)manifest 里的 bytes / lines 会进页面头部条与目录树,
      // 只核 sha256 的话,一份哈希对、字节数错的 manifest 也能 commit,页面上就是错的体积与行数。
      // 复用自 current 的文件不在这里过(它们在自己那一版 put 时核过,复制条件又要求 sha256 相等)。
      if (row.sha256 !== fx.sha256) throw new ConflictError(`${f.path}:内容的 sha256 与 manifest 声明的不一致`);
      if (row.bytes !== fx.bytes) throw new ConflictError(`${f.path}:内容的字节数(${fx.bytes})与 manifest 声明的(${row.bytes})不一致`);
      if (row.lines !== fx.lines) throw new ConflictError(`${f.path}:内容的行数(${fx.lines})与 manifest 声明的(${row.lines})不一致`);
      await tx.rawExec(
        `UPDATE source_files SET content = $3 WHERE sha = $1 AND path = $2`,
        sha,
        f.path,
        f.content,
      );
    }
    const pending = await tx.rawQueryRow<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM source_files WHERE sha = $1 AND content IS NULL`,
      sha,
    );
    return { sha, stored: files.length, pending: pending?.n ?? 0 };
  });
}

export interface CommitResult {
  sha: string;
  fileCount: number;
  totalBytes: number;
  /** epoch ms */
  publishedAt: number;
  /** 被换下的上一版 sha;首次发布或 unchanged 时为 null */
  replaced: string | null;
  /** 该 sha 本来就是 current,什么都没动 */
  unchanged: boolean;
}

/**
 * 翻 current。一个事务:核 manifest 每一项都有内容且行数与 file_count 相符 → 现 current 退为 staging →
 * 本 sha 置 current → 删除其余全部快照(只保留一份,所有者裁定)。任一不符整体回滚,current 不变。
 */
export async function commitSnapshot(sha: string): Promise<CommitResult> {
  return inTransaction(async (tx) => {
    await lockSource(tx);
    const snap = await tx.rawQueryRow<{ status: string; fileCount: number; totalBytes: number; publishedAt: number | null }>(
      `SELECT status, file_count AS "fileCount", total_bytes AS "totalBytes", ${ms("published_at", "publishedAt")}
         FROM source_snapshots WHERE sha = $1 FOR UPDATE`,
      sha,
    );
    if (!snap) throw new NotFoundError(`快照 ${sha.slice(0, 7)} 不存在,先 source_snapshot_begin`);
    if (snap.status === "current") {
      return { sha, fileCount: snap.fileCount, totalBytes: snap.totalBytes, publishedAt: snap.publishedAt ?? 0, replaced: null, unchanged: true };
    }
    const counts = await tx.rawQueryRow<{ total: number; missing: number; totalBytes: number }>(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE content IS NULL)::int AS missing,
              COALESCE(SUM(bytes), 0)::bigint AS "totalBytes"
         FROM source_files WHERE sha = $1`,
      sha,
    );
    if (!counts || counts.total !== snap.fileCount) {
      throw new ConflictError(`快照 ${sha.slice(0, 7)} 的文件行数(${counts?.total ?? 0})与 manifest(${snap.fileCount})不符,重新 begin`);
    }
    // 【总量从实际文件行重算】(codex 首轮 P2)begin 时记的 total_bytes 来自 manifest 声明;每个文件的 bytes 在 put 时已与内容核过,
    // 复用的那部分在它自己那一版核过 —— 汇总值就该从这些行来,而不是信 manifest 的加总
    const totalBytes = Number(counts.totalBytes);
    await tx.rawExec(`UPDATE source_snapshots SET total_bytes = $2 WHERE sha = $1`, sha, totalBytes);
    if (counts.missing > 0) {
      const sample = await tx.rawQueryAll<{ path: string }>(
        `SELECT path FROM source_files WHERE sha = $1 AND content IS NULL ORDER BY path COLLATE "C" LIMIT 10`,
        sha,
      );
      throw new ConflictError(
        `快照 ${sha.slice(0, 7)} 还有 ${counts.missing} 个文件没有内容,先 source_files_put:${sample.map((s) => s.path).join(", ")}${counts.missing > 10 ? " …" : ""}`,
      );
    }
    const prev = await tx.rawQueryRow<{ sha: string }>(
      `UPDATE source_snapshots SET status = 'staging' WHERE status = 'current' RETURNING sha`,
    );
    const done = await tx.rawQueryRow<{ publishedAt: number }>(
      `UPDATE source_snapshots SET status = 'current', published_at = now()
        WHERE sha = $1
        RETURNING ${ms("published_at", "publishedAt")}`,
      sha,
    );
    // 只保留一份:其余快照(刚退下的上一版 + 任何残留的 staging)连同文件一起删(ON DELETE CASCADE)
    await tx.rawExec(`DELETE FROM source_snapshots WHERE sha <> $1`, sha);
    return {
      sha,
      fileCount: snap.fileCount,
      totalBytes,
      publishedAt: done?.publishedAt ?? Date.now(),
      replaced: prev?.sha ?? null,
      unchanged: false,
    };
  });
}

export interface SnapshotListRow {
  sha: string;
  status: "staging" | "current";
  fileCount: number;
  totalBytes: number;
  /** 还缺内容的文件数(current 恒为 0) */
  pending: number;
  /** epoch ms */
  createdAt: number;
  /** epoch ms;staging 为 null */
  publishedAt: number | null;
}

export async function listSnapshots(): Promise<SnapshotListRow[]> {
  return db.rawQueryAll<SnapshotListRow>(
    `SELECT s.sha, s.status, s.file_count AS "fileCount", s.total_bytes AS "totalBytes",
            (SELECT COUNT(*)::int FROM source_files f WHERE f.sha = s.sha AND f.content IS NULL) AS pending,
            ${ms("s.created_at", "createdAt")}, ${ms("s.published_at", "publishedAt")}
       FROM source_snapshots s
      ORDER BY (s.status = 'current') DESC, s.created_at DESC`,
  );
}

/** 只删非 current(残留的 staging);删 current 拒 —— 站点上要换内容就发下一版。 */
export async function deleteSnapshot(sha: string): Promise<void> {
  return inTransaction(async (tx) => {
    await lockSource(tx);
    const snap = await tx.rawQueryRow<{ status: string }>(`SELECT status FROM source_snapshots WHERE sha = $1 FOR UPDATE`, sha);
    if (!snap) throw new NotFoundError(`快照 ${sha.slice(0, 7)} 不存在`);
    if (snap.status === "current") throw new ConflictError(`快照 ${sha.slice(0, 7)} 是 current,不能删;发布另一版会自动换掉它`);
    await tx.rawExec(`DELETE FROM source_snapshots WHERE sha = $1`, sha);
  });
}
