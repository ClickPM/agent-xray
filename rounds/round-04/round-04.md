# Round 04 — 轨迹流与三视图真实化

> 状态:进行中(初审 + 复审 1/2/3 轮 findings 已全部处理,待复审第 4 轮)

## 目标

`GET /trace/stream?sessionId=…` 正式落地(trace 服务 · `api.raw` SSE · 库内回放 + 内存队列 live tail · `afterSeq` 断线续读),前端右栏 Timeline / Chain View / Lifecycle Map 三视图从 `demo-data.ts` 切到真实事件流,且样式零改动:对话进行中右栏实时出事件,历史会话点开即从库回放整条轨迹。

## 前置

- R1(34 事件采集 + SSE 原型)、R2(`trace_events` 表与回放索引)、R3(正式采集点 `agent/runtime.ts` + 脱敏落库)已完成。
- Docker Desktop 已启动;本机 encore local secret `DeepSeekApiKey` 已设置。
- 分支:本轮在 worktree 分支 `claude/r4-development-startup-d6dbec` 上开发(等价于约定的 `round-NN` 分支),审查通过后合并 `main`。

## 前置实测(开工第一件事,决定生命周期设计)

**Encore 网关对 GET 长连接同样不传导客户端断开**——R3 已对 POST 实测过(`rounds/BACKLOG.md`),
本轮先用临时探针 `/spike/close-probe`(GET,每秒一帧,20s)复测 GET:

| 观测点 | 结果(客户端 t=4s 被 `kill -9`) |
|---|---|
| `req` close / error | **从未触发** |
| `resp` close | 只在本端 `resp.end()` 之后触发(t=+20025ms,`writableFinished=true`) |
| `req.socket` / `resp.socket` close | **从未触发** |
| `resp.write()` 返回值 | 断开后仍恒为 `true`(拿不到背压信号) |
| `resp.destroyed` / `req.destroyed` | 全程 `false` |

**结论**:`/trace/stream` **无法在访客离开时自行结束**,连"写失败探测"这条退路也没有。
因此流的生命周期必须由**服务端强制上界**兜底,否则被遗弃的连接会无限累积
(`docs/security.md` §0 威胁 3「资源滥用」)。本轮据此定下三条硬约束(见下「设计决策」D4)。
探针文件用后即删,记录留在本节。

## 设计决策(开工前定,不留给审查环节)

**D1 · 端点落在新建的 `trace` 服务**(`docs/architecture.md` 总览图既定;`dev.ps1` 与 `apps/api/trace/README.md` 都已为其预留)。
Encore.ts 的服务由「含端点的顶层目录」推导(实测 `get_services`:当前 agent/spike/system 三个;
只有 README 的 trace/notes/admin/metrics 不算服务),故新增 `trace/stream.ts` 即自动成为 `trace` 服务。
**代价必须说清**:trace 与 agent 有两处真实耦合——共享 `agent` 库、共享进程内事件队列。
处理方式见 D2/D3,两者都不走「服务 A import 服务 B 内部实现」。

**D2 · 进程内事件总线放中立共享模块** `apps/api/shared/trace-bus.ts`:
agent 服务(生产者,`runtime.ts` 的 `capture()`)与 trace 服务(消费者)都 import 它,
互不依赖对方目录。总线不含任何 Encore 基础设施声明,因此不会被推导成服务。
`agent/sse.ts` 同理移到 `shared/sse.ts`(两个服务都要写 SSE 帧)。

**D3 · trace 服务读库走 `SQLDatabase.named("agent")`**(Encore 官方的跨服务库引用 API,
`encore.dev/storage/sqldb` 已有该静态方法)。trace 只读、不拥有 schema、不加迁移;
`trace_events` 的建表与迁移仍归 agent。为此 trace 自带一个只读查询模块 `trace/store.ts`,
不 import `agent/store`。

**D4 · 流的生命周期(由前置实测倒逼;实现中又被自测证伪一次,已改设计)**:

断开探测不到 ⇒ 服务端只有两种**确定**信息可用来结束一条流:

- `MAX_STREAM_MS = 5min` 单连接硬上界 → 发 `event: bye {lastSeq, reason:"max-duration"}` 后 `end()`,客户端凭 `lastSeq` 立刻续上;
- **同 `clientId` 再次连上** → 一个标签页不会同时读两条流,它此前那条必然已死,精确让位(`reason:"superseded"`)。
  `clientId` 由前端生成并存 `sessionStorage`(粒度正好是「一个标签页」:刷新后还在、标签页关掉即消失)。

外加两条容量闸:`MAX_STREAMS_PER_SESSION = 8`(单会话公平上限)、`MAX_TOTAL_STREAMS = 64`(全站),超出 429。

> **本条最初写的是「同会话超额时逐出最旧的一条」,实现后被自己的实测证伪,已废弃。**
> 现象:浏览器面板聊到第四轮就不再更新。日志显示它被 `superseded` 掉了。原因是这个启发式
> 在本场景里**方向是反的**——真正在看的那条连接恰恰是**最旧**的(访客一进来就连上了),
> 而 React 重挂载、调试探针、curl 这些短命连接都比它新;"越老越可能被遗弃"于是每次都
> 精准掐死唯一活着的观众,真正死掉的连接反而留到超时。教训:分不清死活时不要用时间序
> 猜,要让客户端给出**确定**信息(clientId)。回归用例见 `trace/stream.test.ts`。

**D5 · 脱敏点仍然只有一个:采集时**(`agent/runtime.ts` → `sanitizeEvent`)。
库里存的就是脱敏后的数据,SSE 是纯读取通道,不做二次处理。
`docs/security.md` §2 要求"SSE 推送前 sanitize",本设计以"**入口即脱敏,库与 SSE 都不可能拿到原文**"满足它——
比在出口再洗一遍更强(否则库里会留着原文)。验收项 7 用 SQL + SSE 原始流双向抽查。

**D6 · 回放与 live tail 的接缝**:DB 只在水位 500 或每轮收尾时 flush,单靠库回放会漏掉"当前这一轮"。
故总线为每个会话保留 ring buffer(上限 1000 条,典型事件几百字节;硬上限 8KB/条见 `events.ts`)。
连接建立顺序固定为:**先订阅(live 帧暂存本地)→ 读库回放 → 读 buffer 补齐 → 按 seq 去重合并发出 → 再放行暂存的 live 帧**。
`disposeSession` 里 buffer 的丢弃必须排在**最终 flush 之后**,否则会出现"库里还没有、buffer 已经没了"的空窗。

**D7 · 三视图 = 同一事件流的三种投影**(`docs/architecture.md` 原话),投影逻辑集中在
`apps/web/lib/trace-view.ts` 纯函数里,组件只负责渲染。真实数据与演示数据的差异按下表处理
(**都不改样式,只改喂进去的数据**):

| 视图 | 演示数据 | 真实投影 |
|---|---|---|
| Timeline | 手写两个 turn | 按 `turn_start` 出现次数切组(标签仍是 `Turn N`);首个 `turn_start` 之前的事件并入 Turn 1;**连续同类型事件折叠成一行**(`message_update ×183`),否则一轮 180+ 个 delta 事件会把瀑布冲垮;`ms` = 到下一个事件的时间差,最后一行流式中显示 `…` + 脉动 |
| Timeline 详情卡(画板 1b) | 写死的 context-injector 演示 | INPUT = 该事件脱敏后 data 的单行预览;EXTENSION RETURNED = `xray-observer`;DIFF = `(未改写)`——本站唯一的扩展就是只观测不改写的观测者,如实呈现即可,不编造链式修改 |
| Chain View | 写死 truncator/annotator 两级 | 取会话内**最近一个 chain 模式事件**,RAW OUTPUT = 其 data 预览,链上一级 `xray-observer` 徽标"未修改";尚无 chain 事件时显示等待态 |
| Lifecycle Map | 写死 12 节点状态 | 节点骨架不变(设计稿终稿),`fired`/`active`/`pending` 与 `×N` 全部由事件计数推导;`tool_call`/`tool_execution`/`tool_result` 在 `noTools:'all'` 下恒为 pending——这是实情,不造假 |

**D8 · 顶栏 `47 events` 改真实**。它与三视图同源(轨迹流),留着假数字与旁边的真实面板并列更糟。
`tokens` / `cost` / `ctx` **保持演示数据**(计量与限额是 R7/R8 的事,本轮不碰)。

