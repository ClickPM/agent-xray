# R-PERF — 软导航反馈 + 详情页载荷瘦身 + 错误边界

<!-- 保存为 rounds/round-perf/round-perf.md;该轮其他管理产出放同一目录。 -->

> 状态:**实现完成,codex 两轮审查收口(整改后 PASS),待提交与发版**(2026-09-03)
>
> 画板 `2i` / `2j` / `2k` 已由所有者画好并拉回 `design/`(画板计数 15 → 18),T1 / T2 / T3 三块代码全部落地。

## 背景 —— 所有者报障与定位过程(2026-09-03)

所有者在生产上报两个现象:

1. **打开 `https://www.kzgai.cloud/skills/ppt-master` 白屏**,只有一行
   `Application error: a client-side exception has occurred while loading www.kzgai.cloud`。
2. **点 Skills 卡片「没有反应」**,而且「经常出现」,**点 Notes 有时候也会**。

用 Claude in Chrome 连进所有者本机的 Edge(真实 profile + 扩展)、外加一个干净 Chromium,
两边各跑一轮,定位结论如下。**服务端与镜像无关**:`GET /skills/ppt-master` 稳定 200,
gzip 解出 1,923,796 字节、HTML 完整闭合;路由 chunk 200;站上没有 service worker。

### 现象 1 的定位:全站没有加载态

`apps/web/app/` 下**没有任何 `loading.tsx`**(也没有 `error.tsx`),而 7 个 page 全是
`export const dynamic = "force-dynamic"`。App Router 的软导航在服务端 RSC 返回之前
**一个像素都不动** —— 旧页面原样停着,零反馈。所以「没反应」不是崩溃,是**在等**。

在所有者本机、经生产域名实测(RSC 载荷 / 耗时,各取 2 次):

| 路由 | RSC 载荷 | 耗时 |
|---|---|---|
| `/skills` | 10.9 KB | 48 / 61 ms |
| `/notes` | 9.7 KB | 46 / 57 ms |
| `/about` | — | 95 ms |
| `/notes/agent-basics` | 31 KB | 48 / 85 ms |
| `/skills/obsidian-bases` | 165 KB | 356 / 973 ms |
| **`/skills/diagram`** | **484 KB** | **2159 / 3884 ms** |
| **`/skills/ppt-master`** | **1.57 MB** | **5572 / 7175 ms** |

直接量「点下去到 URL 变化」:点 `diagram` 卡片 **4000 ms**。这 4 秒里页面完全不动。

Notes 侧同因不同源 —— 章节页载荷都不大,但**服务端渲染耗时在抖**:
`agent-basics` 六篇章节 `readme` 124 KB/1724 ms、`glossary` 78 KB/805 ms、
`references` 96 KB/434 ms、`stage-00-lecture` 48 KB/453 ms、`stage-00-practice` 39 KB/111 ms、
**`stage-01-lecture` 49 KB/3353 ms**。49 KB 要 3.35 秒,是渲染耗时不是载荷大小。

### 现象 2 的定位:`ppt-master` 一页水合失败

干净 Chromium 与所有者的 Edge 都稳定复现:

```
Error: Minified React error #418   (Hydration failed … this tree will be regenerated on the client)
```

- **只有 `/skills/ppt-master` 报**。`/about`、`/notes`、`/skills`、`/skills/obsidian-bases`、
  `/skills/encore-api` 逐个试过,控制台干净。
- **是间歇的**:随后连刷两次没再复现 —— 所以所有者只撞见过一次,复现不稳定。
- 把新取的 SSR HTML 与水合后的实时 DOM 做逐字节比对:**113,498 字节完全一致**,
  元素 920 个、属性一个不差,`<head>` 也一样。**所以不是服务端与客户端渲染结果不同**;
  剩下的解释是那一页 HTML 有 1.92 MB、分段到达,水合启动时文档还没到齐。
  React 于是丢掉 SSR 结果整页重渲 —— 这个重渲一旦出岔,就是所有者截到的白屏。

### 两个现象的同一个根因

`apps/web/app/(site)/skills/[name]/page.tsx` 把整包**全部 markdown 文件**在服务端预渲染成
ReactNode 塞进载荷,而页面同一时刻**只显示一个**:

```tsx
for (const f of data.files) {
  if (f.kind !== "markdown") continue;
  mdViews[f.path] = <MarkdownFile content={f.content} />;   // ppt-master:21 个文件全渲染
  tocs[f.path] = extractToc(splitFrontmatter(f.content).body);
}
```

`ppt-master` 289 KB 原文 → 1.57 MB 载荷 / 1.92 MB HTML。而 5–7 秒的耗时里**大头是服务端渲染**:
21 个 markdown 各过一遍 remark-gfm + remark-math + rehype-katex,`force-dynamic` 意味着每次请求都重来一遍。
`diagram`(612 KB HTML)是同一条曲线上的下一个。

## 目标

一句话,可证伪:**`/skills/ppt-master` 的 RSC 载荷降到 500 KB 以下、软导航耗时降到 1.5 s 以下,
React #418 不再出现;所有软导航在 200 ms 内给出可见反馈;任何页面的渲染失败不再是 Next 默认白屏。**

## 前置(已满足)

画板 `2i`(Skill 详情页加载态)/ `2j`(Notes 章节页加载态)/ `2k`(错误态 A 出错 · B 找不到)
于 2026-09-03 由所有者在 Claude Design 画好,经 DesignSync 拉回 `design/`:

- `list_files` → `get_file` → 从持久化结果文件用 python 提取到磁盘(不经 Write,避免 `\u` 转义被解码)。
- 判据按 `design/README.md`:`diff "design/<文件>" "<新稿>" | grep -c '^<'` = **0**(新稿没丢本地任何一行),
  直接覆盖;新增 295 行,恰好是 `2i` / `2j` / `2k` 三块。`support.js` 两边 md5 一致(`951ae391…`),未动。
- 画板计数 15 → 18,已同步改数:`CLAUDE.md`(项目定位 + 规则 8 + 新增一条 R-PERF 修订)、
  `ROUNDS.md` 功能边界段、`design/README.md`(表格 + 画板增删记录 + token 速查)。

给画布的提示词留档:[`design-prompt.md`](design-prompt.md)。

## 交付物

### T1 — 详情页只渲染当前文件(零样式改动)

- `apps/web/app/(site)/skills/[name]/page.tsx`:`mdViews` **只为 `initialPath` 那一个文件**预渲染;
  `tocs` 仍整包算(只有 H2 的 id 与文本,很小,切文件时目录立刻就在)。
- `apps/web/components/skills/SkillDetail.tsx`:取不到预渲染结果时在客户端 `<MarkdownFile>` 就地渲染。
  整包原文本来就在客户端(`files[].content` 是 copy 按钮与 `CodeView` 在用的),
  **口径「切换文件不打后端」不变**。
- `apps/web/components/skills/MarkdownFile.tsx`:去掉「必须是 Server Component」的约束(只改注释)。
- `apps/web/components/Markdown.tsx`:**标题 id 从「渲染期计数」改为 rehype 阶段一次性赋值**
  (新增 `hastText` + `rehypeHeadingIds`,删掉 `textOf` 与闭包 `seen`)。插件**排在 rehype-katex 之后**——
  改动前 id 取自渲染期的 children 文本,那时公式已被 katex 换成 span,排在它之后看到的是同一段文本,
  存量 id 因此逐字不变。`headingIds={false}`(聊天区)时插件不装,一个 id 都不产出。

### T2 — 加载态(画板 2i / 2j)

- `apps/web/components/Skeleton.tsx`(新增):`Bar` / `Line` / `LoadingNote` / `SkeletonScreen` 四个零件,
  纯标记无 hook,两个 `loading.tsx` 都是 Server Component。
- `apps/web/app/(site)/skills/[name]/loading.tsx`(新增,画板 2i)
- `apps/web/app/(site)/notes/[series]/[chapter]/loading.tsx`(新增,画板 2j)
- `apps/web/app/globals.css`:新增一条 `omSkeletonIn`(0→1 不透明度,0.12s / 延迟 0.2s)。
  **它不是视觉语汇,是画板 2i 实现备注要求的 200ms 显形闸**(0.1s 就返回的请求不该闪一层灰条);
  骨架自身的动效仍然只用既有的 `omPulseBg` 与 `omSpin`。
