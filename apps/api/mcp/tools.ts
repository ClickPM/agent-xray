// MCP 管理面的工具集(ROUNDS.md R6 首批)。
//
// 分组:notes 三张表 CRUD · 附件上传/删除 · About 内容 · LLM provider · 工具启停。
// **统计查询 tools 不在本轮**(数据面是 R8,所有者裁定)。
//
// 三条口径:
//   1. **入参即标准 markdown,server 只校验不改写**(Obsidian 改写器随 R5 管道退役)。
//      正文一个字节都不动;只派生 word_count / content_hash(见 content.ts)。
//   2. **凭据只出掩码**:LLM key 的任何读回都是 `sk-…abcd`,且掩码在服务端算好 ——
//      tool result 会进管理端的模型上下文(docs/security.md §3)。
//   3. **写操作全审计**;失败也审计(outcome=error),不写日志的写操作不存在。
//
// `import * as z` 而不是 `import { z }`:后者在 vitest 的 SSR transform 下拿到的是
// undefined(实测 `z.string` 报 "undefined is not an object",而同一份代码在
// node / bun 直跑都正常)。zod 4 把全部构造器摆在包的顶层命名导出上,
// `z.string === (import * as z).string`,换成命名空间导入语义完全一致。
import * as z from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { audit } from "./audit";
import { configEncryptionKey } from "./secrets";
import * as store from "./store";
import { ConflictError, NotFoundError } from "./store";
import { safeErrorText } from "../shared/redact";
import { SITE_TZ_LABEL } from "../shared/site-time";

/**
 * slug 口径必须与 `apps/api/notes/series.ts` 的 SLUG_RE 一字不差。
 * 两边一旦漂移,表现是「系列页列得出、点开 400」—— 没有任何一侧会报错
 * (R5 的 notes-sync 踩过同一个坑,那条注释随管道删除,判据搬到这里)。
 */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const slug = z.string().regex(SLUG_RE, "slug 需匹配 ^[a-z0-9][a-z0-9-]{0,63}$");

/** 分类圆点色:design token 里的 6 位 hex,不接受任意 CSS 颜色(规则 7 的边界)。 */
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "dot 需为 #RRGGBB");

/**
 * 附件文件名:`<内容哈希>.<ext>`,不含路径分隔符 —— 它直接进 URL。
 *
 * **刻意只收小写**(codex 复审 P2,已用真 Caddy 实测复现):原先带 `i` 标志,
 * 于是 `photo.JPG` 能上传成功、回一个 `/notes/…/photo.JPG` 的地址,
 * 而生产的 Caddy matcher 与 next dev 的 rewrite 都只认小写扩展名 ——
 * 那张图在线上会绕过供图路由、落到前端的 404。收紧输入比让两处 matcher
 * 变大小写不敏感更省:文件名本来就约定是小写十六进制哈希。
 */
const ASSET_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,95}$/;

/**
 * 允许的附件类型白名单。
 *
 * **SVG 被刻意排除**,理由与 R5 的图片管线一致:SVG 是可执行文档,
 * 直接访问 `/notes/<系列>/x.svg` 就是在本站同源下打开一份来源不可控的文档 ——
 * 存储型 XSS。这里不做消毒(要引消毒库=新增机制),而是不接受这种输入。
 */
const ASSET_TYPES: Record<string, string[]> = {
  "image/webp": ["webp"],
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/gif": ["gif"],
};

/**
 * 单个附件上限。base64 传输膨胀 4/3,所以它必须和 `endpoint.ts` 的 `BODY_LIMIT`
 * 配套(4 MiB 原文 ≈ 5.4 MiB 请求体,额度 8 MiB 留足余量)。改一处要改两处。
 *
 * 4 MiB 不是拍脑袋:R5 的图片管线把宽度压到 1600px,存量 56 张里最大的一张
 * 205 KB。定得比「够用」高一个数量级就行,再高只是白送攻击面。
 */
const MAX_ASSET_BYTES = 4 * 1024 * 1024;

/** 单篇正文上限:vault 里最长的一篇约 12 万字符,1MB 留足余量。 */
const MAX_CONTENT_BYTES = 1024 * 1024;

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function ok(payload: unknown): ToolResult {
  return {
    content: [
      { type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) },
    ],
  };
}

