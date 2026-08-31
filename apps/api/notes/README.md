# notes 服务

教程库查询与 RSS(R5 已落地);pi 只读工具组待 R6。

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
服务只读:内容由 `tools/notes-sync` 从 vault `学习分享/` 同步入库,
操作规程见 `.claude/skills/sync-notes/SKILL.md`。

## 待实现(R6)

- **pi 只读工具组**(`defineTool`):`notes_list_series` / `notes_get_chapter` / `notes_search`
  - 连接串用 `AGENT_RO_DATABASE_URL`(`agent_ro` 角色,仅 SELECT `notes_*` 三张表)
    —— pi 可读教程、物理上不可改(`docs/security.md` §1 第 2 层)
  - 授权语句在建表之后补(顺序见 ROUNDS.md R9)
