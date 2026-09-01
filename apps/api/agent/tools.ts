// R7 第 1 层沙箱:pi 业务工具组(docs/security.md §1 第 1 层)。
//
// 三条不可退让的性质,改这个文件前先读一遍:
//
//   1. **纯函数**。工具实现只做一件事:经 `queryAsAgentRo` 读 notes 三张表。
//      不碰文件系统、不 spawn 进程、不读 process.env、不做动态 import、不发任何网络请求。
//      连接串 / 凭据在这里根本不存在,因而也无从泄漏。
//   2. **注册集合由 `tool_config` 表决定**,但表里只能「开关已实现的工具」,
//      不能凭名字长出工具:未知名字在 `loadEnabledTools` 被丢弃并记日志。
//      bash / write / 任意代码执行类工具在本注册表里**不存在**,这是 CLAUDE.md 规则 9
//      的物理落点 —— 不是靠配置关掉,是根本没有实现。
//   3. **输出有界**。每个结果都过 `capText`;正文可以是几万字,而工具结果会原样进入
//      模型上下文、进入轨迹事件、再经公开的 /trace/stream 发出去。
//
// 【为什么不用 pi 导出的 `defineTool()`】它是个恒等函数,唯一作用是在用 TypeBox 的
// `Type.Object()` 时保住泛型推断。本文件的 schema 是**普通 JSON Schema 对象**
// (pi 的校验器显式支持:validateToolArguments 对没有 TypeBox.Kind 符号的 schema 走
// JSON Schema 分支,实测 required / additionalProperties / minLength 全部生效),
// 没有泛型可推,而 `defineTool` 是运行时导出 —— 静态 import 它会把整个 pi 包在 API
// 启动时拉进来,破坏 runtime.ts 刻意做的惰性加载。所以这里只用它的**类型**。
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Transaction } from "encore.dev/storage/sqldb";
import { safeErrorText } from "../shared/redact";
import { db } from "./db";
import { queryAsAgentRo } from "./ro-db";

/** 单个工具结果的字符上限。超出截断并显式标注,不静默丢尾巴。 */
const MAX_RESULT_CHARS = 8_000;
/** 列表类工具单次最多返回多少条。 */
const MAX_ROWS = 50;
/** 检索命中的上下文片段长度。 */
const SNIPPET_CHARS = 160;

/** 高危工具的第二道闸:服务器 env(docs/security.md §1 第 1 层「双闸」)。 */
const DANGEROUS_UNLOCK_ENV = "XRAY_UNLOCK_DANGEROUS_TOOLS";

interface ToolText {
  content: [{ type: "text"; text: string }];
  details: unknown;
}

