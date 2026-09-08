# Round R-LEAK — 公开轨迹流的配置面泄露修补(`model_select` 派生字段 + `web_search` 阶段文案)

<!-- 保存为 rounds/round-leak/round-leak.md;该轮其他管理产出放同一目录。 -->

> 状态:**已完成并发版**(2026-09-08 生产 `e8ac83e`,`docs/releases.md` 已记;codex 一轮零 findings)(2026-09-08 开工于分支 `round-leak`;所有者裁定同日:下一阶段拆三轮,本轮第一、先于 R-CROSSLINK / R-CARDS)。
> 它是修补不是功能,**不涉及设计稿**(规则 8 不触发);但改的是脱敏面,所以不走「小修补直接 `main`」——
> 分支 `round-leak`,完整 codex 循环(缺陷门禁),发版记 `docs/releases.md`。
> 规则 9「先改文档」:`docs/security.md` §2 的 R-LEAK 补记已随本任务卡写入,§1 2026-09-07 补记里「记 BACKLOG 等裁定」那句同步改指向本轮。

## 目标

公开轨迹流 `/trace/stream` 与落库的 `trace_events.data` 里**不再出现** LLM provider 名 / model id / model name,
也不再出现搜索网关的 hostname 与搜索模型名;`/agent/ask` 那条流保持原样(它本来就干净)。前端零改动。

可证伪:假 provider 驱动真实 pi loop 跑一轮含 `web_search` 的对话,把该会话**全部**轨迹事件序列化成一整段 JSON、
再把 `/trace/stream` 的原始字节整段收下来,两段里都 grep 不到假 provider 的 host、model id 与假搜索网关的 host、modelId;
`model_select` 事件的 `data` 恰好是 `{type, source}` 两个键。

## 两条通道与修法(BACKLOG 2026-09-07 两条;所有者 2026-09-08 裁定「修」)

| 通道 | 现状 | 修法(所有者未指定档位,取最小改动;可推翻) |
|---|---|---|
| A · `agent/events.ts` `EVENT_DERIVED.model_select` | 白名单只放行 `type` / `source`(第 121 行),但派生项(第 182 行)又把 `summarizeModel(e.model)` / `summarizeModel(e.previousModel)` 即 `{provider, id, name}` 并回去,随 `/trace/stream` 推给访客并落库 | **删掉 `model_select` 的派生项与 `summarizeModel`**。事件仍记录(Timeline 仍有 `model_select` 行),`data` 只剩 `{type, source}`;`hasDetail` 判不出详情时该行不可展开 —— 这是既有行为,不是新态 |
| B · `agent/websearch.ts:314` `progress("request", …)` | 文案直接拼 `new URL(cfg.baseUrl).hostname` 与 `cfg.modelId`,经 `tool_execution_update.partialResultPreview` 出去 | **BACKLOG 三档取 ①**:文案改成固定字符串「已向搜索网关发起请求」;Responses 线与 `google_search` 线若各有一处,一起改。② 保留 model 名与所有者两次裁定(R-TOOLS / R-TOOLCARDS)相反,不取;③ 值级白名单是新增机制,非阻塞性 findings 下不许(审查边界),留作备选记 BACKLOG |

**通道 C · `tools.ts` 的 `web_search` 结果 `details`(落地时新发现,不在开工时的两条里)**:`textResult(…, {provider: cfg.provider, model: cfg.modelId, citations})`
经 pi 的 `tool_execution_end.resultPreview` 出去 —— 与阶段文案是**两条路**,同族排查的静态阅读没盯住它(details 不是「字符串模板」),
是集成探针 `leak-e2e.test.ts` 第一次跑就红了抓到的。修法同族:只留 `citations`。`generate_image` 那一侧从 R-IMAGEGEN 起就写着
「details 里不放 provider / model」,本轮把 `web_search` 对齐它,并在两处留同名注释,新增外呼工具时照抄。

**同族排查(交付项,不是可选)**:`agent/` 下所有会进 `onUpdate` / `progress` / 事件 `data` / 工具结果文本的字符串模板,逐个核有没有引用
`cfg.baseUrl` / `cfg.modelId` / `hostname` / provider 名 —— 至少核 `websearch.ts` 全部四个 phase(`request / accepted / searching / composing`)、
`imagegen.ts` 的 `ImageGenPhase` 文案、`skill-runner.ts` 的失败文案、`tools.ts` 里 `generate_image` / `web_search` / `skill_run` 的固定文案、
`events.ts` 其余派生项(`after_provider_response` 只放 `status`,`before_agent_start` 只放 `systemPromptDelta`,核一遍即可)。核过的清单写进「本轮实测」,每条标「改」或「干净」。

