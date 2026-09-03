# Round TOOLCARDS — 会话区工具调用卡:实时内联 + 一轮跑完后折叠 + 落库回放

<!-- 命名轮,不属于 R0–R11 线性序列(先例 rounds/round-title / round-tools / round-perf)。
     拆解段待写入 ROUNDS.md「R-TOOLCARDS」(草稿在本文末尾),届时以那里为准。 -->

> 状态:**未开始 —— 文档就绪,等三个前置**(2026-09-03)
>
> 1. 所有者对本文「方案」段的裁定(尤其「数据形态」与「折叠范围」两处)
> 2. ✅ 画板 `2l` / `2m` 已由所有者在 Claude Design 画好并于 2026-09-03 拉回 `design/`(提示词 [`design-prompt.md`](design-prompt.md);
>    新稿相对本地零删除行、只增 218 行,直接覆盖;`support.js` md5 一致;`design/README.md` / CLAUDE.md / ROUNDS.md 计数已改 18 → 20)。
>    **画板裁定里两条会直接影响实现**:折叠行的「读者手动展开的状态不会被下一轮收回去」;卡片展开体的 `…(已截断)` 由**服务端**在切断处接上,
>    前端只做 `max-height:106px` + `overflow:hidden`。
> 3. ✅ R-PERF 已于 2026-09-03 合并 `main`(`d58e141`),可直接从 `main` 开 `round-toolcards` 分支;R-SKILLS-2 也已合并(`532c007`),
>    `Workbench.tsx` 以 `main` 当前版本为基线
>
> 本轮**不动代码**之前,本文与提示词是仅有的两份产出。

## 目标

一句话:**访客在会话区看得到 agent 这一轮调了什么工具 —— 进行中按画板 `1a` 内联显示,跑完后按 `2l` 折叠成一行、
按 `2m` 可展开;刷新页面 / 切换会话 / 隔天回来,同一轮的卡片出现在与实时一模一样的位置。**

可证伪:开一轮会触发工具的对话(例如让它查 Notes),流式期间卡片夹在正文中间;`done` 之后收成折叠行 + 最终回答;
`F5` 之后会话区 DOM 与刷新前逐字节相同;没有工具调用的一轮,会话区 DOM 与本轮改动之前逐字节相同。

### 为什么做,为什么现在(核对结论,2026-09-03)

**这不是新功能,是丢了的功能。** 画板 `1a` / `1b` / `1c` / `1d` / `1f` / `1g` 的会话区都画着两张工具调用卡
(`design/Agent Runtime Workbench.dc.html:632–643`),可交互原型也有(静态 HTML)。实现史:

| 提交 | 发生了什么 |
|---|---|
| `bdc1ca4`(首版按画板实现) | `ChatPane` 有 `kind: "tool"` 分支,`ToolChip` 组件按画板画好,`demo-data.ts` 里就是那两条 `read_file` / `bash` |
| `88dc2ae`(R3,对话区切真实数据源) | 历史回放只做 `role → kind、content → text` 直映;流式只推助手文本。当时 `noTools:'all'`,任务卡明写「不声明任何 defineTool 工具」,没有工具可显示,没人注意到卡片不见了 |
| `e6b3e3d`(R4) | `demo-data.ts` 里那两条 tool 项被删 |
| R7 / R-WEBSEARCH / R-TITLE / R-IMAGEGEN | agent 陆续有了真实工具(`notes_*` / `web_search` / `session_rename` / `generate_image`),没有哪一轮回头补会话区 |

现状:`apps/web/components/workbench/Workbench.tsx:120` 的 `ToolChip` 与 `:181` 的渲染分支还在、样式与画板一致,
但全站没有任何地方生成 `kind: "tool"` 的项 —— **死代码**。`messages` 表从 001 迁移起就为此留了位:
`role` 允许 `'tool'`,`payload JSONB` 的列注释写的是「如 R6 工具消息的 `{name, preview, dur, error}`」
(与 `ToolChip` 的四个 props 一一对应),但没有任何代码往里写。ROUNDS.md / 各轮任务卡 / BACKLOG 全文没有一条
「去掉会话区工具卡」的裁定,属无意遗漏。

