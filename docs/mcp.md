# MCP 管理服务说明文档 (docs/mcp.md)

> **强约束注意 (CLAUDE.md 规则 13)**:
> 本文档是 Agent X-Ray 站点管理面契约的**唯一权威全景说明**。
> 任何轮次或改动只要涉及 MCP 工具的增删、签名/入参变更（Zod schema）、返回值结构变更、权限/审计策略调整，或管理面协议与客户端接入机制变更，**必须在同轮次中同步更新本文档**，保持工具总数、参数要求与实际代码（`apps/api/mcp/tools.ts`）强一致。

---

## 1. 架构定位与背景

**Agent X-Ray** 是一个面向访客的 AI Agent 运行时观测网站。站点的内容发布、配置调整与沙箱管理等写操作，**完全由无状态 MCP 管理服务承担**（替代已废弃的 `/admin` Web 后台与画板 3a–3e，所有者裁定 2026-08-31，安全规范见 `docs/security.md` §4）。

- **管理方式**：所有者使用标准的 MCP 客户端（如 Claude Code、Cursor、Zed 等）以自然语言或工具调用方式远程管理站点。
- **服务挂载**：挂载在后端单端点 `api.raw` `/mcp`，对外经反向代理暴露为 `POST /api/mcp`（走既有 `/api/*` 转发，无需额外 Caddy 路由）。
- **协议版本**：强制采用现代无状态协议 **`2026-07-28`**（CLAUDE.md 规则 12 硬约束），不保留会话状态，无 `initialize` 握手与长连 Session ID。
- **SDK 版本**：钉死 `@modelcontextprotocol/server` + `@modelcontextprotocol/node` **`2.0.0`**（官方 TS SDK v2；**严禁**换回无 `server/discover` 且停留在 2025-11-25 的旧包 `@modelcontextprotocol/sdk`）。

---

## 2. 身份认证与多环境配置

### 2.1 认证机制
- **认证方式**：静态 HTTP Bearer Token（`Authorization: Bearer <TOKEN>`）。
- **服务端存储**：服务端**只存储该 Token 的 SHA-256 哈希**（环境变量 `MCP_AUTH_TOKEN_HASH` / cue secret `McpAuthTokenHash`），比对走常数时间比对，防定时攻击。
- **零凭据泄露**：代码仓库、Git 提交历史、运行日志中**绝不出现 Token 明文**；Encore trace 导出前显式排除 Authorization 头。
- **Token 丢失与轮换**：Token 丢失后不可逆恢复，但可通过重新生成 CSPRNG 随机串并将新 SHA-256 哈希写入服务端 `.env` 后重启容器（`docker compose up -d api`）完成无损轮换。

### 2.2 三环境独立配置
每个环境一把独立 Token，一把只开一扇门，禁止跨环境混用：

| 环境 | 端点 URL | Token 环境变量 | 服务端期望哈希存储位置 |
|---|---|---|---|
| **本机开发** | `http://127.0.0.1:4000/mcp` | `XRAY_MCP_TOKEN` | `apps/api/.secrets.local.cue` (`McpAuthTokenHash`) |
| **130 预发** | `http://192.168.100.130/api/mcp` | `XRAY_MCP_TOKEN_130` | 130 宿主机 `~/deploy/.env` (`MCP_AUTH_TOKEN_HASH`) |
| **生产环境** | `https://www.kzgai.cloud/api/mcp` | `XRAY_MCP_TOKEN_PROD` | 生产宿主机 `~/deploy/.env` (`MCP_AUTH_TOKEN_HASH`) |

> **生产 URL 规范注意**：
> 生产环境 URL 必须写规范主机名 `www.kzgai.cloud` 或确保不触发 301 重定向。因为部分 MCP 客户端在 POST 请求遇到 HTTP 301/302 重定向时不会自动跟随且丢弃请求体，会导致客户端误报 `token expired` 或 `ConnectionRefused`。

### 2.3 客户端接入配置（`.mcp.json`）
在项目根目录的 `.mcp.json` 中已注册三套服务：
```json
{
  "mcpServers": {
    "xray-admin": {
      "type": "http",
      "url": "http://127.0.0.1:4000/mcp",
      "headers": {
        "Authorization": "Bearer ${XRAY_MCP_TOKEN}"
      }
    },
    "xray-admin-130": {
      "type": "http",
      "url": "http://192.168.100.130/api/mcp",
      "headers": {
        "Authorization": "Bearer ${XRAY_MCP_TOKEN_130}"
      }
    },
    "xray-admin-prod": {
      "type": "http",
      "url": "https://www.kzgai.cloud/api/mcp",
      "headers": {
        "Authorization": "Bearer ${XRAY_MCP_TOKEN_PROD}"
      }
    }
  }
}
```

---

## 3. 2026-07-28 协议契约与手写调用规范

直接通过 HTTP 客户端（如 PowerShell / curl）调试 `/api/mcp` 时，必须带齐现代无状态协议的逐请求契约：