**为什么历次冒烟没抓到**:7 项扩展脱敏此前只对 `/agent/ask` 跑,`/trace/stream` 那侧只查字面词 `baseUrl`,而泄的是它的**值**。
所以本轮把冒烟改成**值级**:拿当前 provider 配置里的 host 与 modelId 去两条流的原始字节里 grep(`docs/deploy-environments.md` 清单第 8 条)。

**存量数据不回填**:库里既有 `trace_events` 行保留旧值,访客会话 3 天保留期(R-VISITOR)自然清掉;发版后 3 天内旧会话回放仍能看到旧值,所有者已知。

## 前置

- 无设计稿、无迁移、无 MCP 工具变动(仍 51)、无新依赖、无 `.env` 变更。
- 本机验收要 faux provider(`skills-e2e.test.ts` 同款)与 faux 搜索网关(`websearch.test.ts` 已有的假服务)。

## 交付物

| 件 | 路径 | 内容 |
|---|---|---|
| 通道 A | `apps/api/agent/events.ts` | 删 `EVENT_DERIVED.model_select` 与 `summarizeModel`;文件头注释补一句「provider / model 名不进轨迹流(R-LEAK)」 |
| 通道 B | `apps/api/agent/websearch.ts` | `request` 阶段文案改固定字符串(两条线) |
| 通道 C | `apps/api/agent/tools.ts` | `web_search` 结果 `details` 只留 `citations`(删 `provider` / `model`) |
| 同族 | `apps/api/agent/imagegen.ts` 等 | 排查结果:有则同法改文案,无则在任务卡记「核过、干净」 |
| 单元测试 | `apps/api/agent/events.test.ts` | 新用例:给 `model_select` 一个完整 `Model` 对象(provider / id / name / baseUrl 都填),sanitize 后**深度**找不到这四个值,键集合恰为 `{type, source}` |
| 单元测试 | `apps/api/agent/websearch.test.ts` | 新用例两条(Responses / `google_search` 各一):收集全部 `onProgress` 的 `detail`,断言不含 `hostname(cfg.baseUrl)` 与 `cfg.modelId`(值级,不是查字面词) |
| 集成探针 | `apps/api/agent/leak-e2e.test.ts`(或并进 `skills-e2e.test.ts`) | faux provider + faux 搜索网关驱动真实 pi loop 一轮:`JSON.stringify(全部轨迹事件)` 与落库 `trace_events.data` 都 grep 不到 faux host / faux model id / faux search host / faux search modelId |
| 冒烟清单 | `docs/deploy-environments.md` 第 8 条 | 改成值级:从生产 `llm_config` / `websearch_config` 取当前 host 与 modelId,在两条流的原始字节里 grep,期望 0 命中;原来的字面词检查保留 |
| 文档 | `docs/security.md` §2 R-LEAK 补记(已写)· `rounds/BACKLOG.md` 两条关闭 · `docs/releases.md` 发版行 | |

**不交付**:前端改动(Timeline 对 `model_select` 行的处理走既有 `hasDetail` 路径)、系统提示改动、值级 sanitize 机制、存量回填、Tools 面板改动、MCP 工具变动。

## 验收

