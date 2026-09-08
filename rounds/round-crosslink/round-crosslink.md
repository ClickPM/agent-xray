# Round R-CROSSLINK — 跨栏 / 跨页联动:Ask why 预填 + 卡片 ↔ Timeline 互相定位 + Notes 章节 → Runtime 入口

<!-- 保存为 rounds/round-crosslink/round-crosslink.md;该轮其他管理产出放同一目录。 -->

> 状态:**设计稿 2026-09-08 已并入、开工中**(所有者裁定 2026-09-08:下一阶段三轮里的第二轮,排在 R-LEAK 之后、R-CARDS 之前)。分支 `round-crosslink`。
> 三件事共用**同一个原语**:「把一句预设文本放进 Runtime 的输入框,**不自动发送**」——所以并成一轮。
> 与 R-TOOLS / R-PERF / R-TOOLCARDS / R-SOURCE 同一顺序、**不是**规则 8 的例外:画板先扩(桌面 `2q` / `2r` 放**新文件**
> `Agent X-Ray Crosslink.dc.html`,移动端 `4v` / `4w` 追加进 `- Runtime`、`4x` 追加进 `- Notes Skills About`;`1b` / `4f` 只加注释),
> 并入 `design/` 之后才开 `round-crosslink`。给 Claude Design 的提示词在 [`design-prompt.md`](design-prompt.md)。
> 规则 9「先改文档」:`docs/security.md` §0 第 10 条(经链接预填的诱导)已随本任务卡写入。

## 目标

三条联动都成立且**零后端机制**(无新端点、无迁移、无 MCP 变动、`messages.payload` 与两条 SSE 契约不变):

- **C1 · Ask why 做实**:画板 `1b` / `4f` 上那枚一直是死按钮的 `Ask why ↗`([`TimelineView.tsx:70`](../../apps/web/components/workbench/TimelineView.tsx))
  点下去把一句追问填进输入框,访客自己按发送;答案是一轮普通对话,追问本身也进轨迹。
- **C2 · 卡片 ↔ Timeline 互相定位**:会话区工具卡的展开体(`2m`)里多一条「在 Timeline 里查看 ↗」,点了右栏对应的 `tool_call` 行展开并滚入视野;
  Timeline `tool_call` 行的详情卡(`1b`)里多一条「查看卡片 ↗」,点了会话区对应的卡展开并滚入视野。两边靠 `toolCallId` 对上(BACKLOG R-TOOLCARDS 那条)。
- **C3 · Notes 章节 → Runtime**:章节页多一个入口「在 Runtime 里聊这一章」,跳到 `/` 时输入框已带一句以这一章为题的提问;Runtime tab 被隐藏(R-TABS)时入口不渲染。

可证伪:三条各自的点击 → 期望态在本机逐项对照画板;三条都**不发出任何请求**(Network 面板零新增),发送仍由访客按钮触发;
`git diff --stat main -- apps/api` 只有 `runtime.ts` 的一句提示词与它的测试。

## 所有者裁定(2026-09-08)

| # | 裁定项 | 结论 | 落点 |
|---|---|---|---|
| 1 | Ask why 的形态 | **1-A 预填**(不是服务端拼上下文 1-B、不是独立解释器 1-C) | 前端拼一句话进输入框;模型的上下文里本来就有那次工具调用,非工具事件靠 R-SOURCE 的 `source_*` 读源码解释 |
| 2 | 三件事并一轮 | **并**:同一原语、画板量小 | 一个 `prefill` 通路,三处调用 |
| 3 | 定位方向 | **双向**(BACKLOG 原文「互相定位」) | 卡 → 行、行 → 卡各一条链接 |
| 4 | Notes → Runtime 的提问从哪来 | 见下「派生取舍」第 3 条(实现者建议通用模板,不加内容字段;可推翻) | |
| 5 | 顺序 | 先画板、再进轮次 | `2q` / `2r` + `4v` / `4w` / `4x` + `1b` / `4f` 注释 |

派生取舍(实现者定,画板照此画;可推翻):