**所有者裁定(2026-09-03)**:按「第三层」做 —— 不只实时显示,重新打开会话时也要还原到与画板一致的精确位置。
这意味着**落库形态要改**(见「方案」),只对改动之后新写入的轮次生效;已有会话的合并正文拆不开,
按「没有 payload 就只显示正文」退化。访客会话按最后活跃满 3 天清理(007 迁移),所以「已有会话」是一个滚动的
3 天窗口,上线 3 天后线上不再有退化态的会话,**不做回填**。

**画板缺的两个态**(所以要先扩设计稿):`1a` 只画了「一轮进行中」;「跑完后折叠成一行」与「卡片箭头点开是什么」
没画过。参考实现是 pi-web:最终回答出来后,处理过程收成「处理详情 · N 条消息 · M 次工具调用」一行,点开原位展开。
这两个态是画板上没有的新视觉,按 R-TOOLS / R-PERF 的同一顺序 —— **先画 `2l` / `2m`,再进轮次**,不是规则 8 的例外;
恢复卡片本身则是画板早就画着的,与规则 8 无关。

## 前置

- R3(`/agent/ask` SSE)· R4(轨迹流)· R7(真实工具)· R-VISITOR(会话归属与 3 天保留)均已在生产 ✅
- 画板 `2l` / `2m` 已并入 `design/`,`design/README.md` 增删记录、CLAUDE.md 规则 8 与 ROUNDS.md 的画板计数已改 18 → 20 ⏳
- R-PERF 已合并 `main` ⏳
- `docs/security.md` §2 的 R-TOOLCARDS 补记**先于代码**落盘(规则 9;内容见交付物)
- 本机 Docker Desktop 已启动(`dev.ps1 test` 要本地 Postgres);本机 `llm_config` 配好一个能跑的 provider(验收 #2 要真实对话)
- **无迁移、无新表、无新角色、无新凭据、无新端点**

## 方案

### 数据形态:一行助手消息 + `payload.toolCalls` 偏移表(推荐;等所有者裁定)

保持今天的写法:一轮一条助手消息,`seq = userSeq + 1`,`content` = 这一轮全部助手正文按顺序拼接(语义不变,
`persistAssistant` 的幂等 upsert 不动)。**新增的只有 `payload`**:

```jsonc
{
  "v": 1,
  "modelRoundTrips": 2,        // 本轮助手 message_end 计数(= Timeline 的 Turn 数)
  "turnMs": 412,               // 访客消息落库 → done 的总耗时
  "toolCalls": [
    {
      "toolCallId": "call_…",  // 与轨迹流同一 id,将来可互相定位(本轮不做)
      "name": "notes_search",
      "at": 23,                // 工具开始执行时 content 已累积的 JS 字符串长度 —— 卡片插在这个偏移处
      "inputPreview": "…",     // previewText(args):单行、截断、凭据脱敏,与轨迹流同一函数
      "resultPreview": "…",    // previewText(result)
      "isError": false,
      "durationMs": 310
    }
  ]
}
```

为什么是偏移表而不是「消息按段拆成多行」或「写 `role='tool'` 行」:

- **`content` 语义不变、`seq` 方案不变**:今天 `seq` 在用户消息落库时就定死为 `userSeq + 1`,重试写同一 `seq` 只更新不追加
  (R3 的「turn 级去重键」)。按段拆多行或插 tool 行都要给一轮分配不定数量的 `seq`,幂等键随之失效,
  那是机制改动;偏移表把结构塞进本来就存在、本来就为此而留的 `payload` 列,`upsertMessage` 已经收 `payload` 参数。
- **新旧行一个判据**:`payload IS NULL` → 只有正文(旧行、以及没有工具调用的新行);有 `toolCalls` → 按偏移切段。
  没有工具调用的一轮**不写 payload**,与今天的行完全一样。
- **实时与回放同源**:前端只有一条渲染路径 `(content, toolCalls) → 段列表`,实时时由 SSE 帧逐步填出同一份结构,
  回放时从 `payload` 直接拿。验收 #3 的「DOM 逐字节相同」靠的就是这个。
- 偏移是 **JS 字符串长度**(UTF-16 code unit):写入方与切分方都是 JS,同一字符串往返 Postgres `TEXT` 不变,不会错位。

候选 B(段数组 `segments: [{kind:"text",text}|{kind:"tool",…}]`)也成立,代价是正文在 `content` 与 `payload` 里存两份。
不推荐,但如果所有者更看重「payload 自洽、不依赖 content」就选它,前端渲染路径一样。

### 服务端:`ask.ts` 的订阅回调多记两种事件

`rec.session.subscribe` 今天只消费 `message_update.text_delta`(推 `delta`)与 `message_end`(判错 / 计费)。加两种:

- `tool_execution_start`(pi 事件 `{toolCallId, toolName, args}`):记 `at = assistantText.length`、`startedAt = Date.now()`,
  推 SSE 帧 `tool_start { toolCallId, name, at, inputPreview }`
- `tool_execution_end`(`{toolCallId, toolName, result, isError}`):补 `resultPreview` / `isError` / `durationMs`,
  推 SSE 帧 `tool_end { toolCallId, resultPreview, isError, durationMs }`
- `message_end`(助手)计 `modelRoundTrips++`(判错 / 计费的现有逻辑不动)
- `done` 帧**追加**字段 `{ modelRoundTrips, turnMs }`(加法改动,旧客户端忽略即可)
- `persistAssistant(id, userSeq + 1, assistantText, payload)`:有工具调用才传 payload

**把这段累积逻辑抽成一个纯函数模块**(例如 `agent/turn-recorder.ts`:喂 pi 事件、吐 `{text, toolCalls, modelRoundTrips}`),
`ask.ts` 只负责把它的输出发 SSE 与落库 —— 这样它能被 `encore test` 直接测(验收 #6 / #7),不必起真实 provider。

脱敏口径**不新造**:`inputPreview` / `resultPreview` 一律经 `shared/redact.ts` 的 `previewText`,与轨迹流的
`argsPreview` / `resultPreview` 是同一个函数、同一个截断上限、同一套凭据键 / 值清洗(`docs/security.md` §2)。
对话流的帧里**只有摘要字符串,永不带 `args` / `result` 的原始结构**。

**不用轨迹流派生会话区的理由**:`/agent/ask` 与 `/trace/stream` 是两条独立的 SSE 连接,文本 delta 与工具事件跨连接
没有顺序保证;而回放路径反正要 `payload`。一份数据、一个来源、两个消费者(实时帧 / 落库)最省。

### 前端:一条渲染路径

- `apps/web/lib/types.ts`:`ChatItem` 改为 turn 级 ——
  `{ kind: "user", text }` | `{ kind: "assistant", text, toolCalls: ToolCallView[], summary?: { modelRoundTrips, turnMs }, done: boolean }`;
  删掉从未被生产过的 `kind: "tool"`
- `apps/web/lib/agent-api.ts`:`AskHandlers` 加 `onToolStart` / `onToolEnd`;`done` 帧解析出 `summary`;
  `getSession` 的消息类型带 `toolCalls`(经 `dev.ps1 gen` 从后端 `ChatMessage` 类型生成,`api-client.ts` 不手改)
- `Workbench.tsx`:
  - `openSession`:`messages.map(m => ({ kind: m.role, text: m.content, toolCalls: m.toolCalls ?? [], done: true }))`
  - `send`:助手项在**首个 `delta` 或首个 `tool_start`** 到达时建(模型可能一句话没说先调工具);rAF 合帧逻辑不变,
    工具帧走同一个 `commit`
  - `ChatPane` 助手项的三态:`toolCalls.length === 0` → 今天的 `<AssistantMessage>` 原样;
    `!done` → 按 `at` 切段内联渲染(画板 `1a`);`done` → 折叠行 + 最终段(`2l`),点开为 `2m`
  - `ToolChip` 加展开体(`2m` 卡片展开态:`INPUT` / `RESULT` 两段,行数上限 + `…(已截断)`),箭头方向随状态
  - 切段规则:按 `at` 升序切 `text`,空段跳过;最后一个工具之后的文本 = 最终回答,为空时不渲染空 markdown
  - 每个文本段各自过 `<Markdown>` 且各自 `memo`(保住 R9 那条「只有正在流的那段重新解析」的 O(n) 性质)
- **样式**:卡片零改动(`ToolChip` 已与 `1a` 一致);折叠行与展开体的每一个像素取自 `2l` / `2m`,不自造

### 折叠范围(等所有者确认)

默认照 pi-web:**最终回答之前的一切**(中间的话 + 全部卡片)进折叠行,只有最终回答留在外面。
备选是「只折叠卡片、中间的话留在外面」,那样会话区读起来更连续但折叠行的意义变弱。提示词按默认写的,
画板画成什么样就实现成什么样。

### 边界与已知取舍

- `session_rename` 也是一次工具调用,会以一张卡出现在首轮里(与 Timeline 里的 `tool_call · session_rename` 对得上)。
  **默认不做特殊隐藏** —— 透明是本站的卖点;所有者若裁定隐藏,记在这里再改。
- `generate_image` 的卡片与最终回答里的 markdown 图片并存,是两件事(过程 / 结果),不合并。
- `tool_execution_update`(流式部分结果)不消费:卡片不做内部流式。
- 工具开始了但没有 `tool_execution_end`(provider 中途 abort):卡片按 `isError: true`、`resultPreview: ""`、
  `durationMs` 为 `null` 落库;前端显示为错误态、耗时留空。
- 旧行(payload NULL)只显示正文,**不回填**(3 天窗口自然消失)。
- 轨迹回放上限 5000 条与本轮无关:会话区不再依赖轨迹流。

## 交付物

| 路径 | 内容 |
|---|---|
| `docs/security.md` | §2 事件流脱敏补一段 R-TOOLCARDS:对话流新增 `tool_start` / `tool_end` 帧,入参 / 出参只以 `previewText` 摘要出现(与轨迹流同一函数);`messages.payload` 存的也是同一份摘要,不存原始结构(**先于代码**) |
| `apps/api/agent/turn-recorder.ts`(新) | 纯函数:喂 pi 事件 → `{ text, toolCalls[], modelRoundTrips }`;偏移、耗时、脱敏摘要都在这里算 |
| `apps/api/agent/turn-recorder.test.ts`(新) | 验收 #6 / #7 / #8 的用例本体 |
| `apps/api/agent/ask.ts` | 订阅回调接 recorder;发 `tool_start` / `tool_end` 帧;`done` 帧加 `summary`;`persistAssistant` 传 payload |
| `apps/api/agent/store.ts` | `MessageRow` 加 `payload`;`listMessages` SELECT `payload`;`upsertMessage` 已收 payload,不改 |
| `apps/api/agent/sessions.ts` | `ChatMessage` 加 `toolCalls?: ToolCallRecord[]`(从 payload 派生,字段白名单序列化,不透传整个 payload) |
| `apps/api/agent/README.md` | `/agent/ask` 帧清单更新(session / delta / **tool_start / tool_end** / error / done) |
| `apps/web/lib/api-client.ts` | `dev.ps1 gen` 重新生成(生成物;按 BACKLOG R3 先例还原 app slug 噪音行) |
| `apps/web/lib/types.ts` · `apps/web/lib/agent-api.ts` | 见「前端」 |
| `apps/web/components/workbench/Workbench.tsx` | `ChatPane` 三态 · `ToolChip` 展开体 · 折叠行组件(逐像素对照 `2l` / `2m`)· `openSession` / `send` 接线 |
| `design/README.md` · `CLAUDE.md` · `ROUNDS.md` | 画板增删记录 `2l–2m` · 规则 8 计数 18 → 20 · 第十次修订段 + 进度表行 + 拆解段(草稿在本文末尾) |

**不交付**:迁移(`payload` 列早已存在)· 新端点 · 新 MCP 工具 · 轨迹流 / 三视图的任何改动 · Timeline 与卡片的互相定位(记 BACKLOG)。

## 验收

| # | 检查 | 命令 / 期望 | 结果 |
|---|---|---|---|
| 1 | 无回归 | `dev.ps1 check` + `dev.ps1 test` 全绿;`dev.ps1 gen` 后 `api-client.ts` 的 diff 只有 `ChatMessage.toolCalls` 一处 | |
| 2 | 实时三态 | 本机起 `dev.ps1` + `next dev`,新会话问一句会触发 `notes_search` 的话:流式期间卡片夹在正文中间(对照 `1a`);`done` 后收成折叠行 + 最终回答(对照 `2l`);点折叠行展开、点卡片箭头展开(对照 `2m`)。截图三张进任务卡 | |
| 3 | 回放与实时同源 | #2 结束后记录会话区 `innerHTML`;`F5` 重进同一会话再记一次;**逐字节相同**(折叠状态以初始态比) | |
| 4 | 无工具的一轮零变化 | 问一句不触发工具的话(例如「你好」),会话区 `innerHTML` 与本轮改动前的构建**逐字节相同**;库里该助手行 `payload IS NULL` | |
| 5 | 旧行退化正确 | 手工把一条助手行的 `payload` 置 NULL(或用本轮之前的库),打开会话:只有正文、无卡片、无折叠行、无报错 | |
| 6 | 脱敏与体积 | `turn-recorder.test.ts`:入参 / 结果里塞 `apiKey` / `Authorization: Bearer …` → 摘要里是 `[redacted]`;超长入参 / 结果被截到 `previewText` 的上限;SSE 帧与 payload 里**没有** `args` / `result` 原始键 | |
| 7 | 偏移正确 | 用例:文本 → 工具 → 文本 → 工具 → 工具 → 文本 / 一句话没说先调工具 / 以工具收尾 / 工具无 end 事件,断言 `at`、段切分、`isError`、`durationMs`、`modelRoundTrips` | |
| 8 | 帧里没有配置面 | 抓一轮完整 SSE:`tool_start` / `tool_end` / `done` 帧里不含 model / provider / baseUrl / token 数 / 费用 | |
| 9 | 幂等不破 | 同一 `seq` 重复 upsert(模拟重试)后 `payload` 与 `content` 都是最后一次的值,`jsonb_typeof(payload) = 'object'`(规则 4) | |
| 10 | 样式零改动 | `git diff` 里既有元素没有样式属性改动;新增的折叠行 / 展开体的每个值都能在 `2l` / `2m` 上找到出处;`1a` 态的卡片 DOM 与改动前一致 | |
| 11 | 发版后复核 | 生产上重跑 #2 / #3 / #4 各一次,`docs/releases.md` 记一行 | |

## 禁止

- 不改前端页面样式(规则 7):卡片一个像素不动;折叠行与展开体只按 `2l` / `2m` 画的来
- 不加设计稿没有的功能(规则 8):**不画「思考」块、不显示每段 token / 费用 / 模型名 / provider 名**(R-TOOLS 的「不公开配置面」同一口径);不做卡片内部流式;不做卡片 ↔ Timeline 互相定位(记 BACKLOG)
- 不新增迁移、新表、新角色、新端点、新 MCP 工具
- 不动轨迹流、三视图、`events.ts` 的白名单
- 不改 `content` 的语义与 `seq` 方案;不回填旧行
- 对话流帧里不带 `args` / `result` 原始结构 —— 只有 `previewText` 摘要(规则 9)
- 未经所有者裁定不隐藏任何一种工具的卡片(含 `session_rename`)

## 代码审查

<!-- 完成后回填。审查路由见 CLAUDE.md「开发模式」:codex 独立审查,硬失败才降级 /code-review。 -->

- 审查方式:codex `/codex:review --background`(改动超过 1–2 个文件)
- 轮次范围:第 1、2 轮全量;第 3 轮起 `--base <上一轮已审提交>`
- 带给审查者的要求:只判定缺陷与严重级别,不展开设计;偏移表 vs 段数组是所有者裁定,不在审查范围
- findings 处理:<逐条回填>
- 结论:<PASS | 整改后 PASS>

## 失败处理

同一验收项针对性整改后连续 2 次验证仍不过 → 写 `rounds/round-toolcards/BLOCKED.md`,停下呼人。禁止放宽验收标准自我通过。

**止损很便宜**:无迁移,回退 = revert 提交。回退后已写入的 `payload` 只是被忽略的 JSONB,不影响任何读路径
(`listMessages` 回退后不再 SELECT 它)。

## 本轮实测

<!-- 完成后回填:实际数字、踩的坑、与设计/计划的偏离及原因 -->

---

## 待写入 ROUNDS.md 的三段(开工时搬过去,以 ROUNDS.md 为准)

### 头部「功能边界」第十次修订(草稿)

> **2026-09-03 第十次修订(R-TOOLCARDS)**:所有者发现会话区里**没有工具调用卡**,而画板 `1a–1d` / `1f–1g` 的会话区
> 一直画着两张(`read_file` / `bash`)。核对结论:首版 `bdc1ca4` 实现过,R3 `88dc2ae` 把对话区切到真实数据源时
> 只映射了 `role` / `content`,卡片断了来源;当时 `noTools:'all'` 没有工具可显示,没人发现;R4 `e6b3e3d` 删掉 demo
> 数据后 `ToolChip` 留成死代码。**恢复卡片本身不是新功能**,与规则 8 无关。**新增的是两个态**:一轮跑完后把处理过程
> 折叠成一行(参考 pi-web 的「处理详情 · N 次工具调用」),以及卡片箭头点开的入参 / 结果摘要 —— 画板没画过,
> 按 R-TOOLS / R-PERF 的同一顺序**先画 `2l` / `2m` 再进轮次**,不是规则 8 的例外。所有者裁定做到「重新打开会话
> 也要在同一位置」,所以落库形态要改:一轮仍是一条助手消息,`payload` 里加工具调用的**偏移表**(`messages.payload`
> 从 001 迁移起就为此留着),**无迁移**;旧行不回填,3 天保留期自然清空。提示词见
> [`rounds/round-toolcards/design-prompt.md`](rounds/round-toolcards/design-prompt.md)。

### 进度表新行(草稿)

| **R-TOOLCARDS** | 会话区工具调用卡:实时内联(`1a`)+ 跑完后折叠(`2l`)/ 展开(`2m`)+ `payload` 偏移表落库回放;无迁移、前端一条渲染路径 | ⏳ 文档就绪,待画板与所有者裁定([任务卡](rounds/round-toolcards/round-toolcards.md)) | — |

### 「R-TOOLCARDS」拆解段(草稿)

要点同本文「方案」与「验收」,搬过去时压成 ROUNDS.md 的篇幅:问题(丢了的功能 + 缺的两个态)· 形态裁定(偏移表、不用轨迹流派生、
折叠范围照 pi-web)· 五条交付(recorder 纯函数 / ask.ts 两种帧 / store & sessions 带 payload / 前端三态 / security §2 补记)·
验收五条(实时三态 · 回放同源 · 无工具零变化 · 脱敏 · 无配置面)· 前置(画板 `2l`/`2m`、R-PERF 合并)。

## BACKLOG 候选(本轮不做,开工时抄进 `rounds/BACKLOG.md`)

- [ ] R-TOOLCARDS 卡片 ↔ Timeline 互相定位:两边都有 `toolCallId`,点卡片高亮右栏对应行(画板没画,等裁定)
- [ ] R-TOOLCARDS `session_rename` 的卡片是否隐藏(默认显示;裁定隐藏再改)
- [ ] R-TOOLCARDS 会话区是否显示「思考」块(pi-web 有;本站内核透明度靠右栏,默认不做)
- [ ] R-TOOLCARDS 本轮之前的助手行没有 `payload`,重新打开只显示正文;3 天窗口后自然消失,不回填(记一笔备查)
- 既有相关条目:R8「顶栏统计条的 tokens / cost / ctx 仍是 demo 值」(`rounds/BACKLOG.md:86`)—— 本轮的 `done` 帧带 `turnMs` / `modelRoundTrips`,不带 token,不解决它