| # | 检查 | 命令 / 期望 | 结果 |
|---|---|---|---|
| 1 | 编译与测试 | `dev.ps1 check` / `dev.ps1 test` 全绿;新增用例 ≥ 4 条(A 一条、B 两条、集成一条) | ✅ check 绿;test 608 passed(34 文件)+ web `bun test lib` 28 passed;新增 **6** 条 |
| 2 | 通道 A 深度断言 | `events.test.ts`:完整 `Model` 对象进、`{type, source}` 出;`JSON.stringify(out)` 不含 provider / id / name / baseUrl 的**值** | ✅ 键集合 `["source","type"]`;`model` 的五个值(含 `apiKey`)与 `previousModel.id` 深度都搜不到 |
| 3 | 通道 B 值级断言 | `websearch.test.ts`:两条线的全部 progress `detail` 都不含 host / modelId | ✅ 两条线各一条;顺带断言不含 `cfg.provider` |
| 4 | 集成探针 | faux e2e:轨迹事件全量 JSON 与 `trace_events.data` 都 0 命中 | ✅ 五个探针值 × 两份载体 0 命中;另钉两把 key 与假 LLM 地址。**第一次跑抓出通道 C** |
| 5 | `/agent/ask` 不受影响 | 同一轮的对话流帧形状与 R-TOOLCARDS 契约一致(`ask.test.ts` 既有用例全过) | ✅ 全量 608 passed 含 `ask.test.ts` / `turn-recorder.test.ts`,零改动 |
| 6 | 前端零改动 | `git diff --stat main -- apps/web` 为空;本机 Timeline 上 `model_select` 行仍出现,详情为 `{type, source}` 或该行不可展开 | ✅ diff 为空;`hasDetail` 因 `source` 键为真 → 行仍可展开、详情显示 `{ source: "set" }`(既有行为)。另跑 `apps/web` 的 `tsc --noEmit` 通过 |
| 7 | 同族排查清单 | 「本轮实测」列出核过的文件与模板,每条标「改」或「干净」 | ✅ 10 行,3 改 7 干净 |
| 8 | 冒烟第 8 条 | 文档已改成值级;**发版当日在生产实跑一次**:两条流 0 命中,留证 `docs/releases.md` | ✅ 文档已改;生产实跑:一轮真实含 `web_search` 的对话(ask 5,221 B + trace 23,486 B),六个当前配置值(`api.64-186-228-154.sslip.io` / `64-186-228-154` / `gemini-3.8-flash-high` / `cliproxy-dmit` / `cliproxy-gemini` / `gpt-5.6-terra`)× 两条流 **0 命中**;字面词四项同样 0;该轮确实走了搜索(`web_search` 9 次、新文案在流里) |
| 9 | 文档同步 | `docs/security.md` §2 R-LEAK 补记与 §1 2026-09-07 补记那句已改;BACKLOG 两条标关闭;`docs/mcp.md` 不动(仍 51) | ✅ 补记已补通道 C;`docs/mcp.md` 未动(仍 51);BACKLOG 两条已 `[x]` 并注明发版关闭;`docs/releases.md` 的既存泄露那一节加了闭环句 |
| 10 | 发版 | 迁移版本不变(16);`docs/releases.md` 加一行;回滚 = 换回上一个镜像 tag | ✅ 生产 `e8ac83e`(所有者 2026-09-08 裁定直接发生产,不过 130);`migrate.sh` 确认 16 无待执行;五 Tab + 源码快照 + bun 1.4.0 + MCP 2026-07-28 全过;回滚点 `54f7356` |

## 禁止

- 不新增机制(值级 sanitize 白名单、事件级开关、配置项);审查若判「非阻塞」一律改文案 / 删代码。
- 不改前端、不改系统提示、不改 Tools 面板、不改 `/agent/ask` 帧契约、不动 `turn-recorder.ts`。
- 不回填存量 `trace_events`。
- 默认继承两条:不改前端页面样式(CLAUDE.md 规则 7);不加设计稿没有的功能(规则 8)。

## 代码审查

<!-- 完成后回填。审查路由见 CLAUDE.md「开发模式」:codex 独立审查,硬失败才降级 /code-review。 -->

- 审查方式:codex-companion `review --background --scope branch`(全量:branch diff against main),2026-09-08 对提交 `8a74add`。
  带给审查者的要求:只判定缺陷与严重级别,不展开设计方案;本轮是脱敏修补,**值级探针是否真的覆盖两条流**是重点。
- **第 1 轮:零 findings**。审查者结论原文:三条轨迹通道的 provider / model 元数据被一致地移除,事件与工具行为保持不变;
  新增的单元与端到端覆盖符合仓库的安全约束,未见阻塞性回归。它逐项核过的点包括:测试库隔离与 `tool_config` 复原、
  事件 `source` 字段的来源、`tool.execute` 的类型、限额预留在测试里的副作用、剩余的 provider / model 泄露路径。
- findings 处理:无(零 findings,不触发「有采纳整改 → 再发一轮复审」)。
- 结论:**PASS**(一轮收口;复审收口标准要求的「无阻塞性问题或明显 bug / 漏洞类 findings」自动满足)。

## 失败处理

同一验收项针对性整改后连续 2 次验证仍不过 → 写 `rounds/round-leak/BLOCKED.md`,停下呼人。禁止放宽验收标准自我通过。

## 本轮实测

### 同族排查清单(交付项;每条标「改」或「干净」)