function failed(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** 审计上下文:endpoint 层把本次请求的来源塞进来,tools 层只管带上。 */
export interface ToolContext {
  remote?: string;
}

/**
 * 写工具的统一外壳:执行 → 审计 → 整形。
 *
 * 为什么所有写工具都必须过这里:`docs/security.md` §4 要求「全部写操作写审计日志」。
 * 让每个工具自己记的话,漏一个是没人会发现的 —— 少一条审计不会让任何用例失败。
 *
 * 业务异常(NotFoundError / ConflictError)转成 `isError` 的 tool result 而不是抛:
 * MCP 客户端拿到的是模型能读懂并纠正的一句话,而不是一个协议层错误。
 * 非预期异常只回固定文案,原文进服务端日志(与 /agent/ask 的口径一致)。
 */
async function write(
  ctx: ToolContext,
  tool: string,
  summary: string,
  run: () => Promise<unknown>,
): Promise<ToolResult> {
  try {
    const result = await run();
    await audit({ outcome: "ok", method: "tools/call", tool, summary, remote: ctx.remote, detail: result });
    return ok(result);
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ConflictError) {
      await audit({
        outcome: "error",
        method: "tools/call",
        tool,
        summary: `${summary} — ${err.message}`,
        remote: ctx.remote,
      });
      return failed(err.message);
    }
    const text = safeErrorText(err);
    console.error(`mcp tool ${tool} failed: ${text}`);
    await audit({
      outcome: "error",
      method: "tools/call",
      tool,
      summary: `${summary} — ${text}`,
      remote: ctx.remote,
    });
    return failed("操作失败,详见服务端日志。");
  }
}

/** 读工具:不进审计(量大且无价值,§4 只要求写操作),异常口径与写工具一致。 */
async function read(tool: string, run: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await run());
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ConflictError) return failed(err.message);
    console.error(`mcp tool ${tool} failed: ${safeErrorText(err)}`);
    return failed("查询失败,详见服务端日志。");
  }
}

const toIso = (ms: number) => new Date(ms).toISOString();
const toIsoOrNull = (ms: number | null) => (ms === null ? null : toIso(ms));

/** ISO 8601 校验:`new Date()` 对 "abc" 返回 Invalid Date 而不是抛,必须显式判。 */
const isoDate = z
  .string()
  .refine((s) => !Number.isNaN(new Date(s).getTime()), "需为可解析的 ISO 8601 时间");

