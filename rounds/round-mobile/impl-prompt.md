# R-MOBILE 实现提示词 —— 移动端呈现层(社交 webview 优先)

用法:`design/` 已经并入移动端画板集(`4a`–`4u`)之后再贴这份;在此之前开工违反 CLAUDE.md 规则 8。
贴给 Claude Code(本仓库 solo 开发),分支 `round-mobile`。
设计侧的提示词在 [`design-prompt.md`](design-prompt.md)。

---

## 提示词正文(从这里开始复制)

在 `agent-xray` 仓库实现 **R-MOBILE**:站点的移动端可用性,
**主要目标场景是微信等社交 App 的内置浏览器(webview)**,其次是移动浏览器直接访问。
呈现按 `design/Agent X-Ray Mobile.dc.html` 的 21 块画板(`4a`–`4u`)逐块对照。

开工前先读:`CLAUDE.md`(规则 7 / 8 / 10 / 11)、`design/README.md`、
`design/Agent X-Ray Mobile.dc.html`、`apps/web/` 现有实现。

### 0. 这一轮的边界

- **桌面端零改动是硬验收项**(规则 7)。移动端是**新增的呈现层**,不是改造既有页面。
  收口时 `git diff` 里既有组件的样式常量必须没有变化
- **不新增任何产品功能**(规则 8)。移动端只换呈现;新增的只有 `4u` 的载体适配态与移动端交互原语
- **不改后端**:没有新迁移、没有新端点、没有新 MCP 工具(规则 13 因此不涉及)
- **不改部署方式**(规则 10):镜像仍本机构建、tag = git SHA

### 1. 第 0 步:先做技术验证,再写任何 UI 代码

**这一步的结论可能改变整个方案,所以它排在最前面,不许跳过。**

站点的两条 SSE 都是 **`fetch` + `resp.body.getReader()`**(`lib/agent-api.ts:171/191`、
`lib/trace-api.ts:87`),**不是 `EventSource`**。

> **要验的**:Android 微信内置浏览器(X5 / 系统 WebView 两种都要试)里,
> `fetch()` 返回的 `resp.body` 是否可用、`getReader()` 能否逐块拿到数据。
> iOS 微信(WKWebView)一并验。

做法:在预发(130)或生产上开一个最小验证页,或直接用现网的 Runtime 页发一条消息,
在微信里打开、用 `vConsole` 之类的手段看是否流式到达。

- **能用** → 按下面的正文继续
- **不能用**(`resp.body` 为 undefined / 一次性返回 / 中途断)→ **停下,写进任务卡报所有者**。
  回退到 `EventSource` 或长轮询都是**新机制**,按 CLAUDE.md 的审查边界不许在轮次内自行决定。
  在拿到裁定之前,可以先做 Notes / Skills / About 三个 tab 的移动端(它们没有长连接)

### 2. 载体:PWA 只取轻量部分

所有者裁定:**用 PWA 的方式,但默认在浏览器里用,不做「添加到主屏幕」引导**。
主要场景是微信 webview —— 而**微信 webview 里 PWA 三件套全部失效**
(Service Worker 不可用、manifest 不会被读、没有安装入口)。所以本轮只做:

- **`app/manifest.ts`**(Next 15 的 `MetadataRoute.Manifest`)→ `/manifest.webmanifest`。
  这条路**不需要 `public/` 目录**(见 §7 坑 1)。
  字段:`name` / `short_name` / `start_url: "/"` / `scope: "/"` / `display: "standalone"` /
  `orientation: "portrait"` / `lang: "zh-CN"` / `background_color` / `theme_color` / `icons`。
  **它的唯一作用**是访客自己在 Safari/Chrome 里「添加到主屏幕」后能全屏启动 —— 我们不引导,但留着这条路
- **图标**:现有 `app/icon.svg` 与 `app/apple-icon.png` 是 Next 的 metadata 文件约定,已生效。
  manifest 需要 PNG,从 `components/XrayMark.tsx`(与 `icon.svg` 同一图形的另一份载体,改图形要一起改)
  导出 192 / 512 / maskable 512(maskable 图形缩进到中心 80% 安全区)
- **`theme-color`** 给明暗两套(`<meta name="theme-color" media="(prefers-color-scheme: dark)">`)。
  Safari 会用它染地址栏
- iOS meta:`apple-mobile-web-app-capable="yes"`、`apple-mobile-web-app-status-bar-style="black-translucent"`

