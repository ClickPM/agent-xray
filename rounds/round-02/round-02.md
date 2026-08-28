# Round 02 — 数据层与会话持久化

> 状态:已完成(2026-08-28)

## 目标

会话/消息/轨迹事件全部落 Postgres(重启不丢、轨迹可按序回放),agent 服务出会话创建/续接/列表端点,`encore test` 基建可用且首批库读写测试 + R1 脱敏自测转正式测试全绿,`encore gen client` 产物落 `apps/web/lib/api-client.ts`。

## 前置

- R1 已完成(pi in-process 门禁全过;spike 服务在 `apps/api/spike/` 提供真实对话与事件采集)。
- Docker Desktop 已启动(encore 本地 Postgres 走容器)。
- 本轮不需要 LLM 凭据(落库路径由测试与 spike 现有对话流验证)。

## 交付物

| 路径 | 内容 |
|---|---|
| `apps/api/agent/encore.service.ts` | agent 服务声明 |
| `apps/api/agent/db.ts` | `SQLDatabase("agent")` 声明(迁移目录挂接) |
| `apps/api/agent/migrations/001_init.up.sql` | `sessions` / `messages` / `trace_events` 三表 + 回放/列表索引 |
| `apps/api/agent/store.ts` | 落库读写路径:会话建/查/列、消息追加(首条用户消息生成标题)、轨迹事件批量落库与按序回放;JSONB 写入遵守 CLAUDE.md 规则 4 |
| `apps/api/agent/sessions.ts` | 类型化端点:`POST /agent/sessions`(创建)/ `GET /agent/sessions`(列表)/ `GET /agent/sessions/:id`(续接:会话 + 历史消息回放) |
| `apps/api/spike/ask.ts`(改) | spike 对话路径接入正式 store:会话/消息/轨迹事件随真实对话落库(store 是正式代码;此处接线随 R3 正式 `/agent/ask` 一并替换) |
| `apps/api/agent/store.test.ts` | 首批库读写测试:会话 CRUD、消息追加与标题派生、JSONB 类型断言(`jsonb_typeof`,防规则 4 回归)、轨迹批量写入与回放顺序、级联删除 |
| `apps/api/spike/events.test.ts` | R1 脱敏自测 fixtures 转正式 encore test(BACKLOG 条目落地) |
| `apps/api/package.json` / `vitest.config.ts` | vitest devDep;test 脚本必须 `vitest run --passWithNoTests`(规则 2) |
| `apps/web/lib/api-client.ts` | `dev.ps1 gen` 产物(生成物,不手改;本轮仅落类型与数据层,前端仍跑 demo-data) |
| `rounds/BACKLOG.md`(改) | 勾掉「脱敏自测转正式 encore test」条目 |

## 验收

| # | 检查 | 命令 / 期望 |
|---|---|---|
| 1 | 编译 | `dev.ps1 check` 通过 |
| 2 | 测试基建 | `dev.ps1 test` 跑通 vitest(非裸 vitest);store + sanitize 测试全绿 |
| 3 | JSONB 语义 | 测试断言落库 JSONB 字段 `jsonb_typeof` 为 `object`(非 `string`),`->` 查询可用 |
| 4 | 会话端点 | `curl POST /agent/sessions` 创建 → `GET /agent/sessions` 列出 → `GET /agent/sessions/:id` 返回会话与消息 |
| 5 | 落库重启不丢 | spike 真实对话一轮 → 重启 encore(daemon 内重跑)→ 会话/消息/轨迹事件仍可经端点与 SQL 查到,轨迹按 `seq` 有序 |
| 6 | gen client | `dev.ps1 gen` 产出 `apps/web/lib/api-client.ts` 含 agent 会话端点类型;前端零 UI/样式改动 |
| 7 | 脱敏测试迁移 | R1 六组 fixtures 在 `encore test` 下全 PASS;BACKLOG 条目勾销 |

## 禁止

- 不改前端页面样式(规则 7);本轮前端唯一改动 = 生成物 `api-client.ts` 落盘,页面仍消费 demo-data。
- 不加设计稿没有的功能(规则 8);端点范围限 ROUNDS.md R2 明文(建/续接/列表 + 落库)。
- 不实现 `/agent/ask` 正式对话流(R3)、不做 `/trace/stream` 正式端点与正式 sanitize 迁移(R4)、不建 notes/admin/metrics 表(R5/R7/R8)。
- 不声明任何 `defineTool` 工具、不动 `noTools:'all'`(规则 9,R6 的事)。
- JSONB 写入一律 `${JSON.stringify(x)}::text::jsonb`(规则 4);测试只走 `encore test`(规则 2)。

## 代码审查

