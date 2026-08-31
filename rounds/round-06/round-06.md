# Round 06 — MCP 管理服务(替代 /admin 后台)

> 状态:进行中(第 1 轮 findings 已整改,待复审)

## 目标

站点内容与配置的唯一管理入口变成**无状态 MCP server**(`/api/mcp`,2026-07-28 规范):
所有者以 MCP 客户端完成 notes 内容/附件、About、LLM 多 provider、工具启停的全部操作;
`/admin` 六页与 R5 的 notes-sync 管道同轮退役。

## 前置

- R5 已完成(notes_* 三表与查询端点、RSS 就位;存量文章与图片在库/在 `apps/web/public/notes/`)
- 所有者裁定(2026-08-31,本轮开工时确认):
  - **`DEEPSEEK_API_KEY` 引导键彻底移除** —— 运行期 LLM key 只从 `llm_config` 读;
    secret / infra-config / compose 三处一并删除。代价已认:新环境首次部署后
    必须先经 MCP 写入 provider,agent 才能对话(写进部署清单)。
  - **存量 56 张图经 MCP 上传工具回填**,而不是写进迁移或另起脚本。

## 开工实测(选型依据,与 ROUNDS.md 计划的偏离)

| 项 | 计划 | 实测 | 处置 |
|---|---|---|---|
| 官方 TS SDK | 「用官方 TS SDK」 | `@modelcontextprotocol/sdk@1.30.0`(latest)的 `LATEST_PROTOCOL_VERSION = '2025-11-25'`,无 `server/discover` | 支持 2026-07-28 的是 **SDK v2**,以新包名发布:`@modelcontextprotocol/server@2.0.0` + `@modelcontextprotocol/node@2.0.0`(peer `hono`)。本轮装 v2,不装 `@modelcontextprotocol/sdk` |
| 向下协商 | 「保留向下协商」 | `createMcpHandler(factory)` 默认 `legacy: 'stateless'`,同一个 factory 同时服务 2026-07-28 与 2025 时代流量 | 用默认值,不设 `legacy: 'reject'` |
| 挂载形态 | `api.raw` 单 POST `/api/mcp` | v2 handler 是 web 标准 `fetch(Request)`;`toNodeHandler` 适配 `(req,res)` | `api.raw` → `toNodeHandler(handler)` |
| 供图路由 | 「URL 保持 `/notes/<系列>/<哈希>.webp` 不变」 | Encore 路由里 `/notes/:series/:file` 与既有 `/notes/series/:slug` 冲突 | API 侧路径改为 `/assets/notes/:series/:file`;Caddy 按扩展名 `rewrite * /assets{path}`,next dev 同款 rewrite。**对外 URL 不变** |
| 中转 baseURL | 「pi-ai 配置面的表达」 | `ModelRuntime.registerProvider(id, { baseUrl, models })`(`ProviderConfigInput`)+ `setRuntimeApiKey(id, key)` | `llm_config` 存 `base_url` 与可选 `models` JSONB,建会话前按行注册 |

## 交付物

- `apps/api/agent/migrations/003_mcp_admin.up.sql` —— `llm_config` / `tool_config` / `about_content` / `notes_assets` / `mcp_audit`;`notes_chapters` 去掉管道遗留列
- `apps/api/mcp/` —— `db.ts` `auth.ts` `audit.ts` `secrets.ts` `store.ts` `tools.ts` `server.ts` `endpoint.ts` + 测试
- `apps/api/shared/crypto.ts` —— AES-256-GCM 加解密与掩码(key 由服务侧 secret 取好后传入,规则 5)
- `apps/api/notes/assets.ts` —— 公开只读供图 `GET /assets/notes/:series/:file`
- `apps/api/agent/llm-config.ts` + `runtime.ts` 改造 —— 硬编码 provider/model/secret → `llm_config`
- `deploy/Caddyfile` `deploy/docker-compose.yml` `deploy/infra-config.json` `apps/web/next.config.ts`
- 退役:`apps/web/app/admin/` `apps/web/components/admin/` `tools/notes-sync/` `.claude/skills/sync-notes` `dev.ps1 notes`
- 文档:`docs/security.md` §3/§4、`docs/architecture.md`、`docs/deploy-environments.md`、`CLAUDE.md`、`ROUNDS.md`

