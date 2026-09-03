// 管理面的库读写路径(R6)。MCP tools 只做参数校验与结果整形,SQL 全在这里。
//
// 三条贯穿全文件的约定:
//   1. JSONB 写入一律 `${JSON.stringify(x)}::text::jsonb`(CLAUDE.md 规则 4)。
//   2. 时间戳以 epoch 毫秒进出,tools 层转 ISO —— 与 agent/store.ts、notes/store.ts 一致。
//   3. **LLM 明文 key 不在本文件之外流动**:`listProviders` 只回掩码,
//      解密只发生在 `getDefaultProvider`(agent 侧用同一张表另有只读实现)。
import type { Transaction } from "encore.dev/storage/sqldb";
import { encryptSecret, maskSecret } from "../shared/crypto";
import { safeErrorText } from "../shared/redact";
import { siteDay, siteDayAgo } from "../shared/site-time";
// tab 的闭集与读面(apps/api/site/)共用同一份登记表;两个面不互相 import,故落在 shared/
import { SITE_TAB_KEYS, SITE_TABS, isSiteTabKey } from "../shared/site-tabs";
// skill 一包文件的判据与打包(R-SKILLS);读面(apps/api/skills/)只用它的 kind 闭集
import {
  buildSkillZip,
  SkillPackError,
  skillPackHash,
  validateSkillPack,
  type SkillFileInput,
  type SkillFileKind,
  type SkillPack,
} from "../shared/skill-pack";
import { chapterHash, countWords, sha256Hex } from "./content";
import { db } from "./db";

const ms = (col: string, alias: string) =>
  `(extract(epoch FROM ${col}) * 1000)::double precision AS "${alias}"`;

/**
 * 事务包装。
 *
 * 不用 `await using`:`Symbol.asyncDispose` 要 `lib` 里有 esnext.disposable,
 * 而 apps/api 的 tsconfig 只到 ES2022 —— 加 lib 是为一个语法糖动全局编译配置。
 * 显式 commit/rollback 也更直白:抛出即回滚,不留悬挂事务。
 */
async function inTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  const tx = await db.begin();
  try {
    const out = await fn(tx);
    await tx.commit();
    return out;
  } catch (err) {
    // 回滚失败不能盖掉原始错误:原始错误才是调用方需要看到的那个
    await tx.rollback().catch((e) => console.error(`tx rollback failed: ${safeErrorText(e)}`));
    throw err;
  }
}

/** 业务前置条件不满足(引用了不存在的系列等);tools 层据此回可读的错误。 */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

/** 违反业务约束(删一个还挂着章节的系列等)。 */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

// ───────────────────── 分类 ─────────────────────

export interface CategoryRow {
  slug: string;
  name: string;
  dot: string;
  sortOrder: number;
  seriesCount: number;
}

export async function listCategories(): Promise<CategoryRow[]> {
  return db.rawQueryAll<CategoryRow>(
    `SELECT c.slug, c.name, c.dot, c.sort_order AS "sortOrder",
            COUNT(s.slug)::int AS "seriesCount"
       FROM notes_categories c
       LEFT JOIN notes_series s ON s.category_slug = c.slug
      GROUP BY c.slug, c.name, c.dot, c.sort_order
      ORDER BY c.sort_order, c.slug`,
  );
}

export async function upsertCategory(input: {
  slug: string;
  name: string;
  dot: string;
  sortOrder: number;
}): Promise<void> {
  await db.rawExec(
    `INSERT INTO notes_categories (slug, name, dot, sort_order)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (slug) DO UPDATE
        SET name = EXCLUDED.name, dot = EXCLUDED.dot, sort_order = EXCLUDED.sort_order`,
    input.slug,
    input.name,
    input.dot,
    input.sortOrder,
  );
}

/**
 * 删分类。**不级联**:notes_series.category_slug 是 RESTRICT 外键,
 * 底下还有系列时库会拒。这里先查一次只是为了给出「还有 N 个系列」这种能行动的错误,
 * 而不是把外键异常原样抛给客户端。
 */
