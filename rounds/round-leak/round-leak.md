# Round R-LEAK — 公开轨迹流的配置面泄露修补(`model_select` 派生字段 + `web_search` 阶段文案)

<!-- 保存为 rounds/round-leak/round-leak.md;该轮其他管理产出放同一目录。 -->

> 状态:**文档就绪、未开工**(所有者裁定 2026-09-08:下一阶段拆三轮,本轮第一、先于 R-CROSSLINK / R-CARDS)。
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
| 同族 | `apps/api/agent/imagegen.ts` 等 | 排查结果:有则同法改文案,无则在任务卡记「核过、干净」 |
| 单元测试 | `apps/api/agent/events.test.ts` | 新用例:给 `model_select` 一个完整 `Model` 对象(provider / id / name / baseUrl 都填),sanitize 后**深度**找不到这四个值,键集合恰为 `{type, source}` |
| 单元测试 | `apps/api/agent/websearch.test.ts` | 新用例两条(Responses / `google_search` 各一):收集全部 `onProgress` 的 `detail`,断言不含 `hostname(cfg.baseUrl)` 与 `cfg.modelId`(值级,不是查字面词) |
| 集成探针 | `apps/api/agent/leak-e2e.test.ts`(或并进 `skills-e2e.test.ts`) | faux provider + faux 搜索网关驱动真实 pi loop 一轮:`JSON.stringify(全部轨迹事件)` 与落库 `trace_events.data` 都 grep 不到 faux host / faux model id / faux search host / faux search modelId |
| 冒烟清单 | `docs/deploy-environments.md` 第 8 条 | 改成值级:从生产 `llm_config` / `websearch_config` 取当前 host 与 modelId,在两条流的原始字节里 grep,期望 0 命中;原来的字面词检查保留 |
| 文档 | `docs/security.md` §2 R-LEAK 补记(已写)· `rounds/BACKLOG.md` 两条关闭 · `docs/releases.md` 发版行 | |

**不交付**:前端改动(Timeline 对 `model_select` 行的处理走既有 `hasDetail` 路径)、系统提示改动、值级 sanitize 机制、存量回填、Tools 面板改动、MCP 工具变动。

## 验收

| # | 检查 | 命令 / 期望 |
|---|---|---|
| 1 | 编译与测试 | `dev.ps1 check` / `dev.ps1 test` 全绿;新增用例 ≥ 4 条(A 一条、B 两条、集成一条) |
| 2 | 通道 A 深度断言 | `events.test.ts`:完整 `Model` 对象进、`{type, source}` 出;`JSON.stringify(out)` 不含 provider / id / name / baseUrl 的**值** |
| 3 | 通道 B 值级断言 | `websearch.test.ts`:两条线的全部 progress `detail` 都不含 host / modelId |
| 4 | 集成探针 | faux e2e:轨迹事件全量 JSON 与 `trace_events.data` 都 0 命中 |
| 5 | `/agent/ask` 不受影响 | 同一轮的对话流帧形状与 R-TOOLCARDS 契约一致(`ask.test.ts` 既有用例全过) |
| 6 | 前端零改动 | `git diff --stat main -- apps/web` 为空;本机 Timeline 上 `model_select` 行仍出现,详情为 `{type, source}` 或该行不可展开 |
| 7 | 同族排查清单 | 「本轮实测」列出核过的文件与模板,每条标「改」或「干净」 |
| 8 | 冒烟第 8 条 | 文档已改成值级;**发版当日在生产实跑一次**:两条流 0 命中,留证 `docs/releases.md` |
| 9 | 文档同步 | `docs/security.md` §2 R-LEAK 补记与 §1 2026-09-07 补记那句已改;BACKLOG 两条标关闭;`docs/mcp.md` 不动(仍 51) |
| 10 | 发版 | 迁移版本不变(16);`docs/releases.md` 加一行;回滚 = 换回上一个镜像 tag |

## 禁止

- 不新增机制(值级 sanitize 白名单、事件级开关、配置项);审查若判「非阻塞」一律改文案 / 删代码。
- 不改前端、不改系统提示、不改 Tools 面板、不改 `/agent/ask` 帧契约、不动 `turn-recorder.ts`。
- 不回填存量 `trace_events`。
- 默认继承两条:不改前端页面样式(CLAUDE.md 规则 7);不加设计稿没有的功能(规则 8)。

## 代码审查

<!-- 完成后回填。审查路由见 CLAUDE.md「开发模式」:codex 独立审查,硬失败才降级 /code-review。 -->

- 审查方式:codex `/codex:review --background`(前两轮全量;第 3 轮起 `--base <上一轮已审提交>`)。
  带给审查者的要求:只判定缺陷与严重级别,不展开设计方案;本轮是脱敏修补,**值级探针是否真的覆盖两条流**是重点。
- findings 处理:<逐条:采纳整改 / 不采纳及理由>
- 结论:<PASS | 整改后 PASS>

## 失败处理

同一验收项针对性整改后连续 2 次验证仍不过 → 写 `rounds/round-leak/BLOCKED.md`,停下呼人。禁止放宽验收标准自我通过。

## 本轮实测

<!-- 完成后回填:同族排查清单(文件 · 模板 · 改 / 干净)、生产冒烟第 8 条的值级结果、踩的坑 -->

| 文件 | 会出服务端的字符串模板 | 结论 |
|---|---|---|
| `agent/websearch.ts` | | |
| `agent/imagegen.ts` | | |
| `agent/skill-runner.ts` | | |
| `agent/tools.ts` | | |
| `agent/events.ts` 其余派生项 | | |
