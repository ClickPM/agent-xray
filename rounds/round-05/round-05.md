# Round 05 — notes 服务与内容摄入

> 状态:进行中(实现与自验完成,待 codex 审查)

## 目标

vault `学习分享/` 的 293 篇正文经**一条幂等的同步管线**进入 Postgres,notes 服务把它们喂给 Notes 三级页与四分类 + 全站 RSS;重跑同步不产生重复数据,RSS 过校验器。

## 前置

- R2 数据层与 `encore test` 基建已完成(本轮迁移在 `agent` 库上追加 `002`)。
- vault 位于本机 `D:\variFlight_work\VariFlightWork\学习分享`(独立 git 仓,只读消费,本轮不写它)。
- R3/R4 未完成不阻塞本轮:Notes 与 Runtime 无数据耦合。

## 所有者裁定(2026-08-31)

摄入方案经所有者逐条确认,口径如下,实现不得偏离:

| # | 决策 | 结论 |
|---|---|---|
| 1 | 摄入形态 | **不做「快照进仓 / 打进镜像 / 构建时现读」三选一**,改为提供一个专门的 **skill `sync-notes`** 驱动同步。skill 默认对当前目标库 upsert;另留 `--emit-sql` 产出可传输 SQL,130/生产怎么落由 R9 定 |
| 2 | 正文形态 | **库里存标准 markdown,前端渲染**(方案 B)。vault 的 **Obsidian 专有语法必须在同步阶段改写成标准语法** |
| 3 | 图片 | **压缩后进 `apps/web/public/notes/`**(方案 A):只收正文引用到的图,转 WebP + 宽度上限 1600px |
| 4.1 | frontmatter | **不保留**:元数据抽成库字段,正文里不留 frontmatter 块 |
| 4.2 | AI 资料 | **只收 60 篇中译**,英文原文不入库;**保留 `source` 原链**挂在文章页 |
| 4.3 | 教材范围 | Encore(含 20 章深度教程)/ Rust / TypeScript **全融入**;**Rust 教材只保留 markdown 正文**;**任何正文都不得引用 `原始资料/`**(抓取素材,无授权) |
| 4.4 | 内容分享 | **不同步**(与所有者工作相关)。设计稿的 `sharing` 卡片保留,走已有的「本系列章节整理中」占位态 |

裁定之外、由实现侧定并在此备案的三条:

- **`wiki_exclude: true` 一律忽略**。带该标记的四个系列是 Agent基础知识 / Encore / Rust / TypeScript,而 4.3 明确要后三者全融入 —— 该标记只服务所有者另一条 wiki 管线,不是本站的发布闸。
- **`原始资料/` 不摄入**(583 篇抓取素材),正文里指向它的 42+19 处 wikilink 在改写阶段降级为纯文本,不生成任何链接。
- **notes 表建在既有 `agent` 库**(`agent/migrations/002_notes.up.sql`),notes 服务经 `SQLDatabase.named("agent")` 引用。理由:`deploy/migrate.sh` 显式只认 `agent` 一个库,新增第二个 `SQLDatabase` 会让部署脚本直接 die;单库多服务本就是 `agent/db.ts` 既定注释里的用法。

## vault 勘察结论(实测,2026-08-31)

- 可发布正文 **293 篇 / 4.07 MB**;`原始资料/` 583 篇不计
- frontmatter 覆盖 293/293:`title` 279 · `tags` 279 · `date` 272 · `source` 129 · `company` 114
- 图片 97 张 / 77.7 MB(Pi 39MB · DeepSeek 20MB),被 72 篇引用;Rust 教材 0 图
- Obsidian 语法清点:wikilink 1825(带别名 1301 / 带锚点 9)· callout 695(10 种)· 高亮 `==x==` 41 · 注释 `%%` 2 · 图片宽度语法 `![1200](…)` 17 · GFM 表格行 5086 · 嵌入 `![[x]]` 0 · mermaid 0
- 裸 HTML:`<br>` 18 · `<summary>` 6 · `<div>` 2 · `<script>` 2 · `<style>` 2 —— 渲染侧一律不放行裸 HTML,同步阶段改写

## 交付物

