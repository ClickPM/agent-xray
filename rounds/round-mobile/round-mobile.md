# R-MOBILE —— 移动端呈现层(iOS 26 · 社交 webview 优先)

分支 `round-mobile`。设计稿 `design/Agent X-Ray Mobile - Runtime.dc.html`(`4a`–`4j`)与
`design/Agent X-Ray Mobile - Notes Skills About.dc.html`(`4k`–`4u`),已于 2026-09-07 并入
(提交 `2cd0564`,规则 8 的「先改设计稿、再进轮次」已满足)。
提示词:[`design-prompt.md`](design-prompt.md) · [`impl-prompt.md`](impl-prompt.md)。

## 所有者裁定(2026-09-07)

1. 移动端是**独立的一层**,与桌面并存、由视口宽度切换;**桌面 20 块画板与已实现页面零改动**
2. 画板直接新开 `4x` 段(`4a`–`4u`,21 块),放两份新文件,桌面两份不碰
3. 载体 = **PWA 只取轻量部分**(manifest + `display:standalone` + theme-color),
   **不做 Service Worker、不做安装引导** —— 主要目标场景是**微信等社交 webview**,
   而微信里 PWA 三件套全部失效
4. 竖屏(网页锁不了方向,靠 CSS 降级)
5. 移动端 SSE 断线重连**不做**(新机制,记 BACKLOG)
6. 禁双指缩放(`user-scalable=no` 在 iOS 被忽略,靠 JS 拦 `gesturestart`;
   无障碍代价 WCAG 1.4.4 所有者已认)

## 核心设计裁定:两层语言

- **外壳层 = iOS 26**:顶部功能条、底部 Tab Bar、Sheet、胶囊按钮、inset grouped 列表、
  空/加载/错误态
- **内核层 = 照搬桌面 token**:Timeline 耗时色条、Chain、Lifecycle、工具调用卡、
  代码视图行号与三色高亮、markdown 排版 —— 只做触控与换行适配

代码上的落法:`components/mobile/MobileChat.tsx` 直接 `import { AssistantTurn, AssistantMessage }`,
Sheet 里装的就是桌面右栏那四个组件本身。**内核层没有第二份实现**。

## 进度

### ✅ 已完成(提交见下)

**载体与地基**
- `app/layout.tsx`:`viewport` 导出(五项)+ `gesturestart`/`touchmove` 多指拦截脚本。
  主题脚本一字未动(CLAUDE.md 规则 8 R-MOBILE 段要求)
- `app/manifest.ts` → `/manifest.webmanifest`;`scripts/generate-icons.mjs` 生成三张位图图标
  (192 / 512 / maskable 512,入库)
- **`apps/web/Dockerfile` 恢复 `COPY public`**:R6 删 `public/`、R9 删这行的历史写进注释,
  这次它有真内容了。漏这行的表现是**装到主屏幕后图标变默认灰块,静默**
- `app/globals.css`:安全区变量、iOS 26 外壳 token(**降级值当默认、@supports 再升级成玻璃**)、
  `.m-glass-top/bottom`、`.m-tap`、`.m-xscroll`、`.m-hide-narrow` / `.m-show-narrow`、横屏降级
- `lib/use-mobile.ts`:`useSyncExternalStore` + `matchMedia`,服务端快照返回**桌面**(规则 7)

**Runtime 移动壳(`4a`–`4j` 的外壳部分)**
- `components/mobile/MobileTabBar.tsx`:四格底部 Tab Bar,**R-TABS 可见性照旧生效**,
  图标用穷举 `Record<TabKey,string>`(新增 tab 漏图标时 tsc 直接报错)
- `components/mobile/Sheet.tsx`:两档 Sheet(medium 50% / large 92%)+ 拖动切档 + `SegmentedControl`
- `components/mobile/MobileWorkbench.tsx`:功能条(左会话 / 中会话状态 / 右「运行时」+ 事件数徽标)、
  玻璃输入栏、运行时 Sheet(统计条 + 分段控件 + 四视图)、会话列表 Sheet(左滑删除 / 刷新)
