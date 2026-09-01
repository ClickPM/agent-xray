# Round WEBSEARCH — agent 联网搜索工具(第一个外呼组工具)

> 状态:进行中
>
> 轮次编号沿用 R-BUN / R-VISITOR 的横切轮命名(非 R0–R11 线性序列的一员)。
> 插在 R11 之前:上线之后再动 agent 的工具集,等于让生产环境当第一个试验场。

## 目标

给 pi agent 加一个 `web_search` 工具:经 **Responses API 网关**在服务端完成检索与综述,
返回一段带来源的答案;端点/凭据/限额经 **MCP 管理面**配置;搜索的**过程**在右栏三视图里看得见。

可证伪:配好 provider 并开启工具后,问一个模型知识截止之后的问题,
① 对话区给出带来源链接的答案;② 右栏 Timeline 出现
`tool_execution_start · web_search` → `tool_execution_update · web_search ×N` → `tool_execution_end · web_search`;
③ SSE 原始流里搜不到 `Authorization` / key 明文。

## 前置

- R6(MCP 管理面 + `ConfigEncryptionKey` 加密入库)、R7(工具注册与 `tool_config`、`daily_quota`)已完成
- 需要一个**目标域白名单内**的搜索网关凭据(DeepSeek 或自建 AI 网关),经 MCP 写入,不入 Git
- 130 预发可用(R9/R-VISITOR 留下的 compose 形态)

## 范围裁定(开工前确认,写在这里免得后面反复)

| 问题 | 裁定 | 理由 |
|---|---|---|
| 规则 8(不实现设计稿没有的功能)是否被触发 | **否** | `design/Agent Runtime Workbench.dc.html:1162` 就画着 `mkTool('web_search', 'MCP', '外呼', '联网搜索(服务端 key · 域白名单 · 计入日限额)', 'on')`;`docs/security.md` §1 开篇与第 4 层也早写了「后续生图、联网搜索等插件」。本轮是**补齐既定边界**,不是长新功能 |
| 是否集成 Perplexity | **不做**(所有者裁定) | 参考插件里的 3 个 perplexity 工具是收费直连,与本站「服务端持凭据 + 域白名单」的形态是另一套取舍。只取插件的第 1 个工具(经网关的 `web_search`) |
| DeepSeek 兼容 | **做,且零分支**(所有者追加要求) | DeepSeek Responses API 与网关是**同一套协议**(`POST {base}/v1/responses`、`tools:[{type:"web_search"}]`、`stream:true`、`response.output_text.delta`/`completed`/`failed`)。差异只有 baseUrl / modelId / toolType 三个**配置字段**,不需要第二条代码路径 |
| `tool_config` 里的初始状态 | **默认关** | 新环境部署完还没配 provider,注册阶段本来就会丢弃它;默认关把「没配就没有」变成显式的一件事 |
| 超时默认值 | **总 180s / 空闲 45s**(库级 CHECK 上界 300s / 120s) | 贴着实测:网关侧「检索 + 综述」常越过 90s。代价已认——最坏访客等 3 分钟且占着一个会话名额 |
| 前端是否改动 | **零改动**(规则 7) | `apps/web/lib/trace-view.ts` 的三个投影都是泛型的:行名取 `eventType` + `data.toolName`,详情取白名单字段;Lifecycle 的 `tool_call` / `tool_execution` / `tool_result` 三个节点本就存在(此前恒为 pending)。搜索流程靠 pi 的 `onUpdate` → `tool_execution_update`(34 事件之一)进视图,不新造事件、不动组件 |

## 交付物

**文档(规则 9:先改文档)**
- `docs/security.md` —— 威胁模型加第 5 条(外部内容注入);§1 第 1 层加「工具分两组」表 + **外呼组六条附加约束**;第 2 层表清单补 `websearch_config`;第 4 层加 R-WEBSEARCH 落地补记;§3 加 websearch key 口径
- `ROUNDS.md` —— 进度表加行 + 本轮拆解
- `rounds/round-websearch/round-websearch.md` —— 本卡

