# Round R-SKILLS — Skills 技能库 tab(第四个顶部 tab)

<!-- 保存为 rounds/round-skills/round-skills.md;该轮其他管理产出放同一目录。 -->

> 状态:**未开始(文档就绪、四条裁定已落,2026-09-03;所有者要求另开 session 开工)**
>
> 开工前置动作已完成:任务卡与 ROUNDS.md 拆解已过目,「所有者裁定」四条已定(见下),文档已合并 `main`。

## 目标

访客在第四个顶部 tab「Skills」里,按用途分类浏览所有者收录的 skill(Claude Code / Codex 通用的 `SKILL.md` 目录包,自研 + 精选第三方),
点进详情页能**看到目录树、逐文件预览**(markdown 渲染、代码带行号),并且**一键复制安装命令、跳 GitHub、下载 zip**;
内容全部由所有者经 MCP 管理面发布,前端与画板 `2f / 2g / 2h` 逐一对照;既有三个 tab 与画板一字不差。

可证伪:`/skills` 与 `/skills/<name>` 两个页面在本机跑起来,与画板 2f/2g/2h 逐项对得上;经 MCP 发布一个真实 skill(仓库自带的 `.claude/skills/encore-api` 即可)全链路通(写入 → 页面 → zip 解压回读一致)。

## 范围裁定(所有者 2026-09-03)

- **规则 8:不是例外,是「先改设计稿、再进轮次」**(与 R-TOOLS 同一顺序)。设计稿已于 2026-09-03 从 12 块扩到 **15 块**
  (新增 `2f` 首页 / `2g` 详情页 SKILL.md 态 / `2h` 详情页 Python 文件态,原型加 Skills 两屏),并入 `design/`
  (合并口径见 `design/README.md`:三方合并,本地三处动画 / 进度线优化保留)。**然后**才有这一轮。
- 四个产品问题的答复(设计前问的,答复直接决定了画板形态):
  | 问题 | 裁定 |
  |---|---|
  | 页面深度 | **列表 + 详情页**(不是就地展开、不是只有列表) |
  | 访客怎么拿走 | **复制安装命令 + GitHub 仓库外链 + 站内下载 zip**(三样都要;「复制 SKILL.md 全文」未单独选,但画板 2g/2h 的文件预览头部有 `copy`——按画板做,它复制的是当前文件原文) |
  | 组织方式 | **按用途分类**(与 Notes 首页同构:分类表 + 色点 + 卡片网格) |
  | 收录范围 | **自研 + 精选第三方**(卡片带出处行 + 「自研 / 精选」徽标;第三方带原仓库链接) |
- 设计中途补的硬要求:**每个 skill 要能看到它的目录,并能预览文件——markdown 与 Python 代码**。落在 2g/2h:左栏目录树、右栏预览卡,默认 `SKILL.md`。
- **只读**:没有搜索 / 筛选、没有点赞评论、不显示安装量、没有 RSS;卡片上不放按钮。画板上没有的一律不做。
- **agent 不读 skills**:本轮不给 agent 加 `skills_*` 只读工具、不给 `agent_ro` 授权新表(记 `rounds/BACKLOG.md` 待裁定)。

## 前置

R6(MCP 管理面)、R-TABS(tab 登记表 + 呈现开关:新 tab 走同一套三处登记)、R11(生产已上线)。
无新凭据。**可能有一个新依赖**(zip 打包,见「待所有者裁定」第 1 条)。

## 与画板的对照关系(实现时逐项核对)

| 画板 | 路由 | 数据 |
|---|---|---|
| `2f` Skills 首页 | `/skills` | `GET /skills`:分类(顺序 / 名称 / slug / 色点)× 卡片(name / 徽标 / summary / 元信息行)+ 页脚(总数 / 最近更新) |
| `2g` 详情页 · SKILL.md 态 | `/skills/<name>`(默认文件) | `GET /skills/:name`:头部元信息 + 安装命令 + 文件清单(含内容)+ zip 大小 |
| `2h` 详情页 · Python 态 | `/skills/<name>?file=scripts/review.py` | 同上;当前文件由查询串决定,切换是客户端状态 |
| 既有 12 块的导航条 | 全站 | `TABS` 登记表多一项,`GlobalNav` **零改动** |