- 审查方式:codex `/codex:review --background`(thread 01a04770-eaac-7fd3-b7dd-20cb12469e79)
- findings 处理(3 条,全部 P2,全部采纳):
  - **[P2] 长对话轨迹丢头**(runtime.ts)——单轮事件数超内存上限(2000)时,`capture` 先逐出、请求收尾才 flush,被逐出的事件永不落库。**整改**:未落库事件达水位 `FLUSH_THRESHOLD=500` 即触发增量 flush(fire-and-forget,失败只记日志),`flushChain` 串行化保证同会话任意时刻只有一个批量写、`flushedSeq` 单调推进(`appendTraceEvents` 本身 ON CONFLICT 幂等,重放安全);仅 `persisted` 会话触发(mem 基线会话无 DB 行,不触发,避免 FK 违约)。水位与上限之间留 1500 事件在途余量。
  - **[P2] prompt 失败丢已流出的助手文本**(ask.ts)——catch 路径跳过 `appendMessage`,库内历史与客户端已渲染内容不一致。**整改**:prompt 结果与助手文本持久化解耦——失败路径同样落已累计文本,持久化失败只记日志、不吞 SSE error 事件;外层 try/finally 保住心跳清理与 `resp.end()` 原有保证。
  - **[P2] DB 建行失败泄漏 pi 会话**(ask.ts)——`createDbSession` 失败路径不 dispose 已注册的 pi 会话,Postgres 不可用时反复请求可占满 8 会话上限。**整改**:建行失败立即 `disposeSpikeSession` 再返回 500;`persisted` 仅在建行成功后置位。
  - 审查推理中另涉及会话端点公开可枚举——最终 findings 未列;站点按设计无用户概念(`docs/security.md` §6 无注册无上传),工作台会话列表即公开演示语义,不整改。
- 整改后回归:`dev.ps1 check` 通过;`dev.ps1 test` 11/11 全绿;真实对话一轮完整跑通,60 条轨迹事件 seq 0–59 连续落库、消息/标题正常。
- 结论:整改后 PASS

## 失败处理

同一验收项针对性整改后连续 2 次验证仍不过 → 写 `rounds/round-02/BLOCKED.md`,停下呼人。禁止放宽验收标准自我通过。

## 本轮实测

验收逐项(2026-08-28,本机 Windows,encore v1.57.13,node v24.11.1,vitest 4.1.11):

1. **编译** ✅ `dev.ps1 check` 通过;check 阶段自动建库并干净应用迁移 001(建表 13.7s + 迁移 1.3s)。
2. **测试基建** ✅ `dev.ps1 test`(encore test → `vitest run --passWithNoTests`)2 文件 11 用例全绿,3.4s。
3. **JSONB 语义** ✅ 测试断言 `jsonb_typeof(payload/data)='object'`、`->` 链可查、缺省 payload 是 SQL NULL(非 `jsonb 'null'`);live 库抽查 58 条轨迹事件 `bool_and(jsonb_typeof(data)='object')=true`。
4. **会话端点** ✅ curl 过一遍:POST 创建(ISO 时间戳)→ GET 列表(最近活跃倒序)→ GET 单查(会话+历史);非 UUID → `invalid_argument`,未知 id → `not_found`。
5. **落库重启不丢** ✅ spike 真实对话一轮(DeepSeek,含 thinking/delta 流)→ TaskStop 杀进程 → `dev.ps1` 重启 → 列表/单查完整恢复(标题=首条用户消息截断,user+assistant 消息俱在);轨迹 58 条 seq 0–57 连续、按 seq 有序,重启后 SQL 复查一致;`data::text` 凭据模式扫描(authorization/api-key/sk-/bearer)0 命中。
6. **gen client** ✅ `dev.ps1 gen` 产出 `apps/web/lib/api-client.ts`(1024 行),含 `agent` namespace 的 `createSession/getSession/listSessions` 与 `SessionSummary/ChatMessage` 类型;`apps/web` 无任何其他改动(规则 7)。
7. **脱敏测试迁移** ✅ R1 六组 fixtures + 34 事件四模式计数断言入 `spike/events.test.ts`,`encore test` 下全 PASS;BACKLOG 条目勾销(R4 随 sanitize 迁移的备注保留)。

实现要点与踩坑:

- 仓库沿用**隐式服务模式**(spike/system 均无 `encore.service.ts`,目录内 API 定义推断服务),agent 服务同样不加,避免显式/隐式混用风险;R1 任务卡交付物清单里写的 `spike/encore.service.ts` 实际并不存在。
- 轨迹事件批量落库用整批 `${JSON.stringify(events)}::text::jsonb` + `jsonb_array_elements` 展开(`e->'data'` 全程 jsonb,不经历二次编码),一条 SQL 落一批,规则 4 语义完整保留;`ON CONFLICT (session_id, seq) DO NOTHING` 让重复 flush 幂等。
- 时间戳统一 epoch ms(double precision)进出 store,端点层转 ISO——规避驱动对 timestamptz 返回类型(Date/字符串)的不确定性;ms 精度往返测试 `Math.round` 后严格相等。
- spike 落库接线(ask.ts:会话建行/用户消息前置落库/助手最终文本/finally flush 轨迹)是临时胶水,R3 正式 `/agent/ask` 落地时随 spike 一并替换;store/迁移/端点是正式代码。
- 消息 `payload` 列(JSONB,可空)本轮端点暂不透出——为 R6 工具消息(`{name, preview, dur, error}`)预留,读写路径已被测试覆盖。

与计划的偏离:无(交付物与 ROUNDS.md R2 拆解一致)。
