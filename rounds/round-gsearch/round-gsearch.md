# Round GSEARCH — `web_search` 接 Gemini 原生 Google Search grounding(第二条线协议)

> 状态:进行中(验证成立 → 代码与测试已落地 → 待 codex 审查)

## 目标

`web_search` 工具在**不新增工具、不改前端、六条外呼组约束一条不松**的前提下多支持一条线协议:
provider 的 `toolType` 配成 `google_search` 时,请求打 `{baseUrl}/v1/chat/completions` + `tools:[{google_search:{}}]`,
检索与综述由 Google 后端在服务端完成(网关上 `owned_by=antigravity` 的 gemini-* 模型),来源从正文里抽。

可证伪:同一网关、同一把 key,`toolType=google_search` + `gemini-3.8-flash-high` 时 `runWebSearch` 返回带今日日期与
`vertexaisearch.cloud.google.com/grounding-api-redirect/…` 来源的答案;`toolType=web_search` 的既有 Responses 线行为一字不变。

## 前置

- 所有者 2026-09-07 给出「CPA 端点下 Antigravity Gemini 的 Google Search 发起机制」汇总,要求**先验证、成立再扩展**。
  探针与结论见 [`verify.md`](verify.md):核心说法成立;两处与说法不同(`{type:"web_search"}` 打 chat/completions 是**静默忽略**
  而非失败;流式下 grounding 偶发无结果)。
- R-WEBSEARCH(迁移 008、`websearch.ts`)已落地。生产 provider `cliproxy-dmit` 当前是 `gpt-5.6-terra` + `web_search`(Responses 线),
  本轮不动它;本机 `CLIPROXY_API_KEY` 与生产是同一把 key、同一个网关,E2E 可直连。

## 方案(自行裁定,理由写清)

1. **线协议由 `toolType` 唯一决定**(`wireOf`):`google_search` → chat/completions;其余 → Responses。**不加 `apiStyle` 一类的开关**。
   理由是探针 C / E:两个字段能拼出的四种组合里只有一种通,另外三种要么静默离线要么空正文 —— 一个字段就没有非法组合。
   闭集扩一项:迁移 015 改 CHECK,`mcp/tools.ts` 的 zod 同步,两边各有测试钉住。
2. **分叉只在两处**:拼请求体(`buildSearchRequestBody`)与读事件流(`handleChatEvent`);URL / headers / 白名单 / `redirect:"manual"` /
   双计时器 / 字节上界 / 脱敏 / 日限额与 Responses 线共用同一段代码。访客的 `query` 只落进 `messages[0].content`。
3. **来源从正文抽**(`extractLinkCitations`):网关不透出 grounding 元数据,来源只在模型写的 markdown 链接与裸 URL 里。
   纯字符串处理,只收 http(s)、去重、封顶 10 条,与 Responses 线的 `url_citation` 走同一个出口(「来源:」列表 + 轨迹计数)。
4. **不发 `max_tokens`**:与 Responses 线同一取舍,正文长度由 `MAX_ANSWER_CHARS` / 字节上界管,时长由双计时器管。
5. **不新增 MCP 工具(仍 46)**、不新增端点、不改工具目录、前端零改动;`tool_config.web_search` 的说明文案在迁移里改成不指定协议的说法。
6. **规则 9 先改文档**:`docs/security.md` §1 追加 R-GSEARCH 补记(线协议 / 六条约束不变 / 来源从正文抽 / 已认的两条残余)再动代码。

## 交付物

| 文件 | 改动 |
|---|---|
| `docs/security.md` | §1 追加 R-GSEARCH 落地补记(**先于代码**) |
| `apps/api/agent/migrations/015_websearch_google.up.sql` | `tool_type` CHECK 闭集扩 `google_search`;改 `tool_config.web_search` 的 note |
| `apps/api/agent/websearch.ts` | `wireOf` / `chatCompletionsUrl` / `buildSearchRequestBody` / `extractChatText` / `extractLinkCitations`;`runWebSearch` 按线分叉 |
| `apps/api/agent/websearch-config.ts` | `toolType` 注释 |
| `apps/api/mcp/tools.ts` | `websearch_provider_upsert` 的 `toolType` zod 闭集与说明 |
| `apps/api/agent/websearch.test.ts` | 新增三组用例(线选择 / chunk 事件流 / 正文抽来源) |
| `apps/api/mcp/mcp.test.ts` | CHECK 与 zod 的闭集用例扩 `google_search` |
| `docs/mcp.md` | §6.4 `websearch_provider_upsert` 的 `toolType` 说明(规则 13;工具总数仍 46) |
| `rounds/round-gsearch/verify.md` | 探针留证 |
| `ROUNDS.md` | 进度表行 + 拆解段 |

