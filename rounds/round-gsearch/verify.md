# R-GSEARCH · 探针验证留证(2026-09-07)

所有者给出一份「DMIT CLIProxyAPI(CPA)端点下 Antigravity Gemini 模型的 Google Search 发起机制」汇总,
要求**先验证、验证成立再扩展本项目的 websearch**。本文是验证过程与结论;探针脚本 `probe.mjs` 在会话 scratchpad 里,
不入库(它读 `CLIPROXY_API_KEY` 环境变量,输出里 key 一律替换成 `<KEY>`)。

- 网关:`https://api.64-186-228-154.sslip.io/v1`(生产三组 provider 都指向它,`XRAY_WEBSEARCH_EXTRA_HOSTS` 已含此域)
- 统一提示词:「今天是几年几月几日?查询今天(24 小时内)的最新国际头条 2 条,每条附新闻来源的可点击 URL。」
- 判据:①正文里的「今天」是不是真实日期(2026-09-07);②有没有 `vertexaisearch.cloud.google.com/grounding-api-redirect/…`
  签名重定向链接(模型编不出来的强证据);③`finish_reason` / 错误形态。

## A/B 对照表

| 探针 | 端点 + `tools` | 模型 | 结果 | 耗时 |
|---|---|---|---|---|
| **A** | `/chat/completions` + `[{google_search:{}}]` | `gemini-pro-agent` | ✅ 日期 **2026-09-07**;两条当日新闻(美特使基辅之行 / 喀拉喀托之子火山);来源是媒体**首页**链接(theguardian.com/world、aljazeera.com) | 38.1 s |
| **A** | 同上 | `gemini-3.8-flash-high` | ✅ 日期 2026-09-07;**2 条 vertexaisearch 签名重定向链接** | 11.4 s |
| **B** | 无 `tools` | `gemini-pro-agent` | ❌ 自称 2024-05-21,新闻全是 2024 年的(莱希坠机 / ICC 逮捕令) | 43.8 s |
| **C** | `/chat/completions` + `[{type:"web_search"}]` | `gemini-pro-agent` | ❌ **HTTP 200 但静默忽略**:2024-05-20,内容同 B | 18.7 s |
| **D** | `/responses` + `[{type:"web_search"}]`(**本项目现行线**) | `gemini-pro-agent` | ❌ 2024-05-24;`annotations` 存在但为空,来源是媒体栏目首页 | 43.1 s |
| **E** | `/responses` + `[{google_search:{}}]` | `gemini-pro-agent` | ❌ 2024-05-20 | 16.8 s |
| **G** | `/chat/completions` + `[{type:"google_search"}]` | `gemini-3.8-flash-high` | ❌ `finish_reason=malformed_function_call`,空正文 | 2.9 s |
| **S** | 流式 A(`stream:true`) | `gemini-pro-agent` ×2 · `gemini-3.8-flash-high` ×1 | ✅ 三次日期都对;3.8-flash 带签名链接;pro-agent **第一次** grounding 后端无结果(模型自述「搜索服务未能返回任何结果」,`total_tokens` 20033 说明上下文里确实注入过东西),第二次正常 | 8.8–59.9 s |
| **F** | `GET /models` | — | 20 个模型,`owned_by=antigravity` 12 个,与说法里的清单一致 | — |

一个旁证:带 `google_search` 时 `prompt_tokens` 从 35 跳到 268–344(且 `cached_tokens` 230),不带时是 35 ——
上游在服务端往请求里注入了 grounding 相关的上下文,与「服务端单轮闭环」的描述一致。

## 结论

1. **说法的核心成立**:在 CPA 的 `/v1/chat/completions` 上,`tools:[{google_search:{}}]` 是**唯一**能让 Antigravity Gemini
   模型发起 Google Search grounding 的写法;检索在服务端完成,一次往返,客户端不处理 `tool_calls`。流式与非流式都通。
2. **两处与说法不同**:
   - `{type:"web_search"}` 打 chat/completions 不是「失败 / 拒答」,是**静默忽略**(200、正文停在训练截止期)。这比失败更糟 ——
     没有任何错误信号。所以本项目**不能**做成「apiStyle 开关 + toolType 自由组合」,否则会长出一种「配了却静默不联网」的组合。
   - 流式下 grounding 后端**偶发无结果**(3 次里 1 次),模型会在正文里自述。响应里没有「是否真的检索了」的信号,本项目不做二次判定。
3. **对本项目的直接含义**:现行的 `/v1/responses` + `web_search` 线对 gemini 模型**拿不到 grounding**(D、E),
   要接 Google search 必须开第二条线协议,而不是换个 modelId。生产现在的 `gpt-5.6-terra` + `web_search` 走 Responses 线是通的
   (E2E 回归 19.9 s、9 个检索事件、2 条 `url_citation`),本轮不动它。
4. **哪些模型能用**:说法里的三个梯队与实测一致 —— `gemini-3.8-flash-high` / `gemini-3.1-flash-lite` 给签名重定向链接,
   `gemini-pro-agent` 等给真实媒体链接(常是首页而非文章页),`claude-*` / `gpt-oss-*` / `*-image` 不能在此网关上搜。
   本项目**不维护模型名白名单**:配哪个 modelId 由所有者经 MCP 决定,配错的表现是拿到离线答案而不是报错(已写进 `docs/mcp.md`)。

## 落地后的真实网关 E2E(新代码,`runWebSearch` 直连,不经 encore)

| 配置 | 结果 |
|---|---|
| `gemini-3.8-flash-high` + `google_search` | 11.2 s;阶段 request → accepted → composing;**4 条来源**全是 vertexaisearch 签名重定向(PBS / Guardian ×2 / FT) |
| `gemini-pro-agent` + `google_search` | 28.3 s;5 条来源(VOA 等媒体首页) |
| `gpt-5.6-terra` + `web_search`(生产现行) | 19.9 s;searching 阶段 9 个检索事件;2 条 `url_citation`;行为与改动前一致 |