### 3.1 必备请求头
1. `Authorization: Bearer <TOKEN>`
2. `Content-Type: application/json`
3. `Accept: application/json, text/event-stream`（缺少会报 `-32000 Not Acceptable`）
4. `Mcp-Method: <方法名>`（例如 `server/discover`、`tools/list`、`tools/call`；缺少会报 `-32020`）
5. `Mcp-Name: <工具名>`（仅在 `tools/call` 时必需，必须与 `params.name` 一致；缺少会报 `-32020`）
6. `MCP-Protocol-Version: 2026-07-28`

### 3.2 请求体 `params._meta` 命名空间要求
请求体 `params._meta` 必须包含带 `io.modelcontextprotocol/` 前缀的完整命名空间，不得写成裸键名，否则服务端将静默回退至 2025-11-25 遗留分支（导致 `server/discover` 回 `-32601 Method not found`）：
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "server/discover",
  "params": {
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {},
      "io.modelcontextprotocol/clientInfo": {
        "name": "mcp-client",
        "version": "1.0.0"
      }
    }
  }
}
```

---

## 4. 安全防护与审计体系

1. **外层拦截优先（Fail Closed）**：
   - 请求到达后先执行 Token 认证与 Origin 校验，验证通过后才将请求交付 MCP SDK 实例解析 JSON-RPC。未认证的请求不会触发 Server 构造与任何业务逻辑。
2. **防 DNS Rebinding**：
   - 带 `Origin` 请求头的请求一律直接拒绝。管理面客户端（如 Claude Code）在服务端进程内发起请求不带 Origin；如有浏览器跨域请求一律视为潜在攻击并阻断。
3. **敏感凭据脱敏**：
   - 所有 LLM / 搜索 / 生图 API Key 加密存储在数据库中（AES-GCM，结合 `ConfigEncryptionKey`）。
   - 任何读回操作（如 `llm_providers_list`）**一律在服务端算好掩码（如 `sk-…abcd`）**，绝不把明文凭据返回给客户端上下文。
4. **全量写操作审计（`mcp_audit` 表）**：
   - 每一个写工具调用均被审计外壳包裹，记录操作时间、Client IP、操作工具名、脱敏后的入参摘要、执行耗时与执行结果（`success` / `error`）。
   - 审计写入采用旁路模式，即使审计写入异常也不会让主写业务失败抛 500。
5. **附件与上传三重防护**：
   - 限制请求体上限 `bodyLimit: 8388608`（8 MiB）；
   - 文件大小限制：正文单图最大 4 MiB，Skill 单文件最大 256 KB / 整包最大 512 KB；
   - 三重一致性校验：扩展名、`contentType` 与文件二进制魔数（Magic Number）必须严格匹配；
   - **严格禁止 SVG 上传**（防止存储型 XSS）。
6. **显式关闭长连订阅**：
   - 配置 `maxSubscriptions: 0`，主动拒掉 `subscriptions/listen`，防止底层网络断开无法传导致连接泄漏。

---

## 5. 当前已注册工具全景清单（共 51 个）

管理面工具在 `apps/api/mcp/tools.ts` 中集中注册。当前版本共计 **51 个工具**，按业务领域分为 8 大类：

| 领域分类 | 工具数量 | 工具名称清单 |
|---|---|---|
| **1. Notes 研习库** | 13 | `notes_categories_list`, `notes_category_upsert`, `notes_category_delete`, `notes_series_list`, `notes_series_upsert`, `notes_series_delete`, `notes_chapters_list`, `notes_chapter_get`, `notes_chapter_upsert`, `notes_chapter_delete`, `notes_assets_list`, `notes_asset_put`, `notes_asset_delete` |
| **2. About 关于页** | 2 | `about_get`, `about_set` |
| **3. Traffic 统计** | 3 | `traffic_overview`, `traffic_paths`, `traffic_agents` |
| **4. Provider 配置** | 12 | `llm_providers_list`, `llm_provider_upsert`, `llm_set_default`, `llm_provider_delete`, `websearch_providers_list`, `websearch_provider_upsert`, `websearch_set_default`, `websearch_provider_delete`, `imagegen_providers_list`, `imagegen_provider_upsert`, `imagegen_set_default`, `imagegen_provider_delete` |
| **5. 站点与开关控制** | 4 | `tool_config_list`, `tool_config_set`, `site_tabs_list`, `site_tab_set` |
| **6. Skills 技能库** | 8 | `skills_categories_list`, `skills_category_upsert`, `skills_category_delete`, `skills_list`, `skills_get`, `skills_file_get`, `skills_upsert`, `skills_delete` |
| **7. Agent 沙箱执行**| 4 | `skills_agent_set`, `skills_agent_status`, `sandbox_config_get`, `sandbox_config_set` |
| **8. Source 源码快照** | 5 | `source_snapshot_begin`, `source_files_put`, `source_snapshot_commit`, `source_snapshots_list`, `source_snapshot_delete` |

---

## 6. 工具详细说明与参数契约

> **口径**：本节逐条对照 `apps/api/mcp/tools.ts` 的 Zod `inputSchema` 与回执对象写成。
> 标「可选」的字段一律是「省略 = 保留库内原值 / 不参与本次写入」；标「默认 X」的字段省略时按 X 落库。
> 返回值给的是工具回执 JSON 的键名（工具统一把对象序列化成一段文本），时间戳一律是 ISO 8601 字符串。

### 6.1 Notes 研习库管理（13 个）

> **设计准则**：入参即标准 Markdown，服务端不改写正文，只自动派生 `word_count` 与 `content_hash`。
> **命名口径**：分类与系列的展示名字段是 `name`（不是 `title`），只有章节才有 `title` / `summary`；系列没有 `badge` 这个字段。

1. **`notes_categories_list`**（只读）：列出全部文章分类。
   - 入参：无。
   - 返回：分类数组（`slug`, `name`, `dot`, `sortOrder`, `seriesCount`）。
2. **`notes_category_upsert`**（写）：按 slug 新增或更新分类。
   - 入参：`slug`（`^[a-z0-9][a-z0-9-]{0,63}$`）、`name`（1–64 字符）、`dot`（`#RRGGBB` 六位十六进制）、`sortOrder`（整数 0–9999，默认 0）。
   - 返回：`{ slug, status: "saved" }`。