- `components/mobile/MobileChat.tsx`:会话区(气泡 r18 / 正文 15/1.75)与空状态(48 高胶囊建议行)
- `components/workbench/Workbench.tsx`:**原地分支**,不搬状态 ——
  容器与两条 SSE 一字未动,`if (isMobile) return <MobileWorkbench .../>`,
  桌面 JSX 原样留在下面只加了一个 `m-hide-narrow` 类名
- `components/GlobalNav.tsx`:加 `m-hide-narrow`(窄屏整条不渲染),其余零改动

### ⏳ 未完成

- **`4e` 的移动端耗时色条公式还没落到 `TimelineView`**:画板给的是
  `min(100%, max(3px, √(ms/324) × 轨道宽))`,现在 Sheet 里装的仍是桌面的 px 公式
- `4f` 事件详情 payload 横滚盒、`4g` Chain 纵向链路、`4h` Lifecycle 窄屏分组
- `4c`/`4d` 折叠行与卡片展开在移动端的命中区外扩(26 高行 → 44 命中)
- **P1 全部**(`4k`–`4r`:Notes ×4 / Skills ×3 / About)
- **P2 全部**(`4s` 骨架 / `4t` 错误态 / `4u` 载体适配四态)
- 微信 webview 专项:`generateMetadata` 补各页标题(微信导航栏显示 `document.title`)、
  `visualViewport` 键盘避让、复制/下载/外链的 webview 降级提示

## 本轮实测

- `apps/web` `tsc --noEmit` 通过(**门禁不跑它**,见 BACKLOG);`bun test lib` 21 通过
- 390×845 实测:功能条 / 建议胶囊 / 输入栏 / Tab Bar 与画板 `4a` 对位;
  运行时 Sheet 高 422.5 = 父容器 845 的 **50%**、圆角 20、实底白、投影
  `0 -8px 40px rgba(0,0,0,.18)`,分段控件四格且空会话落在 Lifecycle(画板 1e 既有规则未破)
- 硬约束逐项:viewport 五项齐 / manifest 与三张图标 200 / theme-color 明暗两条 /
  玻璃走支持分支(`.72` + `blur(24px) saturate(180%)`,分隔线 0)/ **输入框 16px** /
  `overscroll-behavior-y:none`
- **桌面零改动实测**(1280×800):导航条 44 `flex`、Tab Bar `none`、
  **移动壳未挂载**(只有一份 SSE)、侧栏 260、右栏 428(42%,落在 min300/max500)

### 实现期发现的问题

1. **内联 `display` 盖过 `.m-show-narrow`**(已修):`MobileTabBar` 的内联 `display:"flex"`
   优先级高于类选择器的 `display:none`,表现是**桌面上也出现底部 Tab Bar**。
   显隐一律交给 CSS,组件里不写 `display`。
2. **`SegmentedControl` 的 `font: "inherit"` 简写**(已修):写在 `fontSize`/`fontWeight`
   之后会把两者一起冲掉。

## 待所有者裁定

- **ICP 备案号在移动端的位置,画板没画**。生产必须挂(`docs/deploy-cn-lightweight.md` 的部署约束,
  规则 8 明确「docs 的部署要求是约束不是功能」)。当前做法:给 `{children}` + Tab Bar 套一层
  定位容器,**备案条留在它下面、照旧可见**,桌面因内外层 flex 属性一致而完全透明。
  要不要换个位置(比如收进 About)请裁定。
- **第 0 步的真机验证还没做**:Android 微信里 `fetch` + `resp.body.getReader()` 能否流式。
  这一条不过则 Runtime tab 在安卓微信不可用,回退方案属新机制、须裁定。**我做不了,需要真机**。

## 代码审查

未开始 —— 等 P1/P2 落地后按流程走(前两轮全量,第 3 轮起 `--base` 只审整改 diff)。
