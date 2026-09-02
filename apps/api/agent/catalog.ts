// R-TOOLS:Tools 面板的只读目录端点(设计稿 1f/1g;所有者裁定 2026-09-02,ROUNDS.md「R-TOOLS」)。
//
// 回答的是「这个 agent 具备什么能力」,与有没有正在运行的会话无关 —— 所以它不读会话、
// 不读 `tool_config`、不读任何配置表,是一个纯函数端点。目录**静态**:六个工具全列,
// `web_search` / `generate_image` 未配置或被关掉时照样列出(所有者待裁定项,见任务卡「待所有者裁定」)。
//
// **端点不得吐**(所有者裁定):`execute` 函数、`ActiveWebSearchConfig` 的任何字段
// (baseUrl / key / model / provider)、`dailySearchLimit` 与当日用量、`tool_config` 的 enabled。
// 落点是 `publicEntry` 的**白名单序列化**:只按名取字段,不 spread —— 将来 META 上多出什么,
// 这里不点名就出不去。catalog.test.ts 对响应做 grep 兜底。
import { api } from "encore.dev/api";
import {
  GENERATE_IMAGE_META,
  MAX_RESULT_CHARS,
  SESSION_TOOL_REGISTRY,
  TOOL_REGISTRY,
  WEB_SEARCH_META,
  type ToolMeta,
  type ToolParametersSchema,
} from "./tools";

/**
 * 工具分组 = 注册路径(docs/security.md §1「工具分两组」+ R-TITLE 补记的第三档):
 *   pure     —— 在 `TOOL_REGISTRY`(纯函数组:只读 notes 三张表,不联网)
 *   outbound —— 经 `makeWebSearchTool` / `makeGenerateImageTool` 构造(外呼组:持服务端凭据打白名单域;
 *               `generate_image` 同时按会话绑定,但它的**性质**是外呼 —— 分组按「凭据从哪来」判)
 *   session  —— 在 `SESSION_TOOL_REGISTRY`(会话绑定组:闭包绑定会话 id,只写本会话标题)
 * 前端按这个值挑分组文案与颜色,**不按工具名**。
 */
export type ToolGroup = "pure" | "outbound" | "session";

/** 面板上一条工具的全部内容。字段集就是白名单:多一个要在 `publicEntry` 里点名。 */
export interface ToolCatalogEntry {
  name: string;
  label: string;
  description: string;
  group: ToolGroup;
  /** 入参 JSON Schema,与工具定义里的**同一份**(测试逐字段钉死) */
  parameters: ToolParametersSchema;
  /** 输出形态说明 */
  output: string;
  /** 输出形态的补充(上限 / 边界情形) */
  outputNote?: string;
  /** 执行期间会上报的阶段文案(按顺序);只有会上报进度的工具才有 */
  phases?: string[];
}

export interface ToolCatalogResponse {
  /** 按分组顺序:纯函数组 → 外呼组 → 会话绑定组;组内按注册顺序 */
  tools: ToolCatalogEntry[];
  /**
   * 单个工具结果**正文**的字符上限(`capText` 的预算),面板脚注「工具结果正文统一 N 字符上限」用。
   *
   * 【是正文预算,不是整段结果的长度】(codex 初审 P2)`capText` 超限时把正文截到 N 字符,
   * **再追加一行显式的截断标注**(「…(已截断,原文共 M 字符)」),标注不计入 N。
   * 所以模型 / 轨迹面板实际拿到的文本可以略长于 N —— 这里公开的是「正文最多这么多」这条契约,
   * 不是「结果总长不超过」。catalog.test.ts 把这条语义钉死(N 字符不截;N+1 字符 = 前 N 字符原样 + 标注)。
   *
   * 是代码常量不是配置值(不在库里、不在 env 里,设计稿上本来就印着),
   * 从源头取而不是前端写死 —— 否则它就是「第二个要改的地方」。
   */
  resultBodyCharLimit: number;
}

/**
 * 白名单序列化:**只按名取字段**。`meta` 上多出来的任何东西(将来有人加的、或者
 * `{ ...META, execute }` 摊进定义对象的 `execute` 本身)都到不了这里。
 * `parameters` 深拷贝一份:响应不该持有工具定义里那个活对象的引用。
 */
function publicEntry(meta: ToolMeta, group: ToolGroup): ToolCatalogEntry {
  return {
    name: meta.name,
    label: meta.label,
    description: meta.description,
    group,
    parameters: structuredClone(meta.parameters),
    output: meta.output,
    ...(meta.outputNote !== undefined && { outputNote: meta.outputNote }),
    ...(meta.phases !== undefined && { phases: [...meta.phases] }),
  };
}

/**
 * 目录:**从三条构造路径派生**,不手工维护(所有者裁定 2026-09-02:面板永远不是第二个要改的地方)。
 *
 *   - `TOOL_REGISTRY` 的每一项 → 纯函数组(定义对象就是 `{ ...META, execute }`,META 在对象上)
 *   - `WEB_SEARCH_META` / `GENERATE_IMAGE_META` → 外呼组(它们没有注册表:`makeWebSearchTool(cfg)` /
 *     `makeGenerateImageTool(cfg, ctx)` 没配置就构造不出来,但 META 是模块常量,不依赖 cfg / ctx ——
 *     这正是「未配置时也照样列出、且不暴露配置缺失细节」的来源)
 *   - `SESSION_TOOL_REGISTRY` 的每一项 → 会话绑定组(工厂带 `meta`,不用先造一个假会话)
 *
 * 【已知的一个洞,不要假装没有】派生只覆盖它**认识**的构造路径 —— 今天是这四条。将来有人加
 * **第五条**构造路径且不进 META,这里看不见它。兜底不在这里,在 catalog.test.ts 的双向集合相等:
 * 目录的 name 集合必须等于「两个注册表 + web_search + generate_image」的并集,**且**迁移里
 * `tool_config` 种下的每个名字都要有目录项。新工具必经这两处(注册 + 种启停行),漏一处就红。
 */
export function toolCatalog(): ToolCatalogEntry[] {
  return [
    ...Object.values(TOOL_REGISTRY).map((definition) => publicEntry(definition, "pure")),
    publicEntry(WEB_SEARCH_META, "outbound"),
    publicEntry(GENERATE_IMAGE_META, "outbound"),
    ...Object.values(SESSION_TOOL_REGISTRY).map((factory) => publicEntry(factory.meta, "session")),
  ];
}

/**
 * `GET /agent/tools` —— 工具目录。公开、无需鉴权,与其它访客端点同口径。
 * 不碰库,所以没有 `sensitive`(响应里本来就没有任何凭据或访客数据可脱敏)。
 */
export const listTools = api(
  { expose: true, method: "GET", path: "/agent/tools" },
  async (): Promise<ToolCatalogResponse> => ({
    tools: toolCatalog(),
    resultBodyCharLimit: MAX_RESULT_CHARS,
  }),
);
