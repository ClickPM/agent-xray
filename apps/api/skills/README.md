# skills 服务 — Skills 技能库的只读面(R-SKILLS)

第四个顶部 tab「Skills」的数据面:按用途分类的 skill 目录包(Claude Code / Codex 通用的 `SKILL.md` 目录),自研 + 精选第三方。
设计稿画板 `2f`(首页)/ `2g`(详情 SKILL.md 态)/ `2h`(详情 Python 态)。

## 端点

| 端点 | 用途 |
|---|---|
| `GET /skills` | 首页:只含有 skill 的分类 × 卡片(名字 / 出处 / 一句话 / 文件数 / 更新时间)+ 页脚统计(总数、最近更新) |
| `GET /skills/:name` | 详情:元信息 + **全部文件内容**(整包 ≤ 512 KB,一次取完、文件切换不打后端)+ zip 大小 |
| `GET /assets/skills/:file`(`api.raw`,`GET`/`HEAD`) | `<name>.zip` 下载:库内打好的 zip 原样吐出,`application/zip` + `attachment` + `nosniff` + 一天缓存 + 强 ETag(= 内容哈希,**不用 `immutable`**,理由同 notes 供图) |

## 职责边界

- **只读**。写面在 `apps/api/mcp/` 的八个 `skills_*` 工具(整包发布),与 notes(读)/ mcp(写)是同一个分工(`docs/security.md` §4「两个面互不触碰」)。
  本服务不建表、不打包、不写库;表在 `agent/migrations/012_skills.up.sql`,经 `SQLDatabase.named("agent")` 引用(migrate.sh 只认 agent 一个库)。
- **文件一律当文本返回,永不执行、不 import、不在服务端渲染 markdown**(`docs/security.md` §4 R-SKILLS 补记)。
  `kind` 的闭集与路径规则在 `apps/api/shared/skill-pack.ts`,两个面共用同一份判据。
- **agent 侧本轮不可读**:三张表不授权 `agent_ro` / `agent_title` / `agent_image`(所有者裁定 2026-09-03;`agent/sandbox.test.ts` 钉住)。
  R-SKILLS-2 只会给 `skills` 加一列 `agent_enabled`,注入来源是编译进 api 的代码清单,不是这张表。

## 对外 URL 与 API 路径为什么不一样

对外的下载地址按画板是站根下的 `/skills/<name>.zip`,但 Encore 路由里 `/skills/:file` 会与详情的 `/skills/:name` 撞车(同一层两个通配),
所以 API 侧是 `/assets/skills/<name>.zip`,由 `deploy/Caddyfile`(生产,`@skillsZip`)与 `apps/web/next.config.ts`(开发)按 **`.zip` 扩展名**分流并补 `/assets` 前缀 ——
与 notes 配图的 `/notes/<系列>/<哈希>.webp` → `/assets/notes/…` 同一手法。详情页地址不带扩展名,不会被劫走。少了这两条的表现是「下载 zip」按钮 404 到 Next 上。

## 呈现开关

`site_tab_set{skills,false}` 只藏导航条与 `/skills*` 页面;本服务的三条端点(含 zip)照常服务(R-TABS「边界只到呈现层」)。