**D9 · `apps/api/spike/` 整体删除**(`rounds/BACKLOG.md` 既定:R4 落地 trace 服务时移除)。
R1 的能力已全部转正:34 事件与脱敏在 `agent/events.ts`、SSE 工具在 `shared/sse.ts`、
两条流在 `agent/ask.ts` 与 `trace/stream.ts`。内存基线端点 `spike/mem.ts` 一并移除,
后续测量改用容器 stats(R9)。

## 交付物

| 路径 | 内容 |
|---|---|
| `apps/api/shared/trace-bus.ts` | 进程内事件总线:`publish` / `subscribe` / `recent(afterSeq)` / `dropSession`;每会话 ring buffer(上限 1000),无 Encore 声明 |
| `apps/api/shared/sse.ts` | 由 `agent/sse.ts` **原样迁入**(两个服务共用) |
| `apps/api/shared/redact.ts` | 由 `agent/events.ts` 下沉的凭据脱敏原语(`DROP_KEY`/`sanitizeValue`/`previewText`/`safeErrorText`)。trace 也要按同一口径写日志,不能为一个工具函数去 import agent 的内部模块;`agent/events.ts` 保留 re-export,R3 调用点不改 |
| `apps/api/shared/trace-bus.test.ts` | 总线纯逻辑测试:环形缓冲上限、`afterSeq` 切片、订阅/退订、`dropSession` |
| `apps/api/trace/stream.ts` | `GET /trace/stream`(`api.raw` SSE):参数校验 → 会话存在性(404)→ 同 `clientId` 让位 + 名额(429)→ 订阅 → 库回放 → buffer 补齐 → 去重合并 → live tail;15s 心跳;`MAX_STREAM_MS` 到点 `bye` |
| `apps/api/trace/store.ts` | 只读查询(`SQLDatabase.named("agent")`):`sessionExists()` / `listTraceEvents(sessionId, afterSeq, limit)`(取最新 N 条,`limit` 兜住超长会话) |
| `apps/api/trace/stream.test.ts` | 纯逻辑测试:查询参数解析(含 `clientId` 形态)、回放/live 去重合并、让位判定(含「别再按最旧逐出」的回归用例) |
| `apps/api/trace/README.md`(改) | 「待实现」→ 实际契约与安全口径 |
| `apps/api/agent/runtime.ts`(改) | `capture()` 里事件入队后 publish 到总线;`disposeSession` 最终 flush **之后**再 `dropSession` |
| `apps/api/agent/ask.ts`(改) | `sse` 导入路径改指 `shared/sse` |
| `apps/api/agent/sse.ts` | 删除(迁入 shared) |
| `apps/api/spike/**` | **整体删除**(D9) |
| `dev.ps1`(改) | `$hostedServices` 补 `trace`(漏补的表现是端点静默 404) |
| `apps/web/lib/sse-parse.ts` | 由 `agent-api.ts` 抽出的 SSE 分帧器(两个流共用) |
| `apps/web/lib/trace-api.ts` | 轨迹流客户端:`openTraceStream()`,fetch + ReadableStream,`afterSeq` 续读 + 退避重连,404 停止 |
| `apps/web/lib/trace-view.ts` | 三视图投影纯函数:`toTimelineTurns()` / `toChainView()` / `toLifecycleNodes()` + 时长格式化 |
| `apps/web/lib/types.ts`(改) | 新增 `TraceEvent` / `ChainView` 数据类型;`TraceRow` 增加详情所需字段 |
| `apps/web/components/workbench/{TimelineView,ChainView,LifecycleMap}.tsx`(改) | 由 props 接收真实投影;**样式、布局、className、token、动画参数零改动** |
| `apps/web/components/workbench/Workbench.tsx`(改) | 删除 `usePlayback` 演示回放,改为订阅轨迹流;事件计数接真实值 |
| `apps/web/lib/demo-data.ts`(改) | 移除已被真实数据取代且不再被引用的导出 |
| `docs/architecture.md`(改) | 事件清单指针 `spike/events.ts` → `agent/events.ts`;补记 trace 服务已落地与断连不可探测的约束 |
| `.gitignore`(改) | 忽略 `bun.lock`:bun 只是运行时不负责依赖解析(规则 11),它执行脚本时顺手生成的 lockfile 提交进去会造成「两份 lockfile」的错觉,还会让工作区每次 `dev.ps1 test` 后变脏、卡住 `dev.ps1 build` 的洁净检查 |
| `rounds/BACKLOG.md`(改) | 勾销 spike 移除条与两条 R-BUN 顺延条;补记本轮 3 条新发现 |
| `ROUNDS.md`(改) | 进度表 R4 收口 |