**本轮不做 Service Worker**,理由三条,写进任务卡:① 微信 webview 用不了,对主要场景零收益;
② 站点 `(site)/layout.tsx` 是 `dynamic = "force-dynamic"`(tab 露不露由库里开关决定),缓存 HTML 会让
所有者关掉的 tab 仍然可见;③ 站点核心是实时对话,无离线价值。记 `rounds/BACKLOG.md`。
代价:Android Chrome 的安装提示可能不出现 —— 而所有者本来就不要安装引导,不影响目标。

**不做安装引导 UI**(所有者裁定)。

### 3. 微信 webview 适配(本轮的工程重心)

#### 3.1 页面标题 —— 低成本高价值,先做

**微信 webview 顶部那条不可隐藏的导航栏显示的就是 `document.title`。**
现在全站**只有 `app/layout.tsx` 有 `metadata`,没有任何页面写 `generateMetadata`** ——
意味着在微信里,Notes 的每一章、每个 Skill 详情页,标题栏都写着「Agent X-Ray」。

给这些页面补 `generateMetadata`:`/notes/[series]`、`/notes/[series]/[chapter]`、
`/skills/[name]`、`/notes`、`/skills`、`/about`。标题短(微信栏放不下长标题,会截断),
建议形如 `<章节标题> · Agent X-Ray`,长标题优先保留前半。
**这不动任何样式**,规则 7 不涉及。

#### 3.2 布局与滚动

- **页面本身不滚动**,滚动交给内部容器。`body { overscroll-behavior: none; overflow: hidden; }` ——
  否则微信里整页下拉会露出「网页由 … 提供」的白条
- **`100vh` 在 webview 里不可靠**,用 `100dvh`(`(site)/layout.tsx` 已经是 `100dvh`,保留)
- **可视高度用 `visualViewport` 校正**,不要假设 `100dvh` 在键盘弹起时是对的

#### 3.3 键盘(Runtime 输入栏,最容易翻车的一处)

**iOS 微信 WKWebView 里,键盘弹起时 `position: fixed` 元素会漂,收起后页面可能不回弹。**
所以输入栏**不能用裸 `fixed`**。做法:

- 整个 Runtime 屏装在一个 `height: 100dvh; overflow: hidden` 的定位父容器里,
  输入栏用 `position: absolute; bottom: 0` 挂在它上面
- 监听 `visualViewport` 的 `resize` / `scroll`,把父容器的高度或 `transform` 同步到真实可视区
- 键盘收起后主动 `window.scrollTo(0, 0)` 兜底

#### 3.4 玻璃材质降级

Android 微信内核对 `backdrop-filter` 支持不确定。三处玻璃(顶部功能条 / 底部 Tab Bar / 输入栏)
一律写成:

```css
/* 降级值写在前面,当默认 */
background: rgba(255, 255, 255, 0.94);
@supports (backdrop-filter: blur(1px)) {
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(24px) saturate(180%);
}
```

按画板 `4u` 的降级态核对:降级后版式不塌、层级仍清楚。

#### 3.5 字体

字体栈 `-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif` ——
iOS 上是 SF,Android 上是苹方 / 系统黑体。字号行高按两种字体都站得住的值取(中文正文 15/1.75)。
**mono 仍是自托管的 JetBrains Mono**(`next/font/local`,两端一致),这条不许动。

#### 3.6 复制、下载、外链

- `navigator.clipboard` 在 webview 里可能不可用。三处复制(RSS 地址 / 安装命令 / 错误标识)
  要有 `document.execCommand("copy")` 兜底,再失败就按画板 `4n` 给「长按选中」提示
- **zip 下载与 GitHub 外链在微信里受限**(会落到微信自己的提示或要求「在浏览器中打开」)。
  按画板 `4p` 实现「在微信中不可用」的按钮提示态。
  判定用 UA:`/micromessenger/i.test(navigator.userAgent)` ——
  **UA 只用于这类载体差异提示,绝不用于布局分流**(见 §5)
- **不做微信自定义分享卡片**:那要 JSSDK + 公众号 + JS 接口安全域名,是新功能。记 `rounds/BACKLOG.md`

### 4. 视口与禁用双指缩放

- `apps/web/app/layout.tsx` 增加:

  ```ts
  export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
    viewportFit: "cover",
    themeColor: [/* 明暗两条 */],
  };
  ```

