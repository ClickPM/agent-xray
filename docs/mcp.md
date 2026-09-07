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

## 5. 当前已注册工具全景清单（共 46 个）

管理面工具在 `apps/api/mcp/tools.ts` 中集中注册。当前版本共计 **46 个工具**，按业务领域分为 7 大类：

| 领域分类 | 工具数量 | 工具名称清单 |
|---|---|---|
| **1. Notes 研习库** | 13 | `notes_categories_list`, `notes_category_upsert`, `notes_category_delete`, `notes_series_list`, `notes_series_upsert`, `notes_series_delete`, `notes_chapters_list`, `notes_chapter_get`, `notes_chapter_upsert`, `notes_chapter_delete`, `notes_assets_list`, `notes_asset_put`, `notes_asset_delete` |
| **2. About 关于页** | 2 | `about_get`, `about_set` |
| **3. Traffic 统计** | 3 | `traffic_overview`, `traffic_paths`, `traffic_agents` |
| **4. Provider 配置** | 12 | `llm_providers_list`, `llm_provider_upsert`, `llm_set_default`, `llm_provider_delete`, `websearch_providers_list`, `websearch_provider_upsert`, `websearch_set_default`, `websearch_provider_delete`, `imagegen_providers_list`, `imagegen_provider_upsert`, `imagegen_set_default`, `imagegen_provider_delete` |
| **5. 站点与开关控制** | 4 | `tool_config_list`, `tool_config_set`, `site_tabs_list`, `site_tab_set` |
| **6. Skills 技能库** | 8 | `skills_categories_list`, `skills_category_upsert`, `skills_category_delete`, `skills_list`, `skills_get`, `skills_file_get`, `skills_upsert`, `skills_delete` |
| **7. Agent 沙箱执行**| 4 | `skills_agent_set`, `skills_agent_status`, `sandbox_config_get`, `sandbox_config_set` |

---

## 6. 工具详细说明与参数契约

### 6.1 Notes 研习库管理（13 个）

> **设计准则**：入参即标准 Markdown，服务端不改写正文，只自动派生 `word_count` 与 `content_hash`。

1. **`notes_categories_list`**（只读）：列出全部文章分类。
   - 入参：无
   - 返回：分类列表（含 `id`, `slug`, `title`, `dot`, `sortOrder`, `seriesCount`）。
2. **`notes_category_upsert`**（写）：新增或更新分类。
   - 入参：`slug`（`^[a-z0-9][a-z0-9-]{0,63}$`）、`title`、`description`（可选）、`dot`（6位十六进制 `#RRGGBB`）、`sortOrder`（默认 0）。
3. **`notes_category_delete`**（写）：删除空分类。
   - 入参：`slug`。若分类下仍有系列会拒绝删除。
4. **`notes_series_list`**（只读）：列出系列列表。
   - 入参：`categorySlug`（可选）。
   - 返回：系列列表（含 `chapterCount`, `totalWords` 等）。
5. **`notes_series_upsert`**（写）：新增或更新系列。
   - 入参：`categorySlug`, `slug`, `title`, `summary`（可选）, `badge`（可选）, `sortOrder`。
6. **`notes_series_delete`**（写）：删除空系列。
   - 入参：`categorySlug`, `slug`。若系列下仍有章节会拒绝删除。
7. **`notes_chapters_list`**（只读）：列出系列下的章节目录（不含长正文）。
   - 入参：`seriesSlug`。
8. **`notes_chapter_get`**（只读）：读取单篇章节完整信息（含 Markdown 正文与哈希）。
   - 入参：`seriesSlug`, `slug`。
9. **`notes_chapter_upsert`**（写）：新增或更新章节正文。
   - 入参：`seriesSlug`, `slug`, `title`, `order`, `content`（完整 Markdown 文本）。
   - 行为：自动重新计算字数与 SHA-256 内容哈希；若内容无变化则不更新时间戳。
10. **`notes_chapter_delete`**（写）：删除指定章节。
    - 入参：`seriesSlug`, `slug`。
11. **`notes_assets_list`**（只读）：列出系列下的正文图片资源。
    - 入参：`seriesSlug`。
