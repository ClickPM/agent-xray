// 顶部导航的 tab 登记表(R-TABS,所有者裁定 2026-09-03)。
//
// **字样、href、路由匹配规则都在这里,不由后端下发**(CLAUDE.md 规则 7):
// 导航条长什么样是设计稿画板 1a 的事;后端 `/site/tabs` 只回每个 key 露不露。
// 这个文件因此必须是纯的 —— 它同时被 Server Component(layout / 各页)与
// Client Component(GlobalNav)import,不能碰 `@/lib/api`(那会把服务端
// 请求客户端与 API_INTERNAL_URL 一起打进浏览器 bundle)。取数在 tabs-server.ts。
//
// key 与后端 `apps/api/shared/site-tabs.ts` 的登记表一字不差。新增 tab 时两边
// 都要加(后端还要一条迁移种子),漏了后端的表现是「关不掉」,漏了这里是「压根不显示」。

export type TabKey = "runtime" | "notes" | "skills" | "source" | "about";

export interface TabDef {
  key: TabKey;
  label: string;
  href: string;
  /** 当前 pathname 是否属于这个 tab(决定导航条上哪一格是选中态) */
  match: (pathname: string) => boolean;
  /**
   * R-SOURCE(所有者裁定 2026-09-08 第 7 条「先桌面」):只在桌面导航条出现,移动端 Tab Bar 不列它
   * (iOS 五格上限,且 Source 页没有移动端画板)。`GlobalNav` 不看这个字段;R-TABS 的呈现开关照常对它生效。
   */
  desktopOnly?: boolean;
}

/** 顺序即导航条上从左到右的顺序,也是隐藏 runtime 时「退到哪个 tab」的取用顺序。 */
export const TABS: readonly TabDef[] = [
  { key: "runtime", label: "Runtime", href: "/", match: (p) => p === "/" },
  { key: "notes", label: "Notes", href: "/notes", match: (p) => p.startsWith("/notes") },
  // R-SKILLS(2026-09-03):第四格,画板 2f 的导航条顺序 Runtime · Notes · Skills · About
  { key: "skills", label: "Skills", href: "/skills", match: (p) => p.startsWith("/skills") },
  // R-SOURCE(2026-09-08):第五格,画板 2n 的导航条顺序 Runtime · Notes · Skills · Source · About;移动端不列
  { key: "source", label: "Source", href: "/source", match: (p) => p.startsWith("/source"), desktopOnly: true },
  { key: "about", label: "About", href: "/about", match: (p) => p.startsWith("/about") },
];