export async function deleteCategory(slug: string): Promise<void> {
  const row = await db.rawQueryRow<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM notes_series WHERE category_slug = $1`,
    slug,
  );
  if ((row?.n ?? 0) > 0) {
    throw new ConflictError(`分类 ${slug} 下还有 ${row!.n} 个系列,先移走或删除它们`);
  }
  const done = await db.rawQueryRow<{ slug: string }>(
    `DELETE FROM notes_categories WHERE slug = $1 RETURNING slug`,
    slug,
  );
  if (!done) throw new NotFoundError(`分类 ${slug} 不存在`);
}

// ───────────────────── 系列 ─────────────────────

export interface SeriesRow {
  slug: string;
  categorySlug: string;
  name: string;
  description: string;
  sortOrder: number;
  chapterCount: number;
  assetCount: number;
}

export async function listSeries(categorySlug?: string): Promise<SeriesRow[]> {
  return db.rawQueryAll<SeriesRow>(
    `SELECT s.slug, s.category_slug AS "categorySlug", s.name, s.description,
            s.sort_order AS "sortOrder",
            (SELECT COUNT(*)::int FROM notes_chapters ch WHERE ch.series_slug = s.slug) AS "chapterCount",
            (SELECT COUNT(*)::int FROM notes_assets a WHERE a.series_slug = s.slug) AS "assetCount"
       FROM notes_series s
      WHERE $1::text IS NULL OR s.category_slug = $1
      ORDER BY s.sort_order, s.slug`,
    categorySlug ?? null,
  );
}

export async function upsertSeries(input: {
  slug: string;
  categorySlug: string;
  name: string;
  description: string;
  sortOrder: number;
}): Promise<void> {
  const cat = await db.rawQueryRow<{ slug: string }>(
    `SELECT slug FROM notes_categories WHERE slug = $1`,
    input.categorySlug,
  );
  if (!cat) throw new NotFoundError(`分类 ${input.categorySlug} 不存在,先建分类`);
  await db.rawExec(
    `INSERT INTO notes_series (slug, category_slug, name, description, sort_order)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (slug) DO UPDATE
        SET category_slug = EXCLUDED.category_slug, name = EXCLUDED.name,
            description = EXCLUDED.description, sort_order = EXCLUDED.sort_order`,
    input.slug,
    input.categorySlug,
    input.name,
    input.description,
    input.sortOrder,
  );
}

/**
 * 删系列。章节与附件都是 ON DELETE CASCADE,会一起消失 —— 这是不可逆的,
 * 所以调用方必须显式传 `cascade: true`。默认拒绝,顺带把「还有多少东西会被删掉」
 * 报回去,免得一句 `notes_series_delete{slug}` 顺手带走 40 篇文章。
 */
export async function deleteSeries(slug: string, cascade: boolean): Promise<void> {
  const counts = await db.rawQueryRow<{ chapters: number; assets: number }>(
    `SELECT (SELECT COUNT(*)::int FROM notes_chapters WHERE series_slug = $1) AS chapters,
            (SELECT COUNT(*)::int FROM notes_assets   WHERE series_slug = $1) AS assets`,
    slug,
  );
  const chapters = counts?.chapters ?? 0;
  const assets = counts?.assets ?? 0;
  if (!cascade && (chapters > 0 || assets > 0)) {
    throw new ConflictError(
      `系列 ${slug} 下有 ${chapters} 章、${assets} 个附件;确认要一并删除请传 cascade=true`,
    );
  }
  const done = await db.rawQueryRow<{ slug: string }>(
    `DELETE FROM notes_series WHERE slug = $1 RETURNING slug`,
    slug,
  );
  if (!done) throw new NotFoundError(`系列 ${slug} 不存在`);
}

// ───────────────────── 章节 ─────────────────────

export interface ChapterMetaRow {
  seriesSlug: string;
  slug: string;
  ordinal: number;
  label: string;
  pinned: boolean;
  title: string;
  summary: string;
  wordCount: number;
  sourceUrl: string | null;
  /** epoch ms */
  publishedAt: number | null;
  /** epoch ms */
  updatedAt: number;
}

export async function listChapters(seriesSlug: string): Promise<ChapterMetaRow[]> {
  return db.rawQueryAll<ChapterMetaRow>(
    `SELECT series_slug AS "seriesSlug", slug, ordinal, label, pinned, title, summary,
            word_count AS "wordCount", source_url AS "sourceUrl",
            ${ms("published_at", "publishedAt")}, ${ms("updated_at", "updatedAt")}
       FROM notes_chapters
      WHERE series_slug = $1
      ORDER BY ordinal, id`,
    seriesSlug,
  );
}

export interface ChapterFullRow extends ChapterMetaRow {
  contentMd: string;
}

export async function getChapter(
  seriesSlug: string,
  slug: string,
): Promise<ChapterFullRow | null> {
  return db.rawQueryRow<ChapterFullRow>(
    `SELECT series_slug AS "seriesSlug", slug, ordinal, label, pinned, title, summary,
            content_md AS "contentMd", word_count AS "wordCount", source_url AS "sourceUrl",
            ${ms("published_at", "publishedAt")}, ${ms("updated_at", "updatedAt")}
       FROM notes_chapters
      WHERE series_slug = $1 AND slug = $2`,
    seriesSlug,
    slug,
  );
}

export interface UpsertChapterInput {
  seriesSlug: string;
  slug: string;
  ordinal: number;
  label: string;
  pinned: boolean;
  title: string;
  summary: string;
  /** 标准 markdown;server 只校验不改写(ROUNDS.md R6) */
  contentMd: string;
  sourceUrl: string | null;
  /** ISO 8601 或 null */
  publishedAt: string | null;
}

export interface UpsertChapterResult {
  created: boolean;
  /** 内容与既有行完全一致 → 没有碰 updated_at */
  unchanged: boolean;
  wordCount: number;
}

/**
 * 章节 upsert。幂等口径:内容哈希与库内一致时**整行不动**(包括 updated_at)。
 *
 * 为什么这条很重要:`updated_at` 是 RSS 的排序键与 lastBuildDate 来源。
 * 没有它,一次「把全部文章重发一遍」的批量操作会让订阅源整体假装更新。
 * 判断放在 SQL 的 WHERE 里而不是先查后写:并发两次相同 upsert 之间没有窗口。
 */
export async function upsertChapter(input: UpsertChapterInput): Promise<UpsertChapterResult> {
  const series = await db.rawQueryRow<{ slug: string }>(
    `SELECT slug FROM notes_series WHERE slug = $1`,
    input.seriesSlug,
  );
  if (!series) throw new NotFoundError(`系列 ${input.seriesSlug} 不存在,先建系列`);

  const hash = chapterHash(input);
  const wordCount = countWords(input.contentMd);

  // `xmax = 0` 是 `INSERT … ON CONFLICT` 区分「插入」与「更新」的标准写法:
  // 新插入的行 xmax 为 0,被本事务更新过的行 xmax 是本事务的 xid。
  // 它只用来给所有者一句 created/updated 的回执;真正要紧的
  // 「内容未变则不动 updated_at」由下面的 WHERE 保证,与这个标记无关。
  const row = await db.rawQueryRow<{ action: string }>(
    `INSERT INTO notes_chapters
       (series_slug, slug, ordinal, label, pinned, title, summary, content_md,
        word_count, source_url, content_hash, published_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::timestamptz, now())
     ON CONFLICT (series_slug, slug) DO UPDATE
        SET ordinal = EXCLUDED.ordinal, label = EXCLUDED.label, pinned = EXCLUDED.pinned,
            title = EXCLUDED.title, summary = EXCLUDED.summary,
            content_md = EXCLUDED.content_md, word_count = EXCLUDED.word_count,
            source_url = EXCLUDED.source_url, content_hash = EXCLUDED.content_hash,
            published_at = EXCLUDED.published_at, updated_at = now()
      WHERE notes_chapters.content_hash IS DISTINCT FROM EXCLUDED.content_hash
     RETURNING CASE WHEN xmax = 0 THEN 'created' ELSE 'updated' END AS action`,
    input.seriesSlug,
    input.slug,
    input.ordinal,
    input.label,
    input.pinned,
    input.title,
    input.summary,
    input.contentMd,
    wordCount,
    input.sourceUrl,
    hash,
    input.publishedAt,
  );

  // WHERE 不满足 ⇒ ON CONFLICT 的 UPDATE 被跳过 ⇒ 没有 RETURNING 行 ⇒ 内容未变
  if (!row) return { created: false, unchanged: true, wordCount };
  return { created: row.action === "created", unchanged: false, wordCount };
}

export async function deleteChapter(seriesSlug: string, slug: string): Promise<void> {
  const done = await db.rawQueryRow<{ slug: string }>(
    `DELETE FROM notes_chapters WHERE series_slug = $1 AND slug = $2 RETURNING slug`,
    seriesSlug,
    slug,
  );
  if (!done) throw new NotFoundError(`章节 ${seriesSlug}/${slug} 不存在`);
}

// ───────────────────── 附件 ─────────────────────

export interface AssetMetaRow {
  seriesSlug: string;
  name: string;
  contentType: string;
  byteSize: number;
  etag: string;
  /** epoch ms */
  updatedAt: number;
}

export async function listAssets(seriesSlug?: string): Promise<AssetMetaRow[]> {
  return db.rawQueryAll<AssetMetaRow>(
    `SELECT series_slug AS "seriesSlug", name, content_type AS "contentType",
            byte_size AS "byteSize", etag, ${ms("updated_at", "updatedAt")}
       FROM notes_assets
      WHERE $1::text IS NULL OR series_slug = $1
      ORDER BY series_slug, name`,
    seriesSlug ?? null,
  );
}

export interface PutAssetResult {
  created: boolean;
  byteSize: number;
  etag: string;
  /** 对外可访问的地址(与 R5 存量口径一致,不带 /api 前缀) */
  url: string;
}

export async function putAsset(input: {
  seriesSlug: string;
  name: string;
  contentType: string;
  bytes: Buffer;
}): Promise<PutAssetResult> {
  const series = await db.rawQueryRow<{ slug: string }>(
    `SELECT slug FROM notes_series WHERE slug = $1`,
    input.seriesSlug,
  );
  if (!series) throw new NotFoundError(`系列 ${input.seriesSlug} 不存在,先建系列`);

  const etag = sha256Hex(input.bytes);
  const row = await db.rawQueryRow<{ action: string }>(
    `INSERT INTO notes_assets (series_slug, name, content_type, bytes, byte_size, etag, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (series_slug, name) DO UPDATE
        SET content_type = EXCLUDED.content_type, bytes = EXCLUDED.bytes,
            byte_size = EXCLUDED.byte_size, etag = EXCLUDED.etag, updated_at = now()
     RETURNING CASE WHEN xmax = 0 THEN 'created' ELSE 'updated' END AS action`,
    input.seriesSlug,
    input.name,
    input.contentType,
    input.bytes,
    input.bytes.length,
    etag,
  );
  return {
    created: row?.action === "created",
    byteSize: input.bytes.length,
    etag,
    url: `/notes/${input.seriesSlug}/${input.name}`,
  };
}

export async function deleteAsset(seriesSlug: string, name: string): Promise<void> {
  const done = await db.rawQueryRow<{ name: string }>(
    `DELETE FROM notes_assets WHERE series_slug = $1 AND name = $2 RETURNING name`,
    seriesSlug,
    name,
  );
  if (!done) throw new NotFoundError(`附件 ${seriesSlug}/${name} 不存在`);
}

// ───────────────────── About ─────────────────────

/** 画板 2e 的仓库卡;形状由 tools.ts 的 zod schema 把关,库里只存整块 JSONB。 */
export interface RepoCard {
  name: string;
  lang: string;
  dot: string;
  stars: number;
  desc: string;
  pushed: string;
}

/** 画板 2e 底部的语言构成条。 */
export interface LangSlice {
  name: string;
  pct: number;
  color: string;
}

export interface AboutRow {
  githubUser: string;
  originUrl: string;
  intro: string;
  buildPoints: string[];
  repos: RepoCard[];
  langBar: LangSlice[];
  /** epoch ms;从未设置过时为 null */
  updatedAt: number | null;
}

const EMPTY_ABOUT: AboutRow = {
  githubUser: "",
  originUrl: "",
  intro: "",
  buildPoints: [],
  repos: [],
  langBar: [],
  updatedAt: null,
};

/** JSONB 列在驱动侧已是 JS 值;非数组(手工改库改坏了)按空数组处理,不让页面炸。 */
function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export async function getAbout(): Promise<AboutRow> {
  const row = await db.rawQueryRow<AboutRow>(
    `SELECT github_user AS "githubUser", origin_url AS "originUrl", intro,
            build_points AS "buildPoints", repos, lang_bar AS "langBar",
            ${ms("updated_at", "updatedAt")}
       FROM about_content WHERE id`,
  );
  if (!row) return EMPTY_ABOUT;
  return {
    ...row,
    buildPoints: asArray<string>(row.buildPoints),
    repos: asArray<RepoCard>(row.repos),
    langBar: asArray<LangSlice>(row.langBar),
  };
}

/**
 * About 内容写入,**部分更新**:`undefined` 的字段保留库内原值。
 *
 * 【为什么从 R6 的「整体覆盖」改过来】(所有者裁定 2026-09-01,R8)
 * R8 把「公开仓库」与「语言构成」也收进这张表,字段从 4 个变成 6 个,其中两个
 * 是几十行的数组。若保持整体覆盖语义,那么「只想改一句 intro」就必须把 7 张
 * 仓库卡与整条语言构成原样重报一遍 —— 少报一个字段不会报错,只会把它清空。
 * 这是个只会静默丢数据的接口。改成部分更新之后,清空是**显式**动作
 * (传 `[]` / `""`),与 `llm_provider_upsert` 的口径一致。
 *
 * 单行表用 COALESCE 做部分更新:`$n::text::jsonb` 对 null 与非 null 是同一套
 * 语义(CLAUDE.md 规则 4)—— 写成裸 `::jsonb` 的话,COALESCE 里的 null 会变成
 * jsonb 'null' 而不是 SQL NULL,于是「省略字段」会把列写成 JSON null。
 */
export async function setAbout(input: {
  githubUser?: string;
  originUrl?: string;
  intro?: string;
  buildPoints?: string[];
  repos?: RepoCard[];
  langBar?: LangSlice[];
}): Promise<void> {
  const json = (v: unknown) => (v === undefined ? null : JSON.stringify(v));
  await db.rawExec(
    `INSERT INTO about_content (id, github_user, origin_url, intro, build_points, repos, lang_bar, updated_at)
     VALUES (TRUE,
             COALESCE($1, ''), COALESCE($2, ''), COALESCE($3, ''),
             COALESCE($4::text::jsonb, '[]'::jsonb),
             COALESCE($5::text::jsonb, '[]'::jsonb),
             COALESCE($6::text::jsonb, '[]'::jsonb),
             now())
     ON CONFLICT (id) DO UPDATE
        SET github_user  = COALESCE($1, about_content.github_user),
            origin_url   = COALESCE($2, about_content.origin_url),
            intro        = COALESCE($3, about_content.intro),
            build_points = COALESCE($4::text::jsonb, about_content.build_points),
            repos        = COALESCE($5::text::jsonb, about_content.repos),
            lang_bar     = COALESCE($6::text::jsonb, about_content.lang_bar),
            updated_at   = now()`,
    input.githubUser ?? null,
    input.originUrl ?? null,
    input.intro ?? null,
    json(input.buildPoints),
    json(input.repos),
    json(input.langBar),
  );
}

// ───────────────────── 访问统计(R8;表归 metrics 服务)─────────────────────
//
// 【为什么统计 SQL 在 mcp 而不是 metrics】`visits` 的 schema 与写入路径归 metrics
// 服务(agent/migrations/004_metrics.up.sql + metrics/store.ts),这里只读它。
// 与 trace 服务只读 agent 的 `trace_events` 是同一个先例:表的归属在一处,
// 读它的服务各自写自己的 store,不跨服务 import 内部实现;需要共用的原语
// (这里是「站点时区的今天」)下沉到 shared/。
//
// 【口径】`visits` 是 (day, path, visitor) 的计数行:
//   pv = SUM(hits);uv = COUNT(DISTINCT visitor)。
// visitor 的哈希输入里含日期(见 metrics/visitor.ts),所以**跨天的 visitor
// 不可比** —— 区间总量只能给「各日 UV 之和」,对外叫 visitorDays 而不是 UV,
// 免得那个数被读成「多少个人」。
//
// 【区间边界由 JS 给】不用 SQL 的 CURRENT_DATE:那取数据库会话的时区(容器默认
// UTC),而落库的 day 是站点时区(UTC+8)算的 —— 混用会让区间在跨日附近错开一天。

export interface DailyPoint {
  /** YYYY-MM-DD(站点时区) */
  day: string;
  pv: number;
  uv: number;
}

export interface TrafficOverview {
  from: string;
  to: string;
  pageviews: number;
  /** 各日 UV 之和,**不是**去重人数(见上方口径说明) */
  visitorDays: number;
  /** 只含有数据的日子;没有访问的那天不会出现在数组里 */
  daily: DailyPoint[];
}

export async function trafficOverview(days: number): Promise<TrafficOverview> {
  const from = siteDayAgo(days - 1);
  const daily = await db.rawQueryAll<DailyPoint>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day,
            SUM(hits)::int AS pv,
            COUNT(DISTINCT visitor)::int AS uv
       FROM visits
      WHERE day >= $1::date
      GROUP BY day
      ORDER BY day`,
    from,
  );
  return {
    from,
    to: siteDay(),
    pageviews: daily.reduce((a, d) => a + d.pv, 0),
    visitorDays: daily.reduce((a, d) => a + d.uv, 0),
    daily,
  };
}

