// tab 呈现开关的取数与门禁(R-TABS),**只能在 Server Component 里用**:
// 它 import 了 `@/lib/api`(服务端渲染用的客户端,读 API_INTERNAL_URL)与
// `next/navigation` 的 notFound / redirect。渲染用的登记表在纯的 `./tabs` 里。
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { api } from "./api";
import { TABS, type TabKey } from "./tabs";

/**
 * 本次渲染里可见的 tab,顺序取前端登记表的顺序。
 *
 * 用 React 的 `cache` 包一层:布局要它渲染导航条、页面要它做门禁,同一次请求里
 * 两边各调一次 —— 不去重的话每个页面都会多打一次后端。`cache` 的作用域正是
 * 「一次 render pass」,跨请求不共享,所以所有者在 MCP 里一改,下一次渲染就生效
 * (`site_tab_set` 的 description 是这么承诺的)。
 *
 * 【两条兜底方向与后端一致】后端不认识的 key(前端新加了 tab 而后端还没有)按可见处理;
 * 后端回了前端没有的 key 则被忽略 —— 站点上出现什么由这份前端登记表决定。
 *
 * 【取数失败不兜底,原样抛】与 `lib/api.ts` 的 notFoundOnBadRoute 同一条口径:
 * 后端不可达是真故障,不能伪装成「这些 tab 不存在」。兜成「全部可见」更糟 ——
 * 那意味着一次后端抖动会把所有者刚藏起来的 tab 重新露出来。
 */
export const visibleTabKeys = cache(async (): Promise<TabKey[]> => {
  const { tabs } = await api.site.listTabs();
  const hidden = new Set(tabs.filter((t) => !t.visible).map((t) => t.key));
  return TABS.filter((t) => !hidden.has(t.key)).map((t) => t.key);
});

/**
 * 该 tab 被隐藏时把当前页变成 404。
 *
 * 404 而不是重定向:Notes / About 被藏起来时,它们的地址应该表现得像站点上没有这一块
 * —— 重定向会让一个被藏起来的地址仍然"有反应",反而暴露它存在过。
 * 站点根路径 `/` 是唯一的例外,见 `redirectAwayFromRuntime`。
 */
export async function requireVisibleTab(key: TabKey): Promise<void> {
  const visible = await visibleTabKeys();
  if (!visible.includes(key)) notFound();
}

/**
 * `runtime` 被隐藏时,把站点根路径让给第一个仍可见的 tab。
 *
 * 这里不能用 404:`/` 是站点首页,回 404 意味着"这个网站坏了"。
 * 「至少留一个可见 tab」由写面保证(`site_tab_set` 拒绝关掉最后一个),
 * 所以正常情况下必有落点;真的一个都没有时(有人绕过 MCP 直接改库)才回 404 ——
 * 那是一个配置错误,不该由前端悄悄编一个页面出来遮住它。
 */
export async function redirectAwayFromRuntime(): Promise<void> {
  const visible = await visibleTabKeys();
  if (visible.includes("runtime")) return;
  const target = TABS.find((t) => visible.includes(t.key));
  if (!target) notFound();
  redirect(target.href);
}
