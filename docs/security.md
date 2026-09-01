# 安全模型与审计清单

> 本文是实现与部署的强约束,不是建议。任何违反「沙箱化工具执行环境」四层规则的改动都必须先改本文并说明理由。

## 0. 威胁模型

站点公开可访问,访客可与嵌入后端进程的 pi agent 自由对话。核心威胁:

1. **访客借 agent 触达服务器**——通过对话诱导 agent 执行命令 / 读写文件 / 改配置(含 prompt injection)
2. **凭据泄漏**——LLM API key 经由事件流、前端、Git 仓库外泄
3. **资源滥用**——刷爆 LLM 费用、OOM 拖垮单机、把服务器当代理
4. **管理面被攻破**——MCP 管理端点的 token 泄漏 / 暴力猜测 / 审计缺失

## 1. 沙箱化工具执行环境(四层)

pi agent 需要调用工具(教程库只读查询;后续生图、联网搜索等插件),隔离目标:**用户不能通过 pi 操作服务器的任何设置**。

### 第 1 层 · 工具白名单(MCP 管理面可配)

- `createAgentSession({ noTools: 'all', ... })` 关掉 pi 全部内置工具——bash / read / write / edit / glob 一个不留
- 业务工具逐个注册,注册集合由 `tool_config` 表的启停配置决定(经 MCP 管理面切换,集成与下线走代码发布)
- 每个工具必须是**纯函数**:不接触文件系统、不 spawn 进程、不读 `process.env`、不做动态 import
- 执行类内置工具默认**锁定**:开启需「服务器 env `XRAY_UNLOCK_DANGEROUS_TOOLS=1` + MCP 管理面开关」双闸;所有启停操作写审计日志
- **明文规则:bash / write / 任意代码执行类工具永久禁止进 in-process 进程。** 未来确需执行类能力时,必须独立一次性沙箱容器,不共享本进程

R7 落地补记(2026-09-01,`apps/api/agent/tools.ts` + `runtime.ts`):

- **三个参数是一组闸**:`noTools:"all"` 起步 + `customTools`(本轮启用工具的实现)+ `tools`(显式白名单)。pi 的取值是 `options.tools ?? (noTools ? [] : 默认内置)`,给了白名单就只有名单里的会被激活。**实测**(faux provider 驱动真实 agent loop):`getActiveToolNames()` 与 `getAllTools()` 都只有我们那三个,内置工具一个不出现;工具全关时两者皆空
- **`tool_config` 只能开关「已实现的工具」,不能凭名字长出工具**:表里的未知名字在注册阶段被丢弃并记日志。bash / write 这类名字在 `TOOL_REGISTRY` 里**不存在** —— 上面那条「永久禁止」的物理落点是没有实现,不是配置关掉。**实测**:被诱导的模型直接点名 `bash`,pi 回 `Tool bash not found`
- **`process.env` 的双闸读在注册环节**,不在工具体内:工具本身仍是纯函数。表里 `dangerous=true` 且缺 `XRAY_UNLOCK_DANGEROUS_TOOLS=1` → 不注册(当前注册表没有任何 dangerous 实现,这是给将来准备的闸)
- **工具集变更 = 会话重建**:工具白名单在 `createAgentSession` 时定格,事后开关对内存里的会话无效。所以它并进 R6 那个 `configFingerprint`,走同一条「配置指纹变了,会话下一轮被重建」的统一规则
- **工具结果有界**(8000 字符,超出截断并标注)且**异常不外泄**:数据库错误只进服务端日志,给模型的是一句固定文案 —— 工具结果会进模型上下文 → 进轨迹事件 → 经公开的 `/trace/stream` 出去(§2)

### 第 2 层 · 数据面只读

- 教程库工具走独立 Postgres 角色 `agent_ro`:仅对 `notes_categories` / `notes_series` / `notes_chapters` 三张表 `SELECT`,对 `llm_config` / `tool_config` / `about_content` / `notes_assets` / `mcp_audit` / `daily_quota` / `visits` 无任何权限
- 即使 prompt injection 完全操纵了工具调用,能做的也只有「读教程」

R7 落地补记(2026-09-01,所有者裁定;`apps/api/agent/ro-db.ts` + 迁移 `004`):