export interface TrafficSlice {
  key: string;
  pv: number;
  visitorDays: number;
}

/** 路径分布。`/*` 是归一不出来的路径的常量桶(metrics/path.ts)。 */
export async function trafficPaths(days: number, limit: number): Promise<TrafficSlice[]> {
  return db.rawQueryAll<TrafficSlice>(
    `SELECT path AS key, SUM(hits)::int AS pv, COUNT(DISTINCT visitor)::int AS "visitorDays"
       FROM visits
      WHERE day >= $1::date
      GROUP BY path
      ORDER BY pv DESC, key
      LIMIT $2`,
    siteDayAgo(days - 1),
    limit,
  );
}

/** UA 摘要分布(`<浏览器族>/<平台族>`;原始 UA 从不落库)。 */
export async function trafficAgents(days: number): Promise<TrafficSlice[]> {
  return db.rawQueryAll<TrafficSlice>(
    `SELECT ua AS key, SUM(hits)::int AS pv, COUNT(DISTINCT visitor)::int AS "visitorDays"
       FROM visits
      WHERE day >= $1::date
      GROUP BY ua
      ORDER BY pv DESC, key`,
    siteDayAgo(days - 1),
  );
}

// ───────────────────── LLM provider ─────────────────────

export interface ProviderRow {
  provider: string;
  baseUrl: string | null;
  /** **掩码**,不是明文(docs/security.md §3) */
  apiKeyHint: string;
  modelId: string;
  hasCustomModels: boolean;
  isDefault: boolean;
  dailyTokenLimit: number;
  dailyCostLimitCents: number;
  maxTurnsPerSession: number;
  /** epoch ms */
  updatedAt: number;
}

/** 只回掩码。明文 key 在本模块之外没有任何读路径。 */
export async function listProviders(): Promise<ProviderRow[]> {
  return db.rawQueryAll<ProviderRow>(
    `SELECT provider, base_url AS "baseUrl", api_key_hint AS "apiKeyHint",
            model_id AS "modelId", (models IS NOT NULL) AS "hasCustomModels",
            is_default AS "isDefault",
            daily_token_limit AS "dailyTokenLimit",
            daily_cost_limit_cents AS "dailyCostLimitCents",
            max_turns_per_session AS "maxTurnsPerSession",
            ${ms("updated_at", "updatedAt")}
       FROM llm_config
      ORDER BY is_default DESC, provider`,
  );
}

/**
 * provider 的部分更新输入。
 *
 * **口径统一为「省略即保留」**:`undefined` = 不动这一列,`null`(仅 baseUrl / models)
 * = 显式清空。`apiKey` 本来就只能是这个语义(key 读不回来,改别的字段时无从重报),
 * 让其余字段跟着走是为了避免一种很难发现的丢数据:早先其余字段带 zod 默认值,
 * 于是「只想改个 baseUrl」的一次调用会把限额一起清零,而回执看起来一切正常。
 */
export interface UpsertProviderInput {
  provider: string;
  apiKey?: string;
  baseUrl?: string | null;
  modelId?: string;
  models?: unknown[] | null;
  makeDefault: boolean;
  dailyTokenLimit?: number;
  dailyCostLimitCents?: number;
  maxTurnsPerSession?: number;
}

/**
 * provider upsert。整段在一个事务里 —— `makeDefault` 要先把别人的 is_default 清掉,
 * 与本行的写入之间不能有别的连接插进来:部分唯一索引会让并发的第二个写直接失败,
 * 那对调用方是一个无从解释的约束冲突。
 *
 * `encryptionKeyB64` 由 tools 层从 secret 取好传入(CLAUDE.md 规则 5)。
 */
/**
 * `llm_config` 的「唯一默认」相关读改写的串行闸。
 *
 * 【为什么事务本身不够】(codex 复审 P2)两个并发的 `makeDefault=true` 在
 * READ COMMITTED 下各自看到对方提交前的快照:双双把旧默认清掉、再各自置位,
 * 后提交的那个撞上 `idx_llm_config_single_default` 报约束冲突 —— 对调用方是一句
 * 无从解释的 internal error。而 MCP 客户端是可以并发发 tool call 的。
 *
 * 【为什么不是 `SELECT … FOR UPDATE`】(codex 第 3 轮 P2)行锁在**空表**上锁不住
 * 任何东西:两个「第一次配置 provider」的并发调用会双双通过,然后同样撞唯一索引。
 * 事务级 advisory lock 与表里有没有行无关,一条语句覆盖两种情形,
 * 且随事务结束自动释放(不需要显式解锁,回滚也不会漏)。
 */
