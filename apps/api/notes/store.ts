// notes 读路径。写路径不在服务里 —— 内容由 tools/notes-sync 从 vault 同步进来
// (所有者裁定 2026-08-31),这里只读。时间戳统一以 epoch 毫秒进出,端点层转 ISO。
import { db } from "./db";

/** `x -> epoch ms` 的统一写法,与 agent/store.ts 保持一致 */
const ms = (col: string, alias: string) =>
  `(extract(epoch FROM ${col}) * 1000)::double precision AS "${alias}"`;

export interface SeriesCardRow {
  categorySlug: string;
  categoryName: string;
  dot: string;
  slug: string;
  name: string;
  description: string;
  chapterCount: number;
  /** epoch ms;空系列为 null */
  updatedAt: number | null;
}

/** Notes 首页:四分类 × 系列卡,含章节数与最近更新时间 */
export async function listSeriesCards(): Promise<SeriesCardRow[]> {
  return db.rawQueryAll<SeriesCardRow>(
    `SELECT c.slug AS "categorySlug", c.name AS "categoryName", c.dot,
            s.slug, s.name, s.description,
            -- 置顶的 README 是"总览"不是"第 N 章":getSeries 的 chapterCount 排除它,
            -- 这里必须用同一口径,否则首页卡片会比系列页多显示一章
            -- (codex review 2026-08-31 P2)
            COUNT(ch.id) FILTER (WHERE NOT ch.pinned)::int AS "chapterCount",
            ${ms("MAX(ch.updated_at)", "updatedAt")}
       FROM notes_categories c
       JOIN notes_series s ON s.category_slug = c.slug
       LEFT JOIN notes_chapters ch ON ch.series_slug = s.slug
      GROUP BY c.slug, c.name, c.dot, c.sort_order, s.slug, s.name, s.description, s.sort_order
      ORDER BY c.sort_order, s.sort_order`,
  );
}

export interface LatestRow {
  title: string;
  seriesSlug: string;
  chapterSlug: string;
  /** epoch ms */
  updatedAt: number;
}

/** 首页底部「最新 · A · B · C」行 */
export async function listLatest(limit: number): Promise<LatestRow[]> {
  return db.rawQueryAll<LatestRow>(
    `SELECT title, series_slug AS "seriesSlug", slug AS "chapterSlug", ${ms("updated_at", "updatedAt")}
       FROM notes_chapters
      ORDER BY updated_at DESC, id DESC
      LIMIT $1`,
    limit,
  );
}

export interface SeriesRow {
  slug: string;
  name: string;
  description: string;
  categorySlug: string;
  categoryName: string;
}

export async function getSeries(slug: string): Promise<SeriesRow | null> {
  return db.rawQueryRow<SeriesRow>(
    `SELECT s.slug, s.name, s.description, c.slug AS "categorySlug", c.name AS "categoryName"
       FROM notes_series s JOIN notes_categories c ON c.slug = s.category_slug
      WHERE s.slug = $1`,
    slug,
  );
}

export interface ChapterListRow {
  slug: string;
  label: string;
  title: string;
  pinned: boolean;
  wordCount: number;
  /** epoch ms */
  updatedAt: number;
}

export async function listChapters(seriesSlug: string): Promise<ChapterListRow[]> {
  return db.rawQueryAll<ChapterListRow>(
    `SELECT slug, label, title, pinned, word_count AS "wordCount", ${ms("updated_at", "updatedAt")}
       FROM notes_chapters
      WHERE series_slug = $1
      ORDER BY ordinal, id`,
    seriesSlug,
  );
}

export interface ChapterRow {
  slug: string;
  label: string;
  title: string;
  summary: string;
  contentMd: string;
  wordCount: number;
  sourceUrl: string | null;
  ordinal: number;
  /** epoch ms;可能为 null */
  publishedAt: number | null;
  /** epoch ms */
  updatedAt: number;
}

export async function getChapter(seriesSlug: string, slug: string): Promise<ChapterRow | null> {
  return db.rawQueryRow<ChapterRow>(
    `SELECT slug, label, title, summary, content_md AS "contentMd", word_count AS "wordCount",
            source_url AS "sourceUrl", ordinal,
            ${ms("published_at", "publishedAt")}, ${ms("updated_at", "updatedAt")}
       FROM notes_chapters
      WHERE series_slug = $1 AND slug = $2`,
    seriesSlug,
    slug,
  );
}

export interface NeighborRow {
  slug: string;
  label: string;
  title: string;
}

/** 文章页底部上一章 / 下一章。`dir` 只接受 ±1,不拼进 SQL 以外的东西 */
export async function getNeighbor(
  seriesSlug: string,
  ordinal: number,
  dir: -1 | 1,
): Promise<NeighborRow | null> {
  const cmp = dir === 1 ? ">" : "<";
  const order = dir === 1 ? "ASC" : "DESC";
  return db.rawQueryRow<NeighborRow>(
    `SELECT slug, label, title FROM notes_chapters
      WHERE series_slug = $1 AND ordinal ${cmp} $2
      ORDER BY ordinal ${order}, id ${order}
      LIMIT 1`,
    seriesSlug,
    ordinal,
  );
}

export interface FeedRow {
  title: string;
  summary: string;
  seriesSlug: string;
  seriesName: string;
  chapterSlug: string;
  /** epoch ms */
  updatedAt: number;
}

/** RSS 条目;categorySlug 为空取全站 */
export async function listFeed(categorySlug: string | null, limit: number): Promise<FeedRow[]> {
  return db.rawQueryAll<FeedRow>(
    `SELECT ch.title, ch.summary, ch.series_slug AS "seriesSlug", s.name AS "seriesName",
            ch.slug AS "chapterSlug", ${ms("ch.updated_at", "updatedAt")}
       FROM notes_chapters ch
       JOIN notes_series s ON s.slug = ch.series_slug
      WHERE $1::text IS NULL OR s.category_slug = $1
      ORDER BY ch.updated_at DESC, ch.id DESC
      LIMIT $2`,
    categorySlug,
    limit,
  );
}

export interface CategoryRow {
  slug: string;
  name: string;
}

export async function getCategory(slug: string): Promise<CategoryRow | null> {
  return db.rawQueryRow<CategoryRow>("SELECT slug, name FROM notes_categories WHERE slug = $1", slug);
}