## 验收

| # | 检查 | 命令 / 期望 |
|---|---|---|
| 1 | MCP 客户端实连打通 | 官方 v2 客户端 + Claude Code 各连一次;`server/discover`、`tools/list`、`tools/call` 全通 |
| 2 | 认证 | 无 token / 错 token 全拒(不回显细节),且 `mcp_audit` 有 `denied` 记录 |
| 3 | 发布全链路 | 经 MCP 新建系列+含附件文章 → 前端渲染 → RSS 出现该条 |
| 4 | 存量零回归 | 56 张图回填后 `/notes/<系列>/<哈希>.webp` 仍 200;既有文章页与 RSS 不变 |
| 5 | key 只见掩码 | `llm_provider_upsert` 后 `llm_providers_list` 与任何读路径只回 `sk-…abcd` |
| 6 | 模型热生效 | 切换默认 provider/模型后**新会话**用新模型,无需重启 |
| 7 | 向下协商 | 2025-11-25 客户端(`initialize` 握手)也能 `tools/list`;`GET`/`DELETE` 回 405 |
| 8 | 退役干净 | `/admin/*` 404;`tools/notes-sync`、`dev.ps1 notes`、`sync-notes` skill 不存在;`.agents` 已重同步 |
| 9 | 构建门禁 | `dev.ps1 check` + `dev.ps1 test` 全过;`--services` 含 `mcp` |
| 10 | 无引导密钥 | 仓库内无 `DEEPSEEK_API_KEY`/`DeepSeekApiKey` 残留;未配 provider 时 `/agent/ask` 回明确的 503 |

## 禁止

- 不改前端页面样式(规则 7)。本轮唯一允许的前端结构性改动是**删除 `/admin` 六页**(功能废弃,ROUNDS.md R6 裁定)与 `next.config.ts` 的供图 rewrite。
- 不加设计稿没有的功能(规则 8)。统计查询 tools 属 R8,本轮不做;`subscriptions/listen` 不实现。
- 不在 in-process agent 进程里注册任何 HTTP / bash / write 类工具(规则 9)。

## 代码审查

- 审查方式:codex `/codex:review --background`(范围:branch diff against main)

### 第 1 轮 — 5 条 findings(3×P1 + 2×P2),**全部采纳整改**

| # | 级别 | findings | 核实 | 处置 |
|---|---|---|---|---|
| 1 | P1 | `.env.example` 用 `Get-Random` 生成 token 与加密密钥 | 属实。PS 5.1 的 `Get-Random` 背后是 `System.Random`(非密码学 PRNG),而 docs/security.md §4 要求 token「高熵随机」 | 改用 `RandomNumberGenerator::Create().GetBytes()`;两处生成命令都重写 |
| 2 | P1 | 清空 `baseUrl`/`models` 时旧 overlay 不会被撤掉 | **属实且有安全后果**。pi 源码注释原文:"Re-registration merges defined values over the previous registration and preserves undefined ones";两字段都为 null 时旧写法干脆不调用 `registerProvider`。表现是所有者以为撤掉了中转,而 key 与 prompt 还在发往那个端点 | `applyLlmConfig` 改为**先 `unregisterProvider` 再按新配置重建**,与合并语义无关。**桩中转实测**:配上 4002 → 会话命中 1 次;清空 baseUrl → 新会话命中数不再增加 |
| 3 | P1 | 切 provider 时 `removeRuntimeApiKey` 会打断旧 provider 的既有会话 | 属实。`ModelRuntime` 是单例,pi 每次请求都经 `prepareRequest → getAuth` 重新解析凭据(源码核实),撤掉 A 的 key 会让 A 的既有会话下一轮失败 | 删掉那次 `removeRuntimeApiKey`(它本来只是「不留无用凭据」的洁癖)。同时**校准文档口径**:换模型只影响新会话,换 key / baseUrl 是进程级的、作用于所有会话的下一轮 |
| 4 | P2 | 可覆盖的附件 URL 不该标 `immutable` | 属实。`notes_asset_put` 明确支持同名覆盖,而 `immutable` 让浏览器一年内不复验 | `Cache-Control` 从 `max-age=31536000, immutable` 改为 `max-age=86400`,保留强 ETag。**没有**改成「强制文件名 = 内容哈希」:存量 56 张的名字是 R5 按源文件算的哈希,与上传字节的哈希对不上,强制等于废掉存量 URL |
| 5 | P2 | `SHA256::HashData` 在 PS 5.1 不存在,文档命令跑不通 | 属实,**当场复现**:`Method invocation failed because [System.Security.Cryptography.SHA256] does not contain a method named 'HashData'` | 换成 `SHA256::Create().ComputeHash(...)`,并在本机 PS 5.1 实跑确认两条命令都出正确结果 |