export function capText(text: string, limit = MAX_RESULT_CHARS): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n…(已截断,原文共 ${text.length} 字符)`;
}

/** pi 的工具结果形状:一段文本 + 结构化 details(details 只进 UI/日志,不进模型)。 */
function textResult(text: string, details: unknown): ToolText {
  return { content: [{ type: "text", text: capText(text) }], details };
}

/**
 * 列表类结果的 JSON 序列化,**先裁条数再序列化**。
 *
 * 【为什么不能只靠 `capText`】它是按字符切的,切在一段 JSON 中间就是一段语法错误的
 * JSON —— 模型拿到的不是"少了几条",而是"读不懂"。50 条 × 一条两三百字符已经能越过
 * 上限,不是理论情况。这里对半砍到放得下为止,并把丢掉的条数**写进结果**:
 * 上限不能是静默的,否则"只有 3 条"和"截断到 3 条"在模型眼里一模一样。
 */
function jsonList(key: string, rows: unknown[], extra: Record<string, unknown> = {}): string {
  let kept = rows;
  for (;;) {
    const omitted = rows.length - kept.length;
    const text = JSON.stringify({ ...extra, [key]: kept, ...(omitted > 0 && { omitted }) });
    if (text.length <= MAX_RESULT_CHARS || kept.length <= 1) return text;
    kept = kept.slice(0, Math.floor(kept.length / 2));
  }
}

/**
 * SQL 侧多取一条来判断"还有没有更多",取回时砍掉那一条。
 * 同样是为了不静默截断:`more: true` 会进结果,模型知道自己看到的不是全部。
 */
function splitOverflow<T>(rows: T[], limit: number): { rows: T[]; more: boolean } {
  return rows.length > limit ? { rows: rows.slice(0, limit), more: true } : { rows, more: false };
}

/** 工具失败时给模型看的固定文案。**不含任何上游细节**。 */
const TOOL_FAILURE_TEXT = "查询失败,请稍后再试或换个问法。";

/**
 * 工具执行的统一兜底:**换掉错误内容,但保留「这是一次失败」这个事实**。
 *
 * 两条都要成立,少一条就错:
 *
 *   - **异常绝不能原样返回给模型**:数据库错误文本里可能带连接信息、表结构乃至参数值,
 *     而工具结果会进模型上下文 → 进轨迹事件 → 经公开的 `/trace/stream` 出去
 *     (docs/security.md §2)。原文只进服务端日志且过 `safeErrorText`。
 *   - **失败必须走 pi 的错误路径**(codex 复审 P2)。第一版是 `return` 一条普通文本结果 ——
 *     pi 把「execute 正常 resolve」一律当成功,于是 `tool_execution_end` / `tool_result`
 *     的 `isError` 是 false:一次超时的查询在轨迹面板上显示成一次成功的查询,而轨迹面板
 *     正是本站的卖点。改成**抛出固定文案**:pi 的 `executePreparedToolCall` 捕获异常后
 *     用 `error.message` 造 `createErrorToolResult(...)` 并置 `isError: true`(源码核实),
 *     既拿到了正确的错误状态,给模型的又还是那句固定文案。
 */
async function guarded(tool: string, run: () => Promise<ToolText>): Promise<ToolText> {
  try {
    return await run();
  } catch (err) {
    console.error(`tool ${tool} failed: ${safeErrorText(err)}`);
    throw new Error(TOOL_FAILURE_TEXT);
  }
}

// ───────────────────── 三个只读工具 ─────────────────────

interface SeriesRow {
  categorySlug: string;
  categoryName: string;
  slug: string;
  name: string;
  description: string;
  chapterCount: number;
}

interface ChapterListRow {
  slug: string;
  label: string;
  title: string;
  wordCount: number;
}

/**
 * 系列索引。
 *
 * 【为什么带一个 `series` 参数,而不是第四个工具】ROUNDS.md 把工具组钉成三个名字,
 * 而模型要读一章必须先知道章节 slug —— 这个「目录」能力总得有个落点。放进本工具是
 * 三个选择里最省的:它本来就是「浏览教程库」的入口,给了系列就往下一层走。
 */
const notesListSeries: ToolDefinition = {
  name: "notes_list_series",
  label: "教程库索引",
  description:
    "列出本站 Notes 教程库的系列;给出 series 参数时改为列出该系列的章节表(slug 可用于 notes_get_chapter)。",
  promptSnippet: "notes_list_series —— 浏览本站教程库的系列与章节目录",
  parameters: {
    type: "object",
    properties: {
      category: { type: "string", maxLength: 64, description: "只看某个分类的 slug,省略则全部" },
      series: { type: "string", maxLength: 128, description: "给出系列 slug 时改为返回该系列的章节表" },
    },
    required: [],
    additionalProperties: false,
  },
  async execute(_toolCallId, params) {
    const { category, series } = (params ?? {}) as { category?: string; series?: string };
    return guarded("notes_list_series", async () =>
      queryAsAgentRo(async (tx: Transaction) => {
        if (series) {
          const all = await tx.rawQueryAll<ChapterListRow>(
            `SELECT slug, label, title, word_count AS "wordCount"
               FROM notes_chapters WHERE series_slug = $1
              ORDER BY ordinal, id LIMIT $2`,
            series,
            MAX_ROWS + 1,
          );
          const { rows: chapters, more } = splitOverflow(all, MAX_ROWS);
          if (chapters.length === 0) {
            return textResult(`系列 ${series} 不存在或还没有章节。`, { series, count: 0 });
          }
          return textResult(jsonList("chapters", chapters, { series, ...(more && { more }) }), {
            series,
            count: chapters.length,
          });
        }
        const allSeries = await tx.rawQueryAll<SeriesRow>(
          // 章节数**必须**与公开 API 同口径(codex 初审 P2):置顶的 README 是「总览」
          // 不是「第 N 章」,`notes/store.ts` 的 listSeriesCards / getSeries 都把它排除在外。
          // 这里少一个 FILTER,agent 说出来的数字就会比站点上显示的多一。
          `SELECT c.slug AS "categorySlug", c.name AS "categoryName",
                  s.slug, s.name, s.description,
                  COUNT(ch.id) FILTER (WHERE NOT ch.pinned)::int AS "chapterCount"
             FROM notes_categories c
             JOIN notes_series s ON s.category_slug = c.slug
             LEFT JOIN notes_chapters ch ON ch.series_slug = s.slug
            WHERE $1::text IS NULL OR c.slug = $1
            GROUP BY c.slug, c.name, c.sort_order, s.slug, s.name, s.description, s.sort_order
            ORDER BY c.sort_order, s.sort_order
            LIMIT $2`,
          category ?? null,
          MAX_ROWS + 1,
        );
        const { rows, more } = splitOverflow(allSeries, MAX_ROWS);
        if (rows.length === 0) {
          return textResult(category ? `分类 ${category} 下没有系列。` : "教程库还没有内容。", { count: 0 });
        }
        return textResult(jsonList("series", rows, more ? { more } : {}), { count: rows.length });
      }),
    );
  },
};

interface ChapterRow {
  title: string;
  label: string;
  summary: string;
  contentMd: string;
  sourceUrl: string | null;
  seriesName: string;
}

const notesGetChapter: ToolDefinition = {
  name: "notes_get_chapter",
  label: "读教程章节",
  description:
    "读取某个系列下某一章的正文(标准 markdown,超长会截断)。系列与章节的 slug 由 notes_list_series 或 notes_search 给出。",
  promptSnippet: "notes_get_chapter —— 读取本站教程某一章的正文",
  parameters: {
    type: "object",
    properties: {
      series: { type: "string", minLength: 1, maxLength: 128, description: "系列 slug" },
      chapter: { type: "string", minLength: 1, maxLength: 128, description: "章节 slug" },
    },
    required: ["series", "chapter"],
    additionalProperties: false,
  },
  async execute(_toolCallId, params) {
    const { series, chapter } = params as { series: string; chapter: string };
    return guarded("notes_get_chapter", async () =>
      queryAsAgentRo(async (tx: Transaction) => {
        const row = await tx.rawQueryRow<ChapterRow>(
          `SELECT ch.title, ch.label, ch.summary, ch.content_md AS "contentMd",
                  ch.source_url AS "sourceUrl", s.name AS "seriesName"
             FROM notes_chapters ch JOIN notes_series s ON s.slug = ch.series_slug
            WHERE ch.series_slug = $1 AND ch.slug = $2`,
          series,
          chapter,
        );
        if (!row) {
          return textResult(`没有找到 ${series}/${chapter};先用 notes_list_series 确认 slug。`, {
            found: false,
          });
        }
        const head = [
          `# ${row.title}`,
          `系列:${row.seriesName}(${series}) · 章节:${row.label}(${chapter})`,
          row.summary ? `摘要:${row.summary}` : "",
          row.sourceUrl ? `原文:${row.sourceUrl}` : "",
        ]
          .filter((line) => line !== "")
          .join("\n");
        return textResult(`${head}\n\n${row.contentMd}`, { found: true, series, chapter });
      }),
    );
  },
};