**后端**
- `apps/api/agent/migrations/008_websearch.up.sql` —— `websearch_config` 表 + `daily_quota.searches` 列 + `web_search` 启停种子(默认关)
- `apps/api/agent/secrets.ts` —— `ConfigEncryptionKey` 声明抽出(现在有两个消费方)
- `apps/api/agent/websearch-config.ts` —— 运行期 websearch 配置的只读来源(读不到回 `null` 而非抛)
- `apps/api/agent/websearch.ts` —— 外呼实现:域白名单 / `responsesUrl` / SSE 解析 / 双计时器 / 字节上限 / 来源抽取 / **阶段上报**
- `apps/api/agent/tools.ts` —— `makeWebSearchTool` 工厂 + `ToolRefusal` + `loadEnabledTools` 消费 websearch 配置(含指纹)
- `apps/api/agent/quota.ts` —— `reserveSearch`(一条带条件的原子 UPSERT)
- `apps/api/agent/runtime.ts` —— 重建日志改打工具名(指纹现在含 sha256)
- `apps/api/mcp/store.ts` + `apps/api/mcp/tools.ts` —— 四个 `websearch_*` 管理 tool

**测试**
- `apps/api/agent/websearch.test.ts`(注入 fetch,不打真实网络)
- `apps/api/agent/sandbox.test.ts` / `mcp.test.ts` 增量用例

## 验收

| # | 检查 | 命令 / 期望 |
|---|---|---|
| 1 | 编译与测试全绿 | `dev.ps1 check` + `dev.ps1 test` 全过 |
| 2 | 迁移 008 可施加且幂等 | 本机 `dev.ps1` 起库自动跑;`deploy/migrate.sh` 在 130 上重跑不报错 |
| 3 | **域白名单挡得住** | 单测:`https://evil.tld/v1`、`https://api.deepseek.com.evil.tld`、`http://api.deepseek.com`(非 https)、带内嵌凭据的 URL 全部被拒;MCP 写入侧同样拒 |
| 4 | **访客控不到网络原语** | 静态核验 + 单测:`runWebSearch` 的 URL/headers/model/toolType 只来自配置;`query` 只进 body 的 `input`,且有 300 字上限(schema `maxLength`) |
| 5 | SSE 解析正确 | 单测:delta 累积 / `response.completed` 优先 / `response.failed` 与 `response.incomplete` 报错 / `[DONE]` 与半条 JSON 不炸 / 非 `text/event-stream` 时按普通 JSON 降级 |
| 6 | 双计时器与字节上限 | 单测:空闲超时与总超时分别产出对应 `kind`;超过 4 MiB 中断 |
| 7 | **凭据不外泄** | 单测:任何抛出的 message 与 `details` 都不含 apiKey;`/trace/stream` 抽查无 `Authorization`;`websearch_providers_list` 只回掩码 |
| 8 | **限额生效且原子** | 单测:`daily_search_limit=N` 时第 N+1 次 `reserveSearch` 回 false;并发调用不超发 |
| 9 | 未配 provider 时不注册 | 单测:`tool_config` 开着 `web_search` 但表空 → `loadEnabledTools` 丢弃并记日志,`names` 不含它 |
| 10 | 配置变更下一轮生效 | 单测:改 websearch 配置 → `EnabledTools.fingerprint` 变化(会话据此重建) |
| 11 | **右栏看得见搜索流程** | 130 实跑:Timeline 出现 `tool_execution_update · web_search ×N`;Lifecycle 的 `tool_call` / `tool_execution` / `tool_result` 三节点点亮;进度条数受 `MAX_PROGRESS_EVENTS`(30)封顶 |
| 12 | MCP 四个 tool 可用 | 130 上 `websearch_provider_upsert` → `websearch_providers_list` → `websearch_set_default` → `websearch_provider_delete` 全通,写操作进 `mcp_audit` |
| 13 | **DeepSeek 与网关两条配置都跑得通** | 130 实跑:同一份代码分别配 `api.deepseek.com` 与自建网关,各搜一次都拿到带来源的答案 |
| 14 | 前端零改动 | `git diff --stat apps/web/` 为空 |

## 禁止