## 验收

| # | 检查 | 命令 / 期望 |
|---|---|---|
| 1 | 编译 | `dev.ps1 check` 通过;`apps/web` `npx tsc --noEmit` 无错 |
| 2 | 测试 | `dev.ps1 test` 全绿(R2/R3 既有用例 + 本轮总线/合并/名额/投影用例) |
| 3 | 实时出事件 | 浏览器提问过程中右栏 Timeline **边聊边长**;`curl -N /trace/stream` 与 `/agent/ask` 并行时观察到 `event: trace` 持续到达 |
| 4 | 历史回放 | 刷新页面 → 点开历史会话 → 三视图从库回放出该会话完整轨迹(seq 连续、turn 分组正确);encore 重启后仍可回放 |
| 5 | 断线续读 | 掐断 SSE 后带 `afterSeq=<lastSeq>` 重连 → 只补发之后的事件,无重复、无缺口;前端自动重连后 Timeline 不重影 |
| 6 | 跨回收边界 | 会话被空闲回收后再提问 → 轨迹 seq 跨边界连续,回放与 live 无缝(D6 的 buffer/flush 顺序生效) |
| 7 | SSE 脱敏 | 抓 `/trace/stream` 原始流全文,对 `authorization\|api[-_]?key\|sk-[A-Za-z0-9]{10}\|bearer ` 命中数 **0**;同一会话 SQL 侧 `data::text` 命中数同样为 0 |
| 8 | 名额与上界 | 同 `clientId` 重连 → 旧连接收到 `bye{reason:"superseded"}` 并结束,**不同观众之间互不影响**;同会话第 9 个观众 → 429;`MAX_STREAM_MS` 到点收到 `bye{reason:"max-duration"}`(实测时临时调小,测后改回并复跑 check+test) |
| 9 | 三视图投影正确 | Chain View 显示最近 chain 事件;Lifecycle 的 `×N` 与 SQL `GROUP BY event_type` 计数一致;Timeline 折叠行的 `×N` 与实际事件数一致 |
| 10 | 样式零改动 | `git diff` 中 `apps/web` 的 style 对象、className、token、动画参数逐字节一致(仅数据源与 props 接线) |
| 11 | 服务白名单 | **静态核验**:`dev.ps1` 的 `$hostedServices` 含 `trace`,且 `encore` 认得的服务集合与白名单一致(`get_services`);`spike` 目录已删除故不可能再暴露。**镜像形态的实跑冒烟交 R9**(所有者裁定:镜像只在部署时打包) |
| 12 | gen client | `dev.ps1 gen` 重新生成后前端编译通过 |

## 禁止

- 不改前端页面样式(规则 7):不动 style 对象、布局、className、design token、动画参数;结构改动仅限接线必需且写明理由。
- 不加设计稿没有的功能(规则 8):不做 Ask why 真实实现、不做事件筛选/搜索/导出、不做 tokens/cost/ctx 真实统计(R7/R8)。
- 不声明任何 `defineTool` 工具、不动 `noTools:'all'`(规则 9,R6 的事)。
- 不建 notes/admin/metrics 表、不做限额计费。
- 不在 trace 服务加迁移、不写 `trace_events` 表(trace 只读,schema 归 agent)。
- JSONB 写入一律 `${JSON.stringify(x)}::text::jsonb`(规则 4);测试只走 `encore test`(规则 2)。

## 代码审查

