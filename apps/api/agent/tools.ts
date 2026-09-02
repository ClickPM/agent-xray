// R7 第 1 层沙箱:pi 业务工具组(docs/security.md §1 第 1 层)。
//
// 三条不可退让的性质,改这个文件前先读一遍:
//
//   1. **工具分两组,组内的性质不同,组的边界不许模糊**(R-WEBSEARCH 起,
//      docs/security.md §1「工具分两组」):
//        · **纯函数组**(`notes_*`)——只做一件事:经 `queryAsAgentRo` 读 notes 三张表。
//          不碰文件系统、不 spawn 进程、不读 process.env、不做动态 import、
//          **不发任何网络请求**。连接串 / 凭据在这里根本不存在,因而也无从泄漏。
//        · **外呼组**(`web_search`)——持服务端凭据、只打**目标域白名单**内的固定端点。
//          文件系统 / 子进程 / 动态 import 同样禁止;访客控得到的只有一个 `query` 字段,
//          控不到 URL / host / headers / model(实现在 `websearch.ts`)。
//          它**不是**从注册表里查出来的:没有配置就构造不出来,见 `makeWebSearchTool`。
//        · **会话绑定组**(`session_rename`,R-TITLE;docs/security.md §1 第 1/2 层补记)——
//          既不是纯函数也不外呼:它经 `setSessionTitleAsAgent` 写库,只写 `sessions` 的
//          title / title_source 两列、只写**闭包绑定的那一行会话**(会话 id 不是入参,
//          模型表达不出「改别人的标题」),写面由 Postgres 的列级授权强制(迁移 009)。
//          文件系统 / 子进程 / process.env / 动态 import / 网络照常全部禁止。
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
import { reserveSearch } from "./quota";
import { queryAsAgentRo } from "./ro-db";
import { setSessionTitleAsAgent } from "./title-db";
import { runWebSearch, WebSearchError } from "./websearch";
import { loadActiveWebSearchConfig, type ActiveWebSearchConfig } from "./websearch-config";

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
/** 命名工具的失败文案。刻意带一句「继续回答」——否则模型会卡在重试标题上。 */
const TITLE_FAILURE_TEXT = "标题没能保存,不必重试,请继续回答访客的问题。";

/**
 * 允许**原样**交给模型的失败文案。
 *
 * 只用于「这次失败本身就是一条正常的业务结论」——今日搜索额度用尽、外呼超时。
 * 文案由本文件写死的常量提供,**永远不含上游细节**,所以它与 `TOOL_FAILURE_TEXT`
 * 的安全性质完全相同,区别只在于它能让模型选一条更好的后路
 * (「不能联网了,那就用已有知识回答」而不是「重试一次同样的查询」)。
 *
 * 【为什么要一个专门的类型,而不是让 web_search 绕开 `guarded`】绕开就意味着
 * 那个工具的异常兜底要自己再写一遍,而这正是「漏一处没人会发现」的那类事情。
 */
class ToolRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolRefusal";
  }
}

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
async function guarded(
  tool: string,
  run: () => Promise<ToolText>,
  failureText = TOOL_FAILURE_TEXT,
): Promise<ToolText> {
  try {
    return await run();
  } catch (err) {
    // 我们自己写死的文案直接放行(仍走 throw,`isError` 仍是 true);
    // 它已经在抛出点记过日志,这里不重复记。
    if (err instanceof ToolRefusal) throw err;
    console.error(`tool ${tool} failed: ${safeErrorText(err)}`);
    throw new Error(failureText);
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

// ───────────────────── 外呼组:web_search ─────────────────────

export const WEB_SEARCH_TOOL_NAME = "web_search";

/** 访客(经模型)能塞进来的最长查询。它只会落进请求体的一个字段,见 websearch.ts。 */
const MAX_QUERY_CHARS = 300;

/** 单条来源的标题 / URL 截断长度(来源块整体还要给正文让位,见 execute)。 */
const MAX_CITATION_TITLE = 80;
const MAX_CITATION_URL = 300;

/**
 * 三条**写死**的失败文案(经 `ToolRefusal` 原样交给模型)。
 * 不含任何上游细节,但把「该走哪条后路」说清楚 —— 否则模型的默认反应是
 * 用同一个查询再搜一次,而那三种情形里重试都不会变好。
 */
const SEARCH_QUOTA_TEXT = "今日联网搜索次数已用完,本轮无法联网;请基于已有知识回答,并说明这一点。";
const SEARCH_TIMEOUT_TEXT = "联网搜索超时,本轮没有拿到结果;请基于已有知识回答,并说明这一点。";
const SEARCH_FAILURE_TEXT = "联网搜索失败,本轮没有拿到结果;请基于已有知识回答,并说明这一点。";

/**
 * 构造 `web_search` 工具。
 *
 * 【为什么是工厂而不是 `TOOL_REGISTRY` 里的一个常量】它需要凭据、端点、超时与限额 ——
 * 而那些只有读了库才知道。做成常量就只剩两条路:要么在工具体里读库解密
 * (工具体从此不再是可测的纯逻辑,且每次调用都解一次密),要么放一个模块级可变量
 * (于是「当前用的是哪份配置」变成一个没人说得清的进程状态)。工厂把配置**定格在
 * 会话创建那一刻**,与 pi「工具白名单在 createAgentSession 时定格」的语义正好对齐:
 * 配置变了就换一份指纹,会话下一轮被重建(见 `loadEnabledTools` 与 runtime.ts)。
 *
 * 明文 key 只活在这个闭包里:不进日志、不进事件流、不进任何返回值。
 */
function makeWebSearchTool(cfg: ActiveWebSearchConfig): ToolDefinition {
  return {
    name: WEB_SEARCH_TOOL_NAME,
    label: "联网搜索",
    description:
      "联网搜索并返回一段带来源的简明答案(由搜索网关在服务端执行检索与综述)。" +
      "适合问「最新 / 现在 / 今年」这类超出你已有知识的问题;本站教程库的内容请用 notes_search,不要用本工具。" +
      "只接受一个自然语言查询,不能指定网址、不能抓取指定页面。",
    promptSnippet: "web_search —— 联网搜索时事与站外资料(有每日次数上限,省着用)",
    // 【别在这里加 `promptGuidelines`】(codex 初审 P1)它与 `promptSnippet` 一样,
    // 只在 pi 拼**默认**系统提示词时才会被用到;而本仓库走的是 `systemPromptOverride`,
    // 那是**整体替换**(pi 的 resource-loader:`override ? override(base) : base`,
    // 我们的实现忽略入参),base 里那两节根本不会送达。
    // 注入防御与用法约束因此写在 `runtime.ts` 的 `systemPromptFor` 里 ——
    // 放在一个不会被送达的字段里,比不放更糟:它看起来已经做了。
    // (本对象的 `description` 不受影响:那个走 API 请求的 tools 数组。)
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 2,
          maxLength: MAX_QUERY_CHARS,
          description: "自然语言查询;不要放网址",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    async execute(_toolCallId, params, signal, onUpdate) {
      const { query } = params as { query: string };
      return guarded(WEB_SEARCH_TOOL_NAME, async () => {
        // 【先占额,再外呼】docs/security.md §1 第 4 层。占不到就明确告诉模型
        // 「今天不能联网了」,而不是让它以为是一次偶发失败去重试。
        if (!(await reserveSearch(cfg.dailySearchLimit))) {
          console.warn(
            `tool web_search denied: daily search limit reached (limit=${cfg.dailySearchLimit})`,
          );
          throw new ToolRefusal(SEARCH_QUOTA_TEXT);
        }

        let outcome;
        try {
          outcome = await runWebSearch(query, cfg, {
            // 会话被回收 / 本轮被取消时,外呼要跟着断,别让一个没人要的请求
            // 继续占着上游额度与本进程的一个 socket
            signal,
            // 右栏可见性:阶段上报经 pi 的 onUpdate 变成 `tool_execution_update`
            // 事件(34 事件之一,已在 events.ts 白名单里),Timeline 因而能画出
            // 「发起 → 检索 → 综述」而不是一行卡三分钟的 tool_execution_start。
            onProgress: onUpdate
              ? (p) =>
                  onUpdate({
                    content: [{ type: "text", text: `[${p.phase}] ${p.detail}` }],
                    details: { phase: p.phase },
                  })
              : undefined,
          });
        } catch (err) {
          if (err instanceof WebSearchError) {
            // 上游状态码 / 响应体 / 错误原文只到这里为止(且已过 safeErrorText)
            console.error(`tool web_search failed (${err.kind}): ${safeErrorText(err.message)}`);
            const timedOut = err.kind === "idle_timeout" || err.kind === "total_timeout";
            throw new ToolRefusal(timedOut ? SEARCH_TIMEOUT_TEXT : SEARCH_FAILURE_TEXT);
          }
          throw err; // AbortError 等交给 guarded 兜底
        }

        // 来源块先算好,再把正文截到「剩下的额度」——反过来写的话,
        // `capText` 会从尾部砍掉整个来源列表,而来源正是这个工具最有价值的产出。
        const sources =
          outcome.citations.length > 0
            ? `\n\n来源:\n${outcome.citations
                .map(
                  (c, i) =>
                    `${i + 1}. ${truncateTo(c.title, MAX_CITATION_TITLE) || "(无标题)"} — ${truncateTo(c.url, MAX_CITATION_URL)}`,
                )
                .join("\n")}`
            : "";
        const body = capText(outcome.text, Math.max(200, MAX_RESULT_CHARS - sources.length));
        return textResult(`${body}${sources}`, {
          provider: cfg.provider,
          model: cfg.modelId,
          citations: outcome.citations.length,
        });
      });
    },
  };
}

function truncateTo(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/**
 * **纯函数组**的注册表。外呼组不在这里(它构造不出常量,见 `makeWebSearchTool`),
 * 会话绑定组也不在这里(要等建会话时绑定会话 id,见 `SESSION_TOOL_REGISTRY`)。
 * 三处合起来才是全部:`tool_config` 里出现任何不在这三处的名字,
 * 都只会被丢弃并记日志。新增工具 = 改这个文件 + 发一次版,不是改一行配置。
 */
export const TOOL_REGISTRY: Readonly<Record<string, ToolDefinition>> = Object.freeze({
  [notesListSeries.name]: notesListSeries,
  [notesGetChapter.name]: notesGetChapter,
  [notesSearch.name]: notesSearch,
});

// ───────────────────── 会话绑定工具(R-TITLE) ─────────────────────

export const SESSION_RENAME_TOOL = "session_rename";

/** 标题上限。与 `store.deriveTitle` 同一口径:超出截断并留省略号。 */
const MAX_TITLE_CHARS = 40;

/** 标题为空/只有标点时给模型的固定文案。是「怎么改」的指引,不含任何内部细节。 */
const TITLE_EMPTY_TEXT = "标题为空或只有标点,请给出一个 4–18 字、不带标点的短标题。";

/**
 * 模型给的标题 → 可以进会话列表的标题。
 *
 * 规则照抄参考实现(pi 的 `auto-session-title` 扩展),因为它们是同一批实测出来的模型习惯:
 * 爱把标题整个引起来、爱加「标题:」前缀、爱以句号收尾、偶尔多写一行解释。
 * 这里额外多做两件事:**控制字符压成空格**(标题会进会话列表与删除确认框,不能带排版字符)、
 * **长度上界与 deriveTitle 对齐**——标题的长度不能由模型说了算。
 */
export function sanitizeTitle(raw: string): string {
  let s = (raw.split(/\r?\n/, 1)[0] ?? "")
    // 控制字符(含制表符)压成空格。非 ASCII 标点一律写成 \uXXXX 转义:直接写字面量的话,
    // 编辑器与管道的 NFKC 归一会把全角 ! ? ; , : 悄悄换成半角,字符类看起来还在、其实少了一半。
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // 【为什么是循环而不是四条 replace 顺着写一遍】(faux 探针实测)引号与尾部标点会**互相挡住**:
  // 「排查 SSE 断流」。—— 先去引号时尾巴是句号(去不掉引号),先去句号时尾巴是引号(去不掉句号),
  // 无论哪种顺序,单趟都会剩下一个字符。循环到不动点为止;每一趟要么至少去掉一个字符、
  // 要么原样返回并跳出,必然收敛。
  for (;;) {
    const next = s
      // 首尾的引号与书名号(模型很爱把标题整个引起来)
      .replace(/^["'`\u201c\u201d\u2018\u2019\u300a\u300c\u300e]+/, "")
      .replace(/["'`\u201c\u201d\u2018\u2019\u300b\u300d\u300f]+$/, "")
      // 「标题:」这类前缀
      .replace(/^\u6807\u9898[:\uff1a]\s*/, "")
      // 尾部标点(半角 + 全角 + 中日文)
      .replace(/[.!?;,\u3002\u3001\uff01\uff1f\uff1b\uff0c\uff0e]+$/, "")
      .trim();
    if (next === s) break;
    s = next;
  }

  // 【只去尾部的那一小撮标点是不够的】(codex 复审 P2)上面的字符类只覆盖常见句末标点,
  // 模型给一串 `:` / `——` / `…` / `()` 时它们一个都不在类里,于是「纯标点」会原样活下来、
  // 被当成合法标题写进库并把 title_source 翻成 agent —— 而命名只有一次,那个没法用的标题
  // 就永久钉在会话列表上了。判据因此不是「去完标点还剩字符吗」,而是**剩下的字符里有没有
  // 一个是字母或数字**(\p{L}/\p{N} 覆盖中日韩、拉丁、西里尔……)。
  // 纯 emoji 一并落在这里:它在会话列表里同样不可用,退回去让模型重给一个。
  if (!/[\p{L}\p{N}]/u.test(s)) return "";

  return s.length > MAX_TITLE_CHARS ? `${s.slice(0, MAX_TITLE_CHARS)}…` : s;
}

/** 会话绑定工具在构建时拿到的上下文。**这里的字段永远不该出现在工具入参里。** */
export interface SessionToolContext {
  /** ≡ DB `sessions.id`。工具改的就是这一行,模型无从指定别的会话 */
  sessionId: string;
  /** 本会话是否还需要命名;false 时 `session_rename` 根本不注册(见 buildSessionTools) */
  needsTitle: boolean;
}

export type SessionToolFactory = (ctx: SessionToolContext) => ToolDefinition;

/**
 * `session_rename`:给**本次**会话起标题(R-TITLE)。
 *
 * 【为什么会话 id 不做入参】这是整个例外能被限住的关键。做成入参的话,接口上就存在
 * 「改另一个访客的会话标题」这句话,拦不拦得住全看服务端校验写没写对;
 * 绑成闭包之后,那句话在这个工具的词汇表里根本不存在(docs/security.md §1 第 1 层补记)。
 *
 * 【为什么写不进去不算失败】重复调用(会话已命名)与会话已被删掉,都返回一条**正常**结果:
 * 它们不是错误,把它们抛出去只会在轨迹面板上画出一个红色的 `isError`,
 * 而访客什么也没做错。真正的失败(库不可用)才走 `guarded` 的错误路径。
 */
const sessionRename: SessionToolFactory = (ctx) => ({
  name: SESSION_RENAME_TOOL,
  label: "会话命名",
  // description / promptSnippet 与 runtime.ts 的 systemPromptFor 口径一致(命名时机 = 第一轮,
  // 所有者裁定),三处都进模型上下文,改其一要一起改。
  description:
    "给当前这次会话起一个简短标题,显示在左侧会话列表里。用访客使用的语言," +
    "4–18 字概括访客这次要做的事;不要标点、不要引号,也不要「新会话」「帮助」这类没有信息量的词。" +
    "整个会话只需在第一轮调用一次。",
  promptSnippet: `${SESSION_RENAME_TOOL} —— 给本次会话起一个简短标题(整个会话一次)`,
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        minLength: 1,
        maxLength: 60,
        description: "标题本身,一行,不带引号与标点",
      },
    },
    required: ["title"],
    additionalProperties: false,
  },
  async execute(_toolCallId, params) {
    const { title } = (params ?? {}) as { title?: unknown };
    const clean = typeof title === "string" ? sanitizeTitle(title) : "";
    // 入参不可用是**模型可以改正**的失败:抛出去(pi 据此置 isError:true),
    // 文案本身就是改正方法。
    if (!clean) throw new Error(TITLE_EMPTY_TEXT);
    return guarded(
      SESSION_RENAME_TOOL,
      async () => {
        const changed = await setSessionTitleAsAgent(ctx.sessionId, clean);
        return changed
          ? textResult(`已把本会话的标题设为「${clean}」。`, { title: clean, changed: true })
          : textResult("本会话的标题此前已经设置过,未做更改,不必再次调用。", {
              title: clean,
              changed: false,
            });
      },
      TITLE_FAILURE_TEXT,
    );
  },
});

/**
 * 需要在**建会话时**绑定会话上下文的工具。与 `TOOL_REGISTRY` 分成两张表不是洁癖:
 * 「这个工具带着一个会话身份」是一条安全相关的性质,它应当在类型上就看得见,
 * 而不是靠读实现才发现某个工具偷偷捕获了 sessionId。
 */
export const SESSION_TOOL_REGISTRY: Readonly<Record<string, SessionToolFactory>> = Object.freeze({
  [SESSION_RENAME_TOOL]: sessionRename,
});

// ───────────────────── 启停:tool_config → 注册集合 ─────────────────────

export interface EnabledTools {
  /** 本次启用的**全部**工具名(无状态的 + 会话绑定的);指纹由它算出 */
  names: string[];
  /** 其中**无状态**工具的实现,可直接交给 createAgentSession */
  definitions: ToolDefinition[];
  /** 其中需要绑定会话上下文的工具名;实现由 `buildSessionTools` 在建会话时构造 */
  sessionScoped: string[];
  /** 集合变了就要重建会话(会话的工具集在创建时定格),判据是这个值 */
  /**
   * 集合变了就要重建会话(会话的工具集在创建时定格),判据是这个值。
   *
   * **不只是名字列表**:`web_search` 的端点 / key / 超时 / 限额被 `makeWebSearchTool`
   * 定格在闭包里,名字没变而配置变了同样需要重建 —— 所以 websearch 的配置指纹
   * 也拼在这里。漏了它的表现是「经 MCP 换了搜索端点,已有会话还在打旧的」。
   */
  fingerprint: string;
}

/**
 * 把「启用集合」落成**这一个会话**实际注册的工具。
 *
 * 返回的 `names` 与 `definitions` 必须成对使用:`createAgentSession` 的 `tools` 是白名单、
 * `customTools` 是实现,名字对不上的那一半会静默失效(白名单里多一个名字 = 一个不存在的
 * 工具,实现里多一个 = 永远不会被激活)。
 *
 * 【为什么会话绑定工具可以被这里筛掉】「一个会话只命名一次」的第一道闸:
 * 已经命名过的会话(`needsTitle === false`)干脆不注册 `session_rename` ——
 * 模型看不见它,也就不会在后续每一轮都试着调一次、再被库里的 WHERE 条件挡回去。
 * 第二道闸在 SQL 里(`WHERE title_source = 'derived'`),两道都在是刻意的。
 */
export function buildSessionTools(
  enabled: EnabledTools,
  ctx: SessionToolContext,
): { names: string[]; definitions: ToolDefinition[] } {
  const names = enabled.definitions.map((d) => d.name);
  const definitions = [...enabled.definitions];
  for (const name of enabled.sessionScoped) {
    if (name === SESSION_RENAME_TOOL && !ctx.needsTitle) continue;
    names.push(name);
    definitions.push(SESSION_TOOL_REGISTRY[name](ctx));
  }
  return { names, definitions };
}

/** 上一次记过日志的集合;同一份配置不重复刷屏(热路径每轮都会调一次)。 */
let lastLoggedFingerprint: string | undefined;

/**
 * 读 `tool_config` 决定本次会话注册哪些工具。
 *
 * 两道过滤,顺序不能反:
 *   1. **名字必须落在三处之一**(无状态的 `TOOL_REGISTRY`、会话绑定的
 *      `SESSION_TOOL_REGISTRY`,或外呼组的 `web_search` —— 它不在任何表里,由 `makeWebSearchTool`
 *      按配置构造)。表是所有者可写的,而「凭一个名字就注册一个工具」
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

  // 【只在真的要用时才读 websearch 配置】关着的时候多打一次库、多解一次密,
  // 都是白花的 —— 而且解密失败会记一行与当前配置无关的错误日志。
  // 这里连 dangerous 闸一起判:被闸住的话这个名字后面本来就会被丢掉。
  const webSearchRow = rows.find((r) => r.name === WEB_SEARCH_TOOL_NAME);
  const webCfg =
    webSearchRow && !(webSearchRow.dangerous && !unlocked)
      ? await loadActiveWebSearchConfig()
      : null;

  const names: string[] = [];
  const definitions: ToolDefinition[] = [];
  const sessionScoped: string[] = [];
  const dropped: string[] = [];
  for (const row of rows) {
    const isWebSearch = row.name === WEB_SEARCH_TOOL_NAME;
    // 【必须是 hasOwn 而不是 `in`】(codex 初审 P3)`in` 会走到 Object.prototype 上:
    // 一个叫 `constructor` 的行(`tool_config_set` 的 snake_case 校验放行它)会被判为
    // 「已实现」,然后把 `Object` 本身当工具定义塞进 customTools —— 那东西没有 execute。
    // 注册表是数据不是原型链。
    const isStateless = Object.hasOwn(TOOL_REGISTRY, row.name);
    const isSessionScoped = Object.hasOwn(SESSION_TOOL_REGISTRY, row.name);
    if (!isWebSearch && !isStateless && !isSessionScoped) {
      dropped.push(`${row.name}(未实现)`);
      continue;
    }
    if (row.dangerous && !unlocked) {
      dropped.push(`${row.name}(dangerous,缺 ${DANGEROUS_UNLOCK_ENV}=1)`);
      continue;
    }
    if (isWebSearch) {
      // 【没配 provider 就不注册,而不是注册一个必然失败的工具】给模型一个
      // 每次都失败的工具,只会让它反复重试、把轨迹刷满;而「这轮没有这个工具」
      // 是一个模型天然就会处理的情形。配好之后指纹变化 → 会话下一轮重建。
      if (!webCfg) {
        dropped.push(`${row.name}(未配置 websearch provider)`);
        continue;
      }
      names.push(row.name);
      definitions.push(makeWebSearchTool(webCfg));
      continue;
    }
    names.push(row.name);
    if (isSessionScoped) {
      // 实现要等建会话时绑定会话 id 才能构造(buildSessionTools),这里只记名字
      sessionScoped.push(row.name);
    } else {
      definitions.push(TOOL_REGISTRY[row.name]);
    }
  }

  // 指纹 = 名字集合 + websearch 配置指纹(理由见 EnabledTools.fingerprint 的注释)
  const fingerprint = `${names.join(",")}|ws:${webCfg?.fingerprint ?? "-"}`;
  // 热路径每轮都会调一次,所以只在配置变化时记一行(含本次被丢弃的名字)。
  // **日志里只出名字**:指纹含 websearch 配置的 sha256,刷进日志既没用又难读。
  if (lastLoggedFingerprint !== fingerprint) {
    lastLoggedFingerprint = fingerprint;
    console.log(
      `agent tools enabled: [${names.join(",")}]${dropped.length ? ` dropped: ${dropped.join(", ")}` : ""}`,
    );
  }
  return { names, definitions, sessionScoped, fingerprint };
}