interface SearchRow {
  seriesSlug: string;
  seriesName: string;
  chapterSlug: string;
  title: string;
  /** 命中在正文里的位置(strpos 口径,1-based;0 = 正文没命中) */
  pos: number;
  /** 命中在摘要里的位置;正文没命中时片段取这里 */
  summaryPos: number;
  summary: string;
  contentMd: string;
}

const notesSearch: ToolDefinition = {
  name: "notes_search",
  label: "检索教程库",
  description: "在本站教程库的标题、摘要与正文里做大小写不敏感的子串检索,返回命中的章节与片段。",
  promptSnippet: "notes_search —— 在本站教程库里按关键词找章节",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", minLength: 1, maxLength: 120, description: "关键词(子串匹配,不支持通配符)" },
      limit: { type: "integer", minimum: 1, maximum: 20, description: "返回条数,默认 5" },
    },
    required: ["query"],
    additionalProperties: false,
  },
  async execute(_toolCallId, params) {
    const { query, limit } = params as { query: string; limit?: number };
    return guarded("notes_search", async () =>
      queryAsAgentRo(async (tx: Transaction) => {
        // 【为什么用 strpos 而不是 ILIKE】ILIKE 的模式里 `%` / `_` 是通配符,
        // 一个只输入 `%` 的 query 会命中全部正文;要挡就得转义,而转义规则又是一处
        // 容易写错的地方。strpos 是**纯子串**语义,没有元字符,参数化之后不存在
        // 「查询串影响匹配范围」这回事。表很小,顺序扫 + statement_timeout 足够。
        const rows = await tx.rawQueryAll<SearchRow>(
          `SELECT ch.series_slug AS "seriesSlug", s.name AS "seriesName",
                  ch.slug AS "chapterSlug", ch.title,
                  strpos(lower(ch.content_md), lower($1)) AS pos,
                  strpos(lower(ch.summary), lower($1)) AS "summaryPos",
                  ch.summary, ch.content_md AS "contentMd"
             FROM notes_chapters ch JOIN notes_series s ON s.slug = ch.series_slug
            WHERE strpos(lower(ch.title), lower($1)) > 0
               OR strpos(lower(ch.summary), lower($1)) > 0
               OR strpos(lower(ch.content_md), lower($1)) > 0
            ORDER BY (strpos(lower(ch.title), lower($1)) > 0) DESC, ch.updated_at DESC, ch.id DESC
            LIMIT $2`,
          query,
          Math.min(Math.max(limit ?? 5, 1), 20),
        );
        if (rows.length === 0) {
          return textResult(`教程库里没有匹配「${query}」的内容。`, { count: 0 });
        }
        const hits = rows.map((r) => ({
          series: r.seriesSlug,
          seriesName: r.seriesName,
          chapter: r.chapterSlug,
          title: r.title,
          // 【片段要取真正命中的那段文本】(codex 初审 P2)只在摘要里命中的行,
          // 正文 pos 为 0,按正文取片段就会返回一段与关键词无关的开头 ——
          // 模型看到的"证据"里根本没有它搜的词。命中在哪就从哪取。
          snippet:
            r.pos > 0
              ? snippetAround(r.contentMd, r.pos)
              : r.summaryPos > 0
                ? snippetAround(r.summary, r.summaryPos)
                : snippetAround(r.contentMd, 0),
        }));
        return textResult(jsonList("hits", hits, { query }), { count: hits.length });
      }),
    );
  },
};