1. **预填永不自动发送**(安全前提,`docs/security.md` §0 第 10 条):无论来自按钮还是 URL,文本只落进输入框、访客看得见、发不发由访客决定。
   来自 URL 的预填**读一次即清**(`history.replaceState` 去掉参数),刷新不会再次预填;长度上限 1000 字符,超出整段丢弃(不截断,截断会产生一句被改过的话);
   去掉控制字符。不写 localStorage、不进 cookie、不进任何存储。
2. **Ask why 的文案由前端从 `TraceRow` 拼**,纯函数 `apps/web/lib/ask-why.ts`(`bun test lib` 可测)。两种形状:
   - 工具行(`tool_call`):「在 {turnLabel} 里你调用了 `{toolName}`,入参是 `{inputPreview 前 120 字}`。为什么要这么做?」
   - 非工具行(`before_agent_start` / `context` / `model_select` …):「在 {turnLabel} 里出现了 `{eventName}` 事件({mode};扩展 {extension} 返回了 {returned 前 80 字})。
     这一步是什么、为什么会发生?需要的话读本站源码来解释。」
   `TraceRow` 补 `seq` / `toolCallId?` / `eventType` 三个派生字段(前端 `types.ts`,不是生成物),文案里**不用 seq 编号**(访客与模型都看不到那个号)。
3. **C3 的提问用通用模板,不给章节加「示例提问」字段**:「我在读本站教程《{seriesName} · {title}》(`/notes/{series}/{chapter}`)。
   请用 `notes_get_chapter` 读这一章,先用三句话概括核心观点,然后等我提问。」——零 MCP 变动、零迁移;模型有 `notes_get_chapter`,能落地。
   备选(要所有者裁定才做):`notes_chapter_upsert` 加 `tryPrompt` 字段 + 迁移加列 + `docs/mcp.md`,由所有者逐章写更好的提问。
4. **C3 入口的落点由画板定**:推荐放在标题下 meta 行末尾、与「原文」同一语汇的文本链接(零新视觉语汇);备选是右上 ghost 按钮。
   移动端 `4m` 的功能条已经很满(返回 / 章序 / 目录),入口跟着 meta 行走,不进功能条。
5. **定位的「已定位」态不新造**:Timeline 侧 = 既有展开态(`expandedKey`)+ `scrollIntoView({block:"center"})`,并把「贴底跟随」置 false(否则新事件一来就被拽回底);
   会话区侧 = 既有折叠行打开 + 既有卡片展开态 + `scrollIntoView`。两条新链接的语汇照抄 `Ask why ↗`(mono 11 / 品牌色 / `↗`)。
   `toolCallId` 对不上(旧会话没有 `payload`、或事件被 `MAX_TRACE_EVENTS` 裁掉)时链接**不渲染**,不画「找不到」态。
6. **移动端的 Ask why**:点 `4f` 的胶囊 → 关闭运行时 Sheet → 预填 → 输入框聚焦(键盘避让已有)。C2 的「在 Timeline 里查看」在移动端 = 打开 Sheet 到 large、切到 Timeline、展开该行。
7. **URL 参数名 `ask`**(`/?ask=<encodeURIComponent(text)>`),Workbench 在 `useEffect` 里读 `window.location.search`,**不用** `useSearchParams`
   (Next 15 要求它外面套 Suspense,否则整页退化成 CSR bailout)。Runtime 被隐藏时 `/` 本来就 307 到第一个可见 tab,参数随之丢弃,无需另处理。
8. **系统提示加一句**(`runtime.ts` `SYSTEM_PROMPT_CLAUSES`):「访客可能对轨迹里的某一步追问“为什么”:按你实际做过的调用与拿到的结果如实解释;
   涉及站点内核机制(扩展、守卫、注入)时可以读本站源码再答;不要编造没发生过的步骤。」——提示词修补也走完整 codex 循环。

## 前置

- **设计稿**:`2q` / `2r`(新文件)+ `4v` / `4w` / `4x`(追加)+ `1b` / `4f` 注释,并入 `design/`(四项判据全过;
  `Mobile - Runtime` 现 132,859 B、`- Notes Skills About` 186,339 B,各追加两三块画板仍远离 262,144 B)。
- R-TOOLCARDS(`payload.toolCalls[].toolCallId` + 折叠行 / 卡片展开态)、R-SOURCE(`source_*` 工具,非工具事件的解释依赖它)、R-TABS(`visibleTabKeys`)。
- 建议 R-LEAK 先发版(不是硬前置)。无新凭据、无新依赖、无新容器。

