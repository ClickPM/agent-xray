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

export interface AboutRow {
  githubUser: string;
  originUrl: string;
  intro: string;
  buildPoints: string[];
  /** epoch ms;从未设置过时为 null */
  updatedAt: number | null;
}

export async function getAbout(): Promise<AboutRow> {
  const row = await db.rawQueryRow<AboutRow>(
    `SELECT github_user AS "githubUser", origin_url AS "originUrl", intro,
            build_points AS "buildPoints", ${ms("updated_at", "updatedAt")}
       FROM about_content WHERE id`,
  );
  if (!row) return { githubUser: "", originUrl: "", intro: "", buildPoints: [], updatedAt: null };
  // JSONB 列在驱动侧已是 JS 值;非数组(手工改库改坏了)按空数组处理,不让页面炸
  return { ...row, buildPoints: Array.isArray(row.buildPoints) ? row.buildPoints : [] };
}

export async function setAbout(input: {
  githubUser: string;
  originUrl: string;
  intro: string;
  buildPoints: string[];
}): Promise<void> {
  await db.rawExec(
    `INSERT INTO about_content (id, github_user, origin_url, intro, build_points, updated_at)
     VALUES (TRUE, $1, $2, $3, $4::text::jsonb, now())
     ON CONFLICT (id) DO UPDATE
        SET github_user = EXCLUDED.github_user, origin_url = EXCLUDED.origin_url,
            intro = EXCLUDED.intro, build_points = EXCLUDED.build_points, updated_at = now()`,
    input.githubUser,
    input.originUrl,
    input.intro,
    JSON.stringify(input.buildPoints),
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
export async function upsertProvider(
  input: UpsertProviderInput,
  encryptionKeyB64: string,
): Promise<{ created: boolean; apiKeyHint: string; isDefault: boolean }> {
  return inTransaction(async (tx) => {
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