画板上的文案是**格式**不是内容:卡片元信息行 = `<出处> · <N> 个文件 · 更新于 <relTime>`(自研出处显示 `@<owner>`,精选显示 `owner/repo`);
详情元信息 = `[v<version> · ]<N> 个文件 · <总大小> · 更新于 <isoDate> · <出处>`(第三方时出处是外链 `出处 owner/repo ↗`);
安装命令 = `npx skills add <repo> --skill <name>`(由 `repo` + `name` 派生,不单独存);zip 按钮文案 `下载 zip · <size>`。

## 数据模型(迁移 `012_skills.up.sql`)

三张表,与 notes 三张同一分工(读面只读、写面在 mcp);**不给 `agent_ro` / `agent_title` / `agent_image` 任何权限**(迁移 006 刻意不设默认授权,不写 GRANT 就是全部答案)。

- `skills_categories(slug PK, name, dot, sort_order, updated_at)` —— 与 `notes_categories` 同形;种子四行 `framework / workflow / review / writing`(色点沿用 Notes 四色)。
- `skills(name PK CHECK '^[a-z0-9][a-z0-9-]{0,63}$', category_slug FK, summary, source_type CHECK IN ('own','curated'), repo, repo_url, version NULL, sort_order, zip BYTEA, zip_size, created_at, updated_at)`
  —— `name` 就是目录名与 URL 段;`repo` 是 `owner/repo`(安装命令用,必填);`repo_url` 是 GitHub 目录外链(**可空**,所有者裁定 2026-09-03;空时 `GitHub ↗` 与「出处 ↗」不渲染,与 About `originUrl` 为空时不渲染同一口径);`zip` 在写入时打好存库(见下)。
- `skill_files(skill_name FK ON DELETE CASCADE, path, kind, content TEXT, size_bytes, line_count, sort_order, PK(skill_name, path))`
  —— **只收文本**(UTF-8、无 NUL),`kind` 由扩展名派生、闭集:`markdown / python / shell / typescript / javascript / json / yaml / toml / text`;
  `SKILL.md` 必须存在且 `sort_order = 0`(排目录树首位)。
- 同轮迁移里给 `site_tab_config` 种一行 `('skills', TRUE)`(R-TABS「新增 tab 要改三处」的第 2 处)。

写面校验(全部在 `skills_upsert` 里做,库级 CHECK 兜底):文件 ≤ 64 个;单文件 ≤ 256 KB;整包 ≤ 512 KB;`path` 相对、无 `..`、不以 `/` 开头、段字符集 `[A-Za-z0-9._-]`、深度 ≤ 4;
`SKILL.md` 的 frontmatter `name` 必须等于 skill `name`;`repo_url` 可空、**有值时**只收 http(s)(与 About `originUrl` 的 `isHttpUrl` 同一口径);`LICENSE` 文件不强制(所有者裁定);未知分类拒;删除仍有 skill 的分类拒。
内容与库内完全一致时整行不动(不刷新 `updated_at`,与 `notes_chapter_upsert` 同一约定)。

## 交付物

**后端**
- `apps/api/agent/migrations/012_skills.up.sql` —— 三张表 + 分类种子四行 + `site_tab_config` 种 `skills`
- `apps/api/shared/site-tabs.ts` —— 登记表加 `{ key: "skills", label: "Skills 技能库", path: "/skills" }`(插在 notes 与 about 之间;`site_tab_set` 的 enum 自动多出 `skills`)
- `apps/api/skills/{encore.service.ts,db.ts,store.ts,skills.ts,zip.ts}` + `README.md` —— 只读面:
  `GET /skills`(首页)· `GET /skills/:name`(详情,**含全部文件内容**,整包 ≤ 512 KB 所以一次取完、文件切换不打后端)·
  `GET /assets/skills/:name.zip`(`api.raw`,流式吐库内 `zip`,`Content-Disposition: attachment`、`nosniff`、一天缓存 + 强 ETag,**不用 `immutable`**,理由同 notes 供图)