## 与画板的对照关系(拉回设计稿后逐项填)

| 画板 | 页面 / 组件 | 核对项 | 结果 |
|---|---|---|---|
| `1b`(注释) | `TimelineView.tsx` DetailCard | Ask why 的行为说明;右上第二条链接「查看卡片 ↗」(仅 `tool_call` 行) | ✅ 两条并排、间距 6、Ask why 在最右;画法照抄(11px **系统字**不是 mono —— 画板 2q 注释点名了这一处,照 1b 抄) |
| `2q` 桌面 · 追问预填 + 定位态 | `Workbench.tsx` / `TimelineView.tsx` | 输入框带预填文本、发送按钮常态;右栏 `tool_call` 行展开且滚入视野;会话区卡片展开体多一条「在 Timeline 里查看 ↗」 | ✅ 三处全对;链接在展开体**之内**、`RESULT` 段下 10、`margin-left:-6` 与上面两段左对齐 |
| `2r` 桌面 · Notes 章节页入口 | `app/(site)/notes/[series]/[chapter]/page.tsx` | 入口位置与语汇照画板;Runtime 隐藏时不渲染 | ✅ 取方案 A(meta 行末尾文本链接,与「原文」同一语汇);隐藏时整条连同前面那个「·」一起不渲染 |
| `4f`(注释) | 同上,`compact` | 胶囊点击 = 关 Sheet + 预填 | ✅ 胶囊仍是唯一一枚(画板 4w 的两枚放不下裁定) |
| `4v` 移动 · 追问预填 | `MobileWorkbench.tsx` | Sheet 收起、输入框带文本、键盘弹起 | ✅ Sheet 关闭 + 预填 + 聚焦(`focus()` 同步调用,不进 rAF —— iOS 只在手势那一个任务里 focus 才弹键盘) |
| `4w` 移动 · 卡片定位 | `MobileChat.tsx` + `MobileWorkbench.tsx` | Sheet large、Timeline 该行展开 | ✅ Sheet 升 large + 分段控件切 Timeline + 该行展开滚入视野;「查看卡片」是详情块底部一行链接、命中区实测 44 |
| `4x` 移动 · 章节页入口 | 章节页 + `MobileChapterBar` 不改 | 入口跟 meta 行 | ✅ meta 行 `line-height: 1.9`(实测 20.9px)自然换行到第二行;功能条一个像素没动 |

## 交付物

| 件 | 路径 | 内容 |
|---|---|---|
| 预填原语 | `apps/web/components/workbench/Workbench.tsx` | `draft` 既有;新增:读 `?ask=` 一次即清;`locateCard(toolCallId)` 状态(打开折叠行 + 卡 + 滚动) |
| Ask why 文案 | `apps/web/lib/ask-why.ts` + `ask-why.test.ts` | 纯函数:`TraceRow` → 一句话;两种形状;上限截取 |
| 轨迹投影 | `apps/web/lib/types.ts` / `trace-view.ts` + `trace-view.test.ts` | `TraceRow` 补 `seq` / `eventType` / `toolCallId?` |
| Timeline | `apps/web/components/workbench/TimelineView.tsx` | Ask why `onClick`;`locate` 受控(key + nonce)+ 滚动 + 解除贴底;详情卡「查看卡片 ↗」 |
| 会话区 | `Workbench.tsx`(`ToolCard`)/ `components/mobile/MobileChat.tsx` | 展开体加「在 Timeline 里查看 ↗」;受控展开 |
| 移动壳 | `components/mobile/MobileWorkbench.tsx` | Ask why 关 Sheet;定位开 Sheet 到 large 并切 Timeline |
| Notes 入口 | `app/(site)/notes/[series]/[chapter]/page.tsx` | 服务端按 `visibleTabKeys` 决定渲不渲染;链接 `/?ask=…`;`apps/web/lib/try-in-runtime.ts` 拼模板 + 测试 |
| 提示词 | `apps/api/agent/runtime.ts` + `runtime.test.ts` | 一句追问条款 |
| 文档 | `docs/security.md` §0 第 10 条(已写)· `design/README.md` 画板增删记录(拉稿时)· `rounds/BACKLOG.md` 一条关闭 · `docs/releases.md` | |