```
apps/api/agent/migrations/002_notes.up.sql   notes_categories / notes_series / notes_chapters
apps/api/notes/db.ts                         SQLDatabase.named("agent")
apps/api/notes/store.ts                      读路径 SQL(服务只读,写在同步管线)
apps/api/notes/series.ts                     系列列表 / 系列详情 / 章节正文 端点
apps/api/notes/rss.ts                        api.raw:/rss.xml + /rss/<分类>.xml(renderFeed 抽成纯函数便于测)
apps/api/notes/notes.test.ts                 查询端点与 RSS 生成的测试(9 项)
apps/api/notes/README.md                     已实现 / 待 R6 的边界
tools/notes-sync/                            同步管线(独立 package.json,不在 Encore app root 内)
  src/manifest.ts                            13 系列映射表(内容分享收 0 章)
  src/obsidian.ts                            Obsidian → 标准 markdown 改写器(围栏感知)
  src/images.ts                              引用图收集 + WebP 压缩 + 路径重写 + 孤儿清理
  src/db.ts                                  upsert 入库 / --emit-sql 声明式全量
  src/verify.ts                              同步后自检,判据与改写器一致
  src/main.ts                                CLI 与编排
  README.md                                  代码分工(操作规程在 skill 里)
.claude/skills/sync-notes/SKILL.md           **同步文档进站的 skill(所有者点名的交付物)**
.claude/launch.json                          web dev server 启动配置
apps/web/components/notes/Markdown.tsx       markdown → design token 排版 + 目录抽取
apps/web/components/notes/NotesIndex.tsx     首页交互层(从 page.tsx 拆出,样式逐字未动)
apps/web/components/notes/RssModal.tsx       订阅弹层改为接收 props
apps/web/lib/{api,site,time}.ts              SSR 客户端 / 站点常量 / 相对时间与阅读时长
apps/web/app/(site)/notes/**                 三级页切真实数据
apps/web/public/notes/**                     压缩后的图片(56 张 / 6.5MB)
apps/web/Dockerfile                          补 COPY public(漏了图片全 404)
apps/web/next.config.ts                      dev 侧 /rss* 代理
deploy/Caddyfile                             /rss.xml 与 /rss/* 指向 api
deploy/docker-compose.yml                    API_INTERNAL_URL / SITE_HOST / SITE_ORIGIN
dev.ps1                                      新增 notes 子命令;build --services 补 notes
```

## 验收

| # | 检查 | 命令 / 期望 |
|---|---|---|
| 1 | 同步幂等 | 连跑两次 `sync-notes`,第二次报告 `新增 0 / 更新 0`,`notes_chapters` 行数不变 |
| 2 | Obsidian 语法清零 | `dev.ps1 notes --verify`:围栏与行内代码**之外**无 `[[`、无 `> [!`、无 `%%`、无裸 HTML(裸 LIKE 扫描会把 Cargo 的 `[[bin]]`、bash 的 `[[ -n $X ]]` 全当成残留,不能用) |
| 3 | 原始资料零引用 | 库里不存在指向 `原始资料/` 的 markdown 链接;Rust 教材 42 处已降级为纯文本(纯文本字样保留,不算违反) |
| 4 | 内容边界 | `notes_chapters` 无 `内容分享` 来源;AI 资料只有中译(59 篇原文不在库);`source` 原链落库 |
| 5 | RSS | `/rss.xml` 与 4 条分类源合 RSS 2.0(well-formed、必备元素、RFC822 pubDate、`atom:link rel=self`);条目按 `updated_at` 倒序。在线校验器需公网地址,R9 补跑 |
| 6 | 三级页 | Notes 首页 4 分类卡片 / 系列页章节表 / 文章页正文 + 目录 全部来自 API,`demo-data` 的 notes 段不再被引用 |
| 7 | 样式零改动 | 三级页 diff 只出现数据源与 markdown 渲染相关改动,design token 与布局参数不变 |
| 8 | 服务白名单 | `dev.ps1 build` 的 `--services` 含 notes,构建产物内 `/notes/series` 可达(BACKLOG 2026-08-29 那条) |

## 禁止

- 不改前端页面样式(规则 7);不加设计稿没有的功能(规则 8)。
- 不把摄入管线放进 `apps/api`(规则 6:Encore app root 下的无关 .ts 与依赖会干扰 parser,也会把 sharp 等构建期依赖带进 api 镜像)。
- 不向 vault 写任何东西:同步管线对 vault 只读。
- 不摄入 `原始资料/`,不生成指向它的链接。

## 代码审查