const LLM_CONFIG_LOCK = 0x6c6c6d31; // 'llm1',本库内唯一即可
async function lockProviders(tx: Transaction): Promise<void> {
  await tx.rawExec(`SELECT pg_advisory_xact_lock($1)`, LLM_CONFIG_LOCK);
}

export async function upsertProvider(
  input: UpsertProviderInput,
  encryptionKeyB64: string,
): Promise<{ created: boolean; apiKeyHint: string; isDefault: boolean }> {
  return inTransaction(async (tx) => {
    await lockProviders(tx);
    const existing = await tx.rawQueryRow<{ provider: string; apiKeyHint: string }>(
      `SELECT provider, api_key_hint AS "apiKeyHint" FROM llm_config WHERE provider = $1`,
      input.provider,
    );
    // 建行时没有「保留原值」可言:两个没有合理默认的列必须给出
    if (!existing) {
      if (input.apiKey === undefined) {
        throw new NotFoundError(`provider ${input.provider} 尚未配置,首次写入必须提供 apiKey`);
      }
      if (input.modelId === undefined) {
        throw new NotFoundError(`provider ${input.provider} 尚未配置,首次写入必须提供 modelId`);
      }
    }

    if (input.makeDefault) {
      await tx.rawExec(
        `UPDATE llm_config SET is_default = FALSE, updated_at = now()
          WHERE is_default AND provider <> $1`,
        input.provider,
      );
    }

    const hint = input.apiKey === undefined ? existing!.apiKeyHint : maskSecret(input.apiKey);

    if (existing) {
      // 部分更新:只把**本次给出的**字段拼进 SET。列名来自下面这张固定表,
      // 值全部走占位符 —— 动态的只有「哪几列参与」,没有任何拼接进来的外部文本。
      const sets: string[] = [];
      const params: (string | number | boolean | Buffer | null)[] = [input.provider];
      const set = (col: string, value: string | number | boolean | Buffer | null) => {
        params.push(value);
        sets.push(`${col} = $${params.length}`);
      };
      if (input.apiKey !== undefined) {
        set("api_key_enc", encryptSecret(encryptionKeyB64, input.apiKey));
        set("api_key_hint", hint);
      }
      if (input.baseUrl !== undefined) set("base_url", input.baseUrl);
      if (input.modelId !== undefined) set("model_id", input.modelId);
      if (input.models !== undefined) {
        params.push(input.models === null ? null : JSON.stringify(input.models));
        sets.push(`models = $${params.length}::text::jsonb`);
      }
      if (input.dailyTokenLimit !== undefined) set("daily_token_limit", input.dailyTokenLimit);
      if (input.dailyCostLimitCents !== undefined) {
        set("daily_cost_limit_cents", input.dailyCostLimitCents);
      }
      if (input.maxTurnsPerSession !== undefined) {
        set("max_turns_per_session", input.maxTurnsPerSession);
      }
      if (input.makeDefault) sets.push("is_default = TRUE");
      sets.push("updated_at = now()");
      await tx.rawExec(`UPDATE llm_config SET ${sets.join(", ")} WHERE provider = $1`, ...params);
    } else {
      await tx.rawExec(
        `INSERT INTO llm_config
           (provider, base_url, api_key_enc, api_key_hint, model_id, models, is_default,
            daily_token_limit, daily_cost_limit_cents, max_turns_per_session, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::text::jsonb, $7, $8, $9, $10, now())`,
        input.provider,
        input.baseUrl ?? null,
        encryptSecret(encryptionKeyB64, input.apiKey!),
        hint,
        input.modelId!,
        input.models == null ? null : JSON.stringify(input.models),
        input.makeDefault,
        input.dailyTokenLimit ?? 0,
        input.dailyCostLimitCents ?? 0,
        input.maxTurnsPerSession ?? 0,
      );
    }

    // 第一个配好的 provider 自动成为默认:否则「配了 key 却还是不能对话」
    // 会是个只有读过这段代码才知道原因的坑。写成一条语句是为了让它与上面的写入
    // 处在同一个事务里,不给并发留出「两行都以为自己该当默认」的窗口。
    await tx.rawExec(
      `UPDATE llm_config SET is_default = TRUE, updated_at = now()
        WHERE provider = $1 AND NOT EXISTS (SELECT 1 FROM llm_config WHERE is_default)`,
      input.provider,
    );

    const after = await tx.rawQueryRow<{ isDefault: boolean }>(
      `SELECT is_default AS "isDefault" FROM llm_config WHERE provider = $1`,
      input.provider,
    );
    return { created: !existing, apiKeyHint: hint, isDefault: after?.isDefault ?? false };
  });
}

export async function setDefaultProvider(provider: string): Promise<void> {
  await inTransaction(async (tx) => {
    await lockProviders(tx);
    const exists = await tx.rawQueryRow<{ provider: string }>(
      `SELECT provider FROM llm_config WHERE provider = $1`,
      provider,
    );
    if (!exists) throw new NotFoundError(`provider ${provider} 未配置`);
    await tx.rawExec(
      `UPDATE llm_config SET is_default = FALSE WHERE is_default AND provider <> $1`,
      provider,
    );
    await tx.rawExec(
      `UPDATE llm_config SET is_default = TRUE, updated_at = now() WHERE provider = $1`,
      provider,
    );
  });
}

/**
 * 删 provider。删掉的若是默认 provider,站点就**没有可用模型**了 —— 不在这里拦
 * (拦了就没法删最后一个),而是把「删完还有没有默认」如实回给调用方,
 * 由 tools 层在回执里明说。
 */