- `apps/api/mcp/store.ts` / `tools.ts` —— 八个工具:`skills_categories_list` / `skills_category_upsert` / `skills_category_delete` /
  `skills_list` / `skills_get` / `skills_upsert`(整包:`name, categorySlug, summary, sourceType, repo, repoUrl?, version?, files[{path, content}]`,**整包替换**文件集合)/ `skills_delete`;
  `skills_upsert` 在写入时用 zip 库打包并存 `skills.zip`(管理面工具总数 34 → 42)
- `apps/api/mcp/server.ts` —— INSTRUCTIONS 的「顶部三个 tab」改「四个」,补一句 skills 发布约定
- `apps/api/mcp/README.md` —— 工具表补八条;`apps/api/site/README.md` —— 四个 tab
- `dev.ps1` —— `$hostedServices` 白名单补 `skills`(**R-TABS 漏补 `site` 曾让整站 500 级**,本条列在验收里)
- `deploy/Caddyfile` —— `@skillsZip path_regexp ^/skills/[a-z0-9-]+\.zip$` → `rewrite * /assets{path}` → api(与 `@notesAsset` 同一手法)
- `apps/web/next.config.ts` —— dev 代理补同一条(按 `.zip` 扩展名,动态路由 `/skills/[name]` 不会命中)
- `docs/deploy-environments.md` —— 构建命令的 `--services` 列表补 `skills`;冒烟清单第 1 条改「八个服务各取一个端点」(`GET /skills`)

**前端**(规则 7:既有页面与 `GlobalNav` **零改动**)
- `apps/web/lib/tabs.ts` —— `TabKey` 加 `"skills"`,`TABS` 加 `{ key: "skills", label: "Skills", href: "/skills", match: p => p.startsWith("/skills") }`(第 3 处登记)
- `apps/web/app/(site)/skills/page.tsx` —— 画板 2f(Server Component,`force-dynamic`,`requireVisibleTab("skills")`)
- `apps/web/app/(site)/skills/[name]/page.tsx` —— 画板 2g/2h 的服务端壳(取数、`?file=` 选初始文件、404 门禁)
- `apps/web/components/skills/SkillDetail.tsx`(客户端:目录树选中态、`?file=` 同步、两处 copy 的 1.5s 回落)·
  `FileViewer.tsx`(markdown → frontmatter 键值块 + 既有 `components/Markdown`;代码 → 行号网格)· `lib/highlight.ts`(三 token 高亮的最小 tokenizer:注释 / 字符串 / 关键字,只做 `python / typescript / javascript / shell`,其余 kind 纯等宽)· `lib/frontmatter.ts`(只切 `---` 围起来的 `key: value` 行,不引 yaml 库)
- `apps/web/lib/api-client.ts` —— `dev.ps1 gen` 产物(新增 `skills` 命名空间,mcp 仍排除)

**测试**
- `apps/api/skills/skills.test.ts`(读面:分类顺序、SKILL.md 首位、未知 name、zip 回读)
- `apps/api/mcp/mcp.test.ts` 新增 describe(写面校验逐条、幂等、级联删除、分类删除拒绝、工具总数闸 42)
- `apps/api/site/tabs.test.ts` 的「种子 ↔ 登记表一致」自动覆盖新 tab;`apps/api/agent/sandbox.test.ts` 加断言:`agent_ro` 读 `skills` 三表 `permission denied`

**文档**
- `docs/security.md` §1 第 2 层 / §4 的 R-SKILLS 补记(本次已随文档轮写入,实现时若有偏离先改文档)
- `docs/architecture.md` 总览已标「待实现」,收口时去掉标注
- `docs/releases.md` —— 发生产时记一行

## 验收

