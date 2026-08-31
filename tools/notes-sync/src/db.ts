// 写库口径:同一份「期望状态」既能直接 upsert 进目标库,也能落成一份可传输的 SQL。
//
// 幂等靠三件事(ROUNDS.md R5 验收 1「重跑不产生重复数据」):
//   1. 业务键 (series_slug, slug) 唯一,插入走 ON CONFLICT;
//   2. content_hash 覆盖正文 + 参与展示的全部元数据,一致就不写(报告里才能出「更新 0」);
//   3. 本轮没出现的章节按系列 DELETE —— vault 删了文件,站点跟着下线,不留幽灵页;
//      **系列与分类同理**:只删章节的话,manifest 里去掉或改名的系列会以一张空卡片
//      继续挂在首页上(改名还会新旧两张并存),因为 /notes/series 直接读 notes_series
//      (codex review 2026-08-31 第 2 轮 P2)。

import { Client } from "pg";
import type { CategorySpec } from "./manifest.ts";

export interface SeriesRow {
  slug: string;
  categorySlug: string;
  name: string;
  description: string;
  sortOrder: number;
}

export interface ChapterRow {
  seriesSlug: string;
  slug: string;
  ordinal: number;
  label: string;
  pinned: boolean;
  title: string;
  summary: string;
  contentMd: string;
  wordCount: number;
  sourceUrl: string | null;
  sourcePath: string;
  contentHash: string;
  publishedAt: string | null;
  updatedAt: string;
}

export interface Desired {
  categories: CategorySpec[];
  series: SeriesRow[];
  chapters: ChapterRow[];
}

export interface WriteReport {
  inserted: number;
  updated: number;
  deleted: number;
  unchanged: number;
  /** manifest 里已移除、本次一并下线的系列 / 分类 */
  seriesRemoved: number;
  categoriesRemoved: number;
}

// ───────────────────── 直连目标库 ─────────────────────