## 验收

| # | 检查 | 命令 / 期望 |
|---|---|---|
| 1 | 编译与测试全绿 | `dev.ps1 check`;`dev.ps1 test`(api 26 文件 549 用例 + web 21 用例) |
| 2 | 真实网关 E2E(google 线) | scratchpad `e2e.ts` 直连 `runWebSearch`:`gemini-3.8-flash-high` 返回今日新闻 + vertexaisearch 来源 |
| 3 | 真实网关回归(Responses 线) | 同脚本 `gpt-5.6-terra` + `web_search`(生产现行配置)行为不变:有 searching 阶段、有 `url_citation` |
| 4 | 迁移 015 | 测试库从零迁移通过(列级 CHECK 的自动命名对得上);闭集三值放行、`google` / `google_search_2026_01_01` 拒 |
| 5 | MCP 入参 | zod 放行 `google_search`、拒近似写法;`websearch_provider_upsert` 说明写明两条线 |
| 6 | 访客控不到网络原语 | 请求体 keys 恰为 `messages` / `model` / `stream` / `tools`,query 只在 `messages[0].content`,`tools` 写死 |
| 7 | 凭据不外泄 | 事件流 `error` 带 key 时错误文本已脱敏;进度文案不含 key |
| 8 | 文档 | security.md 补记先于代码;docs/mcp.md 工具总数仍 46、`toolType` 说明同步(规则 13) |
| 9 | 前端零改动 | `git diff --stat` 不含 `apps/web` |

## 禁止

- 不新增工具 / 画板 / MCP 工具 / 端点;不碰 `design/`;不改前端(规则 7 / 8)。
- 不为「grounding 是否真的发生」做二次判定或加信号字段:网关不透出,猜就是编。
- 不维护模型名白名单:哪个 modelId 配 `google_search` 由所有者经 MCP 决定;配错的表现是「拿到离线答案」而不是报错(已写进 `docs/mcp.md`)。
- 不改进度上报的阶段集合与文案(request 文案外显 hostname / model 是 BACKLOG 已记的跨轮次问题,不当场顺手改)。
- 不给 google 线单独加超时 / 限额字段:两条线共用 `websearch_config` 那几列。

## 代码审查

<!-- 完成后回填。 -->

- 审查方式:codex `/codex:review`(全量 `branch diff against main`)
- findings 处理:待回填
- 结论:待回填

## 失败处理

同一验收项针对性整改后连续 2 次验证仍不过 → 写 `rounds/round-gsearch/BLOCKED.md`,停下呼人。禁止放宽验收标准自我通过。

## 本轮实测

- **探针**:9 个探针、3 个模型,结论与 A/B 表见 [`verify.md`](verify.md)。核心说法成立;`{type:"web_search"}` 打 chat/completions
  是静默忽略(200)而非失败;`{type:"google_search"}` 回 `malformed_function_call`;`/responses` 两种 tools 对 gemini 都拿不到 grounding。
- **E2E(新代码直连真实网关)**:`gemini-3.8-flash-high` 11.2 s / 4 条签名重定向来源;`gemini-pro-agent` 28.3 s / 5 条媒体链接;
  Responses 线回归 `gpt-5.6-terra` 19.9 s / 9 个检索事件 / 2 条 `url_citation`。
- **门禁**:`dev.ps1 check` 过;`dev.ps1 test` api 26 文件 549 用例 + web 21 用例全绿。
- **一次自己的失误**:曾加一条「迁移 015 改了 `tool_config.note`」的用例,跑在别的用例清空 `tool_config` 之后就读不到行 ——
  用例依赖执行顺序,删掉;CHECK 那条用例已足以证明迁移应用。
- **`tsc --noEmit` 有 3 处既有错误**(`catalog.test.ts:214` `socketPath`、`skill-runner.test.ts:368/369`),不在本轮改动文件里、
  不在门禁内(BACKLOG「门禁不做全量类型检查」条目),本轮不动。
- **开工时工作区里有一份未提交、不属于本轮的改动**(`runtime.ts` / `runtime.test.ts` / `agent/README.md`,系统提示词通用三条),
  本轮全程没碰它;它在本轮进行中由另一个会话提交成 `40c246d`(`main` 与本分支同时指向它),本分支对 `main` 的 diff 因此只含本轮文件。