/** 命中位置(strpos 口径:1-based,0 = 没在正文里命中)前后各取一半窗口。 */
export function snippetAround(content: string, pos: number, width = SNIPPET_CHARS): string {
  const start = pos > 0 ? Math.max(0, pos - 1 - Math.floor(width / 2)) : 0;
  const end = start + width;
  const raw = content.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${raw}${end < content.length ? "…" : ""}`;
}

/**
 * 已实现工具的注册表。**这就是全部**:`tool_config` 里出现任何不在本表的名字,
 * 都只会被丢弃并记日志。新增工具 = 改这个文件 + 发一次版,不是改一行配置。
 */
export const TOOL_REGISTRY: Readonly<Record<string, ToolDefinition>> = Object.freeze({
  [notesListSeries.name]: notesListSeries,
  [notesGetChapter.name]: notesGetChapter,
  [notesSearch.name]: notesSearch,
});

// ───────────────────── 启停:tool_config → 注册集合 ─────────────────────

export interface EnabledTools {
  /** 传给 createAgentSession 的 `tools` 白名单(同时也是 customTools 的名字集合) */
  names: string[];
  definitions: ToolDefinition[];
  /** 集合变了就要重建会话(会话的工具集在创建时定格),判据是这个值 */
  fingerprint: string;
}

/** 上一次记过日志的集合;同一份配置不重复刷屏(热路径每轮都会调一次)。 */
let lastLoggedFingerprint: string | undefined;

/**
 * 读 `tool_config` 决定本次会话注册哪些工具。
 *
 * 两道过滤,顺序不能反:
 *   1. **名字必须在 TOOL_REGISTRY 里**。表是所有者可写的,而「凭一个名字就注册一个工具」
 *      这件事根本不存在 —— 落到这里的未知名字只会被丢掉。
 *   2. **dangerous 行需要服务器 env 双闸**。表里置 true 只是第一闸;
 *      没有 `XRAY_UNLOCK_DANGEROUS_TOOLS=1` 就不注册(docs/security.md §1 第 1 层)。
 *      注意本注册表目前**没有**任何 dangerous 实现,这段是给将来准备的闸,不是当前路径。
 *
 * 读 env 发生在**注册**环节而不是工具体内 —— 工具本身仍是纯函数(见文件头第 1 条)。
 */
export async function loadEnabledTools(): Promise<EnabledTools> {
  const rows = await db.rawQueryAll<{ name: string; dangerous: boolean }>(
    `SELECT name, dangerous FROM tool_config WHERE enabled ORDER BY name`,
  );
  const unlocked = process.env[DANGEROUS_UNLOCK_ENV] === "1";
  const names: string[] = [];
  const dropped: string[] = [];
  for (const row of rows) {
    // 【必须是 hasOwn 而不是 `in`】(codex 初审 P3)`in` 会走到 Object.prototype 上:
    // 一个叫 `constructor` 的行(`tool_config_set` 的 snake_case 校验放行它)会被判为
    // 「已实现」,然后把 `Object` 本身当工具定义塞进 customTools —— 那东西没有 execute。
    // 注册表是数据不是原型链。
    if (!Object.hasOwn(TOOL_REGISTRY, row.name)) {
      dropped.push(`${row.name}(未实现)`);
      continue;
    }
    if (row.dangerous && !unlocked) {
      dropped.push(`${row.name}(dangerous,缺 ${DANGEROUS_UNLOCK_ENV}=1)`);
      continue;
    }
    names.push(row.name);
  }
  const fingerprint = names.join(",");
  // 热路径每轮都会调一次,所以只在集合变化时记一行(含本次被丢弃的名字)
  if (lastLoggedFingerprint !== fingerprint) {
    lastLoggedFingerprint = fingerprint;
    console.log(
      `agent tools enabled: [${fingerprint}]${dropped.length ? ` dropped: ${dropped.join(", ")}` : ""}`,
    );
  }
  return { names, definitions: names.map((n) => TOOL_REGISTRY[n]), fingerprint };
}
