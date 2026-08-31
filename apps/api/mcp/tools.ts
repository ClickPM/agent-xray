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

/**
 * slug 口径必须与 `apps/api/notes/series.ts` 的 SLUG_RE 一字不差。
 * 两边一旦漂移,表现是「系列页列得出、点开 400」—— 没有任何一侧会报错
 * (R5 的 notes-sync 踩过同一个坑,那条注释随管道删除,判据搬到这里)。
 */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const slug = z.string().regex(SLUG_RE, "slug 需匹配 ^[a-z0-9][a-z0-9-]{0,63}$");

/** 分类圆点色:design token 里的 6 位 hex,不接受任意 CSS 颜色(规则 7 的边界)。 */
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "dot 需为 #RRGGBB");

/** 附件文件名:`<内容哈希>.<ext>`,不含路径分隔符 —— 它直接进 URL。 */
const ASSET_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,95}$/i;

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

/** 单个附件上限。base64 传输会膨胀 4/3,10MB 原文对应约 13.3MB 请求体。 */
const MAX_ASSET_BYTES = 10 * 1024 * 1024;

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
          .regex(ASSET_NAME_RE, "name 需为不含路径分隔符的文件名")
          .describe("形如 <内容哈希>.webp;直接进 URL"),
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
      inputSchema: { seriesSlug: slug, name: z.string().regex(ASSET_NAME_RE) },
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
    { title: "读取 About 页内容", description: "GitHub / origin 双链与「本站如何构建」条目。", inputSchema: {} },
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
      description: "整体覆盖(单行表)。前端接线在 R8,本轮只负责内容入库。",
      inputSchema: {
        githubUser: z.string().max(64).default(""),
        originUrl: z.string().max(512).default(""),
        intro: z.string().max(1024).default(""),
        buildPoints: z.array(z.string().max(256)).max(32).default([]),
      },
    },
    async (args) =>
      write(ctx, "about_set", "About 内容", async () => {
        await store.setAbout(args);
        return { status: "saved" };
      }),
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
        "baseUrl 用于海外中转端点。**改动在下一个新会话生效**,进行中的会话不受影响。" +
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
