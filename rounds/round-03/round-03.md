# Round 03 — Runtime 对话流真实化

> 状态:进行中(实现与验收完成,待 codex 审查)

## 目标

`POST /agent/ask` 正式落地(`api.raw` SSE ← `session.subscribe()`,含并发上限 / 空闲回收 / `dispose()` 及时),前端工作台的**对话区与会话列表**从 `demo-data.ts` 切到真实 API/SSE,且样式零改动:新访客建会话 → 对话逐字流式渲染 → 刷新后会话与历史可恢复。

## 前置

- R1(pi in-process 门禁)、R2(数据层与会话端点)已完成。
- Docker Desktop 已启动(encore 本地 Postgres 走容器)。
- 本机 encore local secret `DeepSeekApiKey` 已设置(R1 起沿用)。
- 分支:本轮在 worktree 分支 `claude/r3-development-start-c30405` 上开发(等价于约定的 `round-NN` 分支),审查通过后合并 `main`。

## 交付物

| 路径 | 内容 |
|---|---|
| `apps/api/agent/events.ts` | 由 `spike/events.ts` **原样迁入**(34 事件 × 四模式清单 + 白名单 sanitize)。理由:正式采集点在 agent 服务,而 `spike` 被 `dev.ps1 build --services` 排除出生产镜像,正式服务不得依赖 spike 目录 |
| `apps/api/agent/events.test.ts` | 由 `spike/events.test.ts` 迁入(六组脱敏 fixtures + 四模式计数断言) |
| `apps/api/agent/runtime.ts` | 正式运行时会话注册表:pi 惰性加载 / ModelRuntime 单例(隔离目录 + secret 注入)/ 观测者扩展全量订阅 34 事件 → 脱敏 → 待落库队列 → `appendTraceEvents`;**并发上限 + 空闲回收(sweeper)+ 容量满时逐出最旧空闲会话 + `dispose()`**;运行时会话 id ≡ DB 会话 id;重建会话时轨迹 `seq` 从库内最大值续接 |
| `apps/api/agent/ask.ts` | `POST /agent/ask`(`api.raw` SSE):JSON body 读取与限长 → 会话解析(新建 / 续接 / 回收后重建并注入历史上下文)→ 同会话并发 409 → 用户消息落库 → `session.subscribe()` 逐 delta 推送 → 助手消息按 `(session_id, seq)` 去重键幂等落库(带重试)→ `done`/`error` 收尾;**SSE 错误一律固定文案**(不透出 provider 原文,消化 BACKLOG 两条 R2 遗留) |
| `apps/api/agent/store.ts`(改) | 新增 `maxTraceSeq()`(重建会话续接轨迹 seq)、`upsertMessage()`(turn 级去重键幂等写);既有函数签名不变 |
| `apps/api/agent/runtime.test.ts` | 运行时纯逻辑测试:队列排干/失败重试/硬上限、空闲回收判定、容量逐出、历史转写裁剪 |
| `apps/api/agent/ask.test.ts` | 幂等写与 SSE 帧编码测试(不打真实 LLM) |
| `apps/api/spike/*`(改) | `events.ts`/`events.test.ts` 迁出后改为从 `../agent/events` 导入;spike 其余部分保持不动(R4 随 trace 服务落地整体移除) |
| `apps/web/lib/agent-api.ts` | 前端数据层:生成客户端实例(base `/api`)+ `askStream()`(fetch + ReadableStream 解析 SSE)+ 相对时间格式化 |
| `apps/web/components/workbench/Workbench.tsx`(改) | 会话列表 / 会话顶栏标题 / 对话区改由真实 API 与 SSE 驱动;**样式、布局、className、token、动画参数零改动** |
| `apps/web/lib/api-client.ts` | `dev.ps1 gen` 重新生成(生成物,不手改) |
| `rounds/BACKLOG.md`(改) | 勾销两条 R2 遗留(助手消息幂等持久化协议、SSE error 脱敏口径) |
| `ROUNDS.md`(改) | 进度表 R3 收口 |

## 验收

