# notes 服务

教程库查询、RSS(R5)与正文配图供图(R6);pi 只读工具组待 R7(2026-08-31 轮次对调)。

## 已实现(R5)

- 表:`notes_categories` / `notes_series` / `notes_chapters`,建在 **agent 库**
  (`agent/migrations/002_notes.up.sql`)。不新开 `SQLDatabase`:`deploy/migrate.sh`
  只配置了 agent 一个库,发现第二个 migrations 目录会直接拒绝执行。
- 查询端点(`series.ts`):
  - `GET /notes/series` — 四分类 × 系列卡 + 首页「最新」行
  - `GET /notes/series/:slug` — 系列元信息 + 章节表
  - `GET /notes/series/:series/chapters/:chapter` — 正文 + 上下章
- RSS(`rss.ts`,`api.raw`):`GET /rss.xml` 与 `GET /rss/<category>.xml`。
  地址在**站根**而不是 `/api` 下(设计稿画板 2d 的订阅地址如此),
  所以 `deploy/Caddyfile` 与 `next.config.ts` 各有一条对应路由,少了就 404。

正文以**标准 markdown** 返回,渲染在前端(所有者裁定 2026-08-31)。
服务只读:内容由所有者经 **MCP 管理服务**发布(`apps/api/mcp/`;入参即标准 markdown,只校验不改写)。
R5 的 `tools/notes-sync` 管道与 sync-notes skill 已随 R6 删除(存量数据不动)。

## 已实现(R6):正文配图供图

- `GET /assets/notes/:series/:file`(`assets.ts`,`api.raw`)—— 从 `notes_assets` 读二进制,
  带一天缓存与强 ETag。**不用 `immutable`**:文件名按约定是内容哈希,但同名覆盖是
  所有者纠错的唯一手段,`immutable` 会让覆盖后的一年里浏览器永不复验(codex review P2)。
  写面在 mcp 服务(全权角色),读面在这里(`docs/security.md` §4「两个面互不触碰」)。
- **对外 URL 仍是 `/notes/<系列>/<哈希>.webp`**,不带 `/assets` —— 存量正文里的 markdown
  就是这么写的,改 URL 等于要改写全部存量文章。桥接由 `deploy/Caddyfile`(生产)
  与 `next.config.ts`(开发)按**扩展名**分流完成。
- **为什么 API 侧要换个前缀**:Encore 路由里 `/notes/:series/:file` 会与既有的
  `/notes/series/:slug` 撞车(同一层上一个字面量、一个通配)。
- **为什么按扩展名而不是整段前缀**:文章页地址 `/notes/<系列>/<章节>` 与图片地址同形,
  唯一可靠的区分是扩展名。Next 的数组式 `rewrites` 属 afterFiles,在**动态路由之前**生效 ——
  写成 `/notes/:series/:file` 会把文章页一并劫走。

## 待实现(R7,原 R6)

- **pi 只读工具组**(`defineTool`):`notes_list_series` / `notes_get_chapter` / `notes_search`
  - 连接串用 `AGENT_RO_DATABASE_URL`(`agent_ro` 角色,仅 SELECT `notes_*` 三张表)
    —— pi 可读教程、物理上不可改(`docs/security.md` §1 第 2 层)
  - 授权语句在建表之后补(顺序见 ROUNDS.md R9)