export async function deleteProvider(provider: string): Promise<{ defaultRemains: boolean }> {
  return inTransaction(async (tx) => {
    // 删除也必须进同一把闸(codex 第 4 轮 P2):advisory lock 与 `FOR UPDATE` 不同,
    // 它不会顺带保护既有行不被别的事务 DELETE。不加的话,一次并发删除可以插在
    // upsert 的「读 existing」与「UPDATE」之间,让那次 UPDATE 影响 0 行,
    // 而 MCP 那边照样回成功。
    await lockProviders(tx);
    const done = await tx.rawQueryRow<{ provider: string }>(
      `DELETE FROM llm_config WHERE provider = $1 RETURNING provider`,
      provider,
    );
    if (!done) throw new NotFoundError(`provider ${provider} 未配置`);
    const left = await tx.rawQueryRow<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM llm_config WHERE is_default`,
    );
    return { defaultRemains: (left?.n ?? 0) > 0 };
  });
}

// ───────────────────── websearch provider(R-WEBSEARCH)─────────────────────
//
// 与上面的 LLM provider 同构:同一把 `ConfigEncryptionKey`、同一个掩码口径、
// 同一套「省略即保留」的部分更新、同一种 advisory lock 串行化。
// **刻意没有合表**——理由写在迁移 008 里(列集合只是碰巧相似;合表会把
// 「唯一默认」的部分唯一索引变成「每个 kind 唯一默认」,那是最容易写错的地方)。

export interface WebSearchProviderRow {
  provider: string;
  baseUrl: string;
  /** **掩码**,不是明文(docs/security.md §3) */
  apiKeyHint: string;
  modelId: string;
  toolType: string;
  totalTimeoutMs: number;
  idleTimeoutMs: number;
  dailySearchLimit: number;
  isDefault: boolean;
  /** epoch ms */
  updatedAt: number;
}

/** 只回掩码。明文 key 在本模块之外没有任何读路径。 */
export async function listWebSearchProviders(): Promise<WebSearchProviderRow[]> {
  return db.rawQueryAll<WebSearchProviderRow>(
    `SELECT provider, base_url AS "baseUrl", api_key_hint AS "apiKeyHint",
            model_id AS "modelId", tool_type AS "toolType",
            total_timeout_ms::double precision   AS "totalTimeoutMs",
            idle_timeout_ms::double precision    AS "idleTimeoutMs",
            daily_search_limit::double precision AS "dailySearchLimit",
            is_default AS "isDefault",
            ${ms("updated_at", "updatedAt")}
       FROM websearch_config
      ORDER BY is_default DESC, provider`,
  );
}

export interface UpsertWebSearchProviderInput {
  provider: string;
  apiKey?: string;
  /** 已在 tools 层过 `checkBaseUrl`;这里不再重复校验(判据只有一份) */
  baseUrl?: string;
  modelId?: string;
  toolType?: string;
  totalTimeoutMs?: number;
  idleTimeoutMs?: number;
  dailySearchLimit?: number;
  makeDefault: boolean;
}

/**
 * 两个超时的列默认值。**必须与迁移 008 的 `DEFAULT` 一字不差** ——
 * 它们在这里只为一件事:算出「这次 upsert 之后生效的值是多少」,好在写入前
 * 判掉 `idle > total`(见 `upsertWebSearchProvider`)。
 *
 * 重复一份常量是有代价的,所以这条一致性由测试钉住,而不是靠注释提醒
 * (`mcp.test.ts` 从 `information_schema.columns` 读列默认值比对)。
 */
export const DEFAULT_TOTAL_TIMEOUT_MS = 180_000;
export const DEFAULT_IDLE_TIMEOUT_MS = 45_000;

/** 与 `LLM_CONFIG_LOCK` 同款、不同键:两张表的「唯一默认」互不相干,别共用一把锁。 */
const WEBSEARCH_CONFIG_LOCK = 0x77736331; // 'wsc1'
async function lockWebSearchProviders(tx: Transaction): Promise<void> {
  await tx.rawExec(`SELECT pg_advisory_xact_lock($1)`, WEBSEARCH_CONFIG_LOCK);
}

export async function upsertWebSearchProvider(
  input: UpsertWebSearchProviderInput,
  encryptionKeyB64: string,
): Promise<{ created: boolean; apiKeyHint: string; isDefault: boolean }> {
  return inTransaction(async (tx) => {
    await lockWebSearchProviders(tx);
    const existing = await tx.rawQueryRow<{
      provider: string;
      apiKeyHint: string;
      totalTimeoutMs: number;
      idleTimeoutMs: number;
    }>(
      `SELECT provider, api_key_hint AS "apiKeyHint",
              total_timeout_ms::double precision AS "totalTimeoutMs",
              idle_timeout_ms::double precision  AS "idleTimeoutMs"
         FROM websearch_config WHERE provider = $1`,
      input.provider,
    );
    // 建行时没有「保留原值」可言。**baseUrl 也在必给之列**(与 llm_config 的差别):
    // 那边省略 base_url 会回落到 pi 内置 provider 的默认端点,这边没有内置端点。
    if (!existing) {
      for (const [field, value] of [
        ["apiKey", input.apiKey],
        ["baseUrl", input.baseUrl],
        ["modelId", input.modelId],
      ] as const) {
        if (value === undefined) {
          throw new NotFoundError(
            `websearch provider ${input.provider} 尚未配置,首次写入必须提供 ${field}`,
          );
        }
      }
    }

    // 【跨字段约束在这里判,不留给库的 CHECK】库那条 CHECK 是最后一道闸,但它撞上来
    // 只会变成一句「操作失败,详见服务端日志」(见 tools.ts 的 `write`)——
    // 而这是一个所有者**改一个数就能自己解决**的输入错误,应当直接说清楚。
    // 生效值 = 本次给的 ?? 库里的 ?? 列默认值(默认值的唯一真相在迁移 008)。
    const effTotal = input.totalTimeoutMs ?? existing?.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
    const effIdle = input.idleTimeoutMs ?? existing?.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    if (effIdle > effTotal) {
      throw new ConflictError(
        `idleTimeoutMs(${effIdle})不能大于 totalTimeoutMs(${effTotal});` +
          "空闲上限大于总上限时空闲计时器永远不会先触发",
      );
    }

    if (input.makeDefault) {
      await tx.rawExec(
        `UPDATE websearch_config SET is_default = FALSE, updated_at = now()
          WHERE is_default AND provider <> $1`,
        input.provider,
      );
    }

    const hint = input.apiKey === undefined ? existing!.apiKeyHint : maskSecret(input.apiKey);

    if (existing) {
      const sets: string[] = [];
      const params: (string | number | boolean | Buffer | null)[] = [input.provider];
      const set = (col: string, value: string | number | boolean | Buffer | null) => {
        params.push(value);
        sets.push(`${col} = $${params.length}`);
      };
      if (input.apiKey !== undefined) {
        set("api_key_enc", encryptSecret(encryptionKeyB64, input.apiKey));
        set("api_key_hint", hint);
      }
      if (input.baseUrl !== undefined) set("base_url", input.baseUrl);
      if (input.modelId !== undefined) set("model_id", input.modelId);
      if (input.toolType !== undefined) set("tool_type", input.toolType);
      if (input.totalTimeoutMs !== undefined) set("total_timeout_ms", input.totalTimeoutMs);
      if (input.idleTimeoutMs !== undefined) set("idle_timeout_ms", input.idleTimeoutMs);
      if (input.dailySearchLimit !== undefined) set("daily_search_limit", input.dailySearchLimit);
      if (input.makeDefault) sets.push("is_default = TRUE");
      sets.push("updated_at = now()");
      await tx.rawExec(
        `UPDATE websearch_config SET ${sets.join(", ")} WHERE provider = $1`,
        ...params,
      );
    } else {
      // 三个可选参数省略时交给列默认值(180s / 45s / 不限),不在这里复述数字:
      // 默认值只该有一处真相,而那处是迁移 008。
      const cols = ["provider", "base_url", "api_key_enc", "api_key_hint", "model_id", "is_default"];
      const vals: (string | number | boolean | Buffer)[] = [
        input.provider,
        input.baseUrl!,
        encryptSecret(encryptionKeyB64, input.apiKey!),
        hint,
        input.modelId!,
        input.makeDefault,
      ];
      const optional: Array<[string, number | string | undefined]> = [
        ["tool_type", input.toolType],
        ["total_timeout_ms", input.totalTimeoutMs],
        ["idle_timeout_ms", input.idleTimeoutMs],
        ["daily_search_limit", input.dailySearchLimit],
      ];
      for (const [col, value] of optional) {
        if (value === undefined) continue;
        cols.push(col);
        vals.push(value);
      }
      await tx.rawExec(
        `INSERT INTO websearch_config (${cols.join(", ")}, updated_at)
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}, now())`,
        ...vals,
      );
    }

    // 第一个配好的 provider 自动成为默认(与 llm_config 同款,同一个理由:
    // 「配了却还是不能用」会是个只有读过代码才知道原因的坑)
    await tx.rawExec(
      `UPDATE websearch_config SET is_default = TRUE, updated_at = now()
        WHERE provider = $1 AND NOT EXISTS (SELECT 1 FROM websearch_config WHERE is_default)`,
      input.provider,
    );

    const after = await tx.rawQueryRow<{ isDefault: boolean }>(
      `SELECT is_default AS "isDefault" FROM websearch_config WHERE provider = $1`,
      input.provider,
    );
    return { created: !existing, apiKeyHint: hint, isDefault: after?.isDefault ?? false };
  });
}

export async function setDefaultWebSearchProvider(provider: string): Promise<void> {
  await inTransaction(async (tx) => {
    await lockWebSearchProviders(tx);
    const exists = await tx.rawQueryRow<{ provider: string }>(
      `SELECT provider FROM websearch_config WHERE provider = $1`,
      provider,
    );
    if (!exists) throw new NotFoundError(`websearch provider ${provider} 未配置`);
    await tx.rawExec(
      `UPDATE websearch_config SET is_default = FALSE WHERE is_default AND provider <> $1`,
      provider,
    );
    await tx.rawExec(
      `UPDATE websearch_config SET is_default = TRUE, updated_at = now() WHERE provider = $1`,
      provider,
    );
  });
}

/**
 * 删 websearch provider。删掉默认的那个之后 `web_search` 工具**下一轮就不再注册**
 * (`loadEnabledTools` 读不到配置就丢弃),站点其余部分不受影响 ——
 * 与删 LLM provider 会让整站不能对话不是一回事,所以这里不需要那种警告。
 */
export async function deleteWebSearchProvider(
  provider: string,
): Promise<{ defaultRemains: boolean }> {
  return inTransaction(async (tx) => {
    // 与 deleteProvider 同款:advisory lock 不像 FOR UPDATE 那样保护既有行不被
    // 别的事务 DELETE,不加的话一次并发删除能插进 upsert 的「读 existing」与
    // 「UPDATE」之间,让那次 UPDATE 影响 0 行而 MCP 照样回成功。
    await lockWebSearchProviders(tx);
    const done = await tx.rawQueryRow<{ provider: string }>(
      `DELETE FROM websearch_config WHERE provider = $1 RETURNING provider`,
      provider,
    );
    if (!done) throw new NotFoundError(`websearch provider ${provider} 未配置`);
    const left = await tx.rawQueryRow<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM websearch_config WHERE is_default`,
    );
    return { defaultRemains: (left?.n ?? 0) > 0 };
  });
}