- 审查方式:codex `/codex:review --background --base 276dbe7`(thread 01a05673-c6aa-72b1-81ec-5fd4491ed079)
- 初审 findings **3 条(2×P1 + 1×P2),全部采纳**:

  - **[P1] 消息预览绕过脱敏**(`agent/events.ts` 的 `summarizeMessage`)——正文是访客与模型的
    自由输入,里面可能出现凭据形态的串(有人把 `sk-…` 贴进对话框)。原实现直接 `slice(0,200)`,
    于是 `message_start` / `message_end` / `turn_end` 把它原样带进库、再经**公开的** `/trace/stream`
    发出去,绕过 `docs/security.md` §2。
    **整改**:预览改走 `previewText(preview, 200)`(凭据串清洗 + 截断)。
    **修的位置与审查者的建议不同**:审查者建议"发出前再洗一遍",但那会违背本轮 D5「脱敏点只有
    一个:采集时」,而且库里仍会留着原文——所以修在采集侧,库与 SSE 一起变干净。
    新增第 7 组脱敏 fixture 锁住它。
  - **[P1] 换会话时收不回自己那条流**(`trace/stream.ts` 的 `selectSuperseded`)——让位条件写成了
    「同 `sessionId` **且**同 `clientId`」。访客在左栏点着看历史会话时,旧会话那条流既收不到断开
    信号、又匹配不上让位条件,于是每换一个会话漏一个名额,直到 `MAX_STREAM_MS`(5min)才释放;
    翻几个会话就能把全站名额耗光并开始 429。
    **整改**:让位只看 `clientId`,不看 `sessionId`——一个标签页任何时刻只读一条轨迹流,
    同 `clientId` 的旧连接一定已经死了,**包括它上一个会话那条**。加了跨会话回收的回归用例。
  - **[P2] Timeline 的 turn 分组整体错位一格**(`web/lib/trace-view.ts`)——原实现"攒一批、遇到
    `turn_start` 一起开组",于是第二个 `turn_start` 把**第一个 turn 的正文**连同自己塞进 Turn 2,
    Turn 1 只剩开场事件。单 turn 的会话看不出来,所以我的浏览器实测漏掉了它。
    **整改(最小改动)**:`turn_start` 开新组,其后事件一律追加到**当前组**。
    残留偏差(下一轮提问的开场事件挂在上一个 Turn 末尾)按「非阻塞 findings 只做最小改动」
    记入 `rounds/BACKLOG.md`,不在本轮加额外的 run 边界判断。

- **自查追加 1 条**(不是 findings):`Workbench` 每次渲染都重算三个投影,输入框每敲一个字都会把
  最多 5000 条事件重投影三遍 → 三个 `useMemo`。
- 整改后回归:`dev.ps1 check` 通过;`dev.ps1 test` **67/67** 全绿;`apps/web` `tsc --noEmit` 通过。
  真机复测:
  - 脱敏:新会话发含 `sk-abcdefghij0123456789` 与 `Bearer abcdef1234567890` 的提问 → 库内 173 条事件
    对两个串命中 **0**,4 条事件里出现 `[redacted]`(`input` / `before_agent_start` / `message_start` /
    `message_end`);同会话 SSE 原始流命中同样为 **0**。
  - 跨会话回收:同 `clientId` 从会话 A 切到会话 B → A 那条收到 `bye{"reason":"superseded"}`;
    对照组 `tabY` 未被误收回(命中 0)。
  - turn 分组:用库里真实的 **912 条事件**跑 `toTimelineTurns` → 6 个 turn,每个都自带完整正文
    (`turn_start … message_update ×N … turn_end … agent_end`),不再错位。
