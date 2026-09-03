// Skills 技能库的**只读**读路径(R-SKILLS)。
//
// 写面在 mcp 服务的 `skills_*` 工具(全权角色、整包发布),读面在这里 ——
// 与 notes(读)/ mcp(写)、site(读)/ mcp(写)是同一个分工
// (`docs/security.md` §4「两个面互不触碰」)。本服务不建表、不加迁移、不写库。
// 时间戳统一以 epoch 毫秒进出,端点层转 ISO(与 notes/store.ts 一致)。
import type { SkillFileKind } from "../shared/skill-pack";
import { db } from "./db";

const ms = (col: string, alias: string) =>
  `(extract(epoch FROM ${col}) * 1000)::double precision AS "${alias}"`;

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

/**
 * 首页:分类 × skill 卡,含文件数。**没有 skill 的分类不出现**(JOIN 而不是 LEFT JOIN),
 * 与 Notes 首页的 listSeriesCards 同一口径 —— 画板 2f 上的分类都是有卡片的。
 */
export async function listSkillCards(): Promise<SkillCardRow[]> {
  return db.rawQueryAll<SkillCardRow>(
    `SELECT c.slug AS "categorySlug", c.name AS "categoryName", c.dot,
            s.name, s.summary, s.source_type AS "sourceType", s.repo, s.repo_url AS "repoUrl",
            (SELECT COUNT(*)::int FROM skill_files f WHERE f.skill_name = s.name) AS "fileCount",
            ${ms("s.updated_at", "updatedAt")}
       FROM skills_categories c
       JOIN skills s ON s.category_slug = c.slug
      ORDER BY c.sort_order, c.slug, s.sort_order, s.name`,
  );
}

export interface LatestSkillRow {
  name: string;
  /** epoch ms */
  updatedAt: number;
}

/** 页脚「最近更新:<name> · <relTime>」;没有 skill 时为 null */
export async function latestSkill(): Promise<LatestSkillRow | null> {
  return db.rawQueryRow<LatestSkillRow>(
    `SELECT name, ${ms("updated_at", "updatedAt")}
       FROM skills
      ORDER BY updated_at DESC, name
      LIMIT 1`,
  );
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

export async function getSkill(name: string): Promise<SkillRow | null> {
  return db.rawQueryRow<SkillRow>(
    `SELECT s.name, s.category_slug AS "categorySlug", c.name AS "categoryName",
            s.summary, s.source_type AS "sourceType", s.repo, s.repo_url AS "repoUrl",
            s.version, s.zip_size AS "zipSize", ${ms("s.updated_at", "updatedAt")}
       FROM skills s JOIN skills_categories c ON c.slug = s.category_slug
      WHERE s.name = $1`,
    name,
  );
}

export interface SkillFileRow {
  path: string;
  kind: SkillFileKind;
  content: string;
  sizeBytes: number;
  lineCount: number;
}

/** 详情页一次取回全部文件(整包 <= 512 KB,所以不做分文件懒加载);顺序 SKILL.md 首位 */
export async function listSkillFiles(name: string): Promise<SkillFileRow[]> {
  return db.rawQueryAll<SkillFileRow>(
    `SELECT path, kind, content, size_bytes AS "sizeBytes", line_count AS "lineCount"
       FROM skill_files
      WHERE skill_name = $1
      ORDER BY sort_order, path`,
    name,
  );
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