- **但 `user-scalable=no` 在 iOS 上会被忽略**(Safari 10 起,WKWebView 同内核 —— 微信也一样)。
  所有者要求禁双指缩放,所以**必须再加 JS 拦截**:对 `gesturestart` / `gesturechange` / `gestureend`
  以及多指 `touchmove` 调 `preventDefault()`(注意 `{ passive: false }`)
- `globals.css`:`html { -webkit-text-size-adjust: 100%; }`、可点元素 `touch-action: manipulation`
  (顺带消掉双击延迟)
- **输入框字号必须 ≥ 16px**。现在 `Workbench.tsx` 的 `InputBar` 是 14px ——
  小于 16 时 iOS 会在聚焦时强行放大整页,而 `user-scalable=no` 拦不住。
  改的是**移动端分支的样式**,桌面那份保持 14(规则 7)
- 安全区一律 `env(safe-area-inset-*)`;配 `viewport-fit=cover` 才生效

### 5. 断点与分流(不许 hydration mismatch)

断点:**≤ 768px = 移动端**。

**不许用 `window.innerWidth` 或 UA 在渲染期分流** —— 站点是 SSR + `force-dynamic`,那必然 hydration mismatch。
两个可选:

- ① **纯 CSS 分流**:两套组件树都渲染、`@media` 显示其一。简单,但 Runtime 会跑**两份 SSE 逻辑与两份取数**
  —— **不可接受**
- ② **状态与呈现分离**:把 `Workbench.tsx` 拆成「状态容器(取数 / SSE / 会话管理 / 折叠计算)」+
  两个**纯呈现壳**(桌面三栏 / 移动 Sheet)。容器用 `useSyncExternalStore` 订阅
  `matchMedia("(max-width: 768px)")` 决定挂哪个壳,服务端快照返回桌面壳、首帧再用 CSS 兜底避免闪动

**采用 ②**。这是本轮唯一的结构性重构,请在任务卡写明「哪些文件是新增、哪些是纯提取(行为不变)」,
并保证提取出来的桌面壳**渲染结果与重构前逐像素一致**。

Notes / Skills / About 三个 tab 是 Server Component 为主、无长连接,**优先走 CSS 分流**,
只有确实需要不同 DOM 结构的(章节页的右侧目录 → Sheet、Skill 详情的目录树 → chip 条)才拆客户端组件。

### 6. 逐块画板 → 文件对照(实现时逐条勾)

| 画板 | 主要文件 |
|---|---|
| `4a`–`4d` Runtime 会话区 | `components/workbench/Workbench.tsx`(拆分)+ 新增移动壳 |
| `4e`–`4i` 运行时面板 Sheet | 新增 Sheet 组件 + 复用 `TimelineView` / `ChainView` / `LifecycleMap` / `ToolsPanel` |
| `4j` 会话列表 | `Workbench.tsx` 的 `SessionSidebar` → 移动端 Sheet 版 |
| 底部 Tab Bar | 新增;数据源仍是 `lib/tabs.ts` + `lib/tabs-server.ts`(**R-TABS 的可见性必须照旧生效**) |
| `4k`–`4n` Notes | `components/notes/NotesIndex.tsx`、`app/(site)/notes/**`、`RssModal.tsx`、`ReadingProgress.tsx` |
| `4o`–`4q` Skills | `components/skills/SkillDetail.tsx`(240px 树 → chip 条 + Sheet)、`SkillsIndex.tsx`、`CodeView.tsx` |
| `4r` About | `app/(site)/about/page.tsx` + 主题开关从 `GlobalNav` 移入 |
| `4s` 加载骨架 | 既有 `loading.tsx` ×2 + `components/Skeleton.tsx` |
| `4t` 错误态 | `app/(site)/error.tsx`、`not-found.tsx`、`StatusScreen.tsx`、`NotFoundScreen.tsx` |
| `4u` 载体适配 | 全局样式 + Tab Bar 的滚动隐藏 + 玻璃降级 + 横屏降级 |
| 页面标题(§3.1) | 各页新增 `generateMetadata` |

**内核层照搬,不许改**:`TimelineView` 的耗时色条(公式上限 198 按画板给的新比例改)、
`ChainView`、`LifecycleMap`、工具卡解剖、`CodeView` 的行号列与三色高亮、`Markdown.tsx` 的正文排版。

