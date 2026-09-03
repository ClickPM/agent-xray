# site 服务 — 站点呈现配置的只读面(R-TABS)

一个端点:`GET /site/tabs`,回「顶部导航的每个 tab 现在露不露」。

## 职责边界

- **只读**。写面在 `apps/api/mcp/` 的 `site_tabs_list` / `site_tab_set`,与 about(读)/ mcp(写)
  是同一个分工(`docs/security.md` §4「两个面互不触碰」)。本服务不建表、不加迁移、不写库。
- **只回呈现与否**。字样、href、路由匹配规则都在前端的 `apps/web/lib/tabs.ts`
  (设计稿画板 1a 的导航条),不由 API 下发 —— CLAUDE.md 规则 7:接后端只换数据源。
- tab 的闭集在 `apps/api/shared/site-tabs.ts`,读写两面共用。库里出现登记表之外的 key 一律丢弃。

## 「隐藏」到底藏掉什么(所有者裁定 2026-09-03)

**呈现层,仅此而已**:

| 藏掉的 | 没藏的 |
|---|---|
| 导航条上那一格不渲染 | `/agent/*`、`/trace/*`、`/notes/*`、`/rss.xml` 等后端端点**照常服务** |
| web 侧该 tab 的页面不可达(404;`runtime` 因为落在站点根路径上,改为 307 到第一个可见 tab) | `GET /site/tabs` 自己(它必须可读,否则前端无从知道该藏谁) |

想让 agent 真的停下来,现成的通路是 `tool_config_set` 关工具、删掉默认 LLM provider,
不是这张表。这条边界同时写在迁移 011 的文件头与 `site_tab_set` 的 description 里。

## 隐藏 `runtime` 的特殊情形

`runtime` 落在站点根路径 `/` 上。它被隐藏时,`/` 不能回 404 —— 那意味着站点首页是一个错误页。
前端改为 307 到登记表里第一个可见的 tab(`apps/web/lib/tabs-server.ts`)——
307 而不是 302,是 Next.js `redirect()` 在 Server Component 里的既定状态码,2026-09-03 生产实测。
「至少留一个可见」由写面保证:`site_tab_set` 拒绝关掉最后一个可见的 tab。
