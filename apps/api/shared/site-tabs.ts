// 顶部导航 tab 的**登记表**(R-TABS,所有者裁定 2026-09-03)。
//
// 读面(`apps/api/site/`)与写面(`apps/api/mcp/`)都要知道「站点上到底有哪几个 tab」,
// 而两个面刻意不互相 import(docs/security.md §4「两个面互不触碰」),所以判据落在 shared/ ——
// 与 `websearch-hosts.ts` / `imagegen-hosts.ts` 是同一个安排。
//
// 【这份清单是闭集,不是提示】库里出现登记表之外的 key(手工改库、或将来删掉某个 tab
// 之后遗留的行)一律被读面丢弃、被写面拒绝 —— 与 `tool_config` 的
// 「未知名字不会凭名字长出工具」是同一条口径(apps/api/agent/sandbox.test.ts)。
//
// 【新增一个 tab 要改三处,缺一处的表现各不相同】
//   1. 本文件加一项            —— 漏了:MCP 关不掉它,读面也不会报告它
//   2. 一条迁移种一行 seed     —— 漏了:读面按缺行兜底成 visible=true,同样关不掉(不报错)
//   3. 前端 `apps/web/lib/tabs.ts` 加同 key 的一项 —— 漏了:后端能关,但导航条上根本没有它
// 1↔2 的一致性有测试钉着(apps/api/site/tabs.test.ts);1↔3 靠前端那份登记表的字面量类型。
//
// 【label / path 只是给管理端看的说明文本】渲染用的字样与路由匹配规则在前端
// (`apps/web/lib/tabs.ts`,设计稿画板 1a 的导航条),**不由后端下发** ——
// CLAUDE.md 规则 7:接后端只换数据源,不把版式搬进 API。

/**
 * 顺序即导航条上的顺序。
 *
 * `as const` 不是洁癖:`key` 的字面量类型是 `site_tab_set` 那个 `z.enum` 的取值来源,
 * 写成 `readonly SiteTabMeta[]` 的话 key 会退化成 `string`,enum 就不再向 MCP 客户端
 * 下发「可用的三个值」,管理端只能猜键名。
 */
export const SITE_TABS = [
  { key: "runtime", label: "Runtime 工作台", path: "/" },
  { key: "notes", label: "Notes 研习库", path: "/notes" },
  // R-SKILLS(2026-09-03):第四个 tab,插在 notes 与 about 之间(画板 2f 的四格导航条顺序)
  { key: "skills", label: "Skills 技能库", path: "/skills" },
  { key: "about", label: "About", path: "/about" },
] as const;

export type SiteTabMeta = (typeof SITE_TABS)[number];

/** 登记在册的 tab key —— 与 `site_tab_config.key` 及前端登记表的 key 一字不差 */
export type SiteTabKey = SiteTabMeta["key"];

export const SITE_TAB_KEYS: readonly SiteTabKey[] = SITE_TABS.map((t) => t.key);

/**
 * key 是否在登记表内。
 *
 * 用数组的 `includes` 而不是对象的 `in`:后者会命中 `Object.prototype` 上的名字
 * (`constructor` / `toString` 等),而这个判断的入参是管理端可以随便填的字符串
 * —— sandbox.test.ts 为 `tool_config` 记过同一个坑。
 */
export function isSiteTabKey(key: string): key is SiteTabKey {
  return (SITE_TAB_KEYS as readonly string[]).includes(key);
}