### 第 2 轮 — 6 条 findings(3×P1 + 3×P2),**5 条采纳整改、1 条不采纳(误报)**

| # | 级别 | findings | 核实 | 处置 |
|---|---|---|---|---|
| 1 | P1 | Caddy 的 `path_regexp` 用 RE2,不支持非捕获组 `(?:…)`,生产会拒绝启动 | **误报**。RE2 支持 `(?:re)`(它不支持的是反向引用与 lookaround)。用真 Caddy 验:`caddy validate` 回 `Valid configuration`;再起容器实跑六条路径,`/notes/pi/abc123.webp → /assets/notes/pi/abc123.webp`、`/notes/pi/01 → WEB`、`/api/mcp → /mcp` 全部正确 | **不采纳**,并把这次实跑当作 Caddy 配置的验收证据留档 |
| 2 | P1 | `/mcp` 端点未标 `sensitive`,凭据会进 Encore trace | **属实,且实测比描述更严重**。本地 trace 里直接读到 `authorization: Bearer <明文管理 token>` —— 服务端只存哈希这件事会被一份 trace 整个抵消。(body 那半条不成立:raw 端点的 `request_payload` 是 `e30=`,即 `{}`,LLM key 没被记) | 加 `sensitive: true`。修后复查同一端点的 trace:`request_headers` 整段消失,payload 变 `<redacted>` |
| 3 | P1 | 热会话不重读 LLM 配置,凭据撤销不可靠 | **属实,但只对了一半**(实测拆开的) | 热路径补上 `applyLlmConfig`。**凭据这一半修好了**:删 provider 后同一个热会话下一轮立即 503(实测)。**端点/模型那一半修不掉**:pi 的 `Model` 对象自带 `baseUrl` 且被 `AgentSession` 从创建起持有,重注册 provider 换不掉它(实测:热会话第 2 轮仍打到已清空的旧中转)。要不要让进行中的对话中途换端点/模型是**产品取舍**,按 CLAUDE.md「审查不负责长出方案」记 BACKLOG 待裁定 |
| 4 | P2 | Encore `bodyLimit` 默认 2 MiB,与工具声明的 10 MiB 上限矛盾 | 属实(类型注释写明默认 2 MiB)。存量最大附件 205 KB,所以回填没暴露它 | 反过来收:`MAX_ASSET_BYTES` 10 MiB → 4 MiB(R5 管线压到 1600px,4 MiB 已是最大存量的 20 倍),`bodyLimit` 显式设 8 MiB。**顺带踩到**:该字段只能写字面量整数,写常量或 `8 * 1024 * 1024` 都报 `expected integer literal` |
| 5 | P2 | 并发 `makeDefault=true` 会撞唯一索引回 500 | 属实。READ COMMITTED 下两个事务各自从自己的快照清旧默认再置位,后提交者撞 `idx_llm_config_single_default`;而 MCP 客户端可以并发发 tool call | 两个相关事务开头加一句 `SELECT provider FROM llm_config FOR UPDATE`,让第二个事务阻塞到第一个提交后**重新求值**。一条语句,不引入锁表/重试机制 |
| 6 | P2 | 大写扩展名的附件能传上去,但生产 Caddy matcher 只认小写 | **属实,同一次 Caddy 实跑复现**:`/notes/pi/abc.PNG` 落到了 WEB 而不是 ASSET | `ASSET_NAME_RE` 去掉 `i` 标志,只收小写。收紧输入比让两处 matcher 变大小写不敏感更省 —— 文件名本来就约定是小写十六进制哈希 |

