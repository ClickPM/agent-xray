# mcp 服务(R6 已落地)

无状态 MCP 管理面,替代已废弃的 `/admin` 后台(所有者裁定 2026-08-31;安全条款见 `docs/security.md` §4)。
所有者以 MCP 客户端(Claude Code 等)管理站点内容与配置;访客不可达的写面,认证 = 静态 bearer token(服务端只存哈希),写操作全审计。

## 形态

| | |
|---|---|
| 协议 | **2026-07-28**(无状态:无 `initialize` 握手、无 `Mcp-Session-Id`,协议版本与客户端能力随每请求的 `_meta` 走;`server/discover` 必须实现) |
| SDK | `@modelcontextprotocol/server` + `@modelcontextprotocol/node` **2.0.0**(钉死) |
| 向下协商 | `createMcpHandler` 的默认 `legacy: 'stateless'`:2025 时代(带握手)的客户端由同一份工具定义以一次性实例服务 |
| 挂载 | `api.raw` 单端点 `/mcp`(对外 `/api/mcp`,走既有 `/api/*` 反代,无需新增 Caddy 路由) |
| 订阅 | **显式关闭**(`maxSubscriptions: 0`),见下 |

> **别把 SDK 换回 `@modelcontextprotocol/sdk`。** 那个包最新版(1.30.0)的
> `LATEST_PROTOCOL_VERSION` 仍是 `2025-11-25`,里面没有 `server/discover` ——
> 2026-07-28 是由 SDK v2 以**全新包名**提供的。R6 开工实测,记在 `rounds/round-06`。

## 文件

| 文件 | 职责 |
|---|---|
| `endpoint.ts` | `api.raw` 入口。**先认证再交给 SDK**:未认证的请求不该有机会让服务端构造 server 实例、解析 JSON-RPC |
| `auth.ts` | bearer 校验。服务端只存 sha256,比较走定长摘要的常数时间比较;失败一律同一句 `unauthorized` |
| `server.ts` | `createMcpHandler` 装配(每请求一个 `McpServer` 实例)+ `toNodeHandler` 适配 |
| `tools.ts` | 24 个工具的入参 schema(zod)与结果整形;写工具统一过审计外壳 |
| `store.ts` | 全部 SQL。**明文 LLM key 不出本文件** |
| `content.ts` | 入库前的派生:字数、章节内容哈希 |
| `audit.ts` | `mcp_audit` 写入;永不 reject(审计是旁路,不能让已完成的写操作变成 500) |
| `secrets.ts` | `McpAuthTokenHash` / `ConfigEncryptionKey`(规则 5:secret 只能在 service 目录内声明) |

加解密原语在 `apps/api/shared/crypto.ts`——mcp(写)与 agent(读)两个服务都要用,
按规则 5 由各自的 service 取好 secret 值再传进去,共享库里不出现 `secret()`。

## 工具(24)

- notes 三张表 CRUD:分类 / 系列 / 章节。**入参即标准 markdown,server 只校验不改写**
- 附件:`notes_asset_put` / `notes_asset_delete` / `notes_assets_list`。存 Postgres,
  由 notes 服务的 `/assets/notes/:series/:file` 供图;对外 URL 保持 `/notes/<系列>/<哈希>.webp`
- About 内容(`about_get` / `about_set`)。R8 起前端 `/about` 直接读这张表
  (`apps/api/about/`),并新增「公开仓库 / 语言构成」两块。
  **`about_set` 是部分更新**(R8 改口径):省略的字段保留原值,清空是显式动作
  (传 `""` / `[]`)。原先的整体覆盖在字段涨到 6 个、其中两个是几十行数组之后,
  会变成一个「只想改一句 intro 却静默清空仓库卡」的接口
- LLM provider:`llm_providers_list` / `llm_provider_upsert` / `llm_set_default` / `llm_provider_delete`。
  key 加密入库,**任何读回只给掩码**;upsert 是**部分更新**(省略的字段保留原值)
- 工具启停(`tool_config_list` / `tool_config_set`,高危工具双闸之一)
- **访问统计(R8)**:`traffic_overview` / `traffic_paths` / `traffic_agents`,只读。
  数据来自 metrics 服务的 `POST /t` 打点;画板 3c 的 Traffic 页已随 `/admin` 废弃,
  这三个 tool 就是统计的全部展示面(没有公开的统计查询端点)。
  聚合 SQL 在 `store.ts`,与 trace 只读 agent 的 `trace_events` 是同一个先例:
  表归 metrics,读它的服务各自写自己的 store。
  **两条最容易读错的口径**(每个 tool 的 description 里都重申过):
  `visitorDays` 是各日 UV 之和、不是去重人数(访客标识按天轮换,隐私设计的直接
  后果);`path` 是归一后的值,`/*` 是归一不出来的那些的常量桶

## 两条容易改错的地方

1. **`subscriptions/listen` 必须保持关闭。** 它是 SDK 自带的,而 Claude Code 一连上来就调
   (2026-08-31 抓包实测:`server/discover` → `subscriptions/listen` → `tools/list`)。
   开着等于在这个端点上留长连 SSE,而 Encore 网关**不把客户端断开传导进来**
   (`apps/api/trace/README.md`),那些流没有任何东西能收尾。`maxSubscriptions: 0` 让它在开流前就被拒
   (SDK 用的是 `?? 默认值`,0 会被保留)。客户端拿到 `-32603` 后照常工作。
2. **附件类型三重一致**:扩展名、`contentType`、文件头魔数。少任何一道,
   一份「声称是 png 的 HTML」就会被供图端点原样出成 `Content-Type: image/png` 之外的东西 ——
   同源下的存储型 XSS。**SVG 永不接受**(它本身就是可执行文档)。

## 安全边界

MCP 用全权 DB 角色写库;pi agent 仍走 `agent_ro` 只读(R7 建角色),
in-process 进程无 HTTP 类工具、物理上不可达本端点。`encore gen client` 也显式
`--excluded-services mcp`,浏览器包里不出现管理面的类型化包装。
