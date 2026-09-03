// R-TABS:顶部导航 tab 的呈现开关查询端点(所有者裁定 2026-09-03)。
//
// 开关由所有者经 **MCP 管理面**的 `site_tab_set` 维护(`apps/api/mcp/`);
// 本服务只读。前端 `apps/web/app/(site)/layout.tsx` 是 Server Component,
// 经生成客户端调用这里,再把可见的 key 传给 `GlobalNav`。
//
// **本端点只回「呈现与否」,不回样式、不回字样、不回路由**(CLAUDE.md 规则 7):
// 导航条长什么样是设计稿画板 1a 的事,前端自己有一份 key → 字样/href 的登记表。
import { api } from "encore.dev/api";
import * as store from "./store";

export interface SiteTab {
  /** 与 apps/web/lib/tabs.ts 的 key 一字不差 */
  key: string;
  /** false = 导航条不渲染它,且它的页面在 web 侧不可达 */
  visible: boolean;
}

export interface ListTabsResponse {
  /** 顺序即登记表顺序;库里没有配置过的 tab 一律回 visible=true */
  tabs: SiteTab[];
}

export const listTabs = api(
  {
    expose: true,
    method: "GET", path: "/site/tabs",
    // 【R-VISITOR】访客 cookie 的 Path 是 `/`,浏览器**直接访问这条路径时会把它一并带来**
    // (哪怕本端点根本不看它)。不设 sensitive 的话,一个可冒充身份的凭据会进 trace。
    // 口径见 shared/visitor-cookie.ts 的「Path=/ 的连带义务」与 docs/security.md §6。
    sensitive: true,
  },

  async (): Promise<ListTabsResponse> => ({ tabs: await store.listTabs() }),
);