| # | 检查 | 命令 / 期望 |
|---|---|---|
| 1 | 编译 | `dev.ps1 check` 通过 |
| 2 | 测试 | `dev.ps1 test` 全绿(含迁移后的脱敏测试与新增运行时测试) |
| 3 | 新会话流式 | 浏览器 `/` 输入一句话 → 助手文本**逐字**出现(非一次性整段);`curl -N -X POST /agent/ask` 观察到多帧 `event: delta` |
| 4 | 刷新可恢复 | 刷新页面 → 会话列表含该会话(标题=首条用户消息)、点开历史消息完整;重启 encore 后仍可恢复 |
| 5 | 续接对话 | 对同一会话再问一句、且**能引用上一轮内容**;进程重启(运行时会话已丢)后续接仍带上下文(历史注入) |
| 6 | 并发上限与回收 | 同会话并发第二个 ask → HTTP 409;超过 `MAX_ACTIVE_SESSIONS` 且无可逐出空闲会话 → 429;空闲超时后会话被 `dispose()`(日志可见,`/agent/ask` 再来时重建) |
| 7 | 轨迹仍落库 | 真实对话一轮后 SQL 查 `trace_events`:`seq` 连续、`jsonb_typeof(data)='object'`、`data::text` 无 `authorization/api-key/sk-/bearer` 命中 |
| 8 | SSE 脱敏 | 制造 provider 失败(临时改坏 key)→ SSE `error` 帧只有固定文案,原文只进服务端日志 |
| 9 | 样式零改动 | `git diff` 中 `apps/web` 无任何样式/布局/token/动画改动(仅数据源与事件接线) |
| 10 | gen client | `dev.ps1 gen` 重新生成后前端编译通过(`npx tsc --noEmit`) |

## 禁止

- 不改前端页面样式(规则 7):不动 style 对象、布局、className、design token、动画参数;结构改动仅限接线必需且写明理由。
- 不加设计稿没有的功能(规则 8):不做 `/demo` input 接管、不做 Ask why、不做错误重试 UI、不做 tokens/cost/ctx 真实统计(R8)。
- 不实现 `/trace/stream` 正式端点、不做三视图真实化(R4)——右栏三视图本轮**仍消费 demo-data**。
- 不声明任何 `defineTool` 工具、不动 `noTools:'all'`(规则 9,R6 的事)。
- 不建 notes/admin/metrics 表、不做限额计费(R5/R7/R8)。
- JSONB 写入一律 `${JSON.stringify(x)}::text::jsonb`(规则 4);测试只走 `encore test`(规则 2)。

## 代码审查

<!-- 完成后回填。审查路由见 CLAUDE.md「开发模式」。 -->

## 失败处理

同一验收项针对性整改后连续 2 次验证仍不过 → 写 `rounds/round-03/BLOCKED.md`,停下呼人。禁止放宽验收标准自我通过。

## 本轮实测

验收逐项(2026-08-31,本机 Windows,encore v1.57.13,bun 1.4.0,vitest 4.1.11,模型 deepseek/deepseek-v4-flash):

1. **编译** ✅ `dev.ps1 check` 通过;`npx tsc --noEmit` 在 `apps/api` 与 `apps/web` 均无错。
2. **测试** ✅ `dev.ps1 test` 5 文件 40 用例全绿(R2 的 16 条 + 本轮新增 24 条:运行时队列/回收/逐出/历史转写、`upsertMessage` 幂等与角色护栏、`maxTraceSeq`、请求体校验、SSE 帧编码)。
3. **新会话流式** ✅ `curl -N -X POST /agent/ask` 一轮 183 帧 `event: delta`;浏览器端逐字渲染。
4. **刷新可恢复** ✅ 浏览器整页 reload → 会话列表含该会话(标题=首条用户消息)→ 点开 4 条历史消息完整;encore 进程重启后同样可恢复。
5. **续接对话** ✅ 同进程内:第一轮「记住暗号:菠萝蜜」→ 第二轮「暗号是什么」答「菠萝蜜」。**进程重启后**(运行时会话已丢)第三轮仍答「菠萝蜜」——历史注入生效;轨迹 `seq` 跨重启从 344 续到 426,`contiguous=true`(未从 0 重来撞既有行)。
6. **并发上限与回收** ✅
   - 409:A 正在流式时对同会话发 B → `{"error":"session is already streaming"}` HTTP 409。
   - 429:11 路并发新会话 → 8×200 + 3×429,与 `MAX_ACTIVE_SESSIONS=8` 一致。
   - 空闲回收:临时把 `IDLE_TIMEOUT_MS` 调到 20s / 扫描 5s 实测,日志 `recycling idle agent session <id> (idle 24s)`;回收后再提问会话被重建且答出第一轮内容(「只回复 OK」→ 复述末两字得「OK」)。**实测后已改回 15min / 60s 并复跑 check+test**。