3. **`notes_category_delete`**（写）：删除空分类。
   - 入参：`slug`。分类下仍有系列时拒绝删除。
   - 返回：`{ slug, status: "deleted" }`。
4. **`notes_series_list`**（只读）：列出系列。
   - 入参：`categorySlug`（可选，按分类过滤）。
   - 返回：系列数组（`slug`, `categorySlug`, `name`, `description`, `sortOrder`, `chapterCount`, `assetCount`）。
5. **`notes_series_upsert`**（写）：按 slug 新增或更新系列。
   - 入参：`slug`、`categorySlug`、`name`（1–128 字符）、`description`（≤512 字符，默认 `""`）、`sortOrder`（整数 0–9999，默认 0）。
   - 注意：`slug` 同时是 URL 片段 `/notes/<slug>`，建后不要再改。
   - 返回：`{ slug, status: "saved" }`。
6. **`notes_series_delete`**（写）：删除系列。
   - 入参：`slug`、`cascade`（布尔，默认 `false`）。系列下仍有章节或附件时必须显式 `cascade: true` —— 它们会被一并删除，不可恢复。
   - 返回：`{ slug, status: "deleted" }`。
7. **`notes_chapters_list`**（只读）：列出系列下的章节目录（不含长正文），按 `ordinal` 排序。
   - 入参：`seriesSlug`。
   - 返回：章节数组（`seriesSlug`, `slug`, `ordinal`, `label`, `pinned`, `title`, `summary`, `wordCount`, `sourceUrl`, `publishedAt`（ISO 或 `null`）, `updatedAt`（ISO））。
8. **`notes_chapter_get`**（只读）：读取单篇章节完整信息（含 Markdown 正文）。
   - 入参：`seriesSlug`、`slug`。
   - 返回：与 `notes_chapters_list` 同样的字段，另加 `contentMd`。**不回内容哈希**（哈希只在服务端内部用于幂等判断）。
9. **`notes_chapter_upsert`**（写）：新增或更新章节正文。
   - 入参：`seriesSlug`、`slug`、`ordinal`（整数 0–9999）、`label`（1–32 字符，章节表左列文本：README / 01 / 02 …）、`pinned`（布尔，默认 `false`，置顶行不计入章节数）、`title`（1–256 字符）、`summary`（≤512 字符，默认 `""`）、`contentMd`（1–1048576 字符，标准 GFM Markdown）、`sourceUrl`（URL，≤1024 字符，可为 `null`，默认 `null`）、`publishedAt`（可解析的 ISO 8601 时间，可为 `null`，默认 `null`）。
   - 行为：自动重算字数与 SHA-256 内容哈希；内容与库内完全一致时整行不动（不刷新 `updatedAt`，RSS 不会假装有更新）。正文里的配图用 `/notes/<seriesSlug>/<文件名>` 引用，文件先经 `notes_asset_put` 上传。
   - 返回：`{ seriesSlug, slug, status: "created" | "updated" | "unchanged", wordCount, url }`。
10. **`notes_chapter_delete`**（写）：删除指定章节，不可恢复。
    - 入参：`seriesSlug`、`slug`。
    - 返回：`{ seriesSlug, slug, status: "deleted" }`。
11. **`notes_assets_list`**（只读）：列出正文图片资源的元信息（不含二进制）。
    - 入参：`seriesSlug`（**可选**，按系列过滤；省略 = 列出全部）。
    - 返回：附件数组（`seriesSlug`, `name`, `contentType`, `byteSize`, `etag`, `url`, `updatedAt`）。
