# Round GSEARCH — `web_search` 接 Gemini 原生 Google Search grounding(第二条线协议)

> 状态:已完成(验证成立 → 代码与测试落地 → codex 4 轮 / 4 条 / 零 high,整改后 PASS → 已合并 `main`,**待发版**)

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
   理由是探针 C / E:对 gemini 模型,「端点 × 工具声明」能拼出的四种组合里只有一种通,另外三种要么静默离线要么空正文
   —— 一个字段就没有非法组合(Responses + `web_search` 对 OpenAI 系模型照常可用,那是既有的第一条线)。
   闭集扩一项:迁移 015 改 CHECK,`mcp/tools.ts` 的 zod 同步,两边各有测试钉住。
2. **分叉只在两处**:拼请求体(`buildSearchRequestBody`)与读事件流(`handleChatEvent`);URL / headers / 白名单 / `redirect:"manual"` /
   双计时器 / 字节上界 / 脱敏 / 日限额与 Responses 线共用同一段代码。访客的 `query` 只落进 `messages[0].content`。
3. **来源从正文抽**(`extractLinkCitations`):网关不透出 grounding 元数据,来源只在模型写的链接里。
   纯字符串处理,只收 http(s)、去重、封顶 10 条,与 Responses 线的 `url_citation` 走同一个出口(「来源:」列表 + 轨迹计数)。
   **审查后收缩为只认 markdown 链接、不扫裸 URL**(见「代码审查」第 3 轮):散文里的裸 URL 没有确定的边界,三轮各一条边界
   findings 之后按「审查循环不是设计」的口径删掉裸 URL 扫描,而不是再补第四条判据。实测三个 gemini 模型给来源一律用 markdown 链接;
   裸 URL 仍在正文里交给模型,只是不进「来源」列表。**这是自行裁定,所有者可推翻**(推翻 = 恢复裸 URL 扫描并接受其边界判据)。
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

- 审查方式:codex `/codex:review`(全量 `branch diff against main`;PowerShell `Start-Process` 脱离启动 + Monitor 盯 `.out`,
  记忆 `codex-review-detached-launch` 的做法)
- **第 1 轮**(审 `5715e8a`,约 6 分钟):**1 条 P2** —— `extractLinkCitations` 把 URL 里的括号当分隔符,
  `…/wiki/Agent_(computing)` 这类来源会被截断成不可用的链接。**采纳**(改判断,不是新机制):两个正则的 URL 字符集改成
  「非分隔字符 | 一组配对 `(…)`」,只认一层(CommonMark 对链接目标的口径),落单的 `)` 仍是分隔符,markdown 链接的收尾括号与
  散文里 `(见 https://x)` 的包法都照常断开。补用例时又撞到同一函数的另一处边界:裸 URL 紧跟**全角逗号**会粘上
  (`…(computing),以及`),一并把全角标点列进裸 URL 的终止集(CJK **字母**不列 —— 模型偶尔写未编码的中文路径,截掉比粘上一个词更糟)。
  `websearch.test.ts` 59 用例全过。
- **第 2 轮**(全量,审 `506b196`,约 6 分钟):**2 条 P2,都采纳**(都是改判断)。
  ①裸 URL 的终止集里混进了 ASCII 的 `?` `:` `,`,查询串 / 端口会被截掉(`…/story?id=42` → `…/story`)。根因是**源码里的「全角标点」实际是半角**
  (od 实测 U+2C / U+3F / U+3A;是我输入时就打成了半角还是经手的工具折的,无法回溯),第 1 轮整改时就已发生而没察觉 ——
  测试没抓到,是因为当时的用例里没有一条 URL 带查询串或端口。整改:两个正则里的全角标点改写成显式的
  `，。；：！？、` 转义(用 node 脚本按字符码写入,不再经手打),ASCII 标点只在**末尾**剥;
  测试字符串里的全角逗号同样按字符码写入。补 3 组用例(查询串 / 端口 / 参数逗号;英文句末标点;markdown 目标里的查询串)。
  ②chat 流被干净关闭却没有 `finish_reason` 也没有 `[DONE]` 时,半截正文会被当成功返回。整改:记一个收尾信号
  (`finish_reason` 或 `[DONE]` 任一即算,网关实测两个都发),缺了就报 `upstream_failed`;**刻意不动 Responses 线**的
  「没有 completed 回落到累积 delta」—— 那是 R-WEBSEARCH 明确测过的取舍,而 chat.completion 的收尾信号是稳定的。补 2 组用例
  (中途关闭 → 失败;只发 `[DONE]` 的网关也算收尾)。`websearch.test.ts` 62 用例全过,`tsc --noEmit` 无新增错误。