7. **轨迹仍落库** ✅ 单会话 427 条事件,`seq` 0–426 连续,`bool_and(jsonb_typeof(data)='object')=true`,`data::text` 对 `authorization|api[-_]?key|sk-[A-Za-z0-9]{10}|bearer ` 命中数 0。
8. **SSE 脱敏** ✅ 临时换成无效 key:SSE 只出 `{"message":"模型调用失败,本轮回复未完成。"}`;provider 原文(`401: {"message":"Authentication Fails, Your api key: ****test is invalid"…}`)只在服务端日志。测后已还原真 key。
9. **样式零改动** ✅ `Workbench.tsx` 的 diff 中所有 style 对象逐字节一致,改动只落在数据源与事件处理(`onSelect(0)`→`onNew`、`s.time`→`relativeTime(s.lastActiveAt)`、`onSuggest`→`onSuggest(s.text)` 等)。
10. **gen client** ✅ `dev.ps1 gen` 重新生成;`apps/web` `npm run build` 通过(24 页)。

实现要点与踩坑:

- **pi 把 provider 失败吞在内部(本轮最大的坑)**:key 无效时 `session.prompt()` **正常 resolve**,助手消息以 `stopReason:"error"` + 空正文收尾。初版只用 try/catch,结果失败的一轮报 `done`、访客看到「什么都没发生」——实测发现后改判据为订阅侧助手 `message_end` 的 `stopReason ∈ {error, aborted}`。`AgentEvent` 联合类型里**没有** error 事件,这是唯一可靠的进程内信号。已记 BACKLOG。
- **助手消息幂等落库**:去重键就用既有 `UNIQUE(session_id, seq)`——助手 seq 在用户消息落库时定死为 `userSeq+1`,`upsertMessage` 走 `ON CONFLICT DO UPDATE … WHERE messages.role = EXCLUDED.role`(角色不匹配时不改写、不返回行,由调用方判失败)。没有引入 outbox 表:单进程内一轮对话的边界清晰,去重键已覆盖「提交成功但连接断开后重试」。
- **会话重建必须续接轨迹 seq**:`createRuntimeSession` 用 `maxTraceSeq(id)+1` 起步。漏掉这一步的表现极隐蔽——新事件 seq 与库内既有行相撞,被 `ON CONFLICT DO NOTHING` **静默丢弃**,重建后的整轮轨迹凭空消失。
- **历史注入**:pi 没有「用已有消息初始化会话」的 API(`CreateAgentSessionOptions` 无此项)。用 `sendCustomMessage({customType:"xray_history", display:false}, {triggerTurn:false})` 把库内历史压成一条 `role:"custom"` 消息注入——它进 LLM 上下文但不进 UI,正是设计稿 1b「context-injector」演示的同一机制。
- **`events.ts` 迁入 agent 服务**:正式采集点在 `agent/runtime.ts`,而 `spike` 被 `dev.ps1 build --services` 排除出生产镜像。若让 agent 从 `../spike/events` 导入,生产镜像会静默依赖一个「本应不存在」的目录。这是本轮唯一的文件搬迁,内容未改。
- **SSE 用 POST + fetch,不用 `EventSource`**:`EventSource` 只能 GET。生成客户端里的 `agent.ask()` 也没用——它的 `callAPI` 在非 2xx 时抛 Encore `APIError` 并吞掉 HTTP 状态码,前端就无法区分 409/429/404 给出不同提示。类型化 RPC 仍走生成客户端(会话列表/历史)。
- **客户端断开即 `abort()`**:继续生成只会白烧 token;已流出的文本照常落库,库内历史与访客所见一致。
- **右栏三视图本轮仍是 demo 数据**(R4 接 `/trace/stream`),`usePlayback` 的 chat 字段已删除、只留 trace 行数。
- 测试环境坑:Git Bash 下 `curl -d '中文'` 会按 GBK 编码发出,库里存成乱码——不是服务端问题,验证中文一律 `printf` 写 UTF-8 文件后 `--data-binary @file`。浏览器自动 UTF-8 编码,无此问题。
- 浏览器自动化的 `key Return` 发出的 keydown `event.key` 为空串,不会触发 `onKeyDown` 里的 `key === "Enter"` 判断;用 `dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))` 验证通过(输入框清空、消息发出、助手答「收到」)。是工具限制,不是应用缺陷。

与计划的偏离:

- 交付物清单里的 `apps/api/agent/ask.test.ts` 实际覆盖「请求体校验 + SSE 帧编码」,幂等写的测试放在了 `agent/store.test.ts`(去重键机制本体在 store 层,测试跟着实现走)。
- 前端错误展示复用助手文本行渲染固定文案(无新组件、无新样式),设计稿没有专门的错误态。