export function registerTools(server: McpServer, ctx: ToolContext): void {
  // ───────────────────── 分类 ─────────────────────

  server.registerTool(
    "notes_categories_list",
    {
      title: "列出 Notes 分类",
      description: "Notes 四分类(产品经理 / 源码拆解 / 代码工程 / AI 前沿)及各自的系列数。",
      inputSchema: {},
    },
    async () => read("notes_categories_list", () => store.listCategories()),
  );

  server.registerTool(
    "notes_category_upsert",
    {
      title: "新建/更新 Notes 分类",
      description: "按 slug 建或改一个分类。dot 是分类圆点色(design token 的 #RRGGBB)。",
      inputSchema: {
        slug,
        name: z.string().min(1).max(64),
        dot: hexColor,
        sortOrder: z.number().int().min(0).max(9999).default(0),
      },
    },
    async (args) =>
      write(ctx, "notes_category_upsert", `分类 ${args.slug}`, async () => {
        await store.upsertCategory(args);
        return { slug: args.slug, status: "saved" };
      }),
  );

  server.registerTool(
    "notes_category_delete",
    {
      title: "删除 Notes 分类",
      description: "分类下还有系列时拒绝删除。",
      inputSchema: { slug },
    },
    async (args) =>
      write(ctx, "notes_category_delete", `删分类 ${args.slug}`, async () => {
        await store.deleteCategory(args.slug);
        return { slug: args.slug, status: "deleted" };
      }),
  );

  // ───────────────────── 系列 ─────────────────────

  server.registerTool(
    "notes_series_list",
    {
      title: "列出 Notes 系列",
      description: "系列及其章节数、附件数;可按分类过滤。",
      inputSchema: { categorySlug: slug.optional() },
    },
    async (args) => read("notes_series_list", () => store.listSeries(args.categorySlug)),
  );

  server.registerTool(
    "notes_series_upsert",
    {
      title: "新建/更新 Notes 系列",
      description: "按 slug 建或改一个系列。slug 同时是 URL 片段 /notes/<slug>,建后不要再改。",
      inputSchema: {
        slug,
        categorySlug: slug,
        name: z.string().min(1).max(128),
        description: z.string().max(512).default(""),
        sortOrder: z.number().int().min(0).max(9999).default(0),
      },
    },
    async (args) =>
      write(ctx, "notes_series_upsert", `系列 ${args.slug}`, async () => {
        await store.upsertSeries(args);
        return { slug: args.slug, status: "saved" };
      }),
  );

  server.registerTool(
    "notes_series_delete",
    {
      title: "删除 Notes 系列",
      description: "系列下有章节或附件时必须显式 cascade=true —— 它们会被一并删除,不可恢复。",
      inputSchema: { slug, cascade: z.boolean().default(false) },
    },
    async (args) =>
      write(ctx, "notes_series_delete", `删系列 ${args.slug} cascade=${args.cascade}`, async () => {
        await store.deleteSeries(args.slug, args.cascade);
        return { slug: args.slug, status: "deleted" };
      }),
  );

  // ───────────────────── 章节 ─────────────────────

  server.registerTool(
    "notes_chapters_list",
    {
      title: "列出系列下的章节",
      description: "章节元信息(不含正文),按 ordinal 排序。",
      inputSchema: { seriesSlug: slug },
    },
    async (args) =>
      read("notes_chapters_list", async () =>
        (await store.listChapters(args.seriesSlug)).map((c) => ({
          ...c,
          publishedAt: toIsoOrNull(c.publishedAt),
          updatedAt: toIso(c.updatedAt),
        })),
      ),
  );

  server.registerTool(
    "notes_chapter_get",
    {
      title: "读取一篇文章",
      description: "含正文 markdown。改文章前先读回来,避免整篇覆盖丢内容。",
      inputSchema: { seriesSlug: slug, slug },
    },
    async (args) =>
      read("notes_chapter_get", async () => {
        const row = await store.getChapter(args.seriesSlug, args.slug);
        if (!row) throw new NotFoundError(`章节 ${args.seriesSlug}/${args.slug} 不存在`);
        return { ...row, publishedAt: toIsoOrNull(row.publishedAt), updatedAt: toIso(row.updatedAt) };
      }),
  );

  server.registerTool(
    "notes_chapter_upsert",
    {
      title: "发布/更新一篇文章",
      description:
        "contentMd 必须是标准 markdown(GFM),server 只校验不改写。" +
        "正文里的配图用 /notes/<seriesSlug>/<文件名> 引用,文件先经 notes_asset_put 上传。" +
        "内容与库内完全一致时整行不动(不刷新 updatedAt,RSS 不会假装有更新)。",
      inputSchema: {
        seriesSlug: slug,
        slug,
        ordinal: z.number().int().min(0).max(9999),
        label: z.string().min(1).max(32).describe("章节表左列文本:README / 01 / 02 …"),
        pinned: z.boolean().default(false).describe("置顶行(README 总览),不计入章节数"),
        title: z.string().min(1).max(256),
        summary: z.string().max(512).default(""),
        contentMd: z.string().min(1).max(MAX_CONTENT_BYTES),
        sourceUrl: z.url().max(1024).nullable().default(null).describe("第三方文章的原文链接"),
        publishedAt: isoDate.nullable().default(null),
      },
    },
    async (args) =>
      write(ctx, "notes_chapter_upsert", `文章 ${args.seriesSlug}/${args.slug}`, async () => {
        const r = await store.upsertChapter(args);
        return {
          seriesSlug: args.seriesSlug,
          slug: args.slug,
          status: r.unchanged ? "unchanged" : r.created ? "created" : "updated",
          wordCount: r.wordCount,
          url: `/notes/${args.seriesSlug}/${args.slug}`,
        };
      }),
  );

  server.registerTool(
    "notes_chapter_delete",
    {
      title: "删除一篇文章",
      description: "不可恢复。",
      inputSchema: { seriesSlug: slug, slug },
    },
    async (args) =>
      write(ctx, "notes_chapter_delete", `删文章 ${args.seriesSlug}/${args.slug}`, async () => {
        await store.deleteChapter(args.seriesSlug, args.slug);
        return { seriesSlug: args.seriesSlug, slug: args.slug, status: "deleted" };
      }),
  );

  // ───────────────────── 附件 ─────────────────────

  server.registerTool(
    "notes_assets_list",
    {
      title: "列出正文配图",
      description: "附件元信息(不含二进制);可按系列过滤。",
      inputSchema: { seriesSlug: slug.optional() },
    },
    async (args) =>
      read("notes_assets_list", async () =>
        (await store.listAssets(args.seriesSlug)).map((a) => ({
          ...a,
          url: `/notes/${a.seriesSlug}/${a.name}`,
          updatedAt: toIso(a.updatedAt),
        })),
      ),
  );

  server.registerTool(
    "notes_asset_put",
    {
      title: "上传正文配图",
      description:
        "二进制以 base64 传入,存进 Postgres 并由 /notes/<seriesSlug>/<name> 提供 —— " +
        "镜像里不烧任何 notes 内容。允许 webp/png/jpeg/gif;**SVG 不接受**(可执行文档,存储型 XSS)。" +
        "同名重传即覆盖。",
      inputSchema: {
        seriesSlug: slug,
        name: z
          .string()
          .regex(ASSET_NAME_RE, "name 需为**全小写**、不含路径分隔符的文件名")
          .describe("形如 <内容哈希>.webp;直接进 URL,只收小写(线上按小写扩展名分流)"),
        contentType: z.enum(Object.keys(ASSET_TYPES) as [string, ...string[]]),
        dataBase64: z.string().min(1),
      },
    },
    async (args) =>
      write(ctx, "notes_asset_put", `附件 ${args.seriesSlug}/${args.name}`, async () => {
        const ext = args.name.split(".").pop()?.toLowerCase() ?? "";
        // 扩展名与 contentType 必须自洽:供图端点按库里的 content_type 出头,
        // 而浏览器是按 URL 里的扩展名建立预期的。两者不一致 = 一张永远加载不出的图。
        if (!ASSET_TYPES[args.contentType].includes(ext)) {
          throw new ConflictError(
            `扩展名 .${ext} 与 contentType ${args.contentType} 不匹配(应为 ${ASSET_TYPES[args.contentType].join("/")})`,
          );
        }
        const bytes = decodeBase64Strict(args.dataBase64);
        if (bytes.length === 0) throw new ConflictError("dataBase64 解出的内容为空");
        if (bytes.length > MAX_ASSET_BYTES) {
          throw new ConflictError(`附件超过 ${MAX_ASSET_BYTES} 字节上限(当前 ${bytes.length})`);
        }
        if (!magicMatches(args.contentType, bytes)) {
          throw new ConflictError(`文件头与 contentType ${args.contentType} 不符`);
        }
        return store.putAsset({ ...args, bytes });
      }),
  );

  server.registerTool(
    "notes_asset_delete",
    {
      title: "删除正文配图",
      description: "不检查是否仍被正文引用;删错了会变破图。",
      inputSchema: { seriesSlug: slug, name: z.string().regex(ASSET_NAME_RE, "name 需为全小写文件名") },
    },
    async (args) =>
      write(ctx, "notes_asset_delete", `删附件 ${args.seriesSlug}/${args.name}`, async () => {
        await store.deleteAsset(args.seriesSlug, args.name);
        return { seriesSlug: args.seriesSlug, name: args.name, status: "deleted" };
      }),
  );

  // ───────────────────── About ─────────────────────

  server.registerTool(
    "about_get",
    {
      title: "读取 About 页内容",
      description:
        "About 页(/about)的全部内容:双链、简介、「本站如何构建」条目、公开仓库卡、语言构成条。" +
        "改之前先读回来 —— about_set 虽是部分更新,但要覆盖某个数组字段时你需要看到它原本的样子。",
      inputSchema: {},
    },
    async () =>
      read("about_get", async () => {
        const a = await store.getAbout();
        return { ...a, updatedAt: toIsoOrNull(a.updatedAt) };
      }),
  );

  server.registerTool(
    "about_set",
    {
      title: "更新 About 页内容",
      description:
        "About 页(/about)展示的全部内容。**部分更新:省略的字段一律保留库内原值**;" +
        "清空是显式动作(传 \"\" 或 [])。改一句 intro 不必、也不该把仓库卡重报一遍。" +
        "写入后前端下次渲染即生效(About 页是 force-dynamic 的 Server Component)。",
      inputSchema: {
        // 【必须按 GitHub 的用户名字符集收紧】这个值会被拼进 https://github.com/<user>
        // 与 <user>.png 两个地址。放开任意字符的话,一个带 `?` 或 `/` 的值就能把
        // 头像与主页链接指到别处去 —— 前端只做 URL 拼接,它挡不住这件事。
        githubUser: z
          .string()
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, "需为合法 GitHub 用户名")
          .or(z.literal(""))
          .optional()
          .describe("GitHub 用户名;头像取 https://github.com/<user>.png。空字符串 = 不渲染头部"),
        // 【必须限定 scheme】这个值直接进 <a href>。不校验的话
        // `javascript:…` / `data:…` 就是一个所有者自己种下的 XSS ——
        // React 转义属性值,但它不会替你判断协议。
        originUrl: z
          .string()
          .max(512)
          .refine((v) => v === "" || /^https?:\/\//i.test(v), "需为 http(s) 绝对地址或空字符串")
          .optional()
          .describe("头部 GitHub 按钮旁的第二条外链;空字符串 = 不渲染那个按钮"),
        intro: z.string().max(1024).optional(),
        buildPoints: z.array(z.string().max(256)).max(32).optional().describe("「本站如何构建」逐条"),
        repos: z
          .array(
            z.object({
              // 同样会被拼进 https://github.com/<user>/<name>,按 GitHub 仓库名收紧
              name: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/, "需为合法 GitHub 仓库名"),
              lang: z.string().max(32).default(""),
              dot: hexColor.describe("语言圆点色"),
              stars: z.number().int().min(0).max(1_000_000).default(0),
              desc: z.string().max(512).default(""),
              pushed: z.string().max(32).default("").describe("最近推送的展示文本,如 2026-08-27"),
            }),
          )
          .max(24)
          .optional()
          .describe("「公开仓库」卡片(画板 2e);链接由前端按 github.com/<user>/<name> 拼"),
        langBar: z
          .array(
            z.object({
              name: z.string().min(1).max(32),
              pct: z.number().min(0).max(100).describe("占比;各项之和不必恰好 100,按给定值渲染"),
              color: hexColor,
            }),
          )
          .max(12)
          .optional()
          .describe("底部语言构成条(画板 2e)"),
      },
    },
    async (args) =>
      write(ctx, "about_set", `About 内容(${Object.keys(args).join(",") || "无字段"})`, async () => {
        await store.setAbout(args);
        return { status: "saved", updated: Object.keys(args) };
      }),
  );

  // ───────────────────── 访问统计(R8)─────────────────────
  //
  // 数据来自 metrics 服务的 `POST /t` 打点(自托管、无第三方脚本、无 cookie)。
  // 画板 3c 的 Traffic 页已随 /admin 废弃,展示面就是下面这三个 tool。
  //
  // 三个 tool 共用两条口径,description 里逐个重申过 —— 它们是最容易被读错的地方:
  //   · visitorDays 是**各日 UV 之和**,不是去重人数(访客标识按天轮换,见
  //     apps/api/metrics/visitor.ts;这是隐私设计的直接后果,不是实现偷懒)
  //   · path 是**归一后**的站内路径,`/*` 是归一不出来的那些的常量桶

  server.registerTool(
    "traffic_overview",
    {
      title: "访问概览与按天趋势",
      description:
        `区间内的总 PV、各日 UV 之和,以及逐日趋势。日期按站点时区 ${SITE_TZ_LABEL}。` +
        "**visitorDays 不是去重人数**:访客标识按天轮换(隐私设计,跨天不可关联)," +
        "所以它是各日 UV 相加。单日的 uv 才是那天的去重访客数。" +
        "没有访问的日子不会出现在 daily 里。",
      inputSchema: { days: z.number().int().min(1).max(365).default(30).describe("含今天在内的天数") },
    },
    async (args) =>
      read("traffic_overview", async () => ({
        timezone: SITE_TZ_LABEL,
        ...(await store.trafficOverview(args.days)),
      })),
  );

  server.registerTool(
    "traffic_paths",
    {
      title: "访问的路径分布",
      description:
        "按站内路径聚合的 PV 与各日 UV 之和,PV 倒序。路径是**归一后**的值:" +
        "`/`、`/notes`、`/notes/<系列>`、`/notes/<系列>/<章节>`、`/about`," +
        "以及归一不出来的那些的常量桶 `/*`(不存在的 slug、扫描器乱打的地址都落在那里)。",
      inputSchema: {
        days: z.number().int().min(1).max(365).default(30),
        limit: z.number().int().min(1).max(200).default(20),
      },
    },
    async (args) => read("traffic_paths", () => store.trafficPaths(args.days, args.limit)),
  );

  server.registerTool(
    "traffic_agents",
    {
      title: "访问的客户端分布",
      description:
        "按 UA 摘要(`<浏览器族>/<平台族>`,如 Chrome/Windows)聚合。" +
        "**原始 User-Agent 从不落库**(它本身是高熵指纹),库里只有这个闭集摘要。",
      inputSchema: { days: z.number().int().min(1).max(365).default(30) },
    },
    async (args) => read("traffic_agents", () => store.trafficAgents(args.days)),
  );

  // ───────────────────── LLM provider ─────────────────────

  server.registerTool(
    "llm_providers_list",
    {
      title: "列出 LLM provider",
      description: "**key 只回掩码**(sk-…abcd),明文任何路径都拿不到。",
      inputSchema: {},
    },
    async () =>
      read("llm_providers_list", async () =>
        (await store.listProviders()).map((p) => ({ ...p, updatedAt: toIso(p.updatedAt) })),
      ),
  );

  server.registerTool(
    "llm_provider_upsert",
    {
      title: "配置 LLM provider",
      description:
        "provider 是 pi-ai 的 provider id(如 deepseek)。apiKey 加密入库,读回只给掩码。" +
        "**部分更新:省略的字段一律保留库内原值**(baseUrl / models 传 null 才是清空)——" +
        "只想改个 baseUrl 时不必、也不该重报 key 与限额。首次配置必须给出 apiKey 与 modelId。" +
        "baseUrl 用于海外中转端点。**任何配置改动都在下一轮生效**:已在内存里的会话会被" +
        "重建到新配置上(库内历史照常保留,访客无感);新会话直接用新配置。" +
        "唯一例外是新配置解析不出模型 —— 那时既有会话原地不动,只有新会话被拒。" +
        "第一个配好的 provider 自动成为默认。",
      inputSchema: {
        provider: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/, "provider 需为 pi-ai 的 provider id"),
        apiKey: z.string().min(8).max(512).optional().describe("明文;省略 = 保留库内既有 key"),
        baseUrl: z.url().max(512).nullable().optional().describe("中转端点;null = 清空回 provider 默认"),
        modelId: z.string().min(1).max(128).optional(),
        models: z
          .array(z.record(z.string(), z.unknown()))
          .max(64)
          .nullable()
          .optional()
          .describe("自定义模型目录,形状同 pi 的 ProviderConfigInput['models'];内置 provider 不必给"),
        makeDefault: z.boolean().default(false),
        dailyTokenLimit: z.number().int().min(0).optional().describe("R7 消费;0 = 不限"),
        dailyCostLimitCents: z.number().int().min(0).optional().describe("R7 消费;0 = 不限"),
        maxTurnsPerSession: z.number().int().min(0).optional().describe("R7 消费;0 = 不限"),
      },
    },
    async (args) =>
      // summary 里绝不能带 apiKey:审计表也是「读接口」的一种
      write(ctx, "llm_provider_upsert", `provider ${args.provider} model=${args.modelId ?? "(不变)"}`, async () => {
        const r = await store.upsertProvider(args, configEncryptionKey());
        return {
          provider: args.provider,
          status: r.created ? "created" : "updated",
          apiKeyHint: r.apiKeyHint,
          isDefault: r.isDefault,
        };
      }),
  );

  server.registerTool(
    "llm_set_default",
    {
      title: "切换默认 LLM provider",
      description: "默认 provider 的 provider+modelId 就是新会话实际使用的模型。",
      inputSchema: { provider: z.string().min(1).max(64) },
    },
    async (args) =>
      write(ctx, "llm_set_default", `默认 provider → ${args.provider}`, async () => {
        await store.setDefaultProvider(args.provider);
        return { provider: args.provider, status: "default" };
      }),
  );

  server.registerTool(
    "llm_provider_delete",
    {
      title: "删除 LLM provider",
      description: "删掉默认 provider 后站点没有可用模型,/agent/ask 会明确拒绝,直到配置新的。",
      inputSchema: { provider: z.string().min(1).max(64) },
    },
    async (args) =>
      write(ctx, "llm_provider_delete", `删 provider ${args.provider}`, async () => {
        const r = await store.deleteProvider(args.provider);
        return {
          provider: args.provider,
          status: "deleted",
          warning: r.defaultRemains ? undefined : "已无默认 provider,agent 对话将被拒绝",
        };
      }),
  );

  // ───────────────────── 工具启停 ─────────────────────

  server.registerTool(
    "tool_config_list",
    {
      title: "列出 agent 业务工具的启停状态",
      description: "pi agent 注册哪些业务工具由这张表决定(docs/security.md §1 第 1 层)。",
      inputSchema: {},
    },
    async () =>
      read("tool_config_list", async () =>
        (await store.listToolConfig()).map((t) => ({ ...t, updatedAt: toIso(t.updatedAt) })),
      ),
  );

  server.registerTool(
    "tool_config_set",
    {
      title: "启停 agent 业务工具",
      description:
        "dangerous=true 的工具是**双闸**的一闸:这里置 true 之后,还需要服务器 env " +
        "XRAY_UNLOCK_DANGEROUS_TOOLS=1 才会被真正注册。bash/write/任意代码执行类工具永久禁止(规则 9)。",
      inputSchema: {
        name: z.string().regex(/^[a-z0-9][a-z0-9_]{0,63}$/, "工具名需为 snake_case"),
        enabled: z.boolean(),
        dangerous: z.boolean().optional(),
        note: z.string().max(256).optional(),
      },
    },
    async (args) =>
      write(ctx, "tool_config_set", `工具 ${args.name} enabled=${args.enabled}`, async () => {
        const r = await store.setToolConfig(args);
        return { name: args.name, enabled: args.enabled, status: r.created ? "created" : "updated" };
      }),
  );
}

