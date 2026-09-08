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

## 代码审查(codex,5 轮,收口 PASS)

前两轮全量 `branch diff against main`,第 3 轮起 `--base <上一轮已审提交>` 只审整改 diff
(CLAUDE.md 的审查范围约定)。**共 17 条 findings:16 条采纳整改、1 条实证不采纳;
high 级为零,末两轮零 findings。**

| 轮 | 范围 | findings | 结果 |
|---|---|---|---|
| 1 | 全量 | 8(2×P1 + 6×P2) | 全部采纳 → `df3030e` |
| 2 | 全量 | 7(2×P1 + 5×P2) | 6 采纳 + **1 实证不采纳** → `e8ac2b1` |
| 3 | `--base df3030e` | 2(P2) | 全部采纳 → `9bcea19` |
| 4 | `--base e8ac2b1` | **0** | 自查另修一处非法嵌套 → `af30b17` |
| 5 | `--base 9bcea19` | **0** | 收口 |

### 第 1 轮(8 条,全部采纳)

两条 P1 都会让移动端**核心交互不可用**:①输入栏被软件键盘整条盖住(iOS 只缩
`visualViewport` 不改布局视口)——这是 `impl-prompt.md` §3.3 早就写明、我却漏做的;
②输入栏与内容留白没计入 `safe-bottom`,而 Tab Bar 实际高度是 `49 + safe-bottom`,
34px Home Indicator 机型上重叠且 Tab Bar 的 `z-index:5` 盖住输入框下半部。
根因是我到处写裸的 `49`,已抽出 `--m-top-inset` / `--m-bottom-inset` 从源头堵住。
六条 P2:缩放拦截没有视口条件(**吃掉了 macOS Safari 的触控板捏合**,违反规则 7)、
`--safe-top` 无消费者、内容页底部只留 24px 被 Tab Bar 遮住、移动 RSS 仍是桌面弹层、
目录 Sheet 档位写着 61% 却传 50%、chip 条没有吸附。

### 第 2 轮(7 条,6 采纳 + 1 不采纳)

**不采纳的那条(P1「Sheet 被滚动容器裁切/偏移」)—— 实证证伪,不加 portal。**
用与站点完全同构的合成 DOM 测两次:①容器滚 800px 后 Sheet 相对外层仍是 `200..400`,
不随滚动偏移;②Sheet `top:400` 远超容器 200 可视高时 `elementFromPoint` 仍命中它,
未被裁切。原因是它的 containing block(布局层 `position:relative` 的外层)是滚动容器的
**祖先** —— CSS 2.1 §11.1.1 的既定行为。

采纳的六条里有三条是我没读透画板:**会话列表应是左侧滑出抽屉**(画板 4j 标题就写着
「(左侧滑出)」,宽 84%、右两角 r20、右侧留 16% 露出被压暗的会话区,而我做成了 92% 全宽的
底部 Sheet,**位置感与画板相反**)、**下拉刷新**(画板明写「刷新图标 → 下拉刷新手势」,
并强调它「是移动端固有的交互原语,**不是新功能**」——所以不适用「非阻塞性 findings
不许新增机制」那条)、**文件树丢了目录节点**(`scripts/run.py` 与 `references/run.py`
会双双显示成无法区分的 `run.py`)。

### 第 3 轮(2 条 P2)

chip 骨架在 320 下把整页顶出横滚(346 塞进 288)。**修法不是给骨架加横滚** ——
画板 4s 明写「加载态里没有真实内容,横滚容器留到内容到达后再出现」,并给了正解
「320/430 吸收差值 = 所有 width 用 % 的骨架条」。另一条:加载功能条中间槽空着,
而画板裁定原话是「`omSpin`(**功能条中间**的「正在取…」)」。

### 第 4 轮(零 findings,但自查另修一处)

复审零 findings,但它的**推理轨迹**里出现过 `Confirming span-div invalid nesting`
却没写进 findings。自己复核确认属实:DOM 里存在 `DIV > SPAN > DIV` —— 第 3 轮我用
`<span className="m-hide-narrow">` 包了返回 `<div>` 的 `LoadingNote`。浏览器解析器
对 `span > div` 不像 `<p>` 那样自动闭合,所以没当场炸,但那是侥幸不是正确、且是水合隐患。
改为给 `LoadingNote` 加 `className`。**审查没报不等于没问题。**

### 收口门禁

`dev.ps1 test` 全绿(**api 28 文件 564 用例 + web 21 用例**)、`apps/web` `tsc --noEmit`
通过(门禁不跑它)、桌面四 tab 零改动实测通过。
