# Round 01 — pi 内核风险门禁 spike

> 状态:已完成(2026-08-28)

## 目标

把「pi SDK in-process 嵌入 Encore 进程」验证到可承诺的程度:Encore 请求内跑通一轮真实 LLM 对话(DeepSeek 官方 API),观测者扩展全量订阅 34 种事件并实测四模式计数,SSE ×2 原型两条路径不缓冲不断流,内存基线出实测数字。任一门禁不过且当轮无法解决 → BLOCKED.md 停下。

## 前置

- R0 已完成(dev.ps1 / encore daemon env / 依赖冒烟)。
- LLM 凭据:本机 pi 配置(`~/.pi/agent/auth.json`)中的 DeepSeek 官方 API key,注入 Encore 本地 secret `DeepSeekApiKey`(明文不落仓库、不进日志)。
- **与 ROUNDS.md 原文的偏离**:原文写「经海外中转端点」;所有者 2026-08-28 指示本轮直接用 DeepSeek 官方 API(境内直连可达,无需中转)。海外中转仍是后续接 Anthropic/OpenAI 时的约束(docs/security.md §5),本轮不涉及。

## 交付物

| 路径 | 内容 |
|---|---|
| `apps/api/package.json` / `package-lock.json` | 钉版本 `@earendil-works/pi-coding-agent@0.84.3`(exact,lockfile 固定) |
| `apps/api/spike/encore.service.ts` | spike 服务声明(R1 专用,R2 起逐步被正式服务替代) |
| `apps/api/spike/events.ts` | 34 事件 × 四模式清单(以 SDK `dist/core/extensions/types.d.ts` 的 34 个 `pi.on` 重载为准) |
| `apps/api/spike/runtime.ts` | pi 惰性初始化:动态 import、ModelRuntime + secret 注入 key、观测者扩展、会话注册表 |
| `apps/api/spike/ask.ts` | `api.raw` GET/POST `/spike/ask` — 真实 LLM 对话 SSE(text delta 流) |
| `apps/api/spike/trace.ts` | `api.raw` GET `/spike/trace/stream?sessionId=` — 轨迹事件 SSE(缓冲回放 + live tail) |
| `apps/api/spike/audit.ts` | GET `/spike/events/audit` — 34 事件订阅核验 + 四模式计数 + 实际捕获事件类型 |
| `apps/api/spike/mem.ts` | GET `/spike/mem` + POST `/spike/mem/import` / `/spike/mem/sessions` — 内存基线测量 |
| `apps/web/next.config.ts` | 仅 dev 生效的 `/api/:path*` → `127.0.0.1:4000/:path*` rewrites(与 Caddy strip_prefix 语义一致;非样式改动) |
| `CLAUDE.md` | 新增「钉版本」段:pi SDK 包名与版本 |
| `docs/architecture.md` | 事件模式计数按实测回改(如有出入) |
| 本文件 | 实测数字回填 |

## 验收

| # | 检查 | 命令 / 期望 |
|---|---|---|
| 1 | 钉版本 | `apps/api/package.json` 精确版本 `0.84.3`;lockfile 含该版本;CLAUDE.md「钉版本」段落地 |
| 2 | 真实 LLM 对话 | `curl -N "127.0.0.1:4000/spike/ask?q=..."` 流式返回 DeepSeek 真实回复(非 mock);Encore 请求 handler 内完成 `createAgentSession({noTools:'all'})` → `prompt()` 全程 |
| 3 | 34 事件订阅 | `/spike/events/audit`:34 个事件名全部 `pi.on` 订阅成功;四模式计数与实测一致;对话后至少捕获 agent/turn/message/provider 生命周期事件,每条含 `{eventType, mode, timestamp, data}` |
| 4 | 模式计数核对 | 实测计数 vs `docs/architecture.md`(notify 18 / veto 6 / chain 7 / takeover 2,合计 33 ≠ 34,已知有出入)→ 以实测回改文档 |
| 5 | SSE 直连不缓冲 | `curl -N 127.0.0.1:4000/spike/ask?...` 与 `/spike/trace/stream` 均逐事件到达(非整体一次性);对话进行中 trace 流实时出事件 |
| 6 | SSE 经 Next dev proxy | 同上两条经 `localhost:3000/api/spike/...` 逐事件到达、长连接不断流 |
| 7 | 内存基线 | import 增量、单活跃会话增量、10 轮 create/dispose 后 RSS 回落数字全部回填本文件「本轮实测」 |
| 8 | 凭据不泄漏 | 抽查两条 SSE 原始输出:无 `Authorization`/`api-key`/key 明文;仓库 diff 无任何 key 片段 |
| 9 | 编译 | `dev.ps1 check` 通过 |