- **角色是真的,登录能力没有**:`agent_ro` 建成 `NOLOGIN`,由应用连接在事务里 `SET LOCAL ROLE agent_ro` 临时降权,而不是另开一条 `AGENT_RO_DATABASE_URL` 连接。权限仍由 Postgres 强制(降权后 `current_user` 就是 `agent_ro`,写 notes 表回 `permission denied`),但省掉了一个 pg 驱动依赖、一份角色口令(`.env` / initdb / secret 各一处)和一个 Encore 管不到的第二连接池
- **换这条路的决定性理由是验收能不能跑**:本机 encore 的库由 CLI 托管,`agent_ro` 的登录口令进不到那套托管配置里,「以 agent_ro 写库必须失败」只能推到部署轮人工核验;而 M2 的止损写的是「R7 沙箱验收不过不得进入任何公网部署轮」。改成 `SET LOCAL ROLE` 之后这条验收进了 `dev.ps1 test`(`apps/api/agent/sandbox.test.ts`)
- **必须是 `SET LOCAL` 而不是 `SET`**:Encore 的连接是池化的,`SET ROLE` 会留在连接上,归还池子后下一个请求(包括 MCP 管理面的写请求)会继承降权状态。`SET LOCAL` 随事务结束复位
- **同一段事务还叠了 `SET TRANSACTION READ ONLY` 与 `statement_timeout`**:前者挡「工具实现自己写错 SQL」,与角色权限是两道独立的闸;后者是第 4 层「资源滥用」的一部分
- **后建的表不自动授权**:刻意不设 `ALTER DEFAULT PRIVILEGES`。将来新增内容表要给 agent 看,必须在那次迁移里显式 `GRANT` —— 忘了写的后果是工具读不到(报错、看得见),而不是悄悄多出一张可读的表

### 第 3 层 · 容器隔离

- Encore+pi 进程跑在容器内:非 root 用户、`read_only: true` 根文件系统(仅 tmpfs 可写)、不挂 docker.sock、不挂宿主目录
- `mem_limit` 防单会话 OOM 拖垮全站;并发 session 上限 + 空闲会话回收 + 及时 `dispose()`

### 第 4 层 · 出网管控

- 外呼型工具(LLM / 生图 / 搜索)的 API key 全部服务端持有,目标域白名单
- 每日 token + 费用计数(`daily_quota`),超限拒绝新会话;单会话 turn 上限
- 用户无法借工具把服务器变成任意代理

R7 落地补记(2026-09-01,`apps/api/agent/quota.ts` + 迁移 `004`):

- **限额值与用量分两张表**:值在 R6 的 `llm_config` 默认行(`daily_token_limit` / `daily_cost_limit_cents` / `max_turns_per_session`,**0 = 不限**,经 MCP 改),用量在 `daily_quota`(每轮累加)。变更节奏不同,合表会让「改配置」与「跑对话」抢同一行
- **日界写死 `Asia/Shanghai`**,不用 UTC 也不依赖服务器 TZ:所有者在境内,「今天的额度」应当在本地零点重置;容器里 TZ 通常是 UTC,依赖它等于让日界随部署环境漂移
- **费用存 micro-USD(整数)**:provider 回的一轮成本常在 1e-5 美元量级,按分四舍五入会把绝大多数轮次记成 0,累计永远追不上限额。比较时把 cents 换算成 micros
- **「新会话」的判据是库里有没有轮次(`turns === 0`),不是请求里带没带 `sessionId`**:`POST /agent/sessions` 是**公开**端点、建的是空会话。按「带了 id 就算续接」判定的话,先批量预建会话再逐个带 id 提问,每日限额会被整体绕过(codex 初审 P1 实指)。以轮次为判据,预建的空会话与全新会话落在同一格
- **「超限拒新会话」的溢出上界是可算的**:限额触发后,最多还有 `MAX_ACTIVE_SESSIONS`(8)个会话各自把 `max_turns_per_session` 的剩余轮数跑完。要收紧就调小 `max_turns_per_session`,不要改成「中途掐断进行中的对话」
- **计数是尽力而为的资源闸,不是账单**:`recordUsage` 失败只记日志、不重试、不把已完成的一轮报成失败。一轮可能有多条助手消息(开了工具之后「助手 → 工具 → 助手」是常态),必须逐条累加 —— **实测**一次工具轮的两条助手消息各带 `usage`(`totalTokens` 1330 / 1054),只取最后一条会漏掉一半
- **拒绝体只出 `code` 不出数字**:`429` + `daily_tokens` / `daily_cost` / `turn_limit`。把「已用 12345 / 上限 10000」写进响应等于把站点的限额配置告诉每一个撞上它的访客;数字只进服务端日志

## 2. 事件流脱敏

- SSE 推送前对每个事件做**白名单字段**过滤(sanitize)
- `before_provider_request` / `before_provider_headers` 中的 Authorization / api-key 字段永不出服务端
- 工具入参/出参截断到固定长度再推送

## 3. 凭据管理