### 7. 验收

- `dev.ps1 check` / `dev.ps1 test` 全绿(api + web 两处)
- **另跑 `apps/web` 的 `tsc --noEmit`** —— 门禁不跑它,类型错误只有生产 `next build` 才拦
  (`rounds/BACKLOG.md` 记着这条)
- Browser pane:`resize_window` 的 `mobile` 预设 + 自定义 320 / 390 / 430 三档,逐块画板比对
- **桌面零改动**:桌面视口下逐页与改动前截图比对,`git diff` 复核既有样式常量未变
- **真机 · iOS 微信**:SSE 流式到达 / 微信标题栏显示对的页面标题 / 双指放不大 /
  输入框聚焦不放大页面 / 键盘弹起时输入栏贴键盘且收起后回弹 / 下拉不露微信白条 /
  Tab Bar 贴安全区 / 玻璃材质正常
- **真机 · Android 微信**:上面全部再来一遍,外加 **`backdrop-filter` 降级是否触发**、
  **fetch streaming 是否可用**(§1)
- **移动浏览器直接访问**(Safari / Chrome):Tab Bar 与浏览器工具栏的叠放按画板 `4u` 第 2 态
- **横屏**:按 `4u` 第 4 态降级,不塌
- SSE 切后台再回前台的行为**如实记录进任务卡**。当前没有重连机制,预期表现是掉进 `onError` 兜底文案;
  实测更糟(白屏 / 消息错乱)就停下报所有者,**不要在本轮自行加重连**(那是新机制)

### 8. 流程与文档

- 分支 `round-mobile`;任务卡 `cp rounds/TEMPLATE.md rounds/round-mobile/round-mobile.md`
- codex 审查:**前两轮全量**(`branch diff against main`),**第 3 轮起 `--base <上一轮已审提交>`**
  只审整改 diff;改动超过 1–2 个文件带 `--background`。
  发起时把「审查是缺陷门禁、不许以审查代替设计、非严重阻塞性 findings 不许新增机制类修复」带给审查者
- 收口标准:无 high 级 / 无 bug 与漏洞类 findings;低危项写明理由记 `rounds/BACKLOG.md`
- 文档同步:`ROUNDS.md` 加 R-MOBILE 行与进度;`CLAUDE.md` 规则 8 加 R-MOBILE 修订段;
  `design/README.md` 加画板增删记录;发版记 `docs/releases.md`
- **`docs/security.md` 本轮预期不需要改**(无新工具、无新出网、无新数据面)

### 9. 已知会踩的坑(逐条已在仓库里核过)

1. **`apps/web/Dockerfile` 故意没有 `COPY /app/public ./public`** —— R6 删了 `public/`,
   R9 把那行 COPY 删掉否则 `docker build` 直接失败(注释就写在那个文件里)。
   本轮**不需要 `public/`**(manifest 走 `app/manifest.ts`、不做 SW)。
   若你中途想往 `public/` 放东西,先读那段注释再决定
2. **`user-scalable=no` 在 iOS 上被忽略**,禁双指必须靠 JS 拦截 `gesturestart`(见 §4)
3. **输入框 < 16px 时 iOS 聚焦强制放大整页**(见 §4)
4. **两条 SSE 是 `fetch` + `getReader()`,不是 `EventSource`** —— Android webview 的支持要先验(见 §1)
5. **iOS WKWebView 键盘弹起时 fixed 元素会漂**,输入栏不能用裸 fixed(见 §3.3)
6. **微信 webview 不支持 Service Worker**,PWA 三件套在主场景全废(见 §2)
7. **`dev.ps1 check` / `test` 都不跑 `tsc --noEmit`**(见 §7)
8. **`lib/tabs.ts` 的 tab 可见性由后端开关决定**,底部 Tab Bar 必须照旧遵守;
   且 `runtime` 被隐藏时站点根路径要 307 到第一个可见 tab —— 这个逻辑已有,别绕过它
9. **深色模式靠 `html.dark` + `localStorage("xray-theme")`**,在 `app/layout.tsx` 的内联脚本里同步注入;
   主题开关移到 About 页后,这段脚本**不要动**
10. **网页锁不了屏幕方向**:`screen.orientation.lock()` 在 webview 与 iOS Safari 都拿不到,
    「竖屏」只能靠 CSS 降级(画板 `4u` 第 4 态)