## 禁止

- 不改前端页面样式(规则 7;next.config.ts rewrites 属接线,不属样式)。
- 不加设计稿没有的功能(规则 8;spike 端点是验证脚手架,不是产品功能,R3/R4 正式实现后移除)。
- 不把 pi 内置工具打开(`noTools:'all'` 起步,规则 9);不声明任何 `defineTool` 工具(R6 的事)。
- 不建库表、不写迁移(R2 的事);会话仅内存态。
- key 明文不进代码、日志、任务卡、SSE。

## 代码审查

- 审查方式:codex `/codex:review --background`(thread 01a04741-7d31-7de3-9cc6-45282bfb7d75)
- findings 处理:
  - **[P1] SSE 事件脱敏应为白名单而非黑名单**(events.ts)——**采纳**。`docs/security.md` §2 是强约束,不应推迟到 R4:已改为逐事件顶层字段白名单(`EVENT_FIELD_WHITELIST`,未列字段一律丢弃;payload/headers/完整 message 等富对象永不放行,以派生摘要替代),值层保留截断 + 凭据键黑名单(`DROP_KEY`,并扩充 credential/cookie/access_token 形态)作纵深防御。整改后回归:provider 事件仅剩 `{type}`/`{type,status}`,泄漏扫描 0 命中。
  - **[P2] `project_trust` handler 必须返回 `{trusted}`**(runtime.ts)——**采纳**。SDK `emitProjectTrustEvent` 直接读 `handlerResult.trusted`,返回 undefined 会 TypeError;观测者对该事件改返回 `{ trusted: "undecided" }`(不做裁决),其余事件仍返回 undefined。
  - 审查推理中另涉及的 spike 端点无认证/无限额/会话上限竞态等——**不整改**,属已知 spike 范围:限额是 R6、后台认证是 R7 的交付,spike 端点仅本机开发环境存在且 R3/R4 落正式实现后移除(任务卡「禁止」段已声明)。
- 结论:整改后 PASS

## 失败处理

同一验收项针对性整改后连续 2 次验证仍不过 → 写 `rounds/round-01/BLOCKED.md`,停下呼人(重点预案:sidecar 形态重评估)。

## 本轮实测

验收逐项(2026-08-28,本机 Windows,encore v1.57.13,node v24.11.1):