- 不改前端页面样式(规则 7)。本轮**连组件都不碰**:搜索流程走既有的 34 事件通路进视图
- 不加设计稿没有的功能:不做 Perplexity、不做「抓指定网址」、不做搜索结果缓存表
- **不给工具任何形式的 URL / host / header 入参**——那是 SSRF,不是搜索
- 不把 websearch 的 token 折进 `daily_quota.tokens`(那是聊天 provider 的账)
- 不在工具体内读 `process.env` / 读库 / 解密

## 代码审查

- 审查方式:`/codex:review --background`(changes against `main`;前两轮用全量范围)
- 结论:**第 1 轮 3 条 findings(2×P1 + 1×P2)全部采纳整改**,复审待发

### 第 1 轮(2026-09-01,基线 `4f338e1`)

| # | 级别 | findings | 核验 | 处理 |
|---|---|---|---|---|
| 1 | P1 | `fetch` 默认跟随重定向,而白名单只校验原始 URL —— 白名单内端点上的开放重定向可把请求送到白名单外/内网 | **属实,且比描述更严重**:bun 实测同源重定向下 `Authorization: Bearer …` **原样跟过去**(见下) | **采纳**:`redirect: "manual"` + 3xx 单独判为 `kind:"redirected"`。判据写进 `docs/security.md` §1 外呼组约束 2 |
| 2 | P1 | `systemPromptFor` 把 `web_search` 混进「它们不能访问服务器或网络」那句;且 `promptSnippet`/`promptGuidelines` 走 `systemPromptOverride` 后送不到 | **属实**。前半:提示词逐字在说这个联网工具不能联网。后半:pi 源码 `resource-loader.js:383` 是 `override ? override(base) : base`,我们的实现忽略入参 → base 里那两节丢失 | **采纳**:提示词按两组分段;注入防御从 `promptGuidelines` 搬进 `systemPromptFor`,并在工具定义处留注释挡住「再加回去」 |
| 3 | P2 | 非流式 JSON 走 `res.json()`,整体缓冲、绕开 `MAX_RESPONSE_BYTES` | **属实**,且同一问题还存在于错误体的 `res.text()`(codex 没提到那一处) | **采纳**:抽 `readTextCapped`,流式 / 非流式 / 错误体三条路径共用同一个上界 |

**三条都补了回归用例**(整改后 `dev.ps1 test` **12 文件 / 260 项全过**,较整改前 +7):
`redirect` 模式与 3xx 拒绝 · 非流式 JSON 的 4 MiB 上界 · 非 JSON 非 SSE 回 `upstream_failed` ·
`systemPromptFor` 分组四条(含「教程库那一句的名字列表里不许出现 `web_search`」)。

**这一轮 codex 的价值主要在第 2 条**:那是个**不会让任何东西报错**的缺陷 —— 编译过、测试过、
搜索也偶尔能用,只是模型收到一条自相矛盾的高优先级指令,表现为「时灵时不灵」。
本机门禁与我自己的用例都照不到它,因为它根本不在代码的行为里,在提示词的语义里。

## 失败处理

同一验收项针对性整改后连续 2 次验证仍不过 → 写 `rounds/round-websearch/BLOCKED.md`,停下呼人。

## 本轮实测

### 本机门禁(2026-09-01)

- `dev.ps1 check`:通过(迁移 008 施加成功,app 起得来)
- `dev.ps1 test`:**12 文件 / 260 项全过**(本轮新增 27 项;基线 233)。
  其中 7 项是 codex 第 1 轮 findings 的回归用例,见「代码审查」段
- `git diff --stat apps/web/` **为空** → 验收 #14(前端零改动)通过

### 踩到的坑