12. **`notes_asset_put`**（写）：上传系列配图，同名重传即覆盖。
    - 入参：`seriesSlug`、`name`（**全小写**、不含路径分隔符的文件名 `^[a-z0-9][a-z0-9._-]{0,95}$`，形如 `<内容哈希>.webp`）、`contentType`（闭集：`image/webp` / `image/png` / `image/jpeg` / `image/gif`）、`dataBase64`（标准 base64）。
    - 防御：单图 ≤ 4 MiB；扩展名必须与 `contentType` 自洽；base64 严格解码（掺杂非法字符即拒）；文件二进制魔数必须与 `contentType` 匹配；**不接受 SVG**。
    - 返回：`{ created, byteSize, etag, url }`（`url` = `/notes/<seriesSlug>/<name>`）。
13. **`notes_asset_delete`**（写）：删除指定正文配图（不检查是否仍被正文引用，删错了会变破图）。
    - 入参：`seriesSlug`、`name`。
    - 返回：`{ seriesSlug, name, status: "deleted" }`。

---

### 6.2 About 关于页内容管理（2 个）

1. **`about_get`**（只读）：获取 About 页面完整配置。
   - 入参：无。
   - 返回：`githubUser`, `originUrl`, `intro`, `buildPoints`（字符串数组）, `repos`（每项 `name` / `lang` / `dot` / `stars` / `desc` / `pushed`）, `langBar`（每项 `name` / `pct` / `color`）, `updatedAt`（ISO；从未设置过为 `null`）。
2. **`about_set`**（写）：更新 About 页面内容（**部分更新语义**）。
   - 入参（**全部可选**；省略保留原值，显式传 `""` 或 `[]` 表示清空）：
     - `githubUser`：合法 GitHub 用户名或 `""`（`""` = 不渲染头部）。
     - `originUrl`：≤512 字符，带主机名的 http(s) 绝对地址或 `""`。
     - `intro`：≤1024 字符。
     - `buildPoints`：≤32 条，每条 ≤256 字符。
     - `repos`：≤24 项；每项 `name`（合法 GitHub 仓库名）/ `lang`（≤32，默认 `""`）/ `dot`（`#RRGGBB`）/ `stars`（整数 0–1000000，默认 0）/ `desc`（≤512，默认 `""`）/ `pushed`（≤32，默认 `""`）。
     - `langBar`：≤12 项；每项 `name`（1–32）/ `pct`（0–100）/ `color`（`#RRGGBB`）。
   - 返回：`{ status: "saved", updated: [本次带上的字段名] }`。

---

### 6.3 Traffic 访问统计（3 个，只读）

> **口径提示**：数据源自 `/t` 匿名打点，访客标识按天轮换。`visitorDays` 为各日 UV 之和（非全局去重人数）。日期按站点时区计算。

1. **`traffic_overview`**：获取近 N 天站点 PV、各日 UV 之和及逐日趋势。
   - 入参：`days`（整数 1–365，默认 30；含今天在内的天数）。
   - 返回：`{ timezone, from, to, pageviews, visitorDays, daily: [{ day, pv, uv }] }`；没有访问的日子不会出现在 `daily` 里。
2. **`traffic_paths`**：获取热门访问路径排行。
   - 入参：`days`（整数 1–365，默认 30）、`limit`（整数 1–200，默认 20）。
   - 返回：`[{ key, pv, visitorDays }]`，按 PV 倒序；`key` 是**归一后**的站内路径，`/*` 是归一不出来的那些的常量桶。
3. **`traffic_agents`**：获取访问端 UA / Agent 分布统计。
   - 入参：`days`（整数 1–365，默认 30）。**没有 `limit`**（UA 摘要本身是闭集，全量返回）。
   - 返回：`[{ key, pv, visitorDays }]`，`key` 是 `<浏览器族>/<平台族>` 摘要（如 `Chrome/Windows`）；原始 User-Agent 从不落库。

---

### 6.4 模型与外呼 Provider 配置（12 个）

> **安全准则**：Key 加密入库，所有列表/读取接口只输出掩码（`sk-…abcd`）；三个 `*_upsert` 一律是**部分更新**（省略即保留），第一个配好的 provider 自动成为默认。
> **设为默认的开关是 `makeDefault`（布尔，默认 `false`），不是 `isDefault`** —— `isDefault` 只出现在**回执与列表**里。
> 三个 `*_upsert` 的回执都是 `{ provider, status: "created" | "updated", apiKeyHint, isDefault }`；三个 `*_set_default` 都是 `{ provider, status: "default" }`；三个 `*_delete` 都是 `{ provider, status: "deleted", warning? }`（`warning` 只在删完已无默认时出现）。三组的 `provider` 入参在 `set_default` / `delete` 上都是 1–64 字符的自由字符串。