1. **钉版本** ✅ `@earendil-works/pi-coding-agent@0.84.3`(exact)入 `apps/api/package.json` + lockfile;CLAUDE.md 新增「钉版本」段。SDK 即 CLI 本体包,无独立 SDK 包;`createAgentSession`/`defineTool`/扩展系统均在其中。
2. **真实 LLM 对话** ✅ DeepSeek 官方 `https://api.deepseek.com`(内置 provider),模型 `deepseek-v4-flash`,thinkingLevel low。Encore 请求 handler 内 `createAgentSession({noTools:'all'})` → `prompt()` 全程跑通,中文/英文各一轮 + 同 session 续问(`?sessionId=`)均正常;done 事件带 messageCount/capturedEvents。
3. **34 事件订阅** ✅ 每个会话 `pi.on` 订阅 34/34 成功、0 错误(`/spike/events/audit`)。纯对话(noTools)场景实际触发 **16 种**:session_start、resources_discover、input、before_agent_start、agent_start、turn_start、context、before_provider_headers、before_provider_request、after_provider_response、message_start、message_update、message_end、turn_end、agent_end、agent_settled。未触发的 18 种需对应场景(tool_* 要工具、session_before_*/compact/tree 要相应操作、user_bash/model_select 等),R4+ 按场景补测。
4. **模式计数核对** ✅ 实测 **notify 19 / veto 6 / chain 7 / takeover 2 = 34**;`docs/architecture.md` 旧记 notify 18(合计 33)为笔误,已回改并附逐事件清单指针(`apps/api/spike/events.ts`)。划分依据:handler result 语义(veto=可取消/拦截,chain=结果沿链传递,takeover=可完全接管,notify=纯通知)。
5. **SSE 直连** ✅ `curl -N` 带毫秒时间戳逐行采样:对话流 delta 在 ~7s(短答)/~18s(长答)内持续逐字到达,非一次性;trace 流对话中实时出事件(先回放缓冲再 live tail,并发第二轮对话事件即时到达)。
6. **SSE 经 Next dev proxy** ✅ `localhost:3000/api/spike/*`(rewrites → :4000,与 Caddy strip_prefix 同语义)对话流 18s 逐字到达、done 正常收尾;trace 流回放 + 长连接心跳(15s `: hb`)不断流。
7. **内存基线**(process.memoryUsage,无法强制 GC——encore 运行时未开 `--expose-gc`,gcForced=false,数字为自然回收口径):
   - 进程基线(pi 未加载):RSS 64.5MB / heap 5.4MB
   - **import 增量**:RSS +96.3MB / heap +62.4MB(动态 import 一次性成本,约 16s)
   - **单活跃(空闲)会话增量**:RSS ~0.4MB / heap ~0.1MB(3 并发均摊)
   - **dispose 回收**:3 会话 dispose 后 RSS 回到创建前 ±0.1MB;10 轮 create/dispose 循环残留 RSS +0.6~0.9MB,无单调增长
   - 部署含义:pi in-process 固定成本 ~100MB,会话边际成本极小;compose `mem_limit` 512MB 起步即可,重点盯长对话历史与事件缓冲(每会话 capped 2000 条)
8. **凭据不泄漏** ✅ 6 份 SSE 原始采样 `grep -iE "authorization|x-api-key|bearer|sk-|cookie|access_token"` 全 0 命中;脱敏为**逐事件字段白名单**(codex review P1 整改,`docs/security.md` §2):payload/headers/完整 message 永不放行,provider 事件透出仅 `{type}`/`{type,status}`;值层另有截断 + 凭据键黑名单兜底。key 走 `.secrets.local.cue`(已入 .gitignore,同时补了 `.secrets.*.cue` 规则),仓库无 key 片段。
9. **编译** ✅ `dev.ps1 check` 通过;`npx tsc --noEmit`(补 @types/node devDep)干净。

踩坑与实测发现:

- **`encore secret set` 需要 app link**,未 link 的本地 app 用 `apps/api/.secrets.local.cue` 提供 secret(官方本地覆盖机制)。
- **bare `createAgentSession()` 不向扩展广播 `session_start`/`resources_discover`**——它们由 run 模式层的 `session.bindExtensions()` 触发。spike 在创建后补 `bindExtensions({ mode: "print" })`(headless,hasUI=false)后两事件正常到达;已写入 `docs/architecture.md`,R3 沿用。
- pi 资源发现指向 tmpdir 下空隔离目录(`agent-xray-spike-pi`),ModelRuntime 的 auth/models/models-store 路径同样隔离——in-process 进程不加载本机 `~/.pi` 的任何用户扩展/凭据;key 仅经 `setRuntimeApiKey` 运行时注入,不落盘。
- DeepSeek `deepseek-v4-flash` 的 thinkingLevelMap 不支持 medium(SDK 会 clamp),spike 显式用 low。
- Encore 检测到新版 v1.58.4,按钉版本原则不升级(v1.57.13 继续)。

与计划的偏离:

- ROUNDS.md 原文「经海外中转端点」→ 按所有者指示改用 DeepSeek 官方 API 境内直连(见「前置」)。
- 新增 `apps/api/spike/sse.ts`(SSE 写出小工具)与 `@types/node` devDep,交付物清单外的必要小件。
