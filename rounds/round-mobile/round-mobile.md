# R-MOBILE —— 移动端呈现层(iOS 26 · 21 块画板)

分支 `round-mobile`。设计稿 `design/Agent X-Ray Mobile - Runtime.dc.html`(`4a`–`4j`)与
`design/Agent X-Ray Mobile - Notes Skills About.dc.html`(`4k`–`4u`),已于 2026-09-07 并入
(`2cd0564`,规则 8 的「先改设计稿、再进轮次」已满足)。
提示词:[`design-prompt.md`](design-prompt.md) · [`impl-prompt.md`](impl-prompt.md)。

## 所有者裁定(2026-09-07)

1. 移动端是**独立的一层**,与桌面并存、由视口宽度切换;**桌面 20 块画板与已实现页面零改动**
2. 画板直接新开 `4x` 段(`4a`–`4u`,21 块),放两份新文件,桌面两份不碰
3. 载体 = **PWA 只取轻量部分**(manifest + `display:standalone` + theme-color),不做 SW、不做安装引导
4. 竖屏(网页锁不了方向,靠 CSS 降级)
5. 移动端 SSE 断线重连**不做**(新机制,记 BACKLOG)
6. 禁双指缩放
7. **二次裁定:按普通 H5 做,不为微信单独优化**。画板不作废(每屏那条「微信导航栏 · 不可控」
   本来就只是画布示意、代码从不渲染);砍掉的是 UA 判定、「在微信中不可用」提示态、
   以微信栏为由的各页 `generateMetadata`(移进 BACKLOG)。玻璃的 `@supports` 降级**保留** ——
   它对任何 H5 都成立。

## 核心设计裁定:两层语言

- **外壳层 = iOS 26**:功能条、底部 Tab Bar、Sheet、胶囊按钮、inset grouped 列表、空/加载/错误态
- **内核层 = 照搬桌面 token**:Timeline 耗时色条、Chain、Lifecycle、工具调用卡、代码视图行号与
  三色高亮、markdown 排版 —— 只做触控与换行适配

代码上的落法:`MobileChat.tsx` 直接 `import { AssistantTurn, AssistantMessage }`,Sheet 里装的
就是桌面右栏那四个组件本身。**内核层没有第二份实现。**

## 交付(21 块全部落地)

| 画板 | 内容 | 提交 |
|---|---|---|
| 载体 | viewport 五项 + `gesturestart` 拦截 + manifest + 三张图标 + Dockerfile 恢复 `COPY public` | `5c38483` |
| `4a`–`4d` | Runtime 空状态 / 对话 / 折叠 / 展开 | `5c38483` |
| `4e` | 运行时 Sheet · Timeline(移动端色条公式 + compact 网格) | `5c38483` `d41405b` |
| `4f` | 事件详情:payload 横滚 · Ask why 同排胶囊 · 展开自动升 large | `5fbac27` |
| `4g` | Chain View:居中箭头 → 左侧连接线 + 模式色点 | `5fbac27` |
| `4h` | Lifecycle:12 节点单列 → 四组 × 2 列 | `5fbac27` |
| `4i` `4j` | Tools 面板 / 会话列表 Sheet(左滑删除) | `5c38483` |
| `4k`–`4n` | Notes 四块 | `b07a0b1` `d73d1cb` |
| `4o` `4r` | Skills 首页 / About + 主题开关 | `052cb40` |
| `4p` `4q` | Skill 详情:chip 条 + 文件树 Sheet | `c30583b` |
| `4s` `4t` `4u` | 骨架 / 错误态 / 载体适配 | `5fbac27` |

## 本轮实测

为验证先给开发库种了最小内容(走真实 MCP 路径,`server/discover` 回 `2026-07-28`、46 工具):
Notes 一分类 + 一系列 + 三章(含置顶 README)、Skills 一包两文件、About 全套。
章节正文刻意覆盖多级标题 / 代码块 / 宽表 / 行内 mono / 引用块。

- **桌面零改动**(1280×800):导航条 44 `flex`、Tab Bar `none`、**移动壳未挂载**(只有一份 SSE)、
  侧栏 260、右栏 428 —— 全是原值
