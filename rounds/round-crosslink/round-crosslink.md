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

| 画板 | 页面 / 组件 | 核对项 |
|---|---|---|
| `1b`(注释) | `TimelineView.tsx` DetailCard | Ask why 的行为说明;右上第二条链接「查看卡片 ↗」(仅 `tool_call` 行) |
| `2q` 桌面 · 追问预填 + 定位态 | `Workbench.tsx` / `TimelineView.tsx` | 输入框带预填文本、发送按钮常态;右栏 `tool_call` 行展开且滚入视野;会话区卡片展开体多一条「在 Timeline 里查看 ↗」 |
| `2r` 桌面 · Notes 章节页入口 | `app/(site)/notes/[series]/[chapter]/page.tsx` | 入口位置与语汇照画板;Runtime 隐藏时不渲染 |
| `4f`(注释) | 同上,`compact` | 胶囊点击 = 关 Sheet + 预填 |
| `4v` 移动 · 追问预填 | `MobileWorkbench.tsx` | Sheet 收起、输入框带文本、键盘弹起 |
| `4w` 移动 · 卡片定位 | `MobileChat.tsx` + `MobileWorkbench.tsx` | Sheet large、Timeline 该行展开 |
| `4x` 移动 · 章节页入口 | 章节页 + `MobileChapterBar` 不改 | 入口跟 meta 行 |

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

| # | 检查 | 命令 / 期望 |
|---|---|---|
| 1 | 编译与测试 | `dev.ps1 check` / `dev.ps1 test` 全绿(含 web `bun test lib` 新增:`ask-why` / `try-in-runtime` / `trace-view` 三处);`apps/web` `tsc --noEmit` 过 |
| 2 | C1 桌面 | 点 `1b` 的 Ask why → 输入框文本 = `ask-why.ts` 对该行的输出;Network 零新增;按发送后一轮正常,Timeline 出现这次追问 |
| 3 | C1 非工具行 | 对 `before_agent_start` 行点 Ask why → 文案是非工具形状;faux provider e2e 里模型调用 `source_read` 或直接作答均可,断言只到「发出去了、轨迹形状正常」 |
| 4 | C1 移动 | `4f` 胶囊 → Sheet 关闭、输入框带文本并聚焦 |
| 5 | C2 卡 → 行 | 展开体链接 → 右栏该 `tool_call` 行展开、`getBoundingClientRect` 在视口内;新事件到达不再自动滚回底(贴底已解除) |
| 6 | C2 行 → 卡 | 详情卡链接 → 会话区折叠行打开、该卡展开、在视口内;进行中(未折叠)的一轮同样成立 |
| 7 | C2 对不上 | 无 `payload` 的旧会话、被裁掉的事件:两侧链接都不渲染 |
| 8 | C2 移动 | `4w`:Sheet 升到 large、面板切到 Timeline、该行展开 |
| 9 | C3 桌面 | 章节页入口 → `/` 输入框带模板文本、地址栏无 `?ask=`、刷新后输入框为空、未发送 |
| 10 | C3 隐藏 tab | `site_tab_set runtime false` 后章节页无入口;直接访问 `/?ask=x` 307 到第一个可见 tab |
| 11 | 预填边界 | `?ask=` 超 1000 字符整段丢弃;含控制字符被去掉;不写任何存储 |
| 12 | 画板逐项 | `2q` / `2r` / `4v` / `4w` / `4x` 逐项对照;`1b` / `4f` 之外的既有画板与页面零改动(`git diff --stat` 核) |
| 13 | 提示词 | `runtime.test.ts` 钉那句在;faux e2e 一轮追问不报错 |
| 14 | 文档同步 | `design/README.md` 增删记录;BACKLOG「卡片 ↔ Timeline」关闭;`docs/releases.md` 一行;MCP 51 不变 |

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
- findings 处理:<逐条>
- 结论:<PASS | 整改后 PASS>

## 失败处理

同一验收项针对性整改后连续 2 次验证仍不过 → 写 `rounds/round-crosslink/BLOCKED.md`,停下呼人。禁止放宽验收标准自我通过。

## 本轮实测

<!-- 完成后回填:与画板的偏离及原因、Ask why 文案在真实 provider 上的答复质量(留两三个例子)、踩的坑 -->