1. **测试抓到一个真凭据泄漏**(验收 #7 的用例直接红)。`runWebSearch` 原先把上游 4xx 的
   响应体原样拼进 `WebSearchError.message`,而**网关会把请求头回显进错误体** ——
   于是明文 key 进了错误对象。
   - 第一反应「调用点已经 `safeErrorText` 了」是错的:那只保证**写进日志的那一行**干净,
     而一个带着凭据的 `Error` 会被传递、被别处 catch、被将来某个人直接 `console.error(err)`。
   - 修法是**在构造错误的地方就抹掉**(`redactUpstream`),而且要两道:`scrubString` 打通用形态
     (`sk-` 前缀 / `Bearer …`),再叠一道**本次 key 的精确替换** —— 自定义网关的 key 常是纯十六进制,
     通用模式一个都匹配不上。补了一条专门的用例钉住后半道。
2. **zod 4 静默吞掉 `.refine` 的「函数形式 params」**(自查时抓到,没等到审查)。
   `.refine(check, (v) => ({ message: … }))` 是 zod **3** 的写法;zod 4.5.4 下它
   **不报错、不抛**,只是把错误消息退回成一句 `"Invalid input"`(bun 实测)。
   后果是 `websearch_provider_upsert` 拒掉一个坏 baseUrl 时,所有者看到的是
   「Invalid input」而不是「host 不在白名单 / 没写 https / 带了 query」——
   而那句理由正是这个 tool 最有用的产出。改用 `superRefine` + `ctx.addIssue`。
   - **连带补了一层此前完全没有的测试**:`mcp.test.ts` 原来只测 store 函数,
     一个字都照不到 MCP 的入参 schema。新增用假 server 收下 `registerTools` 的注册配置、
     再拿**真 schema** 去 parse 的用例组(baseUrl 六种坏形态 / toolType 白名单 /
     超时上下界与库 CHECK 一致),这类「schema 静默不生效」以后会红。
3. **`.secrets.local.cue` 不随 worktree 走**(gitignored)。`loadActiveWebSearchConfig` 要解密,
   没有 `ConfigEncryptionKey` 时它会走「解不开 → 返回 null」的分支 —— 正例测不了。
   从主 checkout 拷一份进 worktree 即可(仍不入库)。顺带发现该文件的注释里早就写着
   `apps/api/{mcp,agent,metrics}/secrets.ts`,而 agent 侧此前把声明内联在 `llm-config.ts` 里;
   本轮抽出 `agent/secrets.ts` 之后那句注释才成立。
4. **`dev.ps1 gen` 的产物有无关漂移,已回退**:`apps/web/lib/api-client.ts` 只变了两处 ——
   app slug(`936eu` → `hvcca`,BACKLOG 里 R3 那条已记:slug 随生成所在 checkout 变)
   与一段 R-VISITOR 时期没跟着重新生成的过期注释。本轮**没有新增任何端点**,
   所以整份回退,不让它污染审查范围。

### 与计划的偏离

- **域白名单落在 `shared/websearch-hosts.ts` 而不是 `agent/websearch.ts`**:写入侧(mcp)与调用侧(agent)
  都要用同一份判据,而 `docs/security.md` §4 要求两个面互不 import —— 与当初把 `redact.ts`
  下沉到 `shared/` 是同一个理由。
- **多了一个 `ToolRefusal`**:`guarded` 原先把**所有**异常换成同一句「查询失败」。对搜索来说
  「今天额度用完了」和「上游超时」是模型应当据以改变策略的信息(别重试、改用已有知识),
  而不是又一次偶发失败。文案仍是本文件写死的常量、仍走 `throw`(`isError` 仍为 true),
  安全性质与原来完全相同。
- **`store.ts` 里重复了两个超时默认值**(为了在写入前判 `idle > total`,给所有者一句能行动的话,
  而不是把 CHECK 冲突变成「详见服务端日志」)。重复常量的一致性**由测试钉住**:
  `mcp.test.ts` 从 `information_schema.columns` 读列默认值比对,漂移就红。

### codex 第 1 轮实测补记

`fetch` 的三种 `redirect` 模式在 bun 下的实际行为(本地起 http server 实测,
不是照着规范推的)——这条决定了修法选 `manual` 而不是 `error`:

```
follow → status 200  body: {"reachedEvil":"/evil","auth":"Bearer sk-secret"}   ← 凭据跟着跳过去了
manual → status 302  type default                                              ← status 可读,能给确定的错误
error  → THREW TypeError UnexpectedRedirect ...                                ← 只能拿到一个笼统异常
```

选 `manual`:`error` 抛出的 TypeError 会掉进通用的 `upstream_failed` 分支,
「网关配了个重定向」于是看起来像一次普通的上游报错,排查时分不出来。

<!-- 130 预发留证待回填 -->