- 初审结论:整改后待复审
- **复审第 1 轮** `/codex:review --background --base 4e7411a`(thread 见任务输出),
  3 条 findings(**全部 P2,全部指向上一轮整改本身**),处理如下:

  - **[P2] 复制标签页会共用 `clientId`,两个标签页互相顶掉**(`trace-api.ts`)——浏览器「复制标签页」
    会连 `sessionStorage` 一起复制。属实。
    **不做机制类整改,记 BACKLOG 并在代码里写明边界**:改成「每次页面加载换新 id」确实避开了
    复制标签页,但把代价换成**更常见**的动作——每刷新一次就漏一个名额到 5min 超时,连刷几次
    就把本会话名额吃光;两头都占住需要「连接代次」这类协议字段,属机制类改动,按 CLAUDE.md
    「非阻塞 findings 严禁新增机制类修复」不在整改范围。已与「断开探测不到」一并挂到 R9 重估
    ——届时若能拿到断开信号,整个让位机制都可以退役。
  - **[P2] 快速切会话时两个请求可能乱序进 `acquireSlot`,让位让错人**(`trace/stream.ts`)——属实:
    占名额原本排在 `await sessionExists` **之后**,于是"谁的库查询先返回谁先占槽",已经没人读的
    B 后到就会把用户正在看的 C 让位掉。
    **整改(纯语句移位,不加机制)**:把 `acquireSlot` 提到**第一个 await 之前**,占槽顺序 = 请求
    到达顺序,不再受库延迟摆布;`sessionExists` 挪进统一的 try/finally,404/400/500 路径由 finally
    立刻释放名额。残留(网络把请求到达顺序也调换)需要连接代次才能根治,记 BACKLOG。
  - **[P2] 上一轮的分组修正把下一轮开场事件归进了上一组**(`trace-view.ts`)——属实,这正是我
    上一轮自己记进 BACKLOG 的残留。既然只需多认一个边界,本轮**改成彻底修好**而不是继续挂着:
    遇到下一轮 agent run 的开场事件(`input`,会话重建时还有 `session_start`)就重新进入暂存,
    等它引出的 `turn_start` 一起开下一组;BACKLOG 里那条随之删除。

- **复审第 2 轮** `/codex:review --background --base 236c428`,1 条 finding(P2),**采纳整改**:

  - **[P2] 让位排在了会话校验之前**(`trace/stream.ts`)——上一轮把登记名额提到第一个 `await`
    之前,顺手也把**让位**一起提前了。于是一个 sessionId 已失效(或恰好赶上库查询失败)的请求,
    会先掐掉那条**健康的**流,自己又建不起来——让位是不可逆的(客户端收到 `superseded` 就不再
    重连),观众两头落空。
    **整改**:把「登记」与「让位」拆成两步——`acquireSlot` 只登记名额 + 判容量(仍在第一个
    `await` 之前,槽位号 = 请求到达顺序),`supersedeOlderStreams` 移到**会话校验成功之后**。
    为了不让这一挪把复审第 1 轮的竞态放回来,让位改成**只针对槽位号比自己小的连接**:
    "新请求赢"于是与各自的库查询谁先返回无关。校验失败的请求什么都不动,旧流照常活着。
    新增回归用例锁住让位方向。

- **复审第 3 轮** `/codex:review --background --base 3304195`,1 条 finding(P2),**采纳整改**:

  - **[P2] 名额打满时,同一客户端换不回自己那条**(`trace/stream.ts`)——上一轮把让位挪到会话
    校验之后,于是容量判定跑在了让位之前。那条"马上就要释放"的旧连接仍被算进名额,同一个
    标签页在名额打满时重挂载 / 切会话 / 到期续连一律 429,而没人读的旧连接还要占到
    `MAX_STREAM_MS`,面板就一直连不上。
    **整改(只改判断)**:新增 `countableSlots()`——判容量时把「本客户端稍后会让位的旧连接」
    从计数里排除(复用既有的 `selectSuperseded`,同一套"只算比自己早的"口径)。
    校验失败时本次登记由 finally 释放,旧连接原样还在,计数回到原状,不存在超发。

- 复审整改后回归:`dev.ps1 check` 通过;`dev.ps1 test` **69/69** 全绿;`apps/web` `tsc --noEmit` 通过。
  真机复测第 2 轮整改:健康流存在时,同 `clientId` 请求一个不存在的会话 → 该请求 404,
  **健康流未被误杀**(`superseded` 命中 0);随后同 `clientId` 换到真实会话 → 旧流正常收到
  `bye{"reason":"superseded"}`。
  真机复测第 3 轮整改:8 个不同 `clientId` 占满单会话名额后 → 第 9 个新观众 **429**(上限仍生效),
  而已有观众 `cap3` 重连 **200**(不再自己把自己 429 掉),其旧连接正常让位,对照观众 `cap5` 未被误伤。