- 结论:待第 3 轮复审(范围按 CLAUDE.md「第 3 轮起只审整改 diff」)

## 失败处理

同一验收项针对性整改后连续 2 次仍不过 → 写 `rounds/round-06/BLOCKED.md` 停下呼人。

## 本轮实测

### 验收结果

| # | 检查 | 结果 |
|---|---|---|
| 1 | MCP 客户端实连 | ✅ `claude mcp list` → `✔ Connected`。**抓包实测 Claude Code 原生说 2026-07-28**:三个请求依次是 `server/discover` → `subscriptions/listen` → `tools/list`,均带 `MCP-Protocol-Version: 2026-07-28` 与 `Mcp-Method` 头,没有走 initialize 握手 |
| 2 | 认证 | ✅ 无 token / 错 token / 多带一个字符 → 全 401 `unauthorized`(文案一致,不回显细节);带 `Origin` → 403;四次尝试在 `mcp_audit` 各留一条 `denied` 记录 |
| 3 | 发布全链路 | ✅ 新建系列 → 上传 1×1 webp → 发文章引用它 → `/notes/r6-smoke/01` 渲染出图(`naturalWidth=1`,来自 Postgres)→ `/rss.xml` 与 `/rss/engineering.xml` 出现该条 |
| 4 | 存量零回归 | ✅ 56 张存量图经 `notes_asset_put` 回填(6.47 MB),`apps/web/public/notes/` 已删除;`/notes/pi/0b60f550dd19.webp` 仍 200,带强 ETag,`If-None-Match` → 304。文章页(无扩展名)不受 rewrite 影响,仍 200 |
| 5 | key 只见掩码 | ✅ `llm_providers_list` 只回 `sk-…3f9a`;库内 `api_key_enc` 61 字节密文、不含明文;`mcp_audit` 全表搜不到 key 片段 |
| 6 | 模型热生效 | ✅ 切到不存在的模型 → 下一个**新会话** 503;切回 → 新会话建起(服务端日志逐次打 `llm config applied`)。**生效面**见审查段第 2 轮 #3:换 key / 删 provider 对所有会话下一轮生效(实测),换 baseUrl / 换模型只对新会话生效 |
| 7 | 向下协商 | ✅ 2025-11-25 的 `initialize` 握手 200 且 `tools/list` 拿到 21 个工具;`GET`/`DELETE` → 405;不支持的版本 → 400 `UnsupportedProtocolVersionError`;头体不一致 → 400 `-32020 HeaderMismatch` |
| 8 | 退役干净 | ✅ `/admin` 404、`next build` 5 条路由无 admin;`tools/notes-sync`、`dev.ps1 notes`、`sync-notes` skill 已删,`.agents/skills` 重同步为 8 个 |
| 9 | 构建门禁 | ✅ `dev.ps1 check` 通过;`dev.ps1 test` 8 文件 111 用例全过(R6 新增 32 个);`tsc --noEmit` api 与 web 均干净;`--services` 已含 `mcp` |
| 10 | 无引导密钥 | ✅ 活代码与配置里 `DEEPSEEK_API_KEY`/`DeepSeekApiKey` 零残留(只剩历史轮次任务卡的记述);未配 provider 时 `/agent/ask` → `503 对话服务尚未配置模型` |

### 踩到的坑