- LLM key:经 MCP 管理面写入 → 服务端加密存储(Postgres);任何读接口**含 MCP tool result**只返回掩码(`sk-…abcd`)——tool result 会进入 MCP 客户端的模型上下文,掩码必须在服务端完成
  - **不存在引导凭据**(所有者裁定 2026-08-31,R6 落地):R1–R5 期间的 Encore secret `DeepSeekApiKey` 已**彻底移除**——secret 声明、`deploy/infra-config.json` 的 secrets 段、compose 的 `DEEPSEEK_API_KEY` 三处一并删除。运行期 LLM 凭据的**唯一来源是 `llm_config` 表**,密文由 `ConfigEncryptionKey` 解开。代价已认:新环境首次部署后必须先经 MCP 的 `llm_provider_upsert` 写入一个 provider,`/agent/ask` 才可用(在那之前回明确的 503,不是含糊的模型错误)
  - 加密口径:AES-256-GCM,密文布局 `nonce(12)‖ct‖tag(16)` 存 BYTEA(`apps/api/shared/crypto.ts`)。选认证加密是为了让「库被改一个字节」直接解密失败,而不是解出一段垃圾 key 去打 provider。`ConfigEncryptionKey` 换掉 = 既有密文全部作废,必须经 MCP 重写各 provider 的 key
  - `ConfigEncryptionKey` 与 `McpAuthTokenHash` 都不是可直接使用的凭据:前者是密钥、后者是**哈希**,拿到它们既登不了管理面也用不了 LLM
- `.env` 不入 Git;仓库推送前跑 gitleaks;`.gitignore` 已覆盖 `.env*` / `*.key` / `*.pem`
- 服务器上 `.env` 权限 600

## 4. 管理面(无状态 MCP,`/api/mcp`)

> 2026-08-31 所有者裁定:原 `/admin` 后台(画板 3a–3e)整体废弃,唯一管理入口改为**无状态 MCP server**(2026-07-28 规范为目标版本,保留 SDK 向下协商),所有者以 MCP 客户端(Claude Code 等)操作。本节替代原「管理后台(同域 /admin)」全部条款。

- 单管理员;认证 = **静态 bearer token**:高熵随机、服务端只存哈希、经 secret/`.env` 注入,永不入 Git 与日志(solo 维护,不上 OAuth——规范的 authorization 章节为可选项,此为显式取舍)
- 无 cookie 会话,故无 CSRF 攻击面;仅 HTTPS(Caddy 终止);可选:Caddy 层对 `/api/mcp` 加 IP 白名单
- 认证失败一律拒绝且不回显细节(是没带、格式不对、还是值不对,对调用方都是同一句 `unauthorized`——差异化文案等于帮猜 token 的人做二分);失败尝试与全部写操作(内容、配置、工具启停)写审计日志
- **两个面互不触碰**:MCP 服务用全权 DB 角色写库;pi agent 工具仍走 `agent_ro` 只读,且 in-process 进程无 HTTP 类工具、物理上不可达 MCP 端点。`encore gen client` 也显式排除 mcp 服务,浏览器包里不出现管理面的类型化包装

R6 落地补记(2026-08-31):

- **审计表 `mcp_audit`** 字段:`outcome`(ok/denied/error)· `method` · `tool` · `summary`(过 `shared/redact` 口径,不含请求原文)· `remote` · `detail`。`remote` 存的是**所有者自己的**来源地址(反代 XFF 首段),与 §6「访客统计不存原始 IP」不是同一件事:管理面只有一个使用者,审计要能回答「这次写入从哪儿发起」
- **带 `Origin` 头的请求一律 403**。规范要求校验 Origin 防 DNS rebinding;管理面没有浏览器客户端(所有者用的是 Claude Code 这类进程内客户端,它们不发 Origin),所以「有 Origin 就拒」比维护一份随环境漂移的域名白名单更严也更省。将来真要接浏览器客户端,改成白名单并同步本条
- **`subscriptions/listen` 显式关闭**(`maxSubscriptions: 0`)。它是 SDK 自带的,而 Claude Code 一连上来就会调(实测抓包)。开着等于在管理端点上留长连 SSE,而 Encore 网关**不把客户端断开传导进来**(见 `apps/api/trace/README.md`),那些流没有东西能收尾。管理面本无订阅需求
- **附件是可执行文档的入口**:上传只接受 webp/png/jpeg/gif,**SVG 永不接受**(同源下的存储型 XSS);扩展名、`contentType`、文件头魔数三者必须一致;供图响应带 `X-Content-Type-Options: nosniff`

## 5. 服务器基线(境内轻量服务器)

- SSH 仅密钥登录,禁密码;防火墙只开 80/443(+SSH 端口)
- fail2ban;系统自动安全更新;Caddy 自动 TLS
- 备案期间云厂商封 80/443 → 用 IP + 非标端口自测,备案通过后再绑域名
- **境内直连 Anthropic/OpenAI API 不通或不稳** → LLM 出口配置海外中转端点(自备官方 key),中转地址作为 secrets 管理

## 6. 隐私与合规

- 访问统计自托管:IP 加盐哈希后落库,不存原始 IP;无第三方统计脚本
- 站点无用户注册、无用户上传;About 页仅所有者经管理面发布的公开信息(GitHub / origin 链接等)

## 7. 供应链

- lockfile 固定版本;`npm audit` 进 CI;Dependabot 开启
- pi 依赖体量大(~130MB),部署镜像分层缓存,升级前先在本地过一遍事件兼容性