// ───────────────────── imagegen provider(R-IMAGEGEN)─────────────────────
//
// 与 websearch provider 那组逐字同构:同一把 `ConfigEncryptionKey`、同一个掩码口径、
// 同一套「省略即保留」的部分更新、同一种 advisory lock 串行化、同样**不合表**
// (理由见迁移 008 / 010)。多出来的两个字段是协议形态 `api_style` 与尺寸 `image_size`。

export interface ImageGenProviderRow {
  provider: string;
  baseUrl: string;
  /** **掩码**,不是明文(docs/security.md §3) */
  apiKeyHint: string;
  modelId: string;
  apiStyle: "images" | "chat";
  imageSize: string | null;
  totalTimeoutMs: number;
  idleTimeoutMs: number;
  dailyImageLimit: number;
  isDefault: boolean;
  /** epoch ms */
  updatedAt: number;
}

/** 只回掩码。明文 key 在本模块之外没有任何读路径。 */
export async function listImageGenProviders(): Promise<ImageGenProviderRow[]> {
  return db.rawQueryAll<ImageGenProviderRow>(
    `SELECT provider, base_url AS "baseUrl", api_key_hint AS "apiKeyHint",
            model_id AS "modelId", api_style AS "apiStyle", image_size AS "imageSize",
            total_timeout_ms::double precision  AS "totalTimeoutMs",
            idle_timeout_ms::double precision   AS "idleTimeoutMs",
            daily_image_limit::double precision AS "dailyImageLimit",
            is_default AS "isDefault",
            ${ms("updated_at", "updatedAt")}
       FROM imagegen_config
      ORDER BY is_default DESC, provider`,
  );
}

export interface UpsertImageGenProviderInput {
  provider: string;
  apiKey?: string;
  /** 已在 tools 层过 `checkImageBaseUrl`;这里不再重复校验(判据只有一份) */
  baseUrl?: string;
  modelId?: string;
  apiStyle?: "images" | "chat";
  /** null = 清空(用上游默认) */
  imageSize?: string | null;
  totalTimeoutMs?: number;
  idleTimeoutMs?: number;
  dailyImageLimit?: number;
  makeDefault: boolean;
}

/**
 * 两个超时的列默认值。**必须与迁移 010 的 `DEFAULT` 一字不差**(mcp.test.ts 从
 * `information_schema.columns` 读列默认值比对),用途与 websearch 那两个常量相同。
 */
export const DEFAULT_IMAGE_TOTAL_TIMEOUT_MS = 180_000;
export const DEFAULT_IMAGE_IDLE_TIMEOUT_MS = 30_000;

/** 与前两把锁同款、不同键:三张表的「唯一默认」互不相干,别共用一把锁。 */
const IMAGEGEN_CONFIG_LOCK = 0x69676331; // 'igc1'
async function lockImageGenProviders(tx: Transaction): Promise<void> {
  await tx.rawExec(`SELECT pg_advisory_xact_lock($1)`, IMAGEGEN_CONFIG_LOCK);
}

export async function upsertImageGenProvider(
  input: UpsertImageGenProviderInput,
  encryptionKeyB64: string,
): Promise<{ created: boolean; apiKeyHint: string; isDefault: boolean }> {
  return inTransaction(async (tx) => {
    await lockImageGenProviders(tx);
    const existing = await tx.rawQueryRow<{
      provider: string;
      apiKeyHint: string;
      totalTimeoutMs: number;
      idleTimeoutMs: number;
    }>(
      `SELECT provider, api_key_hint AS "apiKeyHint",
              total_timeout_ms::double precision AS "totalTimeoutMs",
              idle_timeout_ms::double precision  AS "idleTimeoutMs"
         FROM imagegen_config WHERE provider = $1`,
      input.provider,
    );
    // 建行时没有「保留原值」可言:这张表没有内置端点可回落,三个字段必给
    if (!existing) {
      for (const [field, value] of [
        ["apiKey", input.apiKey],
        ["baseUrl", input.baseUrl],
        ["modelId", input.modelId],
      ] as const) {
        if (value === undefined) {
          throw new NotFoundError(
            `imagegen provider ${input.provider} 尚未配置,首次写入必须提供 ${field}`,
          );
        }
      }
    }

    // 跨字段约束在这里判,不留给库的 CHECK(理由同 websearch:给所有者一句能行动的话)
    const effTotal = input.totalTimeoutMs ?? existing?.totalTimeoutMs ?? DEFAULT_IMAGE_TOTAL_TIMEOUT_MS;
    const effIdle = input.idleTimeoutMs ?? existing?.idleTimeoutMs ?? DEFAULT_IMAGE_IDLE_TIMEOUT_MS;
    if (effIdle > effTotal) {
      throw new ConflictError(
        `idleTimeoutMs(${effIdle})不能大于 totalTimeoutMs(${effTotal});` +
          "空闲上限大于总上限时空闲计时器永远不会先触发",
      );
    }

    if (input.makeDefault) {
      await tx.rawExec(
        `UPDATE imagegen_config SET is_default = FALSE, updated_at = now()
          WHERE is_default AND provider <> $1`,
        input.provider,
      );
    }

    const hint = input.apiKey === undefined ? existing!.apiKeyHint : maskSecret(input.apiKey);

    if (existing) {
      const sets: string[] = [];
      const params: (string | number | boolean | Buffer | null)[] = [input.provider];
      const set = (col: string, value: string | number | boolean | Buffer | null) => {
        params.push(value);
        sets.push(`${col} = $${params.length}`);
      };
      if (input.apiKey !== undefined) {
        set("api_key_enc", encryptSecret(encryptionKeyB64, input.apiKey));
        set("api_key_hint", hint);
      }
      if (input.baseUrl !== undefined) set("base_url", input.baseUrl);
      if (input.modelId !== undefined) set("model_id", input.modelId);
      if (input.apiStyle !== undefined) set("api_style", input.apiStyle);
      if (input.imageSize !== undefined) set("image_size", input.imageSize);
      if (input.totalTimeoutMs !== undefined) set("total_timeout_ms", input.totalTimeoutMs);
      if (input.idleTimeoutMs !== undefined) set("idle_timeout_ms", input.idleTimeoutMs);
      if (input.dailyImageLimit !== undefined) set("daily_image_limit", input.dailyImageLimit);
      if (input.makeDefault) sets.push("is_default = TRUE");
      sets.push("updated_at = now()");
      await tx.rawExec(
        `UPDATE imagegen_config SET ${sets.join(", ")} WHERE provider = $1`,
        ...params,
      );
    } else {
      // 可选参数省略时交给列默认值(images / NULL / 180s / 30s / 不限),不在这里复述:
      // 默认值只该有一处真相,而那处是迁移 010。
      const cols = ["provider", "base_url", "api_key_enc", "api_key_hint", "model_id", "is_default"];
      const vals: (string | number | boolean | Buffer | null)[] = [
        input.provider,
        input.baseUrl!,
        encryptSecret(encryptionKeyB64, input.apiKey!),
        hint,
        input.modelId!,
        input.makeDefault,
      ];
      const optional: Array<[string, number | string | null | undefined]> = [
        ["api_style", input.apiStyle],
        ["image_size", input.imageSize],
        ["total_timeout_ms", input.totalTimeoutMs],
        ["idle_timeout_ms", input.idleTimeoutMs],
        ["daily_image_limit", input.dailyImageLimit],
      ];
      for (const [col, value] of optional) {
        if (value === undefined) continue;
        cols.push(col);
        vals.push(value);
      }
      await tx.rawExec(
        `INSERT INTO imagegen_config (${cols.join(", ")}, updated_at)
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}, now())`,
        ...vals,
      );
    }

    // 第一个配好的 provider 自动成为默认(与另两张表同款,同一个理由)
    await tx.rawExec(
      `UPDATE imagegen_config SET is_default = TRUE, updated_at = now()
        WHERE provider = $1 AND NOT EXISTS (SELECT 1 FROM imagegen_config WHERE is_default)`,
      input.provider,
    );

    const after = await tx.rawQueryRow<{ isDefault: boolean }>(
      `SELECT is_default AS "isDefault" FROM imagegen_config WHERE provider = $1`,
      input.provider,
    );
    return { created: !existing, apiKeyHint: hint, isDefault: after?.isDefault ?? false };
  });
}

export async function setDefaultImageGenProvider(provider: string): Promise<void> {
  await inTransaction(async (tx) => {
    await lockImageGenProviders(tx);
    const exists = await tx.rawQueryRow<{ provider: string }>(
      `SELECT provider FROM imagegen_config WHERE provider = $1`,
      provider,
    );
    if (!exists) throw new NotFoundError(`imagegen provider ${provider} 未配置`);
    await tx.rawExec(
      `UPDATE imagegen_config SET is_default = FALSE WHERE is_default AND provider <> $1`,
      provider,
    );
    await tx.rawExec(
      `UPDATE imagegen_config SET is_default = TRUE, updated_at = now() WHERE provider = $1`,
      provider,
    );
  });
}