| # | 检查 | 命令 / 期望 |
|---|---|---|
| 1 | 编译与全量测试 | `dev.ps1 check` 通过;`dev.ps1 test` 全绿(本轮之前 16 文件 388 用例,新增用例数回填) |
| 2 | 三处登记齐 | `site/tabs.test.ts` 种子 ↔ 登记表一致通过;`site_tab_set` 的 enum 下发 `runtime, notes, skills, about` |
| 3 | 写面校验 | `mcp.test.ts`:缺 `SKILL.md` / frontmatter `name` 不符 / `..` 路径 / 绝对路径 / 非法字符 / 深度 > 4 / 单文件 > 256 KB / 整包 > 512 KB / > 64 文件 / 含 NUL / 未知分类 / `repoUrl` 有值但非 http(s) —— 逐条被拒,库无残留;**不带 `repoUrl`、不带 `LICENSE` 的 curated 包能发布**(所有者裁定非必填) |
| 4 | 幂等 | 同内容重发 → `status: unchanged`,`updated_at` 不动;改一个文件 → `updated`,zip 重打 |
| 5 | 级联与分类保护 | `skills_delete` 后 `skill_files` 无残留;`skills_category_delete` 对仍有 skill 的分类 → `ConflictError` |
| 6 | 读面 | `GET /skills` 分类按 `sort_order`、卡片按 `sort_order`、页脚统计正确;`GET /skills/<name>` 文件顺序 `SKILL.md` 首位;未知 name → 404 |
| 7 | zip | `GET /skills/<name>.zip` 200、`application/zip`、`Content-Disposition` 文件名 = `<name>.zip`;解压后文件集合与内容与库内一致(测试里回读);未知 → 404;**经 next dev 代理与经 Caddy 两条路径都通** |
| 8 | 画板 2f 对照 | 本机实跑截图:四分类 + 色点、徽标色(自研蓝 / 精选灰)、卡片三行、页脚两行、hover 态 |
| 9 | 画板 2g/2h 对照 | 默认 `SKILL.md`:frontmatter 块 + 正文 + 「本页目录」;点 `.py`:行号列、三 token 高亮、「本页目录」消失;`?file=` 深链直达;两处 copy 点击后 1.5s 显示 `copied` 再回落;`repoUrl` 为空的 skill 不渲染 `GitHub ↗` 与出处链接、其余版式不变 |
| 10 | 呈现开关 | `site_tab_set{skills,false}` → 导航条三格、`/skills` 与 `/skills/<name>` 404;恢复 → 四格,与画板 1a(四格版)一字不差 |
| 11 | 安全 | 含 `<script>` / `<img onerror>` 的 md 与 py 文件在页面上只是文本;`repoUrl` 为 `javascript:` 时写面拒、前端 `safeExternal` 二次拦;zip 响应带 `nosniff`;`sandbox.test.ts`:`agent_ro` 读 skills 三表 `permission denied` |
| 12 | 镜像白名单 | `dev.ps1 build` 的服务列表含 `skills`;镜像里 `GET /skills` 非 404(冒烟清单第 1 条,八服务) |
| 13 | 真实 MCP 协议路径 | 用 `XRAY_MCP_TOKEN` 对本机 `/mcp` 发 2026-07-28 契约:`tools/list` 总数 42;`skills_upsert` 发布仓库自带的 `.claude/skills/encore-api`(整包)→ 页面出现 → zip 解压与源目录一致 |
| 14 | gen client | `dev.ps1 gen` 后 `api-client.ts` 含 `skills` 命名空间、不含 `mcp`;前端类型对得上 |

## 禁止

- 不改前端页面样式(规则 7):既有三 tab 页面、`GlobalNav.tsx`、`Markdown.tsx` 零改动;新页面严格照画板 2f/2g/2h。
- 不加设计稿没有的功能(规则 8):无搜索 / 筛选 / 排序、无点赞评论、无安装量、无 RSS、卡片无按钮、无「查看原始文件」新页面。
- **不执行任何 skill 文件、不做服务端 markdown 改写、不收二进制文件**;文件内容一律当文本进 React(转义)与既有 `Markdown` 组件(不开 raw HTML)。
- 不给 agent 加读 skills 的工具、不给 `agent_ro` 授权新表(BACKLOG 待裁定)。
- 不在 `/skills` 之外新增站点路由;zip 的 API 侧路径固定 `/assets/skills/…`(与 notes 供图同一前缀策略,避开 Encore 同层字面量 / 通配撞车)。
- 不动 `.secrets.local.cue` 与任何环境的 token / 密钥;不升级 encore CLI / MCP SDK(规则 12)。