| 文件 | 会出服务端的字符串模板 / 结构 | 结论 |
|---|---|---|
| `agent/websearch.ts` | `progress("request", …)` 拼 `hostname(cfg.baseUrl)` + `cfg.modelId` | **改** —— 固定文案「已向搜索网关发起请求」(两条线共用同一个 `progress()`,只有这一处,不是两处) |
| `agent/websearch.ts` | 其余三个 phase:`accepted`「上游已接单…」/ `searching`「网关正在检索(第 N 个检索事件)」/ `composing`「正在综述回答(已 N 字)」 | 干净(只有计数,无配置值) |
| `agent/tools.ts` | `web_search` 结果 `textResult(…, details)` 的 `provider` / `model` | **改** —— 只留 `citations`(通道 C,探针抓到) |
| `agent/tools.ts` | `WEB_SEARCH_PHASE_LABELS` / `GENERATE_IMAGE_PHASE_LABELS` / `SKILL_RUN_PHASE_LABELS`(面板文案) | 干净(「发起 / 已受理 / 检索中 / 综述中」等静态词) |
| `agent/tools.ts` | 三组固定失败文案(`SEARCH_*` / `IMAGE_*` / `RUN_*` 共 11 条)+ `webSearchResultHeader` | 干净(刻意不含上游细节,注释已写明) |
| `agent/tools.ts` | 其余 `textResult` 的 details:`notes_*` `{series,count}` / `source_*` `{sha,file,…}` / `skill_load` `{skill,scripts,chars}` / `skill_run` `{skill,script,exitCode,…}` / `session_rename` `{title,changed}` / `generate_image` `{imageId,contentType,bytes}` | 干净(skill / script / 文件路径是公开集合,不是配置面) |
| `agent/imagegen.ts` | `ImageGenPhase` 五段文案(`request` 只写「向生图网关发起请求(对话式 / 图片接口形态)」) | 干净 —— R-IMAGEGEN 起就写着「文案里不带 host / model」,本轮把 websearch 对齐它 |
| `agent/skill-runner.ts` | `submitted`「已提交到执行容器(skill/script)」/ `running`「运行中 Ns」/ `finished`「已结束(exit=…,…ms)」 | 干净(socket 路径 / 超时数字在构造处就被排除,文件头注释已写明) |
| `agent/events.ts` 其余派生项 | `context` / `agent_end` 只回 `messageCount`;`turn_end` / `message_*` 走 `summarizeMessage`(过 `previewText`);`tool_*` 走 `previewText`;白名单 `after_provider_response` 只放 `status`、`before_provider_*` 只放 `type` | 干净(`model_select` 是唯一把富对象并回白名单之外的那个,已删) |
| `agent/turn-recorder.ts` · `agent/ask.ts` | 会话区帧与 `messages.payload` | 干净(R-TOOLCARDS 已定「不带 model / provider / token / 费用」,本轮不动) |

### 本机验收结果

- `dev.ps1 check` 全绿;`dev.ps1 test` **608 passed(34 文件)** + web 侧 `bun test lib` 28 passed。
- 新增用例 **6 条**(任务卡要求 ≥ 4):`events.test.ts` 2 条(键集合恰为 `{type, source}` + 值级深度断言;`source` 闭集三值仍透出)、
  `websearch.test.ts` 3 条(Responses / `google_search` 两条线的 progress 值级断言 + 工具结果 `details` 断言)、`leak-e2e.test.ts` 1 条(集成探针)。
- 验收 6:`git diff --stat main -- apps/web` **为空**;`model_select` 行仍会出现,`hasDetail` 因 `source` 键为真 → 行仍可展开、详情显示 `{ source: "set" }`,与既有行为一致。

### 踩的坑

1. **探针比静态阅读强**:通道 A / B 的单元测试全绿之后,集成探针**第一次跑就红**,抓出了任务卡没列的通道 C
   (`tool_execution_end.resultPreview` 里 `"details":{"provider":"leakprobe-search-provider","model":"leakprobe-search-model-8b1d",…}`)。
   静态排查漏它的原因很具体:任务卡把范围写成「**字符串模板**」,而 details 是个结构化对象,不长得像模板。
2. **假搜索网关不能是本地 HTTP 服务**:外呼组白名单要求 https + host 精确匹配(`shared/outbound-hosts.ts`),
   本地 `http://127.0.0.1:<port>` 过不了 `parseAllowedBaseUrl`。给 `makeWebSearchTool` 开一个注入 fetch 的测试后门属于新增机制(审查边界),不做;
   最终换 `globalThis.fetch`(`imagegen.test.ts` 已有的同款做法),只拦白名单 host 上的请求,pi 打假 LLM 的那条照样走真 fetch。
3. **`tool_config` 的复原清单会拖垮后面的文件**:`vitest.config.ts` 是 `fileParallelism: false`,文件间不并行**但有顺序**;
   探针的 `afterAll` 一开始照抄了 `skills-e2e.test.ts` 的复原清单(那份还是 R-SOURCE 之前的),漏了迁移 016 的三行 `source_*`,
   于是 `source-tools.test.ts` 那条「种子默认开」读到空表而失败。按 `sandbox.test.ts` 的 `restoreToolSeeds` 补齐后全绿。
   (`skills-e2e.test.ts` 自己那份也缺这三行 —— 属既有问题,`rounds/BACKLOG.md` 已有同族一条,本轮不顺手改。)