1. **`@modelcontextprotocol/sdk` 是错的包。** 它最新版(1.30.0,发布于 2026-07-27)的
   `LATEST_PROTOCOL_VERSION` 仍是 `2025-11-25`,`server/discover` 根本不存在。
   2026-07-28 由 SDK **v2** 提供,以全新包名发布(`@modelcontextprotocol/server` /
   `@modelcontextprotocol/client`,2.0.0),旧包停在 1.x。装错包的表现不是编译失败,
   而是做出一个「看起来实现了但协议版本不对」的服务端。

2. **`subscriptions/listen` 不是「不实现就没有」。** 它由 `createMcpHandler` 自带
   (默认上限 1024),而 Claude Code 一连上来就调。留着等于在管理端点上开一条
   Encore 网关下**断连探测不到**的长连 SSE(本仓库 R3/R4 已两次实测确认这一点),
   没有任何东西能收尾。用 `maxSubscriptions: 0` 在开流前拒掉;客户端拿到 `-32603` 照常工作。

3. **供图路由与既有 notes 路由撞车。** `/notes/:series/:file` 和 `/notes/series/:slug`
   在 Encore 路由里同层冲突,只能给 API 侧换前缀(`/assets/notes/…`)。
   而 Next 的数组式 `rewrites` 属 **afterFiles**,在动态路由**之前**生效——
   若不按扩展名限定,`/notes/pi/01` 这种文章页会被一起劫走。

4. **`public/` 会盖住 rewrite。** 图片回填进库之后,`/notes/pi/*.webp` 仍由 Next 从
   `public/` 直接返回(弱 ETag、`max-age=0`),看起来「一切正常」但根本没走新路径。
   必须真的把文件删掉才能验到供图端点。

5. **`import { z } from "zod"` 在 vitest 下是 undefined。** 同一份代码 node / bun 直跑都正常,
   只有 vitest 的 SSR transform 拿不到那个命名空间导出。换成 `import * as z from "zod"`
   (zod 4 把构造器摆在包顶层,语义完全一致)。

6. **`npm run build` 会把正在跑的 `next dev` 搞坏。** 两者共用 `apps/web/.next/`,
   生产构建覆盖掉 dev 的 chunk 之后,页面报 `Cannot find module './833.js'`,
   而后端一切正常——很容易误判成本轮改动的锅。验收时要么先停 dev,
   要么接受之后得 `rm -rf apps/web/.next` 再重起 dev。

7. **`llm_provider_upsert` 原本会静默清零限额。** `apiKey` 是「省略即保留」,其余字段却带
   zod 默认值 → 只想改个 baseUrl 的一次调用把日限额一起清成 0,而回执看起来一切正常。
   已统一成「**省略即保留**,`null` 才是清空」,并补了针对性用例。

### 存量图片如何装进另一个库

镜像里不烧任何 notes 内容,所以每个环境的图片都要各自入库一次。二进制在本轮之后
不再存在于工作区,从 git 历史取(删除前的提交是 `081f56c`):

```bash
git checkout 081f56c -- apps/web/public/notes   # 取回到工作区(不提交)
# 起后端,把 XRAY_MCP_TOKEN 指向目标环境,逐个 notes_asset_put(seriesSlug/name/contentType/dataBase64)
git rm -r --cached apps/web/public/notes && rm -rf apps/web/public/notes
```

预发/生产也可以直接 `pg_dump`/`pg_restore` 搬库(内容是数据,不是制品)。

### 已知遗留(不在本轮整改)

- `apps/web/lib/api-client.ts` 里的 Encore 应用 slug(`gbf6c` → `k2yas`)会随**生成它的 checkout**
  变化:`encore.app` 的 `id` 为空,本地 app 由 cwd 定位并分配随机 slug。它只出现在
  `Environment()` / `PreviewEnv()` / User-Agent 三处,本项目自托管、不用 Encore Cloud,
  功能无影响,但每次换 worktree 生成都会产生噪音 diff。已记 `rounds/BACKLOG.md`。
