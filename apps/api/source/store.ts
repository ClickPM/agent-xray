// Source 源码快照的**只读**读路径(R-SOURCE)。
//
// 写面在 mcp 服务的 `source_*` 工具(全权角色、三段式发布),读面在这里 ——
// 与 skills(读)/ mcp(写)是同一个分工(`docs/security.md` §4「两个面互不触碰」)。
// 本服务不建表、不打包、不写库;只查 `status = 'current'` 那一份。
// 时间戳统一以 epoch 毫秒进出,端点层转 ISO(与 skills/store.ts 一致)。
import type { Transaction } from "encore.dev/storage/sqldb";
import { safeErrorText } from "../shared/redact";
import type { SourceFileKind } from "../shared/source-pack";
import { db } from "./db";

const ms = (col: string, alias: string) =>
  `(extract(epoch FROM ${col}) * 1000)::double precision AS "${alias}"`;

/**
 * 单快照只读事务(与 skills/store.ts 的 readSnapshot 同一理由):目录页要两条查询(快照行 + 文件表),
 * 文件页也是两条(快照行 + 那一个文件)。READ COMMITTED 下每条语句各看各的快照,所有者恰好在两条之间
 * commit 了新版,响应就会把旧版的 sha 配上新版的文件。`REPEATABLE READ` 让整个事务只看第一条查询那一刻,
 * 而写面的 commit 本就是一个事务,于是读到的永远是某一个完整的已发布版本。
 * `SET TRANSACTION` 必须是事务里的第一条语句(Postgres 的硬性要求)。
 */
async function readSnapshot<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  const tx = await db.begin();
  try {
    await tx.rawExec("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    const out = await fn(tx);
    await tx.commit();
    return out;
  } catch (err) {
    // 回滚失败不能盖掉原始错误;原始错误才是调用方要看的那个
    await tx.rollback().catch((e) => console.error(`source read tx rollback failed: ${safeErrorText(e)}`));
    throw err;
  }
}

export interface SnapshotRow {
  sha: string;
  fileCount: number;
  totalBytes: number;
  /** epoch ms */
  publishedAt: number;
}

export interface SourceFileMetaRow {
  path: string;
  kind: SourceFileKind;
  bytes: number;
  lines: number;
}

export interface SourceFileRow extends SourceFileMetaRow {
  content: string;
}

async function currentRow(tx: Transaction): Promise<SnapshotRow | null> {
  // total_bytes 是 BIGINT(int8):驱动可能以 bigint / 字符串交回,进不了 JSON 也不合生成客户端的 number 契约(codex 第 2 轮 P1)。
  // 与时间戳同一做法:SQL 侧就 cast 成 double precision(3 MB 量级离 2^53 远得很)
  return tx.rawQueryRow<SnapshotRow>(
    `SELECT sha, file_count AS "fileCount", total_bytes::double precision AS "totalBytes", ${ms("published_at", "publishedAt")}
       FROM source_snapshots
      WHERE status = 'current'`,
  );
}

export interface IndexSnapshot {
  snapshot: SnapshotRow;
  /** 全部文件的元信息(不含内容),按路径码点序;前端由它长出目录树 */
  files: SourceFileMetaRow[];
}

/** 目录页:current 快照 + 全部文件元信息,同一快照;没有 current 回 null */
export async function indexSnapshot(): Promise<IndexSnapshot | null> {
  return readSnapshot(async (tx) => {
    const snapshot = await currentRow(tx);
    if (!snapshot) return null;
    const files = await tx.rawQueryAll<SourceFileMetaRow>(
      // COLLATE "C":码点序,与前端目录树(buildSourceTree 的 `<`)和发布脚本同一口径;库默认 collation 会把大小写混排
      `SELECT path, kind, bytes, lines
         FROM source_files
        WHERE sha = $1
        ORDER BY path COLLATE "C"`,
      snapshot.sha,
    );
    return { snapshot, files };
  });
}

export interface FileSnapshot {
  snapshot: SnapshotRow;
  file: SourceFileRow;
  /** 同一快照里的全部文件元信息(目录树);与 file 出自同一个 REPEATABLE READ 事务 */
  files: SourceFileMetaRow[];
}

/**
 * 文件页:current 快照 + 那一个文件(含内容)+ 全部文件元信息,**三者同一快照**;没有 current 或没有这个文件都回 null。
 *
 * 【为什么目录树也从这里出】(codex 首轮 P2)页面若分两次请求(文件 + 目录树),恰好夹着一次发布 commit 时,
 * 页头 / 正文是旧版而目录树是新版,树里甚至没有正在显示的文件。一次事务一次取完,整页才真的是「同一个 sha」。
 */
export async function fileSnapshot(path: string): Promise<FileSnapshot | null> {
  return readSnapshot(async (tx) => {
    const snapshot = await currentRow(tx);
    if (!snapshot) return null;
    const file = await tx.rawQueryRow<SourceFileRow>(
      `SELECT path, kind, bytes, lines, content
         FROM source_files
        WHERE sha = $1 AND path = $2 AND content IS NOT NULL`,
      snapshot.sha,
      path,
    );
    if (!file) return null;
    const files = await tx.rawQueryAll<SourceFileMetaRow>(
      `SELECT path, kind, bytes, lines
         FROM source_files
        WHERE sha = $1
        ORDER BY path COLLATE "C"`,
      snapshot.sha,
    );
    return { snapshot, file, files };
  });
}