#### LLM Provider（对话大模型）
1. **`llm_providers_list`**（只读）：列出已配置的 LLM 模型服务商（Key 仅回掩码）。
   - 入参：无。
   - 返回：`[{ provider, baseUrl, apiKeyHint, modelId, hasCustomModels, isDefault, dailyTokenLimit, dailyCostLimitCents, maxTurnsPerSession, updatedAt }]`。
2. **`llm_provider_upsert`**（写）：配置或更新 LLM 服务商。
   - 入参：`provider`（**必填**，pi-ai 的 provider id，`^[a-z0-9][a-z0-9._-]{0,63}$`，如 `deepseek`）、`apiKey`（可选，8–512 字符明文，加密入库）、`baseUrl`（可选，URL，≤512 字符；传 `null` = 清空回 provider 默认）、`modelId`（可选，1–128）、`models`（可选，≤64 项的对象数组；传 `null` = 清空）、`makeDefault`（布尔，默认 `false`）、`dailyTokenLimit` / `dailyCostLimitCents` / `maxTurnsPerSession`（可选，非负整数，0 = 不限）。
   - 首次配置必须给出 `apiKey` 与 `modelId`；配置改动在**下一轮**生效（既有会话按配置指纹重建）。
3. **`llm_set_default`**（写）：将指定 provider 设为默认对话模型。
   - 入参：`provider`。
4. **`llm_provider_delete`**（写）：删除指定 provider。
   - 入参：`provider`。**默认 provider 也能删**（拦住就没法删最后一个）；删完已无默认时回执带 `warning: "已无默认 provider，agent 对话将被拒绝"`。

#### WebSearch Provider（联网搜索外呼）
5. **`websearch_providers_list`**（只读）：列出搜索服务商（带掩码与白名单）。
   - 入参：无。
   - 返回：`{ allowedHosts: [...], providers: [{ provider, baseUrl, apiKeyHint, modelId, toolType, totalTimeoutMs, idleTimeoutMs, dailySearchLimit, isDefault, updatedAt }] }`。
6. **`websearch_provider_upsert`**（写）：配置或更新联网搜索服务商。
   - 入参：`provider`（**必填**，自取标签，`^[a-z0-9][a-z0-9._-]{0,63}$`）、`apiKey`（可选，8–512）、`baseUrl`（可选，≤512，须过白名单校验）、`modelId`（可选，1–128）、`toolType`（可选，见下）、`totalTimeoutMs`（可选，10000–300000，默认 180000）、`idleTimeoutMs`（可选，5000–120000，默认 45000；不得大于 `totalTimeoutMs`）、`dailySearchLimit`（可选，非负整数，默认 0 = 不限）、`makeDefault`（布尔，默认 `false`）。
   - `toolType` 是闭集（zod 正则与迁移 015 的库级 CHECK 同步），**同时唯一决定线协议**（R-GSEARCH，2026-09-07）：
     - `web_search`（库默认）/ `web_search_YYYY_MM_DD`：OpenAI 系 Responses API 内置搜索，`POST {baseUrl}/v1/responses`（DeepSeek 与自建网关同一套）。
     - `google_search`：Gemini 原生 Google Search grounding，`POST {baseUrl}/v1/chat/completions` + `tools:[{google_search:{}}]`；配合网关上 `owned_by=antigravity` 的 `gemini-*` 模型（如 `gemini-3.8-flash-high` / `gemini-pro-agent`）。其它 `toolType` 与 gemini 模型的组合不报错但拿不到联网结果，见 `docs/security.md` §1 R-GSEARCH 补记。
   - 防护：`baseUrl` 的 host 必须在 `apps/api/shared/websearch-hosts.ts` 白名单（或环境变量追加列表）内，且必须是 https、不带 query/fragment、不内嵌凭据。
   - 首次配置必须给出 `apiKey`、`baseUrl` 与 `modelId`；配好之后还要 `tool_config_set{name:"web_search", enabled:true}` 才会真正注册（种子行默认是关的）。
7. **`websearch_set_default`**（写）：设置默认搜索服务商。
   - 入参：`provider`。
8. **`websearch_provider_delete`**（写）：删除搜索服务商。
   - 入参：`provider`。删掉默认的那个之后 `web_search` 工具**下一轮起不再注册**，`tool_config` 里的开关不会被动。

#### ImageGen Provider（生图外呼）
9. **`imagegen_providers_list`**（只读）：列出生图服务商。
   - 入参：无。
   - 返回：`{ allowedHosts: [...], providers: [{ provider, baseUrl, apiKeyHint, modelId, apiStyle, imageSize, totalTimeoutMs, idleTimeoutMs, dailyImageLimit, isDefault, updatedAt }] }`。