- **关于连续三轮都落在同一处机制**:让位/名额这段共三轮 findings(P1 扩大让位范围 → P2 让位与
  校验的先后 → P2 容量计数口径),每一条都真实且都是上一次整改带出来的。判断**不属于**
  「以审查代替设计」:三次都是同一个小函数的收敛式细化,改完的形状比改之前更简单
  (登记按到达顺序 → 校验 → 只让位比自己早的同客户端连接 → 开流),三个判定都拆成了纯函数并有
  回归用例;根因(拿不到断开信号)是环境约束,已在 D4 与 BACKLOG 写明并挂到 R9 重估。
  **若下一轮仍在这段出新 finding,就停下回所有者层面重定方案,不再在循环里打补丁。**
  真机复测:404 / 400 路径正常返回且名额被 finally 释放;正常流仍能回放 + `ready`;
  跨会话让位仍生效(`bye{"reason":"superseded"}`)。
  分组用库里真实的 **912 条事件**复核 → 6 个 turn **每个都自成完整一轮**
  (开场 `input`/`before_agent_start`/`agent_start` → `turn_start` → 正文 → `turn_end`/`agent_end`/`agent_settled`),
  开场与正文都不再串组。

## 失败处理

同一验收项针对性整改后连续 2 次验证仍不过 → 写 `rounds/round-04/BLOCKED.md`,停下呼人。禁止放宽验收标准自我通过。

## 本轮实测

环境:本机 Windows,encore v1.57.13,bun 1.4.0,vitest 4.1.11,模型 deepseek/deepseek-v4-flash。
后端跑在 **:4001**(:4000 被另一个 checkout 的 `encore run` 占着,不去动别人的进程),
前端 Next dev :3000 期间把 `next.config.ts` 的 dev 代理临时指向 4001,**测完已改回 4000**。

验收逐项(2026-08-31):

1. **编译** PASS `dev.ps1 check` 通过;`apps/web` 本地 `tsc --noEmit` 无错。
2. **测试** PASS `dev.ps1 test` 6 文件 **66/66** 全绿(R2/R3 的 55 条 + 本轮 11 条:总线环形缓冲/订阅退订/`dropSession` 回收、回放去重合并、查询参数形态、让位判定与回归用例)。
3. **实时出事件** PASS 浏览器打开会话后由 curl 发起一轮对话,页面事件计数 **702 -> 715 -> 752 -> 819** 逐段增长,Timeline 同时长出 `Turn 5`。
4. **历史回放** PASS 整页 reload -> 点开历史会话 -> 三视图从库回放:200 事件、`Turn 1`/`Turn 2` 分组正确。encore 多次热重载(= 进程内会话丢失)后仍可回放。
5. **断线续读** PASS `curl` 带 `afterSeq=100` 重连 -> 只补发 seq 101-113 共 13 条(全量 114 条),无重复无缺口。前端自动重连:把 `MAX_STREAM_MS` 临时调到 20s,浏览器跨过**两次**到期重连后仍能收到新一轮事件(819 -> 912),库内 `count(DISTINCT seq)=count(*)`,Timeline 无重影。
6. **跨回收边界** PASS 该会话 `session_start` 出现 **4 次**(4 次运行时会话重建),而 `trace_events` 仍是 `seq 0-911` 连续、无重复——重建时 `maxTraceSeq+1` 续接与「最终 flush 之后才丢 buffer」的顺序都生效。
7. **SSE 脱敏** PASS `/trace/stream` 原始流全文对 `authorization|api[-_]?key|sk-[A-Za-z0-9]{10}|bearer ` 命中 **0**;同一会话 SQL 侧 `data::text` 命中同样为 **0**,且 `jsonb_typeof(data)='object'` 全真。
8. **名额与上界** PASS 同 `clientId` 重连 -> 旧连接收到 `bye{"lastSeq":818,"reason":"superseded"}` 并结束;8 个不同 `clientId` 占满后第 9 个 -> **429**,且前 8 条**一条都没被踢**;`MAX_STREAM_MS` 到点 -> `bye{"reason":"max-duration"}`。测完已把 20s 改回 5min 并复跑 check + test。
9. **三视图投影正确** PASS Lifecycle 的 `xN` 与 SQL `GROUP BY event_type` 逐项一致(`message_update x97`、`context x1`、`turn_end x1` …;`tool_*` 三个节点 0 次 -> pending);Timeline 折叠行 `message_update x97` 与库内计数一致;Chain View 取到最近的 chain 事件 `message_end`;详情卡展开 `turn_start` 显示 `{ timestamp: …, turnIndex: 0 }`。
10. **样式零改动** PASS `apps/web/components` 的 diff 里带样式的改动行只有 8 行,且每行的 style 对象**逐字节一致**,只换了取值表达式(`chainSteps.event` -> `chain.event`、`contextDetail.input` -> `detail.input` 等)。
11. **服务白名单** PASS(静态核验)`dev.ps1` 的 `$hostedServices = "agent,trace,system"`,与 `encore` 实际推导出的服务集合(`get_services`:agent / trace / system)完全一致,无遗漏、无多余;`apps/api/spike/` 整目录已删除,`/spike/*` 不可能再存在。
    **未跑 `dev.ps1 build`**——所有者裁定「镜像只在部署时打包」,不在开发轮里构建。镜像形态下「已声明服务全部可达」的实跑冒烟并入 R9 的部署冒烟(ROUNDS.md R9 本来就有这一条),`rounds/BACKLOG.md` 里那条白名单维护热点保持打开。