## 所有者裁定(2026-09-03,开工前四条已定)

1. **zip 打包库 → 裁定:默认,`fflate`**(纯 JS、无原生依赖、`zipSync` 一次调用;bun 下可用)。新增一个生产依赖,落地时记进「本轮实测」并钉 exact 版本。
   备选(未采用):自写 stored-method zip 写入器。
2. **精选第三方 skill 的许可与仓库链接 → 裁定:均非必填**。`LICENSE` 文件不强制、`repoUrl` 可空,`skills_upsert` 不因缺它们拒绝;
   许可合规由所有者在收录时自行把关(只收允许再分发的包)。`repoUrl` 有值时仍走 http(s) 两道校验;为空时前端不渲染 `GitHub ↗` 与出处链接(About `originUrl` 先例)。
3. **自研 skill 的真实仓库 → 裁定:默认**,即**不设全局默认值**:`repo`(`owner/repo`)是每个 skill 发布时 `skills_upsert` 的必填字段,安装命令由它派生;画板里的 `ClickPM/agent-skills` 只是示例数据,不入库、不写死在代码里。
4. **代码高亮 → 裁定:默认,按画板做三 token 高亮**(自写最小 tokenizer,只做 `python / typescript / javascript / shell`,不引高亮库)。

## 已知边界(不在本轮修,写明)

1. skill markdown 里的**相对链接 / 相对图片**不解析(站内不提供 skill 的资源文件),渲染成什么就是什么;`references/*.md` 里指向同目录文件的链接会 404。
2. 详情页一次取回整包内容(≤ 512 KB),大包首屏会重一些;上限就是为此设的,不做分文件懒加载。
3. 与 R-TABS「已知边界 1」同类:About 页没有指向 `/skills` 的链接,不受隐藏影响;Notes 页亦然。
4. 隐藏 `skills` 时 zip 端点照常服务(与 R-TABS「边界只到呈现层」一致)。

## 止损

回退成本:删 `apps/api/skills/`、`apps/web/app/(site)/skills/`、`components/skills/`,登记表两处各删一行,Caddy / next 各删一条路由;
表由一条新迁移 `DROP`(`deploy/migrate.sh` 口径,不回滚已施加迁移)。临时下架不用回退:`site_tab_set{skills,false}` 即可。

## 代码审查

<!-- 完成后回填。审查路由见 CLAUDE.md「开发模式」:codex 独立审查,硬失败才降级 /code-review。 -->

- 审查方式:<codex /codex:review --background(改动跨前后端十余文件)>
- findings 处理:<逐条:采纳整改 / 不采纳及理由>
- 结论:<PASS | 整改后 PASS>

## 失败处理

同一验收项针对性整改后连续 2 次验证仍不过 → 写 `rounds/round-skills/BLOCKED.md`,停下呼人。禁止放宽验收标准自我通过。

## 本轮实测

<!-- 完成后回填:实际数字、踩的坑、与设计/计划的偏离及原因 -->

### 文档轮留证(2026-09-03)

- 设计稿:云端 Claude Design 项目(`1a257a60-…`)经 `DesignSync` 拉回三份文件;`support.js` md5 与本地一致未动;两份 `.dc.html` 以 `16a82bd` 为 base 三方合并(零冲突),本地 `omWaveSweep` / `omSpin` / 阅读进度线注释全部保留,云端 2f–2h、四格 tab、原型 Skills 两屏全部并入(核验:合并稿相对本地**零删除行**,Prototype 仅三行为云端有意改动的基线行;`<div>` / `<sc-for>` / `<sc-if>` 开合计数两份文件均配平)。
- 给 Claude Design 的提示词与原型 HTML 原稿未入库(scratchpad 产物,画板已是终稿)。