10. **`imagegen_provider_upsert`**（写）：配置或更新生图服务商。
    - 入参：`provider`（**必填**，`^[a-z0-9][a-z0-9._-]{0,63}$`）、`apiKey`（可选，8–512）、`baseUrl`（可选，≤512，须过生图白名单）、`modelId`（可选，1–128）、`apiStyle`（可选，`images` / `chat`，库默认 `images`）、`imageSize`（可选，`auto` 或 `1024x1024` 这类 `^(auto|[0-9]{3,4}x[0-9]{3,4})$`；传 `null` = 不发、用上游默认；`chat` 形态忽略）、`totalTimeoutMs`（可选，10000–300000，默认 180000）、`idleTimeoutMs`（可选，5000–120000，默认 30000；不得大于 `totalTimeoutMs`）、`dailyImageLimit`（可选，非负整数，默认 0 = 不限）、`makeDefault`（布尔，默认 `false`）。
    - 防护：`baseUrl` 必须在 `apps/api/shared/imagegen-hosts.ts` 独立白名单内（与搜索白名单是两份），同样要求 https、无 query/fragment、不内嵌凭据。
    - 首次配置必须给出 `apiKey`、`baseUrl` 与 `modelId`；配好之后还要 `tool_config_set{name:"generate_image", enabled:true}`。
11. **`imagegen_set_default`**（写）：设置默认生图服务商。
    - 入参：`provider`。
12. **`imagegen_provider_delete`**（写）：删除生图服务商。
    - 入参：`provider`。删掉默认的那个之后 `generate_image` 工具**下一轮起不再注册**（已生成的图片不受影响）。

---

### 6.5 站点与工具开关控制（4 个）

1. **`tool_config_list`**（只读）：查看 agent 业务工具的启停开关状态（如 `web_search`, `generate_image`, `skill_load`, `skill_run` 等）。
   - 入参：无。
   - 返回：`[{ name, enabled, dangerous, note, updatedAt }]`。
2. **`tool_config_set`**（写）：设置指定工具启用或停用。
   - 入参：`name`（snake_case，`^[a-z0-9][a-z0-9_]{0,63}$`）、`enabled`（布尔）、`dangerous`（可选布尔）、`note`（可选，≤256 字符）。
   - 返回：`{ name, enabled, status: "created" | "updated" }`。
   - 注意：`dangerous=true` 的工具（如 `skill_run`）受**双闸**保护，即使此处开闸，宿主 env 未加 `XRAY_UNLOCK_DANGEROUS_TOOLS=1` 仍不会被注册。
3. **`site_tabs_list`**（只读）：查询顶部五格 Tab 的可见性配置。
   - 入参：无。
   - 返回：`[{ key, label, path, visible, updatedAt }]`，`key` 为 `runtime` / `notes` / `skills` / `source` / `about`；`updatedAt` 为 `null` = 这个 tab 从没被配置过（此时按可见处理）。
4. **`site_tab_set`**（写）：动态设置顶部某一 Tab 是否展示。
   - 入参：`key`（enum：`runtime` / `notes` / `skills` / `source` / `about`；R-SOURCE 起五值）、`visible`（布尔）。
   - 返回：`{ key, visible, status: "created" | "updated", visibleTabs }`（`visibleTabs` = 改完之后仍可见的 key 列表）。
   - 边界：属于合规运维开关。隐藏仅作用于导航栏呈现与页面路由 307，后端数据接口不受影响；**不许关掉最后一个可见的 tab**（会拒绝）。

---

### 6.6 Skills 技能库管理（8 个）

> **设计准则**：用于管理展示自研与精选的 Skill 目录包。只收 UTF-8 文本，纯文本渲染，不收二进制文件，不接受可执行代码直接在宿主服务运行。
> **命名口径**：分类的展示名是 `name`（不是 `title`）；skill 的卡片文案是 `summary`（没有 `description` 入参），LICENSE 作为普通文本文件放进 `files`（没有 `license` 入参）。

1. **`skills_categories_list`**（只读）：技能分类列表。
   - 入参：无。
   - 返回：`[{ slug, name, dot, sortOrder, skillCount }]`。
2. **`skills_category_upsert`**（写）：新增或更新技能分类。
   - 入参：`slug`、`name`（1–64 字符）、`dot`（`#RRGGBB`）、`sortOrder`（整数 0–9999，默认 0）。
   - 返回：`{ slug, status: "saved" }`。
3. **`skills_category_delete`**（写）：删除空分类。
   - 入参：`slug`。分类下还有 skill 时拒绝删除。
   - 返回：`{ slug, status: "deleted" }`。
4. **`skills_list`**（只读）：技能包清单（不含文件）。
   - 入参：`categorySlug`（可选）。
   - 返回：`[{ name, categorySlug, summary, sourceType, repo, repoUrl, version, sortOrder, fileCount, zipSize, url, updatedAt }]`。
5. **`skills_get`**（只读）：获取指定技能元信息与文件清单（含相对路径、`kind`、字节数与行数，**不含长文本内容**，防止撑爆上下文）。
   - 入参：`name`（`^[a-z0-9][a-z0-9-]{0,63}$`）。
   - 返回：`skills_list` 的元信息字段 + `files: [{ path, kind, sizeBytes, lineCount }]` + `url` / `zipUrl`。