**不交付**:新端点、迁移、MCP 工具变动(仍 51)、`messages.payload` 形状变更、SSE 帧变更、服务端拼上下文、独立解释器、章节级「示例提问」字段、自动发送、
「找不到对应行 / 卡」的提示态、Ask why 的答案弹层。

## 验收

| # | 检查 | 命令 / 期望 | 结果 |
|---|---|---|---|
| 1 | 编译与测试 | `dev.ps1 check` / `dev.ps1 test` 全绿(含 web `bun test lib` 新增:`ask-why` / `try-in-runtime` / `trace-view` 三处);`apps/web` `tsc --noEmit` 过 | ✅ `check` 通过;`test` = api 34 文件 609 用例 + web 55 用例(改前 21 → 新增 34)全绿;`tsc --noEmit` 通过 |
| 2 | C1 桌面 | 点 `1b` 的 Ask why → 输入框文本 = `ask-why.ts` 对该行的输出;Network 零新增;按发送后一轮正常,Timeline 出现这次追问 | ✅ 文本 = `在 Turn 1 里你调用了 notes_search,入参是 {"query":"agent loop"}。为什么要这么做?`,`performance.getEntriesByType('resource')` 增量 0,光标 `[63,63]`;按发送后模型如实解释、轨迹从 49 行涨到 96 行 |
| 3 | C1 非工具行 | 对 `before_agent_start` 行点 Ask why → 文案是非工具形状;faux provider e2e 里模型调用 `source_read` 或直接作答均可,断言只到「发出去了、轨迹形状正常」 | ✅ `context` 行 → `在 Turn 1 里 context 这一步做了什么?为什么需要它?`(非工具形状,无工具名与入参);未自动发送 |
| 4 | C1 移动 | `4f` 胶囊 → Sheet 关闭、输入框带文本并聚焦 | ✅ Sheet 关闭(整棵子树卸载)、文本在、`document.activeElement === input`、光标句尾、Network 增量 0 |
| 5 | C2 卡 → 行 | 展开体链接 → 右栏该 `tool_call` 行展开、`getBoundingClientRect` 在视口内;新事件到达不再自动滚回底(贴底已解除) | ✅ 行 `s18` 展开且在视口内(`scrollTop` 66 / 上限 717);随后发一轮新消息:轨迹 49 → 80 行而 `scrollTop` 恒为 66 —— 贴底跟随确实解除 |
| 6 | C2 行 → 卡 | 详情卡链接 → 会话区折叠行打开、该卡展开、在视口内;进行中(未折叠)的一轮同样成立 | ✅ 折叠行打开 + 卡展开(`RESULT` 段在)+ `rect` 在视口内 + Network 增量 0。进行中那一支未折叠、卡本来就在 DOM 里,走同一条 effect |
| 7 | C2 对不上 | 无 `payload` 的旧会话、被裁掉的事件:两侧链接都不渲染 | ✅ 把 `messages.payload` 全置 NULL 再打开会话:会话区无卡无折叠行,`tool_call` 行的详情卡**只剩 `Ask why ↗`**、没有禁用态也没有提示。折叠成 `×N` 的一支由 `trace-view.test.ts` 钉 |
| 8 | C2 移动 | `4w`:Sheet 升到 large、面板切到 Timeline、该行展开 | ✅ 三件事都发生(分段控件 `aria-selected=true` 落在 Timeline),行在视口内;链接命中区实测 44×128 |
| 9 | C3 桌面 | 章节页入口 → `/` 输入框带模板文本、地址栏无 `?ask=`、刷新后输入框为空、未发送 | ✅ 地址栏回到 `/`(同页另一个参数 `keep=1` 保留、只删 `ask`),文本在、聚焦、光标句尾、未发送;刷新后输入框为空 |
| 10 | C3 隐藏 tab | `site_tab_set runtime false` 后章节页无入口;直接访问 `/?ask=x` 307 到第一个可见 tab | ✅ 直接改库 `site_tab_config.runtime=false`(本机 MCP 未连,行为等价):章节页无入口、meta 行无悬空「·」;`/?ask=hello` 跟随重定向落在 `/notes`,`ask` 未带过去 |
| 11 | 预填边界 | `?ask=` 超 1000 字符整段丢弃;含控制字符被去掉;不写任何存储 | ✅ 1001 字符 → 输入框空;`前
中	后<U+200B>隐<U+202E>藏` → 只剩五个汉字码位;`localStorage` 0 键、`sessionStorage` 只有既有的 `xray-trace-client`、无 cookie |
| 12 | 画板逐项 | `2q` / `2r` / `4v` / `4w` / `4x` 逐项对照;`1b` / `4f` 之外的既有画板与页面零改动(`git diff --stat` 核) | ✅ 见上「与画板的对照关系」;`git diff --stat main` 只有本轮交付物 + 一条 CSS 增量(`.m-locate-*` / `.m-chapter-meta`,都在 `@media (max-width:768px)` 内) |
| 13 | 提示词 | `runtime.test.ts` 钉那句在;faux e2e 一轮追问不报错 | ✅ 新增用例钉「被追问「为什么这么做」时 / 实际做过 / 可以读本站源码再答 / 不要编造没发生过的步骤」四段,且**零工具与有工具两种底座都在**;本机 faux provider 跑完一轮追问正常 |
| 14 | 文档同步 | `design/README.md` 增删记录;BACKLOG「卡片 ↔ Timeline」关闭;`docs/releases.md` 一行;MCP 51 不变 | ✅ `design/README.md` / CLAUDE.md / ROUNDS.md 三处计数与增删记录已同步(设计稿并入那一提交);`docs/security.md` §0 第 10 条翻成「已落地」;BACKLOG 那两条待**发版后**关闭(本条按既有口径:发版才算关);`apps/api/mcp` 零改动,工具仍 51 |