12. **gen client** PASS `dev.ps1 gen` 重新生成(spike 命名空间消失、新增 trace),前端 `tsc --noEmit` 通过。

实现要点与踩坑:

- **本轮最大的坑:我自己定的逐出启发式是反的。** 详见 D4 的引述块。价值在于它只有在真实浏览器里连续聊几轮才会暴露——单测和 curl 都测不出来,因为它们不产生「一条长期存活的观众连接 + 若干短命连接」这种形态。
- **GET 与 POST 一样探测不到断开**(前置实测)。这不只是「少一个优化」,它直接决定了本端点必须有硬上界与让位机制,否则就是一个可以被无限占用的资源。
- **`message_update` 一轮 97 条**,不折叠的话瀑布图会变成 97 行一模一样的东西。折叠只合并**相邻**同类型事件,不打乱时序,`xN` 写进行名(沿用设计稿 `tool_call · read_file` 把附加信息放行名的写法)。
- **回放与 live 的接缝顺序**(先订阅 -> 再读库 -> 再补 buffer -> 去重发出 -> 放行暂存)是本端点唯一容易出静默缺口的地方:任何一步换位置都会漏掉「两步之间产生的那几条」,而漏了不会报错,只是少几行。
- **`ready` 帧的 `lastSeq` 常常不是 -1**:连接建立(订阅)到库查询返回之间会有事件产生,它们经 buffer 进了回放段。这不是 bug,正是 D6 想要的行为。
- **Encore 服务是按「含端点的顶层目录」推导的**(实测 `get_services`),所以 `shared/` 这种只有库代码的目录不会变成服务,而新建 `trace/stream.ts` 会自动让 `trace` 成为服务——`dev.ps1 build --services` 必须同步补名字,否则镜像里该端点静默 404。
- **`afterSeq` 用字面量形态校验而不是 `Number()`**:`Number(" ")===0`、`Number("1e3")===1000`,这类「能转成数但不是十进制整数」的输入被静默接受会让游标语义变形。
- 环境坑:worktree 首次开发需要 `apps/web` 单独 `npm ci`、以及把主 checkout 的 `.secrets.local.cue`(gitignored)拷过来,否则 pi 报 `No API key found for deepseek` 而 `/agent/ask` 只回固定错误文案。
- 浏览器自动化对受控 input 的 `type`/`Enter` 不生效(R3 已记),本轮改为用 curl 驱动对话、只在浏览器里观察三视图,反而更接近「两个通道各自独立」的真实形态。

与计划的偏离:

- 交付物多了 `apps/api/shared/redact.ts`(计划里没有):trace 服务要按同一口径脱敏日志,而把 `safeErrorText` 留在 `agent/events.ts` 就会逼出一条 trace -> agent 的 import,与 D2 冲突。`agent/events.ts` 保留 re-export,R3 的调用点一行未改。
- 多了 `.gitignore` 的 `bun.lock` 一行,理由见交付物表。
- D4 的具体机制与开工时写的不同(逐出最旧 -> 同 clientId 让位),原因见 D4 引述块;上限数值也随之从 3/10min 调成 8/5min。