- **第 3 轮**(只审整改 diff,`--base 506b196`,审 `d7e0570`,约 5 分钟):**1 条 P2** —— 裸 URL 后紧跟 ASCII 逗号 + 中文
  (`…Agent_(computing),以及`)时,逗号与后面的散文一起被吞进 URL;并指出第 2 轮把那条用例改成全角逗号掩盖了这个回归(属实)。
  **三轮各一条、全落在裸 URL 的边界判据上**(括号 / ASCII 标点 / ASCII 标点紧贴 CJK)—— 这正是记忆 `review-loop-is-not-design`
  与 CLAUDE.md「审查边界」说的那种模式:散文里的裸 URL 在中英混排下**没有确定的边界**,再补一条「ASCII 标点后紧贴 CJK 即止」
  只是第四条判据。**处置:不补判据,删掉裸 URL 扫描,只认 markdown 链接**(删代码;边界由 `(` `)` 确定)。所有者不在线,
  这是自行裁定并已写进方案 3 与 `docs/security.md` 补记,可推翻。用例改写为:markdown 链接(去重 / http(s) / 封顶 / 查询串端口完整 /
  一层括号)+ 「裸 URL 一律不抽」的反向断言。
- **第 4 轮**(只审整改 diff,`--base d7e0570`,审 `47363a7`,约 4 分钟):**零 findings** ——
  「实现 / 测试 / 安全文档 / 轮次文档一致地去掉了裸 URL 抽取,未发现新的正确性、安全或兼容性缺陷」。
- **结论:整改后 PASS**(4 轮 / 4 条 / 全 P2、零 high;3 条采纳整改 + 1 条按「审查循环不是设计」收缩方案)。
  收口状态的全量门禁:`dev.ps1 check` 过,`dev.ps1 test` api 26 文件 **553** 用例 + web 21 用例全绿;
  真实网关 E2E 在最终代码上复跑:`gemini-3.8-flash-high` 16.6 s / 3 条签名重定向来源,`gemini-pro-agent` 37.6 s / 3 条媒体链接。

## 失败处理

同一验收项针对性整改后连续 2 次验证仍不过 → 写 `rounds/round-gsearch/BLOCKED.md`,停下呼人。禁止放宽验收标准自我通过。

## 本轮实测

- **探针**:9 个探针、3 个模型,结论与 A/B 表见 [`verify.md`](verify.md)。核心说法成立;`{type:"web_search"}` 打 chat/completions
  是静默忽略(200)而非失败;`{type:"google_search"}` 回 `malformed_function_call`;`/responses` 两种 tools 对 gemini 都拿不到 grounding。
- **E2E(新代码直连真实网关)**:`gemini-3.8-flash-high` 11.2 s / 4 条签名重定向来源;`gemini-pro-agent` 28.3 s / 5 条媒体链接;
  Responses 线回归 `gpt-5.6-terra` 19.9 s / 9 个检索事件 / 2 条 `url_citation`。
- **门禁**:`dev.ps1 check` 过;`dev.ps1 test` api 26 文件 549 用例 + web 21 用例全绿(首版);收口状态 553 + 21。
- **全角标点会落成半角**:第 1 轮整改时手打进正则的「,;:!?」在源码里是 U+2C / U+3B / U+3A / U+21 / U+3F(od 实测),
  第 2 轮才被 codex 抓到;是输入时就半角还是经手的工具折的无法回溯。此后凡是源码里要写全角字符,一律用 node 按字符码写入并 od 验证
  (最终版删掉了裸 URL 扫描,源码里已不再有这类字符)。
- **发版后要用它**:经 `xray-admin-prod` 的 `websearch_provider_upsert{provider:"cliproxy-gemini", apiKey:<同一把>, baseUrl:同现行,
  modelId:"gemini-3.8-flash-high", toolType:"google_search", makeDefault:true}`;切回 `websearch_set_default{provider:"cliproxy-dmit"}` 即回滚,
  不用发版。迁移 015 随发版跑(`migrate.sh` 14 → 15)。
- **一次自己的失误**:曾加一条「迁移 015 改了 `tool_config.note`」的用例,跑在别的用例清空 `tool_config` 之后就读不到行 ——
  用例依赖执行顺序,删掉;CHECK 那条用例已足以证明迁移应用。
- **`tsc --noEmit` 有 3 处既有错误**(`catalog.test.ts:214` `socketPath`、`skill-runner.test.ts:368/369`),不在本轮改动文件里、
  不在门禁内(BACKLOG「门禁不做全量类型检查」条目),本轮不动。
- **开工时工作区里有一份未提交、不属于本轮的改动**(`runtime.ts` / `runtime.test.ts` / `agent/README.md`,系统提示词通用三条),
  本轮全程没碰它;它在本轮进行中由另一个会话提交成 `40c246d`(`main` 与本分支同时指向它),本分支对 `main` 的 diff 因此只含本轮文件。