- 按实测只给这两条慢路由加:`/skills`、`/notes`、`/about`、`/notes/[series]` 都在 50–300 ms,
  给它们加骨架只会闪一下。

### T3 — 错误边界与 404(画板 2k)

- `apps/web/components/StatusScreen.tsx`(新增):2k 的共用版式 + `CopyableId`。
- `apps/web/app/(site)/error.tsx`(新增,2k 变体 A):页面级错误,**带导航条**。
- `apps/web/app/(site)/not-found.tsx`(新增,2k 变体 B):接管站内所有 `notFound()`
  (失效 skill / 改名的系列章节 / 被隐藏 tab 的地址),主出口按路径推「回上一层列表」,末尾回显访问路径。
- `apps/web/app/error.tsx`(新增,2k 变体 A 的**无导航条版**):**本机实测发现的缺口** ——
  `error.tsx` 兜不住同段 layout 自己的错误,而本站最可能的故障(后端不可达)恰恰炸在
  `(site)/layout.tsx` 的 `visibleTabKeys()` 上,`(site)/error.tsx` 根本没机会渲染。详见「本轮实测」第 5 条。

## 验收

| # | 检查 | 结果 |
|---|---|---|
| 1 | `dev.ps1 check` + `dev.ps1 test` | ✅ check 通过;test **18 文件 / 414 用例全绿**;`next build` 通过 |
| 2 | 载荷瘦身 | ✅ 代理指标达标:详情页预渲染体积 `ppt-master` 959.1 → 88.9 KB(**−90.7%**)、`diagram` 278.4 → 29.6 KB(**−89.4%**)。**真实 RSC 数字待发版后在生产复量**(#9) |
| 3 | **标题 id 零漂移** | ✅ 281 篇正文全量比对,其中 **225 篇有生产 HTML 作 ground truth:失配 0**;`headingIds=false` 漏出 id 的文档 0 篇。方法见「本轮实测」第 2 条 |
| 4 | 水合干净(零 React #418) | ⏳ 待生产复验 —— 本机没有 1.9 MB 那种页面可复现(#9) |
| 5 | 切文件不打后端 | ✅ 本机实测:切到**没有预渲染**的 `references/b.md`,`performance.getEntriesByType('resource')` **16 → 16(零新请求)**,`?file=` 同步,客户端渲染出的 **85 个 h2 id 与 85 条目录逐条对上、顺序一致** |
| 6 | 画板对照 · 无样式改动 | ✅ 既有文件的 diff 里没有任何 style / className / token / 动画参数改动(唯一命中「style」关键字的是 `rehypeKatex` 的 `errorColor`,值未变、只是换行) |
| 7 | 软导航反馈 | ✅ 骨架已按 2i / 2j 逐项对照截图核对(见「本轮实测」第 4 条)。**「200 ms 内」这一条待生产复量** —— 本机 dev 首次导航含路由编译 2.49 s,不是有效样本 |
| 8 | 错误边界 | ✅ 三态本机实测:`(site)/error.tsx`(带导航条)、`app/error.tsx`(后端不可达)、`(site)/not-found.tsx`(`/skills/no-such-skill`)。截图与细节见「本轮实测」第 5 条 |
| 9 | 生产复验 | ⏳ 发版后重量 #2 / #4 / #7 的数字,回填本节 |

## 禁止

默认继承两条:**不改前端页面样式**(CLAUDE.md 规则 7);**不加设计稿没有的功能**(规则 8)。
本轮另加四条(全部遵守):

- **不在 T2 / T3 上抢跑**:`2i–2k` 并入 `design/` 之前不写 `loading.tsx` / `error.tsx`。
- **不动 `Markdown.tsx` 的任何视觉映射**:本轮只改「id 在哪一步赋值」。
- **不借机改 Skills 的交互口径**:不加搜索 / 筛选 / 折叠目录树 / 懒加载滚动。
- **不改缓存策略**:`force-dynamic` 保持原样。

## 与画板的偏离(**所有者已裁定 2026-09-03:三条全部维持现状,不再动代码**)

1. **2k 的「导航条四格都不高亮」没有实现** —— 所有者裁定「可以」,不为它新增机制。画板裁定是「错误页的当前路由已经无效,高亮任何一格都是假信息」。
   实现上做不到便宜:`GlobalNav` 由 `usePathname()` 决定高亮,而它在 `(site)/layout.tsx` 里、**在错误边界之上**,
   React 的 context 只能往下流,错误页无法反向影响它。可行的两条路都是新增机制 ——
   ①在 layout 里加一个 client context provider,错误页挂载后 setState 通知;
   ②给 `GlobalNav` 加 data 属性 + globals.css 用 `:has()` 反选,但高亮是内联样式,要盖过它得写三个 `!important`。
   按「非严重问题不新增机制类修复」暂不做,**记这里等裁定**。现状:在 `/skills/xxx` 出错时 Skills 那一格仍高亮。
2. **`app/error.tsx` 没有导航条**。不得已:导航条要显示哪几格,正是刚刚取失败的那份数据。
   退化成「全部显示」会把所有者用 `site_tab_set` 藏起来的 tab 露出来(那是合规运维动作,不能靠猜);
   退化成「一格不显示」是一条空条,不如不画。理由已写进该文件的文件头。
   **所有者裁定:接受无导航条,但「不能退化露出隐藏 tab」是硬约束** ——
   现状满足:`visibleTabKeys()` 失败时直接抛给错误边界,**代码里没有任何默认 tab 集合作兜底**,
   所以不存在「取不到就按全开渲染」的路径。后续任何人给它加 fallback 都是违反本条裁定,
   审查与改动时要按这条判。
3. **新增了一条 keyframe `omSkeletonIn`**。画板 2i 的裁定是「不引入新的 shimmer / skeleton 关键帧」,
   同一块画板的实现备注又要求「骨架延迟 ~200ms 再出」。Next 的 `loading.tsx` 是立刻挂上的,
   这 200ms 没有别的地方能表达,只能落在 CSS 上。这条 keyframe 只做 0→1 的不透明度、不参与视觉语汇。
4. **`2k` 的品牌色实心主按钮是全站第一处实心按钮**(`components/ui.tsx` 的注释写着「ghost 按钮 — 全站唯一按钮语汇」)。
   这不是实现自造,是画板 2k 明确定的出口层级;`ui.tsx` 那句注释因此略微过时,本轮没有改它(规则 7:不动既有组件)。

## 未做 / 已知遗留

- **`app/not-found.tsx`(根部 404)仍是 Next 的默认英文页**。它只接管「完全不匹配任何路由」的地址(如 `/foo`),
  渲染在 `RootLayout` 里、拿不到 `(site)` 的导航条。**所有者裁定 2026-09-03:不做**
  (站内真实可达的 404 —— 失效 skill / 改名章节 / 被隐藏 tab —— 已全部走 `(site)/not-found.tsx` 的 2k B 版式;
  剩下的是手敲错地址那一类,不值得为它再开一套无 chrome 的版式)。
- 站内真实可达的 404(失效 skill / 改名章节 / 被隐藏 tab)全部走 `(site)/not-found.tsx`,已按 2k 实现。

## 代码审查

- 审查方式:codex `/codex:review --background --scope working-tree`(工作区尚未提交,全量范围 —— 按 CLAUDE.md「前两轮固定全量」)

### 第 1 轮(2026-09-03)

**1 条 finding,0 条 high,已采纳整改。**

- **[P2] 避免把隐藏 Tab 的 404 主操作指回自身** —— `apps/web/app/(site)/not-found.tsx`。
  **采纳整改**,是真 bug:所有者用 `site_tab_set` 把 Skills 藏起来之后,`/skills` 与 `/skills/<name>`
  本来就会 404(R-TABS:隐藏 = 页面在站点上不存在),而当时那枚主按钮固定指向 `/skills` ——
  点下去是同一个 404;访问的正好是列表根路径时,按钮甚至指向当前地址,原地打转。
  整改:`(site)/not-found.tsx` 改成 Server Component 只做一件事 —— 取 `visibleTabKeys()`
  (React `cache` 包过,同一次请求里 `requireVisibleTab` 已经取过,不多打一次后端),
  把可见集合传给新的客户端半边 `components/NotFoundScreen.tsx`;
  「回上一层列表」只在那一层**当前露着**时才给,否则退化成「返回首页」。
  `/` 永远有落点(写面拒绝关掉最后一个可见 tab;`runtime` 被藏时 `/` 会 307 到第一个可见 tab)。
  **本机实测**:藏掉 skills 后 `/skills` 与 `/skills/ppt-master` 都只剩「返回首页」、导航条三格;
  放回后 `/skills/no-such-skill` 恢复成「回 Skills 列表」+「返回首页」。`npx tsc --noEmit` 通过。

### 第 2 轮(复审,缺陷门禁;2026-09-03)

全量范围(前两轮固定全量),**零 findings**:
「No actionable regressions were identified in the staged, unstaged, or untracked changes.
The web TypeScript check also completes successfully.」

- **结论:整改后 PASS**。两轮共 1 条 finding(0×high / 1×P2)**全部采纳整改**,末轮零 findings,
  缺陷门禁通过(CLAUDE.md 复审收口标准:不得带阻塞性问题或明显 bug/漏洞类 findings 收口)。

## 失败处理

同一验收项针对性整改后连续 2 次验证仍不过 → 写 `rounds/round-perf/BLOCKED.md`,停下呼人。
禁止放宽验收标准自我通过。

特别地:**验收 #3(标题 id 零漂移)不许放宽**。它挡的是「正文里已有的锚点集体失效」,
是会静默损坏存量内容的一类改动。

## 本轮实测

### 1. 基线

见上方「背景」两张表(2026-09-03 于生产实测)。

### 2. 标题 id 零漂移怎么量的(验收 #3)

`Markdown.tsx` 的改动波及 Notes 全部正文,id 一旦变了,文章里已有的 `[见](#锚点)` 会集体失效 ——
所以不能靠抽查。做法:

1. 从生产抓全量语料:13 个系列 **225 篇章节**(每篇同时抓 ① 页面 HTML 里 `<h2 id>` 的出现顺序,
   即**改动前的代码跑出来的 ground truth**;② 同一章的 `contentMd`),外加 19 个 skill 的 **56 个 markdown 文件**,共 **281 篇**。
2. 把改动后的 `Markdown.tsx` 复制一份(只删掉 `katex.min.css` 的 import),用 `react-dom/server`
   的 `renderToStaticMarkup` 对同一批正文渲染,抽出 `h2 id` 序列。
3. 三项比对:①对生产 HTML;②对 `extractToc(md)` 的目录 id;③`headingIds={false}` 时是否漏出 id。

结果:**① 225 篇失配 0;③ 0 篇漏出**。② 有 2 篇不一致,但**与本轮改动无关**——
`codex-harness/chapter-14` 多 1 个、`ppt-master:SKILL.md` 多 4 个,都是 `> [!IMPORTANT]` 这类
**引用块里的 H2**:`extractToc` 按原始行匹配 `^\s{0,3}##`,前面有 `>` 就匹配不上,而渲染器照样把它当 h2 渲染并挂 id。
①的零失配已经证明改动前就是这样。已按「跨轮次发现的问题不当场顺手改」记进 `rounds/BACKLOG.md`。

脚本留档在会话 scratchpad(`fetch-corpus.mjs` / `check.tsx` / `size.tsx`),不进仓库。

### 3. 载荷瘦身的量化(验收 #2)

RSC flight 不好在本机单测,用同一套渲染器的 `renderToStaticMarkup` 体积做同比例代理:

| skill | markdown 篇数 | 原文合计 | 改动前(全渲染) | 改动后(只渲 SKILL.md) | 降幅 |
|---|---|---|---|---|---|
| `ppt-master` | 21 | 270.8 KB | 959.1 KB | 88.9 KB | **−90.7%** |
| `diagram` | 9 | 77.8 KB | 278.4 KB | 29.6 KB | **−89.4%** |

**代价要认**:客户端要能渲染非首个 markdown,`react-markdown` 进了 Skills 详情路由的 chunk,
`next build` 报的 First Load JS 从 ~108 KB 涨到 **238 KB**。这是**一次性、可缓存的静态 JS**,
换掉的是**每次请求都要重新生成和传输的 ~1.1 MB 动态载荷**,而且服务端每次少解析 20 篇 markdown。
真要省这 130 KB,唯一的办法是切文件时往服务端要一次(违背「切换文件不打后端」),没有做。

### 4. 加载态怎么验的(验收 #7)

本机 DB 是空的,先经真实 MCP 协议路径(2026-07-28 逐请求契约)灌了两组夹具:
一个 3 文件的小 skill、一个 3 × 大 markdown 的 skill(395 KB),以及一个 110 KB 的 Notes 章节 ——
把服务端渲染拖到看得清骨架。1440×900 视口下逐项对照画板截图确认:

- **2i**:面包屑 `Skills` 是真链接 + 两段骨架、右侧 `omSpin`「正在取…」、22px 标题条 `omPulseBg`、
  徽标块、两行描述条、meta 条、右上两枚按钮骨架块、`INSTALL` 小标题真实 + 命令行 `omPulseBg`、
  `FILES` 三级缩进 8 行、「本页目录」4 条、预览卡头部条 + frontmatter 块 + 正文骨架 + 一块代码卡片形状。
- **2j**:进度线不出现、标题条 460px `omPulseBg`、段落长短不一、代码卡片形状、三行列表形状、
  上/下一章两枚骨架块、右栏「本章目录」标题真实 + 5 条。

验完把三组夹具从本机库删干净(`skills_delete` ×2、`notes_series_delete --cascade`)。

### 5. 错误边界:一个只有跑起来才发现的缺口(验收 #8)

先写的是 `(site)/error.tsx`。**把本机 api 停掉去复现「后端不可达」时,它没有生效** ——
页面回到 Next 默认的 `Application error: a server-side exception has occurred`,
调用栈指向 `lib/tabs-server.ts` 的 `listTabs`。

原因:`error.tsx` 只兜住**自己 children** 里的错误,兜不住**同段 layout 自己**的错误;
而 `(site)/layout.tsx` 每次请求都要 `visibleTabKeys()` 打一次后端(R-TABS:导航条显示哪几格由库里的开关决定)。
**本站最可能的一种故障恰恰落在这条路径上**,`(site)/error.tsx` 根本没机会渲染。

于是补了 `app/error.tsx`(根段)兜住它。三态本机逐个实测通过:

| 触发 | 落到哪 | 结果 |
|---|---|---|
| api 停掉后打开任一页 | `app/error.tsx` | 2k 变体 A,**无导航条**(理由见「与画板的偏离」2),digest + UTC 时间戳可复制 |
| 页面自己抛错(临时注入 `throw`,验完已还原) | `(site)/error.tsx` | 2k 变体 A,**带导航条**,`重试` 按钮走 `reset()` |
| `/skills/no-such-skill` | `(site)/not-found.tsx` | 2k 变体 B,灰点 + `HTTP 404` + 「回 Skills 列表」+ 路径回显 |

另外两处刻意的实现选择:

- **时间戳在 `useEffect` 里取**,不在渲染期。服务端组件抛错时错误边界也会在服务端渲染一遍,
  渲染期取 `new Date()` 两边必然对不上 —— 那是一个必现的水合失配,本轮修的正是这一类问题。
- **不显示 `error.message`**,只露 `digest`。服务端错误在生产会被 Next 换成通用文案 + digest,
  但客户端错误的 message 是原文,可能带上内部路径或字段名(`docs/security.md` §5 同一口径)。

### 6. 暗色下的一处必要推导(画板只画了亮色)

2k 的主按钮是品牌色实心 + 白字。照抄 `#ffffff` 在暗色下会出事:`--accent` 在 `html.dark` 是浅蓝 `#60a5fa`,
白字压上去只有约 2:1 的对比度(本机开暗色实测,肉眼已经发糊)。改成 `color: var(--bg)` 一处解决两边 ——
亮色下 `--bg` 就是 `#ffffff`,与画板一字不差;暗色下是 `#1a1a1a`,深字压浅蓝读得清。
实测 `getComputedStyle` 回 `bg rgb(96,165,250)` / `color rgb(26,26,26)`。