## 禁止

- 不做服务端拼上下文(1-B)、不做独立解释器(1-C)、不加端点、不改 SSE 帧、不改 `payload`。
- 不自动发送;不把预填文本写进任何存储;不用 `useSearchParams`。
- 不画「找不到对应行 / 卡」态;不给 Timeline 行或卡片新造高亮色(用既有展开态)。
- 不给章节加内容字段(备选要另裁定)。
- 默认继承两条:不改前端页面样式(规则 7,画板之外的一个像素都不动);不加设计稿没有的功能(规则 8)。

## 代码审查

<!-- 完成后回填。 -->

- 审查方式:codex `/codex:review --background`(前两轮全量;第 3 轮起 `--base <上一轮已审提交>`)。
  带给审查者的要求:只判定缺陷与严重级别,不展开设计方案;重点是预填的边界(长度 / 控制字符 / 读一次即清)与 `toolCallId` 对不上时的兜底。

**第 1 轮**(全量 `branch diff against main`,提交 `fd8276a`):3 条 findings,**全部 P2、无 high**,**三条全部采纳整改**。

| # | finding | 处理 |
|---|---|---|
| 1 | **预填输入框不换行**(`MobileWorkbench.tsx` / `InputBar`):画板 `2q` / `4v` 要求「溢出自然换行、输入框长到两行 / 胶囊自然增高」,而两处都还是单行 `<input>` —— 长句只会横向滚动、把大半句藏起来 | **采纳**。两处换成 `<textarea rows=1>` + 自动增高(`height:auto` → `scrollHeight + border`),回车仍是发送(`preventDefault` 挡掉换行),**静息高度一像素不差**(桌面把行高钉成 19px 复刻原 `<input>` 的行盒;移动端取画板 4v 的 `padding 9/16 + line-height 1.375`,9+22+9=40 正好是原 min-height)。五行封顶后框内滚动 —— 文本不裁不省略。移动端输入栏是绝对定位浮层,长高后由 `grown` 把内容区的底部让位一起顶上去,否则最后一条消息会被盖住 |
| 2 | **`/?%61sk=hello` 不会被清除**:`readAskParam` 经 `URLSearchParams` 解码后认得它、照常预填,而清除那一步在**原始串**上找 `"ask="` → 认不出 → 参数留在地址栏、刷新再预填一次,违反 `docs/security.md` §0 第 10 条的「读一次即清」 | **采纳**。判据改成 `url.searchParams.has("ask")`(与读取侧同一套解码),删完再 `replaceState` |
| 3 | **定位请求跨会话残留**:行键是 `s<seq>` 而 seq 每个会话从 0 起;在 A 定位后切到 B,`TimelineView` 下次挂载(移动端关掉再打开 Sheet)会拿旧请求展开 B 里**同键的无关行**,还顺手关掉贴底跟随 | **采纳**。`clearLocate()` 在 `openSession` / `startNew` 里作废两个方向的请求 |