export async function applyToDatabase(dsn: string, desired: Desired): Promise<WriteReport> {
  const client = new Client({ connectionString: dsn });
  await client.connect();
  const report: WriteReport = {
    inserted: 0, updated: 0, deleted: 0, unchanged: 0,
    seriesRemoved: 0, categoriesRemoved: 0,
  };
  try {
    await client.query("BEGIN");

    for (const c of desired.categories) {
      await client.query(
        `INSERT INTO notes_categories (slug, name, dot, sort_order) VALUES ($1,$2,$3,$4)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, dot = EXCLUDED.dot, sort_order = EXCLUDED.sort_order`,
        [c.slug, c.name, c.dot, c.sortOrder],
      );
    }

    for (const s of desired.series) {
      await client.query(
        `INSERT INTO notes_series (slug, category_slug, name, description, sort_order) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (slug) DO UPDATE SET category_slug = EXCLUDED.category_slug, name = EXCLUDED.name,
           description = EXCLUDED.description, sort_order = EXCLUDED.sort_order`,
        [s.slug, s.categorySlug, s.name, s.description, s.sortOrder],
      );
    }

    const existing = new Map<string, string>();
    const rows = await client.query<{ series_slug: string; slug: string; content_hash: string }>(
      "SELECT series_slug, slug, content_hash FROM notes_chapters",
    );
    for (const r of rows.rows) existing.set(`${r.series_slug}/${r.slug}`, r.content_hash);

    const seen = new Set<string>();
    for (const ch of desired.chapters) {
      const key = `${ch.seriesSlug}/${ch.slug}`;
      seen.add(key);
      const prev = existing.get(key);
      if (prev === ch.contentHash) {
        report.unchanged++;
        continue;
      }
      await client.query(
        `INSERT INTO notes_chapters
           (series_slug, slug, ordinal, label, pinned, title, summary, content_md, word_count,
            source_url, source_path, content_hash, published_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (series_slug, slug) DO UPDATE SET
           ordinal = EXCLUDED.ordinal, label = EXCLUDED.label, pinned = EXCLUDED.pinned,
           title = EXCLUDED.title, summary = EXCLUDED.summary, content_md = EXCLUDED.content_md,
           word_count = EXCLUDED.word_count, source_url = EXCLUDED.source_url,
           source_path = EXCLUDED.source_path, content_hash = EXCLUDED.content_hash,
           published_at = EXCLUDED.published_at, updated_at = EXCLUDED.updated_at`,
        [
          ch.seriesSlug, ch.slug, ch.ordinal, ch.label, ch.pinned, ch.title, ch.summary,
          ch.contentMd, ch.wordCount, ch.sourceUrl, ch.sourcePath, ch.contentHash,
          ch.publishedAt, ch.updatedAt,
        ],
      );
      if (prev === undefined) report.inserted++;
      else report.updated++;
    }

    for (const key of existing.keys()) {
      if (seen.has(key)) continue;
      const [seriesSlug, slug] = splitKey(key);
      await client.query("DELETE FROM notes_chapters WHERE series_slug = $1 AND slug = $2", [seriesSlug, slug]);
      report.deleted++;
    }

    // 章节删干净之后再收元数据(外键方向 chapters -> series -> categories)
    const goneSeries = await client.query(
      "DELETE FROM notes_series WHERE NOT (slug = ANY($1::text[]))",
      [desired.series.map((x) => x.slug)],
    );
    report.seriesRemoved = goneSeries.rowCount ?? 0;
    const goneCats = await client.query(
      "DELETE FROM notes_categories WHERE NOT (slug = ANY($1::text[]))",
      [desired.categories.map((c) => c.slug)],
    );
    report.categoriesRemoved = goneCats.rowCount ?? 0;

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
  return report;
}

/** key 里 series_slug 不含 `/`,按第一个斜杠切即可 */
function splitKey(key: string): [string, string] {
  const i = key.indexOf("/");
  return [key.slice(0, i), key.slice(i + 1)];
}

// ───────────────────── 产出可传输 SQL ─────────────────────

/**
 * 生成的 SQL 不读当前库状态,是一份**声明式的期望状态**:
 * 全量 upsert + 删除不在清单里的章节。因此对空库和已同步过的库执行结果一致,
 * 与 deploy/migrate.sh 一样落在单事务里,失败整体回滚。
 */
export function emitSql(desired: Desired): string {
  const out: string[] = [
    "-- 由 tools/notes-sync 生成,勿手改。对空库与已同步库执行结果一致(声明式全量)。",
    "BEGIN;",
  ];

  for (const c of desired.categories) {
    out.push(
      `INSERT INTO notes_categories (slug, name, dot, sort_order) VALUES (${lit(c.slug)}, ${lit(c.name)}, ${lit(c.dot)}, ${c.sortOrder})
 ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, dot = EXCLUDED.dot, sort_order = EXCLUDED.sort_order;`,
    );
  }
  for (const s of desired.series) {
    out.push(
      `INSERT INTO notes_series (slug, category_slug, name, description, sort_order) VALUES (${lit(s.slug)}, ${lit(s.categorySlug)}, ${lit(s.name)}, ${lit(s.description)}, ${s.sortOrder})
 ON CONFLICT (slug) DO UPDATE SET category_slug = EXCLUDED.category_slug, name = EXCLUDED.name, description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;`,
    );
  }
  for (const ch of desired.chapters) {
    out.push(
      `INSERT INTO notes_chapters (series_slug, slug, ordinal, label, pinned, title, summary, content_md, word_count, source_url, source_path, content_hash, published_at, updated_at)
 VALUES (${lit(ch.seriesSlug)}, ${lit(ch.slug)}, ${ch.ordinal}, ${lit(ch.label)}, ${ch.pinned}, ${lit(ch.title)}, ${lit(ch.summary)}, ${lit(ch.contentMd)}, ${ch.wordCount}, ${lit(ch.sourceUrl)}, ${lit(ch.sourcePath)}, ${lit(ch.contentHash)}, ${lit(ch.publishedAt)}, ${lit(ch.updatedAt)})
 ON CONFLICT (series_slug, slug) DO UPDATE SET ordinal = EXCLUDED.ordinal, label = EXCLUDED.label, pinned = EXCLUDED.pinned, title = EXCLUDED.title, summary = EXCLUDED.summary, content_md = EXCLUDED.content_md, word_count = EXCLUDED.word_count, source_url = EXCLUDED.source_url, source_path = EXCLUDED.source_path, content_hash = EXCLUDED.content_hash, published_at = EXCLUDED.published_at, updated_at = EXCLUDED.updated_at;`,
    );
  }

  const keys = desired.chapters.map((c) => `(${lit(c.seriesSlug)}, ${lit(c.slug)})`);
  out.push(
    keys.length > 0
      ? `DELETE FROM notes_chapters WHERE (series_slug, slug) NOT IN (${keys.join(", ")});`
      : "DELETE FROM notes_chapters;",
  );
  // 与 applyToDatabase 同口径:章节之后收元数据,否则被移除的系列会留一张空卡片
  out.push(
    `DELETE FROM notes_series WHERE slug NOT IN (${desired.series.map((x) => lit(x.slug)).join(", ")});`,
  );
  out.push(
    `DELETE FROM notes_categories WHERE slug NOT IN (${desired.categories.map((c) => lit(c.slug)).join(", ")});`,
  );
  out.push("COMMIT;", "");
  return out.join("\n");
}

/** Postgres 字面量;standard_conforming_strings 默认开启,反斜杠不需要转义 */
function lit(v: string | number | null): string {
  if (v === null) return "NULL";
  if (typeof v === "number") return String(v);
  if (v.includes("\0")) throw new Error("字面量含 NUL 字节,拒绝生成 SQL");
  return `'${v.replace(/'/g, "''")}'`;
}