12. **`notes_asset_put`**（写）：上传系列配图。
    - 入参：`seriesSlug`, `fileName`（仅小写哈希文件名如 `abc.webp`）, `contentType`（仅支持 webp/png/jpg/gif）, `base64Data`。
    - 防御：文件最大 4 MiB，强制做魔数与格式一致性校验，不接受 SVG。
13. **`notes_asset_delete`**（写）：删除指定正文配图。
    - 入参：`seriesSlug`, `fileName`。

---

### 6.2 About 关于页内容管理（2 个）

1. **`about_get`**（只读）：获取 About 页面完整配置。
   - 返回：`intro`, `narrative`, `openSource`, `languages`, `techStack`, `milestones`。
2. **`about_set`**（写）：更新 About 页面内容（**部分更新语义**）。
   - 入参：各字段均为可选（省略保留原值，显式传 `""` 或 `[]` 表示清空）。

---

### 6.3 Traffic 访问统计（3 个，只读）

> **口径提示**：数据源自 `/t` 匿名打点，访客标识按天轮换。`visitorDays` 为各日 UV 之和（非全局去重人数）。

1. **`traffic_overview`**：获取近 N 天站点 PV、日均访问量及趋势。
   - 入参：`days`（1–90，默认 30）。
2. **`traffic_paths`**：获取热门访问路径排行。
   - 入参：`days`（默认 30）、`limit`（默认 20）。
3. **`traffic_agents`**：获取访问端 UA / Agent 分布统计。
   - 入参：`days`（默认 30）、`limit`（默认 20）。

---

### 6.4 模型与外呼 Provider 配置（12 个）

> **安全准则**：Key 加密入库，所有列表/读取接口只输出掩码；更新为部分更新语义。

#### LLM Provider（对话大模型）
1. **`llm_providers_list`**：列出已配置的 LLM 模型服务商（Key 仅回掩码）。
2. **`llm_provider_upsert`**：配置或更新 LLM 服务商。
   - 入参：`provider` (如 `deepseek`), `apiKey` (可选更新), `baseUrl`, `modelId`, `isDefault` (布尔)。
3. **`llm_set_default`**：将指定 provider 设为默认对话模型。
   - 入参：`provider`。
4. **`llm_provider_delete`**：删除指定的 provider（默认 provider 不允许直接删除）。

#### WebSearch Provider（联网搜索外呼）
5. **`websearch_providers_list`**：列出搜索服务商（带掩码与白名单状态）。
6. **`websearch_provider_upsert`**：配置或更新联网搜索服务商。
   - 入参：`provider`, `apiKey`, `baseUrl`, `modelId`, `dailySearchLimit` (0 为不限), `toolType` (可选), `totalTimeoutMs` / `idleTimeoutMs` (可选), `makeDefault`。
   - `toolType` 是闭集（zod 与迁移 015 的库级 CHECK 同步），**同时唯一决定线协议**（R-GSEARCH，2026-09-07）：
     - `web_search`（默认）/ `web_search_YYYY_MM_DD`：OpenAI 系 Responses API 内置搜索，`POST {baseUrl}/v1/responses`（DeepSeek 与自建网关同一套）。
     - `google_search`：Gemini 原生 Google Search grounding，`POST {baseUrl}/v1/chat/completions` + `tools:[{google_search:{}}]`；配合网关上 `owned_by=antigravity` 的 `gemini-*` 模型（如 `gemini-3.8-flash-high` / `gemini-pro-agent`）。其它 `toolType` 与 gemini 模型的组合不报错但拿不到联网结果，见 `docs/security.md` §1 R-GSEARCH 补记。
   - 防护：`baseUrl` 的域名必须在 `apps/api/shared/websearch-hosts.ts` 白名单或环境变量追加列表内。
7. **`websearch_set_default`**：设置默认搜索服务商。
8. **`websearch_provider_delete`**：删除搜索服务商。

#### ImageGen Provider（生图外呼）
9. **`imagegen_providers_list`**：列出生图服务商。
10. **`imagegen_provider_upsert`**：配置或更新生图服务商。
    - 入参：`provider`, `apiKey`, `baseUrl`, `modelId`, `apiStyle` (`images` 或 `chat`), `imageSize` (如 `1024x1024`), `dailyImageLimit`。
    - 防护：`baseUrl` 必须在 `apps/api/shared/imagegen-hosts.ts` 独立白名单内。