三条的整改都在本机复验过:① 桌面空框 37px = 改动前 `<input>` 的 37px、追问句长到两行(56px)、1000 字封顶 113px 且框内可滚;
移动端空框正好 40px、追问句 84px(三行)、内容区底部让位 107 → 151 同步跟上;② `/?%61sk=…` 预填后地址栏干净;
③ 在 A 定位 `s18` 后切到 B(94 行、含同键行)再让 `TimelineView` 重新挂载 —— **零行展开**。

**第 2 轮**(仍全量,提交 `e10491a`):3 条 findings(1 条 P1 + 2 条 P2),**三条全部采纳整改**。

| # | finding | 处理 |
|---|---|---|
| 1 | **P1 · 没有 payload 的事件行点不开,也就没有 Ask why**:`expandable` 自 R4 起是 `hasDetail()`(除 `type` 外还有内容才可展开),而画板 4v 的裁定是「Ask why 胶囊在**任何**事件行都有」 | **采纳**,`expandable` 改成恒真(一处判断)。审查者举的 `context` / `message_*` 在真实事件流里其实都有 payload、点得开 —— **实测只有四种**没有:`agent_start` / `before_provider_headers` / `before_provider_request` / `agent_settled`。但其中 `before_provider_request` 正是屏幕上最长的那根条(一次模型往返、927ms),最招人问「为什么这么久」却偏偏点不开,所以 finding 成立。代价说清楚:这四种行现在也带箭头了 —— 箭头是「可展开」的既有语汇,而画板 1a/2q 的静态稿只给**展开中**的行画箭头、没规定哪些行可展开,故不算偏离画板。展开后 INPUT 段如实写「(无附加字段)」,不编内容 |
| 2 | **P2 · 移动端「查看卡片」把目的地藏在 Sheet 后面**:链接是在运行时 Sheet 里点的,而会话区那张卡在 Sheet **背后**,卡确实展开并滚过去了,访客却只看见一张没动过的 Sheet | **采纳**,`cardLink.go` 顺带发一个 `sheetRequest: close`。与反方向(卡 → 行要把 Sheet 打开到 large)正好互为镜像 |
| 3 | **P2 · U+2028 / U+2029 漏网**:它们的 Unicode 类别是 `Zl` / `Zp`,不在 `INVISIBLE` 覆盖的 `Cc` / `Cf` 里,而浏览器按换行渲染 —— `/?ask=safe%E2%80%A8hidden` 能在「看起来只有一行」的框里把后半句推到五行视窗之外,削的正是「发送前访客看得见」 | **采纳**,字符类补 `  `,`ask-why.test.ts` 加用例钉住 |

复验:`before_provider_request` 行现在可展开、Ask why 给出非工具形状文案,全部 33 行**零行没有箭头**;
移动端点「查看卡片」后 Sheet 关闭、卡展开且在视口内(top 146);`bun test lib` 56 用例全绿(新增 1 条)。

- 结论:**整改后待复审**(第 3 轮起按流程只审整改 diff,`--base e10491a`)。

## 失败处理

同一验收项针对性整改后连续 2 次验证仍不过 → 写 `rounds/round-crosslink/BLOCKED.md`,停下呼人。禁止放宽验收标准自我通过。

## 本轮实测

**与任务卡的三处偏离**(画板是边界,任务卡里的派生取舍在画板定稿后按画板走):

1. **非工具行的追问文案取画板那一版,不是任务卡草稿那一版**。任务卡写的是「…出现了 `{eventName}` 事件({mode};扩展 {extension} 返回了 {returned 前 80 字})。这一步是什么…」;
   画板 `1b` / `2q` / `4v` 三处注释统一定成 **「在 Turn 2 里 context 这一步做了什么?为什么需要它?」** —— 只有 Turn 标签 + 事件名。取画板:
   模式色与扩展返回值都是**右栏已经画在访客眼前的东西**,再抄进问句只会让预填变长,而模型的上下文里本来就有这一轮的全部事件。