/**
 * 严格 base64 解码。
 *
 * `Buffer.from(s, "base64")` **静默忽略非法字符**:一段被截断或掺了别的东西的
 * 输入会解出一半的图,库里于是躺着一个永远显示不出来的附件,而 tool 回的是成功。
 * 这里回编码一次比对,不一致就拒。
 */
export function decodeBase64Strict(input: string): Buffer {
  const compact = input.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0) {
    throw new ConflictError("dataBase64 不是合法的标准 base64");
  }
  const buf = Buffer.from(compact, "base64");
  if (buf.toString("base64") !== compact) throw new ConflictError("dataBase64 不是合法的标准 base64");
  return buf;
}

/**
 * 文件头校验。声明的 contentType 不等于内容真是那个类型 —— 供图端点会把
 * 库里的 content_type 原样出成响应头,一个「声称是 image/png 的 HTML」就是
 * 同源下的存储型 XSS。魔数是这层的最后一道闸,配合上面的扩展名一致性检查。
 */
export function magicMatches(contentType: string, bytes: Buffer): boolean {
  switch (contentType) {
    case "image/webp":
      return (
        bytes.length >= 12 &&
        bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
        bytes.subarray(8, 12).toString("latin1") === "WEBP"
      );
    case "image/png":
      return bytes.length >= 8 && bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
    case "image/jpeg":
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/gif":
      return (
        bytes.length >= 6 &&
        (bytes.subarray(0, 6).toString("latin1") === "GIF87a" ||
          bytes.subarray(0, 6).toString("latin1") === "GIF89a")
      );
    default:
      return false;
  }
}