- **硬约束**:viewport 五项齐 / manifest 与三张图标全 200 / theme-color 明暗两条 /
  玻璃走支持分支 / **输入框 16px** / `overscroll-behavior-y:none`
- **每一屏都量过 `body.scrollWidth === innerWidth === 390`(页面永不横滚)**
- `4e` Sheet 高 422.57 = 视口 50%、圆角 20、实底白、投影与画板一致
- `4m` 进度线 `top:44 z:5`(贴功能条底缘)、正文 15/1.75、h2 19、h3 17、
  **代码块横滚 784>353**、宽表横滚
- `4h` 四组网格、2 列 174×2、Sheet 与页面都不横滚
- `4p` chip 条 `[90x32 153x32]` overflowX:auto、**安装命令横滚 403>244**、INSTALL r16 border0
- `4t` 404 页四格字重 `400,400,400,400`、色全 `#6b7280`;导航回 `/notes` 后恢复 `400,600,400,400`
- `tsc --noEmit` 通过、`bun test lib` 21 通过

### 实现期发现并修掉的缺陷

1. **内联 `display` 盖过 `.m-show-narrow`** —— 桌面上也冒出底部 Tab Bar。显隐一律交给 CSS。
2. **`SegmentedControl` 的 `font:"inherit"` 简写**把 `fontSize`/`fontWeight` 一起冲掉。
3. **inset grouped 的行必须透明**:画板里卡是 `#f5f5f5`、行不设背景;做成白底等于把卡盖住,
   单行分组时完全看不出边界。同一错误在两个 Sheet 里各有一份。
4. **`.m-series-head` 改 column 后必须显式 `align-items:stretch`** —— 内联是 `flex-start`,
   整宽主按钮只有 129px。
5. **移动端没法切主题**(自己引入的回归):桌面导航条整条 `display:none`,而主题按钮在上面。
   按 `4r` 搬进 About。
6. **`<label>` 包受控 checkbox 会双触发** —— `onChange` 跑两次,`classList.toggle` 与 `setDark`
   不同相,表现是「主题真的切了但开关视觉停在原位」。改 `<button role="switch">`。
7. **`.md-chapter` 选择器选不中**:`components/Markdown` 不套容器类,正文元素直接落在
   `.m-chapter-body` 下。

## 待所有者审核 / 裁定

- **ICP 备案号在移动端的位置,画板没画**。当前:给内容区套一层定位容器,Tab Bar 贴它的底,
  备案条在下面照旧可见,桌面因内外层 flex 属性一致而完全透明。要不要换位置请裁定。
- **安卓微信 `fetch` + `resp.body.getReader()` 的真机验证没做**(需要真机)。按二次裁定
  已不为微信优化,但 Runtime 的流式在**任何**移动浏览器上都该实测一次。
- ~~主题开关的像素态没确认~~ **已查清并销项**:`getComputedStyle` 读回关闭色**不是 bug,是测量假象**。
  判据三步:① 直接用 JS 写 `track.style.background` 后 computed 仍不变,而**无 transition 的
  `outline` 立刻跟随** → 不是渲染器整体冻结,是带 transition 的属性卡住;② 窗口隐藏时不产生
  动画帧,**transition 时间线冻结**,computed 因此永远停在起始值(等 700ms 也一样);
  ③ 临时 `transition:none` 强制回流后,**旋钮 computed = `matrix(1,0,0,1,20,0)` 即 `translateX(20px)`,
  正是开启位**(旋钮全程没被探针碰过,证据干净)。开关的功能与视觉都正确。
  **顺带得到一条通用教训**:窗口不可见时,凡是带 `transition` 的属性都不能用 `getComputedStyle` 验,
  要么读 style 属性、要么临时去掉 transition。
- 三条既有问题已记 `rounds/BACKLOG.md`:全站 ghost 按钮字号 14≠设计稿 12、
  `/skills/[name]` 在 dev 下卡加载骨架(**已排除是本轮改动**)、各页 `generateMetadata`。

## 代码审查

见下方「codex 审查」段。