<!-- 完成后回填 -->

- 审查方式:
- findings 处理:
- 结论:

## 失败处理

同一验收项针对性整改后连续 2 次验证仍不过 → 写 `rounds/round-05/BLOCKED.md`,停下呼人。禁止放宽验收标准自我通过。

## 本轮实测

### 数字

| 项 | 实测 |
|---|---|
| 入库 | **226 章 / 12 个系列**(内容分享按裁定为 0 章,卡片走占位态)。首次同步时是 225 章;本轮进行中 vault 新增了一篇(WikiSkill 论文归档,vault 侧 2026-08-31 提交),管线**自动收了进来**并只写了 1 条新增 —— 端到端跑通的真实证据 |
| 正文 | 约 68.7 万字 |
| 图片 | 引用 63 · 落盘 56 张 · **76.0MB → 6.5MB**(WebP q82,宽度上限 1600px) |
| 改写 | 站内链接命中 1158 · callout 591 · 未解析链接 156 个目标 / 290 处(全部降级为纯文本) |
| 分系列 | agent-basics 33 · ai-native-swe 7 · sharing 0 · claude-code-harness 17 · codex-harness 17 · deepseek-harness 15 · pi 15 · harness-engineering 1 · rust-bible 16 · typescript-deep 19 · encore 22 · ai-blog-archive 62 · ai-blog-index 1 |

### 验收结果

| # | 检查 | 结果 |
|---|---|---|
| 1 | 同步幂等 | ✅ 连跑第二次 `新增 0 · 更新 0 · 未变 226 · 删除 0`,图片 `新写 0 · 复用 56` |
| 2 | Obsidian 语法清零 | ✅ `dev.ps1 notes --verify` 六项全 PASS(同步末尾自动跑,FAIL 即非零退出)|
| 3 | 原始资料零引用 | ✅ 生成的链接 0 条(63 章正文里仍有"原始资料"字样,均为降级后的纯文本) |
| 4 | 内容边界 | ✅ sharing 0 章 · 英文原文 0 章 · 档案 62/63 篇带 source 原链(缺的那篇是中文原创汇总,本就无原文) |
| 5 | RSS | ✅ 5 条源(全站 + 四分类)全部 well-formed / RSS 2.0 / 每条 30 items / 带 `atom:link rel=self` / `pubDate` 合 RFC822。**在线 W3C Feed Validator 需要公网地址,顺延到 R9 预发上跑** |
| 6 | 三级页 | ✅ 首页四分类卡片、系列页章节表、文章页正文+目录全部来自 API;`demo-data.ts` 的 notes 段已整段删除,无引用残留 |
| 7 | 样式零改动 | ⚠️ 见下方「与设计稿的偏离」——画板未给样例的元素按同一套 token 补齐,已逐条记录 |
| 8 | 服务白名单 | ✅ `dev.ps1 build` 的 `--services` 已含 notes;`encore check` / `encore test`(25 项)全绿 |

### 与设计稿的偏离(规则 7 逐条备案)

1. **画板 2c 没有的元素补了样式**:列表 / 表格 / 分隔线 / 正文图片。真实正文有 5086 行表格,不给样式就是没有边框的裸表。补的样式全部复用画板既有 token(边框 `--border`、表头底 `--bg-panel`、圆角 7),与代码块卡片同一族,不新增视觉语言。
2. **上下章按钮加了 `maxWidth: 300` + 省略号**:真实章节标题最长 68 字符,不收会把按钮拉穿整行。
3. **「本章目录」改为真实 h2 锚点链接**,取消了画板里写死的"第 2 项高亮"——没有滚动联动就没有"当前项",硬留一个高亮是假信息。阅读进度条按画板保持静态 31%。
4. **Notes 首页拆成 server + client 两个文件**(`page.tsx` 取数 / `NotesIndex.tsx` 管弹层 state)。JSX、样式、className 逐字未动。
5. **三级页改为 `force-dynamic`**:原先 `generateStaticParams` 依赖 demo-data 的固定 slug 列表;更要紧的是 `docker build` 时后端不可达,允许预渲染会让镜像构建直接失败。

### 踩到的坑(按代价排序)