6. **`skills_file_get`**（只读）：读取指定技能包内的单个文件内容。
   - 入参：`name`、`path`（1–200 字符）。
   - 返回：`{ path, kind, content, sizeBytes, lineCount }`。
7. **`skills_upsert`**（写）：创建或全量覆盖技能包（**整包替换**：每次都要带全部文件，库内多出来的文件会被删掉）。
   - 入参：`name`、`categorySlug`、`summary`（≤512 字符，默认 `""`）、`sourceType`（**必填**，`own` = 自研 / `curated` = 精选第三方）、`repo`（**必填**，`owner/repo`，安装命令由它派生）、`repoUrl`（可选，带主机名的 http(s) 绝对地址；省略 = 页面不渲染 GitHub 外链）、`version`（可选，≤32 字符，页面显示 `v<版本>`）、`sortOrder`（整数 0–9999，默认 0）、`files`（1–64 项，每项 `path`（≤200 字符）与 `content`（UTF-8 原文））。
   - 规则：根目录必须有 `SKILL.md` 且 frontmatter 的 `name` 与技能名完全一致；`kind` 由扩展名派生且是闭集（`markdown / python / shell / typescript / javascript / json / yaml / toml / text`），二进制、svg、html 一律拒；`path` 相对、无 `..`、不以 `/` 开头、每段只用 `[A-Za-z0-9._-]`、至多 4 段；整包 ≤ 64 个文件、单文件 ≤ 256 KB、整包文本 ≤ 512 KB；任一文件不合规则整包不入库；入库时自动打好一致的 ZIP 包。内容与库内完全一致时整行不动（`unchanged`，`updatedAt` 不刷新）。
   - 返回：`{ name, status: "created" | "updated" | "unchanged", fileCount, totalBytes, zipSize, url, zipUrl }`。
8. **`skills_delete`**（写）：删除技能包，连同全部文件，不可恢复。
   - 入参：`name`。
   - 返回：`{ name, status: "deleted" }`。

---

### 6.7 Agent 技能沙箱执行控制（4 个）

> **设计准则**：控制 Agent 是否被允许通过 `skill_load` 注入上下文以及通过 `skill_run` 在独立容器中运行 Python 脚本。

1. **`skills_agent_set`**（写）：授权或收回某个 Skill 在 Agent 对话中的使用权限。
   - 入参：`name`（技能名）、`enabled`（布尔）。
   - 返回：`{ name, agentEnabled, status: "saved" }`。
   - 严格约束：**只能在代码清单（`runner/skills/`，即 `shared/skills.generated.ts`）之内开关**，不在清单里直接拒；库里也必须已有展示副本（先 `skills_upsert`），否则报 NotFound。改可用集合要发版。改动对**新会话**生效。
2. **`skills_agent_status`**（只读）：Agent 可用技能的「状态透视镜」。
   - 入参：无。
   - 返回：`{ gates: { skill_load, skill_run }, skills: [{ name, network, scripts, inLibrary, agentEnabled, consistency, drift?, available }] }`——`network` 是该 skill 声明的出网档次、`scripts` 是它声明的可运行脚本文件名；`consistency` 为 `ok` / `drift` / `missing`（`drift` 时另有 `drift: { missing, extra, changed }` 三组路径）；`available` = `inLibrary ∧ agentEnabled ∧ consistency === "ok"`。
   - drift 的修法：用 `skills_upsert` 重新上传与代码副本相同的文件。
3. **`sandbox_config_get`**（只读）：读取执行沙箱的配额限制。
   - 入参：无。
   - 返回：`{ dailyRunLimit, totalTimeoutMs, updatedAt }`（单行不存在 = 迁移 013 没跑，报 NotFound）。
4. **`sandbox_config_set`**（写）：调整沙箱执行限制（**部分更新**，省略的字段保留原值）。
   - 入参：`dailyRunLimit`（可选，整数 0–1000000，0 = 不限）、`totalTimeoutMs`（可选，5000–120000 毫秒，与数据库 CHECK 同界）。
   - 返回：`{ dailyRunLimit, totalTimeoutMs, updatedAt, status: "saved" }`。执行容器侧另有 rlimit，这里改不到。

---

### 6.8 Source 源码快照发布（5 个，R-SOURCE，所有者裁定 2026-09-08）

> **设计准则**：站点自身源码的快照按 40 位 git SHA **三段式**发布（begin → put → commit），只保留一份 current；读面 `/api/source*` 与 agent 的 `source_*` 工具只看 current。
> 正常情况下由 `tools/source-publish/publish.mjs` 随 `dev.ps1 ship` **自动**调用（首次发版在 `compose up` 之后手动 `dev.ps1 source-publish <host> <sha>`），不是人手工具；这里的契约是给排障时看的。
> 只收文本（UTF-8、无 NUL）；kind 由扩展名 / 文件名派生且是闭集（`markdown / typescript / javascript / python / shell / powershell / sql / json / yaml / toml / css / dockerfile / text`）；`path` 相对、无 `..`、无反斜杠、每段 `[A-Za-z0-9._()[]-]`、≤ 12 段、≤ 300 字符；单文件 ≤ 256 KB、一批 ≤ 512 KB / ≤ 200 个、一个快照 ≤ 2000 个文件（`apps/api/shared/source-pack.ts`）。快照**只来自 git 树**由脚本保证（`docs/security.md` §4 R-SOURCE 补记）。

