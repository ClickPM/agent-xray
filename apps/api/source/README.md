# source 服务 — Source 源码 tab 的只读面(R-SOURCE)

第五个顶部 tab「Source」的数据面:站点自身源码的快照(线上正在跑的那一版,按 40 位 git SHA 发布)。
设计稿画板 `2n`(首页 README 态)/ `2o`(代码文件态)/ `2p`(加载态),放在 `design/Agent X-Ray Source.dc.html`。

## 端点

| 端点 | 用途 |
|---|---|
| `GET /source` | current 快照头部(sha / shortSha / publishedAt / fileCount / totalBytes / repo / repoUrl)+ **全部文件元信息**(path / kind / bytes / lines,不含内容);目录树由前端从路径长出来。没有 current → `not_found` |
| `GET /source/file?path=` | 单文件(含内容)+ 同一快照的头部。`path` 形状不合法 → `invalid_argument`,不存在 → `not_found`(前端两者都当 404,走画板 2k-B) |

两条都在 `REPEATABLE READ, READ ONLY` 事务里取(`store.ts` 的 `readSnapshot`):发布 commit 与读取并发时,不会把旧版的 sha 配上新版的文件。

## 职责边界

- **只读**。写面在 `apps/api/mcp/` 的五个 `source_*` 工具(三段式发布:`begin` 带 manifest 增量 → `put` 分批 → `commit` 单事务翻 current),
  与 skills(读)/ mcp(写)是同一个分工(`docs/security.md` §4「两个面互不触碰」)。本服务不建表、不写库;
  表在 `agent/migrations/016_source.up.sql`,经 `SQLDatabase.named("agent")` 引用(migrate.sh 只认 agent 一个库)。
- **文件一律当文本返回,永不执行、不 import、不在服务端渲染 markdown**(`docs/security.md` §4 R-SOURCE 补记)。
  `kind` 的闭集与路径规则在 `apps/api/shared/source-pack.ts`,两个面共用同一份判据;发布脚本 `tools/source-publish/rules.mjs`
  重复了一份(它在 Encore app root 之外,规则 6),`shared/source-pack.test.ts` 钉两份一致。
- **agent 侧可读**:`agent_ro` 对两张表有 `SELECT`(迁移 016 显式 GRANT),三个纯函数组工具 `source_list` / `source_read` / `source_search`
  在 `agent/tools.ts`,经 `ro-db.ts` 读同一份 current 快照;它们不经过本服务。
- 仓库名与地址是代码常量(`shared/source-repo.ts`),随快照头部回给前端;`GitHub ↗` 由前端拼 `<repoUrl>/tree/<sha>` 或 `<repoUrl>/blob/<sha>/<path>`。

## 呈现开关

`site_tab_set{source,false}` 只藏导航条与 `/source*` 页面;本服务的两条端点照常服务(R-TABS「边界只到呈现层」)。

## 部署

`dev.ps1` 的 `$hostedServices` 必须含 `source`(漏了的表现是生产 `/api/source` 404、页面全 2k-B)。
快照随 `dev.ps1 ship` 自动发布;首次发版(旧 api 没有 `source_*` 工具)在 `compose up` 之后手动 `dev.ps1 source-publish <host> <sha>`。
