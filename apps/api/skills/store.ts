// Skills 技能库的**只读**读路径(R-SKILLS)。
//
// 写面在 mcp 服务的 `skills_*` 工具(全权角色、整包发布),读面在这里 ——
// 与 notes(读)/ mcp(写)、site(读)/ mcp(写)是同一个分工
// (`docs/security.md` §4「两个面互不触碰」)。本服务不建表、不加迁移、不写库。
// 时间戳统一以 epoch 毫秒进出,端点层转 ISO(与 notes/store.ts 一致)。
import type { Transaction } from "encore.dev/storage/sqldb";
import { safeErrorText } from "../shared/redact";
import type { SkillFileKind } from "../shared/skill-pack";
import { db } from "./db";

const ms = (col: string, alias: string) =>
  `(extract(epoch FROM ${col}) * 1000)::double precision AS "${alias}"`;

/**
 * 单快照只读事务。
 *
 * 【为什么读面要开事务】(codex 首轮 P2)详情页要两条查询(元信息 + 文件),首页也是两条(卡片 + 最近更新)。
 * READ COMMITTED 下每条语句各看各的快照:所有者恰好在两条之间发布了一版,响应就会把
 * 旧版的 `fileCount` / `zipSize` 与新版的文件列表拼在一起。`REPEATABLE READ` 让整个事务
 * 只看第一条查询那一刻的快照,而写面 `upsertSkill` 本就是一个事务(元信息 + 删旧文件 + 插新文件),
 * 于是读到的永远是某一个完整的已发布版本。`READ ONLY` 与 ro-db.ts 同一用意:挡住「读面自己写错 SQL」。
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
    await tx.rollback().catch((e) => console.error(`skills read tx rollback failed: ${safeErrorText(e)}`));
    throw err;
  }
}

export type SkillSourceType = "own" | "curated";

export interface SkillCardRow {
  categorySlug: string;
  categoryName: string;
  dot: string;
  name: string;
  summary: string;
  sourceType: SkillSourceType;
  repo: string;
  repoUrl: string | null;
  fileCount: number;
  /** epoch ms */
  updatedAt: number;
}

export interface LatestSkillRow {
  name: string;
  /** epoch ms */
  updatedAt: number;
}

export interface IndexSnapshot {
  cards: SkillCardRow[];
  /** 页脚「最近更新:<name> · <relTime>」;没有 skill 时为 null */
  latest: LatestSkillRow | null;
}

/**
 * 首页:分类 × skill 卡(含文件数)+ 最近更新,同一快照。
 * **没有 skill 的分类不出现**(JOIN 而不是 LEFT JOIN),与 Notes 首页的 listSeriesCards 同一口径 ——
 * 画板 2f 上的分类都是有卡片的。
 */
export async function indexSnapshot(): Promise<IndexSnapshot> {
  return readSnapshot(async (tx) => {
    const cards = await tx.rawQueryAll<SkillCardRow>(
      `SELECT c.slug AS "categorySlug", c.name AS "categoryName", c.dot,
              s.name, s.summary, s.source_type AS "sourceType", s.repo, s.repo_url AS "repoUrl",
              (SELECT COUNT(*)::int FROM skill_files f WHERE f.skill_name = s.name) AS "fileCount",
              ${ms("s.updated_at", "updatedAt")}
         FROM skills_categories c
         JOIN skills s ON s.category_slug = c.slug
        ORDER BY c.sort_order, c.slug, s.sort_order, s.name`,
    );
    const latest = await tx.rawQueryRow<LatestSkillRow>(
      `SELECT name, ${ms("updated_at", "updatedAt")}
         FROM skills
        ORDER BY updated_at DESC, name
        LIMIT 1`,
    );
    return { cards, latest };
  });
}

export interface SkillRow {
  name: string;
  categorySlug: string;
  categoryName: string;
  summary: string;
  sourceType: SkillSourceType;
  repo: string;
  repoUrl: string | null;
  version: string | null;
  zipSize: number;
  /** epoch ms */
  updatedAt: number;
}

export interface SkillFileRow {
  path: string;
  kind: SkillFileKind;
  content: string;
  sizeBytes: number;
  lineCount: number;
}

export interface SkillSnapshot {
  skill: SkillRow;
  /** 全部文件(整包 <= 512 KB,所以不做分文件懒加载);顺序 SKILL.md 首位 */
  files: SkillFileRow[];
}

/** 详情页:元信息 + 全部文件,同一快照(理由见 readSnapshot);不存在回 null */
export async function skillSnapshot(name: string): Promise<SkillSnapshot | null> {
  return readSnapshot(async (tx) => {
    const skill = await tx.rawQueryRow<SkillRow>(
      `SELECT s.name, s.category_slug AS "categorySlug", c.name AS "categoryName",
              s.summary, s.source_type AS "sourceType", s.repo, s.repo_url AS "repoUrl",
              s.version, s.zip_size AS "zipSize", ${ms("s.updated_at", "updatedAt")}
         FROM skills s JOIN skills_categories c ON c.slug = s.category_slug
        WHERE s.name = $1`,
      name,
    );
    if (!skill) return null;
    const files = await tx.rawQueryAll<SkillFileRow>(
      `SELECT path, kind, content, size_bytes AS "sizeBytes", line_count AS "lineCount"
         FROM skill_files
        WHERE skill_name = $1
        ORDER BY sort_order, path`,
      name,
    );
    return { skill, files };
  });
}

export interface ZipRow {
  bytes: Buffer;
  /** 内容哈希,读面拿它当强 ETag */
  etag: string;
}

/**
 * zip 字节。写面在入库时打好(mcp),这里只读。
 * `bytea` 在驱动侧回的是 Buffer/Uint8Array;统一归一成 Buffer(与 notes/store.ts 的 getAsset 同一处理)。
 */
export async function getZip(name: string): Promise<ZipRow | null> {
  const row = await db.rawQueryRow<{ zip: Uint8Array; etag: string }>(
    `SELECT zip, content_hash AS etag FROM skills WHERE name = $1`,
    name,
  );
  if (!row) return null;
  return { etag: row.etag, bytes: Buffer.isBuffer(row.zip) ? row.zip : Buffer.from(row.zip) };
}