1. **`source_snapshot_begin`**（写）：按 `sha` 建（或重建）staging 快照，并带整份 manifest。
   - 入参：`sha`（40 位小写十六进制）、`files[]`（每项 `path` / `sha256`（64 位十六进制）/ `bytes`（0–262144）/ `lines`（非负整数），不含内容；1–2000 项）。
   - 行为：服务端把 current 快照里 `(path, sha256)` 相同的文件内容直接复制过来；同 sha 重 begin = 清掉上次的 staging 重来；sha 已是 current 时什么都不动。
   - 返回：`{ sha, total, reused, missing[], alreadyCurrent, status }`（`missing` 是还缺内容的路径；`status` 为 `staging` 或 `already_current`）。
2. **`source_files_put`**（写）：给 staging 快照补一批内容。
   - 入参：`sha`、`files[]`（每项 `path` / `content`；1–200 项，内容总量 ≤ 512 KB）。
   - 规则：只收 manifest 里的 path；服务端现算 sha256 必须等于 manifest 声明值，否则**整批拒**（事务回滚）；同文件重传（哈希相同）幂等。
   - 返回：`{ sha, stored, pending }`（`pending` = 还缺内容的文件数，为 0 才能 commit）。
3. **`source_snapshot_commit`**（写）：把 staging 翻成 current。
   - 入参：`sha`。
   - 行为：一个事务里核 manifest 每一项都有内容且行数相符 → 现 current 退下 → 本 sha 置 current → **删除其余全部快照**；任一不符整体回滚、current 不变，并点名缺哪些文件；sha 本来就是 current 时回 `unchanged`。
   - 返回：`{ sha, fileCount, totalBytes, publishedAt, replaced, unchanged, status, url }`（`status` 为 `current` 或 `unchanged`，`replaced` 是被换下的上一版 sha、首次发布或 unchanged 时为 `null`，`url` 恒为 `/source`）。
4. **`source_snapshots_list`**（只读）：列出 current 与残留的 staging。
   - 入参：无。
   - 返回：`[{ sha, shortSha, status, fileCount, totalBytes, pending, createdAt, publishedAt }]`（`publishedAt` 对 staging 为 `null`）。
5. **`source_snapshot_delete`**（写）：删除一份**非 current** 的快照（残留的 staging）；删 current 会拒绝——站点上要换内容就发下一版。
   - 入参：`sha`。
   - 返回：`{ sha, status: "deleted" }`。

审计：四个写工具（`begin` / `put` / `commit` / `delete`）每次调用一行 `mcp_audit`（`summary` 只有 sha 前 7 位与文件数，不记正文）；`put` 对每个文件核 sha256 / bytes / lines 三个事实，`commit` 从实际文件行重算 `totalBytes`。

---

## 7. 高危工具与沙箱解锁完整流程

为防止 Agent 意外执行未授权脚本，`skill_run` 与沙箱运行采用了“代码白名单 + 环境变量 + MCP 开关”的三重锁闭体系：

```text
[发版部署 runner 容器镜像]
          ↓
[MCP 写入/更新 Skill 库并校验一致性: skills_upsert]
          ↓
[MCP 开启上下文注入工具: tool_config_set skill_load true]
          ↓
[MCP 逐个激活可用 Skill: skills_agent_set <name> true]
          ↓
[核验技能状态一致无漂仪: skills_agent_status → ok]
          ↓
[生产机器 .env 添加 XRAY_UNLOCK_DANGEROUS_TOOLS=1 并重启 api 容器]
          ↓
[MCP 开启沙箱执行工具: tool_config_set skill_run true]
```

只有以上环节全部就绪，Agent 才能在沙箱容器中执行脚本；任何环节缺失均会以安全守卫阻断（Fail-Safe）。

---

## 8. 维护与更新守则

1. **新工具上线流程**：
   - 在 `apps/api/mcp/tools.ts` 中完成 Zod 参数校验、`audit` 包装与逻辑实现；
   - 编写 `apps/api/mcp/*.test.ts` 补充完整单测；
   - **立即同步更新本文档**：更新工具总数、所属分类、入参规范与安全要点（**硬性规则 13**）；
   - 在轮次任务卡中回填工具总数核验项。
2. **向下兼容要求**：
   - 严禁变更已有工具的只读属性；
   - 对已有参数变更需采用“可选 + 默认值”模式，避免破坏自动化 MCP Client 调用链路。
