# about 服务(R8 已落地)

About 页(设计稿画板 2e)的内容查询。**只读**。

## 端点

`GET /about` —— 返回 `about_content` 单行表的全部内容:

| 字段 | 画板位置 |
|---|---|
| `githubUser` | 头像(`https://github.com/<user>.png`)、`@handle`、GitHub ↗ 按钮 |
| `originUrl` | GitHub 按钮旁的第二条外链(ROUNDS.md R8「github/origin 双链」) |
| `intro` | 头部简介 |
| `buildPoints` | 「本站如何构建」逐条 |
| `repos` | 「公开仓库」卡片(R8 新增列) |
| `langBar` | 底部语言构成条(R8 新增列) |

空表(新环境还没经 MCP 写过内容)回全空而不是 404 —— About 页此时应该是一个
空页,而不是让整个 Tab 变成错误页。

## 边界

- **只读**:`about_content` 的 schema 与迁移归 mcp 服务的建表迁移
  (`agent/migrations/003_mcp_admin.up.sql` + `005_about_showcase.up.sql`);
  本服务经 `SQLDatabase.named("agent")` 引用,不建表、不加迁移、不写库。
- 写面在 mcp 的 `about_set`(全权 DB 角色),读面在这里 —— 与 notes(读)/ mcp(写)、
  trace(读)/ agent(写)是同一个分工(`docs/security.md` §4「两个面互不触碰」)。
- **两处会被拼进 URL 的字段在写入侧就收紧了**:`githubUser` 按 GitHub 用户名字符集、
  `repos[].name` 按仓库名字符集、`originUrl` 限定 http(s) scheme(见 `mcp/tools.ts`)。
  前端另有一道 scheme 白名单 —— 库是可以绕过 tool 直接改的,而这些值会进 `<a href>`。