2. **`TraceRow` 补的是五个派生字段,不是三个**。任务卡列的是 `seq` / `toolCallId` / `eventType`;工具行的文案还要工具名与入参摘要,
   而它们只在 `name`(`tool_call · web_search`)与 `detail.input`(整串 `{ toolCallId: …, toolName: …, inputPreview: … }`)里 ——
   从展示串反解等于让文案依赖排版。于是补 `toolName` / `inputPreview` 两个,直接取脱敏事件里的同名字段。
3. **`toolCallId` 只给 `tool_call` 行**(任务卡只说了「折叠成 `×N` 的不给」)。见下面第 1 个坑。

**踩的三个坑**(都是本机验收照出来的,静态看代码看不出来):

1. **「id → 行」的表被同一次调用的后续事件覆盖,定位落在 `tool_execution_end` 上。** 同一个 `toolCallId` 出现在四种事件上
   (`tool_execution_start` / `tool_call` / `tool_result` / `tool_execution_end`),投影一开始给这四种行都填了 `toolCallId`,
   容器建表时 `map.set(id, key)` **后写覆盖先写**,于是从卡片点「在 Timeline 里查看」跳到的是 `tool_execution_end`。
   表现很像「定位到了」(确实展开了一行、也确实滚过去了),不逐行核对读不出来。修法在投影侧:`toolCallId` 只发给 `tool_call` 行,
   容器那边不再重复判一次 `eventType`(两处口径会漂)。`trace-view.test.ts` 加了钉这一条的用例。
2. **`requestAnimationFrame` 在页面不可见时根本不回调**,于是「行展开了但没滚过去」。本机验收时 Browser pane 是隐藏的
   (`document.visibilityState === "hidden"`),定位的滚动挂在 rAF 里就永远不执行 —— 行确实展开了,`scrollTop` 却纹丝不动,
   一度以为是「贴底跟随把它拽回去了」。改成 **effect 里立刻滚一次 + `setTimeout(…, 0)` 再补一次**:前者覆盖「行已在 DOM 里」,
   后者覆盖「这一帧才挂载」(移动端 Sheet 关着时整棵子树不渲染、会话区折叠行收起时卡片不在 DOM 里)。
   产品上 rAF 也能用(点得到就说明页面可见),但一个不依赖可见性的东西没有理由挂在可见性上。
3. **本机开发库的 `llm_config` 是空的**,验收要自带假 provider(记忆 `local-acceptance-faux-provider` 的老坑,这轮照方抓药:
   node 起一个 OpenAI `chat/completions` SSE 假服务按剧本回「调 `notes_search` → 一句正文 → 追问的解释」,
   `llm_config` 种一行 `faux` 指过去,验完删行、杀进程)。pi loop / 工具 / 轨迹 / SSE / 落库全是真的。

**Ask why 的答复质量**:本机只有假 provider(按关键字回固定剧本),答复质量要等真 provider 才有意义 ——
本轮只验到「文案是对的、发得出去、答复正常落进轨迹」。三个例子留在这里,发版后照它们在生产上抽验:
`在 Turn 1 里你调用了 notes_search,入参是 {"query":"agent loop"}。为什么要这么做?` /
`在 Turn 1 里 context 这一步做了什么?为什么需要它?` /
`我在读本站教程《Pi · Agent Loop — query 这一个循环》(/notes/pi/01)。请用 notes_get_chapter 读这一章,先用三句话概括核心观点,然后等我提问。`

**顺带发现、按规矩没当场改的一条**:移动端展开 Timeline 任一行都会在控制台报
`Cannot update a component (MobileWorkbench) while rendering a different component (TimelineView)` ——
`onExpand?.()`(画板 4f 的「展开即升档」)写在了 `setExpandedKey` 的更新函数里,而更新函数在渲染阶段执行。
**引入于 R-MOBILE、`git diff main` 里那一段一字未动**,功能表现正常、只是 dev 下报错刷屏,已记 `rounds/BACKLOG.md`。