1. **改写器必须对代码围栏免疫**。vault 里 `==` 有 41 处,其中真高亮约 5 处,其余全是 Rust/TS 代码里的比较运算符(491 段 rust + 419 段 ts 围栏);`<script>` / `<summary>` / `<table>` 也几乎全在围栏或行内代码里当例子讲。逐字符跑正则会把教程代码改烂,而且改完仍是合法 markdown,渲染出来看不出问题。
2. **Obsidian 表格里的竖线是 `\|`**。`AI技术博客索引` 整张表(62 条链接)都是 `[[路径\|别名]]` 形态,按 `|` 切别名会把 `\` 留在目标末尾,导致整表链接失效。
3. **图片路径里有未转义的括号**:`01-分层图(阶段-0-的-⭐-最小产出就是把这张图画出来).png`。正则 `[^)\s]+` 会在第一个 `)` 处截断,只能按 CommonMark 的括号配平手写扫描器。
4. **按目录名生成 slug 会静默丢章**。`Karpathy-LLM-Knowledge-Bases/` 下有两篇中译,撞成同一个 slug 后 upsert 后者覆盖前者 —— 表现是"62 变 61",不报错。改成按文件名生成,并加了全局重复 slug 硬校验。
5. **命名漂移同样是静默漏收**。有一篇中译叫 `… (Chinese Translation).md` 而不是 `-Chinese-<日期>`,默认排除策略把它漏掉了。加了「AI资料每个子目录必须命中至少一篇」的覆盖校验,漂移变成硬失败。
6. **知识星球课程的配图是 base64 内嵌的**(7 处 / 59KB),不解码既进不了压缩流程,又会把整串 base64 塞进 `content_md`。
7. **摘要会落到 `---` 上**:教程普遍以 `> 导语` + `---` 开头,只跳过引用的话 RSS 里整片 description 都是一根分隔线。
8. **用 SQL LIKE 做同步后自检全是误报**:Rust 的 `[[bin]]` 是 Cargo TOML 语法、bash 的 `[[ -n $X ]]` 是条件测试、讲 HTML 的文章有行内代码 `<table>`。改成 `--verify`,判据与改写器一致(只看围栏与行内代码之外)。
9. **Encore 的路径参数不能带 `.xml` 后缀**(段内混字面量),`/rss/:category.xml` 匹配不上,只能 `/rss/:file` 拿整段自己剥。
10. **RSS 地址在站根**,不带 `/api` 前缀,`deploy/Caddyfile` 与 `next.config.ts` 各要补一条路由,少了就 404 到 Next 上。
11. **`apps/web/Dockerfile` 的 `COPY public` 这次必须加**:R-BUN 时 public/ 还是空的所以刻意没写,现在有 6.5MB 图片,漏掉的表现是页面正常、图片全 404。

### 提交后自查补的两处(未经审查发现,自己找出来的)

1. **`%%…%%` 注释剥离原先没有围栏感知**。旧实现对整篇正文跑一次 `/%%[\s\S]*?%%/g`,
   而模块的核心不变式是"改写永不进代码"。当前 vault 里唯一一处 `%%` 在未摄入的英文原文里,
   没有实际损坏;但哪天正文的代码块里出现 `%%`(批处理的 `%%A`、SQL 的 `LIKE '%%'`)
   就会被静默吃掉,且吃完仍是合法 markdown。改成逐行、跨行状态机,只在围栏之外生效。
2. **图片相对路径没有 vault 边界校验**。正文里的 `../../../x.png` 会被解析并复制进
   公网可访问的 `public/`。vault 是自有内容,威胁模型弱,但这条守卫顺带也能抓出
   "图放错目录"的手误,成本是三行。

### 遗留 / 需所有者知悉

- **`AI native软件工程教程` 的 7 篇是知识星球「雷哥AI 解决方案」付费课程原文**,经 Obsidian Web Clipper 抓取收录(该系列的课程目录页自己写明了这一点,原文链接需星球权限)。这与所有者对 `原始资料/`(no license)和 AI 资料英文原文的处置是同一类问题,但本轮未被点名排除,**已按现有裁定摄入**。要不要发布请所有者裁定;排除只需删 manifest 里的一条。
- `SITE_HOST` 成为 `deploy/.env` 的新必填项(RSS 绝对链接与订阅弹层地址都取它),compose 里用 `${SITE_HOST:?}` 挡空值。`docs/deploy-environments.md` 的 `.env` 必填清单已同步。
- 在线 W3C Feed Validator 需要公网可达地址,R9 预发部署后补跑一次。