/**
 * 删 imagegen provider。删掉默认的那个之后 `generate_image` 工具**下一轮就不再注册**
 * (`loadEnabledTools` 读不到配置就丢弃),站点其余部分不受影响;已生成的图片不受影响
 * (它们在 generated_images 里,与 provider 无关)。
 */
export async function deleteImageGenProvider(
  provider: string,
): Promise<{ defaultRemains: boolean }> {
  return inTransaction(async (tx) => {
    // 删除也必须进同一把闸(理由见 deleteProvider)
    await lockImageGenProviders(tx);
    const done = await tx.rawQueryRow<{ provider: string }>(
      `DELETE FROM imagegen_config WHERE provider = $1 RETURNING provider`,
      provider,
    );
    if (!done) throw new NotFoundError(`imagegen provider ${provider} 未配置`);
    const left = await tx.rawQueryRow<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM imagegen_config WHERE is_default`,
    );
    return { defaultRemains: (left?.n ?? 0) > 0 };
  });
}

// ───────────────────── 工具启停 ─────────────────────

export interface ToolConfigRow {
  name: string;
  enabled: boolean;
  dangerous: boolean;
  note: string;
  /** epoch ms */
  updatedAt: number;
}

export async function listToolConfig(): Promise<ToolConfigRow[]> {
  return db.rawQueryAll<ToolConfigRow>(
    `SELECT name, enabled, dangerous, note, ${ms("updated_at", "updatedAt")}
       FROM tool_config ORDER BY name`,
  );
}

/**
 * 工具启停。
 *
 * **不在这里判 `dangerous` 的第二道闸**:双闸的另一闸是服务器 env
 * `XRAY_UNLOCK_DANGEROUS_TOOLS`,它作用在 agent 侧的**注册**环节
 * (docs/security.md §1 第 1 层)。管理面把开关置为 true 是合法操作,
 * 但没有 env 时 agent 依然不会注册它 —— 两闸串联,不是二选一。
 */
export async function setToolConfig(input: {
  name: string;
  enabled: boolean;
  dangerous?: boolean;
  note?: string;
}): Promise<{ created: boolean }> {
  const row = await db.rawQueryRow<{ action: string }>(
    `INSERT INTO tool_config (name, enabled, dangerous, note, updated_at)
     VALUES ($1, $2, COALESCE($3::boolean, FALSE), COALESCE($4::text, ''), now())
     ON CONFLICT (name) DO UPDATE
        SET enabled = EXCLUDED.enabled,
            dangerous = COALESCE($3::boolean, tool_config.dangerous),
            note = COALESCE($4::text, tool_config.note),
            updated_at = now()
     RETURNING CASE WHEN xmax = 0 THEN 'created' ELSE 'updated' END AS action`,
    input.name,
    input.enabled,
    input.dangerous ?? null,
    input.note ?? null,
  );
  return { created: row?.action === "created" };
}

// ───────────────────── 顶部导航 tab 的呈现开关(R-TABS)─────────────────────

export interface SiteTabRow {
  key: string;
  /** 管理端可读的名字,来自 shared/site-tabs.ts 的登记表(不是库里的列) */
  label: string;
  /** 该 tab 在站点上的落点,同样来自登记表 */
  path: string;
  visible: boolean;
  /** epoch ms;从未配置过(库里没有这一行)时为 null */
  updatedAt: number | null;
}

/**
 * 登记表 × 库里的开关。兜底方向与读面(`apps/api/site/store.ts`)逐字相同:
 * 登记表里有、库里没行 → 当作可见;库里有、登记表里没有 → 丢弃。
 * 两处各自实现是刻意的(两个面不互相 import),所以有一条测试拿它们对比。
 */
export async function listSiteTabs(): Promise<SiteTabRow[]> {
  const rows = await db.rawQueryAll<{ key: string; visible: boolean; updatedAt: number }>(
    `SELECT key, visible, ${ms("updated_at", "updatedAt")} FROM site_tab_config`,
  );
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return SITE_TABS.map((t) => {
    const row = byKey.get(t.key);
    return {
      key: t.key,
      label: t.label,
      path: t.path,
      visible: row?.visible ?? true,
      updatedAt: row ? row.updatedAt : null,
    };
  });
}

/**
 * 事务级 advisory lock:「不许关掉最后一个可见 tab」是一条**跨行**约束,
 * 而跨行约束在 READ COMMITTED 下靠单条语句是拦不住并发的 ——
 * 两个并发的「关掉 notes」「关掉 about」各自看到对方提交前的快照,
 * 双双认为「还剩别的可见 tab」,提交完站点上一个 tab 都不剩。
 *
 * 用 advisory lock 而不是 `SELECT … FOR UPDATE`:理由与 `lockProviders` 同 ——
 * 行锁在**缺行**的情形下锁不住任何东西(某个 tab 从没被配置过时它本来就没有行),
 * 而这里恰恰要在「行还不存在」时也保证互斥。
 */
const SITE_TABS_LOCK = 0x74616231; // 'tab1',本库内唯一即可
async function lockSiteTabs(tx: Transaction): Promise<void> {
  await tx.rawExec(`SELECT pg_advisory_xact_lock($1)`, SITE_TABS_LOCK);
}

/**
 * 置一个 tab 的呈现开关。
 *
 * **拒绝关掉最后一个可见的 tab**:全关之后站点的导航条是空的、`/` 无处可去
 * (前端隐藏 `runtime` 时是重定向到第一个可见 tab,没有可见 tab 就没有落点),
 * 而把自己关成这样之后**唯一的恢复通路仍然是 MCP** —— 这不是死锁,但它是一个
 * 除了所有者自己没人看得懂的故障态。在这里挡掉,比在前端补一层兜底便宜。
 *
 * key 的合法性由 tools 层的 `z.enum` 与这里各判一次:tool 那道给的是可读的错误消息
 * 与客户端可见的取值列表,这道保证「绕过 tool 直接调 store 也进不了未知的 key」。
 */
export async function setSiteTab(input: {
  key: string;
  visible: boolean;
}): Promise<{ created: boolean; visibleKeys: string[] }> {
  if (!isSiteTabKey(input.key)) {
    throw new NotFoundError(`未知的 tab:${input.key}(可用:${SITE_TAB_KEYS.join(" / ")})`);
  }
  return inTransaction(async (tx) => {
    await lockSiteTabs(tx);
    const row = await tx.rawQueryRow<{ action: string }>(
      `INSERT INTO site_tab_config (key, visible, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE
          SET visible = EXCLUDED.visible,
              updated_at = now()
       RETURNING CASE WHEN xmax = 0 THEN 'created' ELSE 'updated' END AS action`,
      input.key,
      input.visible,
    );

    // 结果集**只按登记表里的 key 统计**:库里遗留的未知行不该顶替一个真的可见 tab
    // (读面会把它们丢弃,前端看不到它们)。缺行按可见计,与两处读面的兜底一致。
    const after = await tx.rawQueryAll<{ key: string; visible: boolean }>(
      `SELECT key, visible FROM site_tab_config WHERE key = ANY($1)`,
      SITE_TAB_KEYS as string[],
    );
    const byKey = new Map(after.map((r) => [r.key, r.visible]));
    const visibleKeys = SITE_TAB_KEYS.filter((k) => byKey.get(k) ?? true);

    if (visibleKeys.length === 0) {
      throw new ConflictError(
        `${input.key} 是最后一个可见的 tab,关掉它之后站点上不会剩下任何入口 —— 拒绝。` +
          `先把另一个 tab 打开,再关这个。`,
      );
    }
    return { created: row?.action === "created", visibleKeys: [...visibleKeys] };
  });
}

// ───────────────────── Skills 技能库(R-SKILLS)─────────────────────
//
// 与 notes 三张表同一分工:这里是写面(全权角色),读面在 apps/api/skills/。
// **整包发布**:`upsertSkill` 收全部文件,校验(shared/skill-pack.ts)→ 打 zip → 一个事务里
// 替换整个文件集合。任何一个文件不合规,整包都不入库。

export interface SkillCategoryRow {
  slug: string;
  name: string;
  dot: string;
  sortOrder: number;
  skillCount: number;
}

export async function listSkillCategories(): Promise<SkillCategoryRow[]> {
  return db.rawQueryAll<SkillCategoryRow>(
    `SELECT c.slug, c.name, c.dot, c.sort_order AS "sortOrder",
            COUNT(s.name)::int AS "skillCount"
       FROM skills_categories c
       LEFT JOIN skills s ON s.category_slug = c.slug
      GROUP BY c.slug, c.name, c.dot, c.sort_order
      ORDER BY c.sort_order, c.slug`,
  );
}

export async function upsertSkillCategory(input: {
  slug: string;
  name: string;
  dot: string;
  sortOrder: number;
}): Promise<void> {
  await db.rawExec(
    `INSERT INTO skills_categories (slug, name, dot, sort_order, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (slug) DO UPDATE
        SET name = EXCLUDED.name, dot = EXCLUDED.dot, sort_order = EXCLUDED.sort_order,
            updated_at = now()`,
    input.slug,
    input.name,
    input.dot,
    input.sortOrder,
  );
}

/** 删分类。**不级联**(与 deleteCategory 同款):底下还有 skill 时给出能行动的错误。 */
export async function deleteSkillCategory(slug: string): Promise<void> {
  const row = await db.rawQueryRow<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM skills WHERE category_slug = $1`,
    slug,
  );
  if ((row?.n ?? 0) > 0) {
    throw new ConflictError(`分类 ${slug} 下还有 ${row!.n} 个 skill,先移走或删除它们`);
  }
  const done = await db.rawQueryRow<{ slug: string }>(
    `DELETE FROM skills_categories WHERE slug = $1 RETURNING slug`,
    slug,
  );
  if (!done) throw new NotFoundError(`分类 ${slug} 不存在`);
}

export interface SkillMetaRow {
  name: string;
  categorySlug: string;
  summary: string;
  sourceType: "own" | "curated";
  repo: string;
  repoUrl: string | null;
  version: string | null;
  sortOrder: number;
  fileCount: number;
  zipSize: number;
  /** epoch ms */
  updatedAt: number;
}

export async function listSkills(categorySlug?: string): Promise<SkillMetaRow[]> {
  return db.rawQueryAll<SkillMetaRow>(
    `SELECT s.name, s.category_slug AS "categorySlug", s.summary, s.source_type AS "sourceType",
            s.repo, s.repo_url AS "repoUrl", s.version, s.sort_order AS "sortOrder",
            (SELECT COUNT(*)::int FROM skill_files f WHERE f.skill_name = s.name) AS "fileCount",
            s.zip_size AS "zipSize", ${ms("s.updated_at", "updatedAt")}
       FROM skills s
      WHERE $1::text IS NULL OR s.category_slug = $1
      ORDER BY s.sort_order, s.name`,
    categorySlug ?? null,
  );
}

export interface SkillFileMetaRow {
  path: string;
  kind: SkillFileKind;
  sizeBytes: number;
  lineCount: number;
}

/** 元信息 + 文件清单(**不含内容**:一包最多 512 KB,整包回给管理端会灌满模型上下文) */
export async function getSkill(
  name: string,
): Promise<(SkillMetaRow & { files: SkillFileMetaRow[] }) | null> {
  const meta = await db.rawQueryRow<SkillMetaRow>(
    `SELECT s.name, s.category_slug AS "categorySlug", s.summary, s.source_type AS "sourceType",
            s.repo, s.repo_url AS "repoUrl", s.version, s.sort_order AS "sortOrder",
            (SELECT COUNT(*)::int FROM skill_files f WHERE f.skill_name = s.name) AS "fileCount",
            s.zip_size AS "zipSize", ${ms("s.updated_at", "updatedAt")}
       FROM skills s WHERE s.name = $1`,
    name,
  );
  if (!meta) return null;
  const files = await db.rawQueryAll<SkillFileMetaRow>(
    `SELECT path, kind, size_bytes AS "sizeBytes", line_count AS "lineCount"
       FROM skill_files WHERE skill_name = $1
      ORDER BY sort_order, path`,
    name,
  );
  return { ...meta, files };
}

/** 单个文件的原文(改文件前先读回来,免得整包覆盖丢内容) */
export async function getSkillFile(
  name: string,
  path: string,
): Promise<(SkillFileMetaRow & { content: string }) | null> {
  return db.rawQueryRow<SkillFileMetaRow & { content: string }>(
    `SELECT path, kind, content, size_bytes AS "sizeBytes", line_count AS "lineCount"
       FROM skill_files WHERE skill_name = $1 AND path = $2`,
    name,
    path,
  );
}

export interface UpsertSkillInput {
  name: string;
  categorySlug: string;
  summary: string;
  sourceType: "own" | "curated";
  repo: string;
  /** null = 没给(前端不渲染外链) */
  repoUrl: string | null;
  version: string | null;
  sortOrder: number;
  files: SkillFileInput[];
}

export interface UpsertSkillResult {
  created: boolean;
  /** 元信息与全部文件都与库内一致 → 整行不动(updated_at 不刷新,zip 不重打) */
  unchanged: boolean;
  fileCount: number;
  totalBytes: number;
  zipSize: number;
}

/**
 * skill 整包 upsert。
 *
 * 顺序:分类存在 → 校验整包(shared/skill-pack.ts,任一文件不合规就抛,库无残留)→ 算哈希
 * → 事务:锁住这一行(`FOR UPDATE`,让同一个 skill 的两次并发发布串行)→ 哈希相同则整行不动
 * → 否则 upsert 元信息 + zip、删旧文件、插新文件。
 *
 * 【为什么不像 notes 那样把哈希判断写进 ON CONFLICT 的 WHERE】文件集合在另一张表,
 * 「不动」必须同时覆盖两张表;先 SELECT … FOR UPDATE 再决定,比两条语句各自判简单且没有窗口。
 * 表空时 FOR UPDATE 锁不住东西 —— 两个「首次发布同一个 skill」的并发调用会有一个撞主键,
 * 报成 internal error;所有者一个人用管理面,这条不值一把 advisory lock。
 */
export async function upsertSkill(input: UpsertSkillInput): Promise<UpsertSkillResult> {
  const cat = await db.rawQueryRow<{ slug: string }>(
    `SELECT slug FROM skills_categories WHERE slug = $1`,
    input.categorySlug,
  );
  if (!cat) throw new NotFoundError(`分类 ${input.categorySlug} 不存在,先建分类`);

  let pack: SkillPack;
  try {
    pack = validateSkillPack(input.name, input.files);
  } catch (err) {
    // 校验失败是所有者改一下输入就能解决的事,按业务冲突回可读的一句话
    if (err instanceof SkillPackError) throw new ConflictError(err.message);
    throw err;
  }
  const hash = skillPackHash(input, pack.files);

  return inTransaction(async (tx) => {
    const existing = await tx.rawQueryRow<{ hash: string; zipSize: number }>(
      `SELECT content_hash AS hash, zip_size AS "zipSize" FROM skills WHERE name = $1 FOR UPDATE`,
      input.name,
    );
    if (existing && existing.hash === hash) {
      return {
        created: false,
        unchanged: true,
        fileCount: pack.files.length,
        totalBytes: pack.totalBytes,
        zipSize: existing.zipSize,
      };
    }

    const zip = Buffer.from(buildSkillZip(input.name, pack.files));
    await tx.rawExec(
      `INSERT INTO skills
         (name, category_slug, summary, source_type, repo, repo_url, version, sort_order,
          zip, zip_size, content_hash, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), now())
       ON CONFLICT (name) DO UPDATE
          SET category_slug = EXCLUDED.category_slug, summary = EXCLUDED.summary,
              source_type = EXCLUDED.source_type, repo = EXCLUDED.repo,
              repo_url = EXCLUDED.repo_url, version = EXCLUDED.version,
              sort_order = EXCLUDED.sort_order, zip = EXCLUDED.zip, zip_size = EXCLUDED.zip_size,
              content_hash = EXCLUDED.content_hash, updated_at = now()`,
      input.name,
      input.categorySlug,
      input.summary,
      input.sourceType,
      input.repo,
      input.repoUrl,
      input.version,
      input.sortOrder,
      zip,
      zip.length,
      hash,
    );

    // 整包替换:旧文件集合整个换掉,不做逐文件 diff —— 「删掉一个文件」也是一次发布
    await tx.rawExec(`DELETE FROM skill_files WHERE skill_name = $1`, input.name);
    for (const f of pack.files) {
      await tx.rawExec(
        `INSERT INTO skill_files (skill_name, path, kind, content, size_bytes, line_count, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        input.name,
        f.path,
        f.kind,
        f.content,
        f.sizeBytes,
        f.lineCount,
        f.sortOrder,
      );
    }
    return {
      created: !existing,
      unchanged: false,
      fileCount: pack.files.length,
      totalBytes: pack.totalBytes,
      zipSize: zip.length,
    };
  });
}

/** 删 skill。文件是 ON DELETE CASCADE,一起消失;不可恢复,tool 的 description 里说清。 */
export async function deleteSkill(name: string): Promise<void> {
  const done = await db.rawQueryRow<{ name: string }>(
    `DELETE FROM skills WHERE name = $1 RETURNING name`,
    name,
  );
  if (!done) throw new NotFoundError(`skill ${name} 不存在`);
}