11. **`imagegen_set_default`**：设置默认生图服务商。
12. **`imagegen_provider_delete`**：删除生图服务商。

---

### 6.5 站点与工具开关控制（4 个）

1. **`tool_config_list`**（只读）：查看系统工具的启停开关状态（如 `web_search`, `generate_image`, `skill_load`, `skill_run` 等）。
2. **`tool_config_set`**（写）：设置指定工具启用或停用。
   - 入参：`name` (工具名), `enabled` (布尔值)。
   - 注意：高危工具（如 `skill_run`）受环境变量双闸保护，即使此处开闸，宿主环境未解锁仍无法生效。
3. **`site_tabs_list`**（只读）：查询顶部四大 Tab 的可见性配置。
   - 返回：`runtime`, `notes`, `skills`, `about` 的可见状态（`visible`）。
4. **`site_tab_set`**（写）：动态设置顶部某一 Tab 是否展示。
   - 入参：`key` (`runtime` / `notes` / `skills` / `about`), `visible` (布尔值)。
   - 边界：属于合规运维开关。隐藏仅作用于导航栏呈现与页面路由 307，后端数据接口不受影响。

---

### 6.6 Skills 技能库管理（8 个）

> **设计准则**：用于管理展示自研与精选的 Skill 目录包。只收 UTF-8 文本，纯文本渲染，不收二进制文件，不接受可执行代码直接在宿主服务运行。

1. **`skills_categories_list`**（只读）：技能分类列表。
2. **`skills_category_upsert`**（写）：新增或更新技能分类。
   - 入参：`slug`, `title`, `description`, `sortOrder`。
3. **`skills_category_delete`**（写）：删除空分类。
4. **`skills_list`**（只读）：技能包清单列表（不含文件具体内容）。
   - 入参：`categorySlug`（可选）。
5. **`skills_get`**（只读）：获取指定技能元信息与文件列表（含相对路径、文件类型 kind、大小，不含长文本内容，防止撑爆上下文）。
   - 入参：`name`。
6. **`skills_file_get`**（只读）：读取指定技能包内的单个文件内容。
   - 入参：`name`, `path`。
7. **`skills_upsert`**（写）：创建或全量覆盖技能包（**整包替换**）。
   - 入参：`name`, `categorySlug`, `summary`, `description`, `repo`, `repoUrl` (可选), `license` (可选), `files` 数组（含 `path` 与 `content`）。
   - 规则：必须包含根目录 `SKILL.md` 且 frontmatter `name` 与技能名完全一致；整包 ≤ 64 个文件、单文件 ≤ 256 KB、整包文本 ≤ 512 KB；自动生成一致性 ZIP 包。
8. **`skills_delete`**（写）：删除技能包。

---

### 6.7 Agent 技能沙箱执行控制（4 个）

> **设计准则**：控制 Agent 是否被允许通过 `skill_load` 注入上下文以及通过 `skill_run` 在独立容器中运行 Python 脚本。

1. **`skills_agent_set`**（写）：授权或收回某个 Skill 在 Agent 对话中的使用权限。
   - 入参：`name` (技能名), `enabled` (布尔值)。
   - 严格约束：**只能在代码白名单（`runner/skills/`）之内开关**。若不在代码清单中会直接拒绝；改动可用集合必须走发版流程。
2. **`skills_agent_status`**（只读）：Agent 可用技能的“状态透视镜”。
   - 入参：无。
   - 返回：每个白名单技能的 `inLibrary`（是否已入库）、`agentEnabled`（是否开启授权）、`consistency`（`ok` / `drift` / `missing`，有偏差时列出文件差异路径）、`available`（是否完全可用），以及当前两个执行工具的开关闸状态。
3. **`sandbox_config_get`**（只读）：读取执行沙箱的配额限制。
   - 返回：`dailyRunLimit`（日调用上限，0 为不限）、`totalTimeoutMs`（超时阈值）。
4. **`sandbox_config_set`**（写）：调整沙箱执行限制。
   - 入参：`dailyRunLimit`（可选）、`totalTimeoutMs`（可选，5000–120000 毫秒，受数据库 CHECK 约束）。

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
