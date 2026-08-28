# 安全模型与审计清单

> 本文是实现与部署的强约束,不是建议。任何违反「沙箱化工具执行环境」四层规则的改动都必须先改本文并说明理由。

## 0. 威胁模型

站点公开可访问,访客可与嵌入后端进程的 pi agent 自由对话。核心威胁:

1. **访客借 agent 触达服务器**——通过对话诱导 agent 执行命令 / 读写文件 / 改配置(含 prompt injection)
2. **凭据泄漏**——LLM API key 经由事件流、前端、Git 仓库外泄
3. **资源滥用**——刷爆 LLM 费用、OOM 拖垮单机、把服务器当代理
4. **管理后台被攻破**——弱认证 / 会话劫持 / CSRF

## 1. 沙箱化工具执行环境(四层)

pi agent 需要调用工具(教程库只读查询;后续生图、联网搜索等插件),隔离目标:**用户不能通过 pi 操作服务器的任何设置**。

### 第 1 层 · 工具白名单(管理后台可配)

- `createAgentSession({ noTools: 'all', ... })` 关掉 pi 全部内置工具——bash / read / write / edit / glob 一个不留
- 业务工具经 `defineTool` 逐个注册,注册集合由 `tool_config` 表的启停配置决定(管理后台可切换,集成与下线走代码发布)
- 每个工具必须是**纯函数**:不接触文件系统、不 spawn 进程、不读 `process.env`、不做动态 import
- 执行类内置工具默认**锁定**:开启需「服务器 env `XRAY_UNLOCK_DANGEROUS_TOOLS=1` + 管理后台开关」双闸;所有启停操作写审计日志
- **明文规则:bash / write / 任意代码执行类工具永久禁止进 in-process 进程。** 未来确需执行类能力时,必须独立一次性沙箱容器,不共享本进程

### 第 2 层 · 数据面只读

- 教程库工具走独立 Postgres 角色 `agent_ro`:仅对 `notes_*` 表 `SELECT`,对 `llm_config` / `admin_*` / `tool_config` / `visits` 无任何权限
- 即使 prompt injection 完全操纵了工具调用,能做的也只有「读教程」

### 第 3 层 · 容器隔离

- Encore+pi 进程跑在容器内:非 root 用户、`read_only: true` 根文件系统(仅 tmpfs 可写)、不挂 docker.sock、不挂宿主目录
- `mem_limit` 防单会话 OOM 拖垮全站;并发 session 上限 + 空闲会话回收 + 及时 `dispose()`

### 第 4 层 · 出网管控

- 外呼型工具(LLM / 生图 / 搜索)的 API key 全部服务端持有,目标域白名单
- 每日 token + 费用计数(`daily_quota`),超限拒绝新会话;单会话 turn 上限
- 用户无法借工具把服务器变成任意代理

## 2. 事件流脱敏

- SSE 推送前对每个事件做**白名单字段**过滤(sanitize)
- `before_provider_request` / `before_provider_headers` 中的 Authorization / api-key 字段永不出服务端
- 工具入参/出参截断到固定长度再推送

## 3. 凭据管理

- LLM key:管理后台写入 → 服务端加密存储(Postgres);任何读接口只返回掩码(`sk-…abcd`)
- `.env` 不入 Git;仓库推送前跑 gitleaks;`.gitignore` 已覆盖 `.env*` / `*.key` / `*.pem`
- 服务器上 `.env` 权限 600

## 4. 管理后台(同域 /admin)

- 单管理员;密码 argon2id 哈希;登录限速 + 连续失败锁定
- 会话 cookie:`HttpOnly` + `Secure` + `SameSite=Strict`;写操作校验 CSRF
- 可选:Caddy 层对 `/admin*` 加 IP 白名单
- 登录、配置变更、工具启停全部写审计日志

## 5. 服务器基线(境内轻量服务器)

- SSH 仅密钥登录,禁密码;防火墙只开 80/443(+SSH 端口)
- fail2ban;系统自动安全更新;Caddy 自动 TLS
- 备案期间云厂商封 80/443 → 用 IP + 非标端口自测,备案通过后再绑域名
- **境内直连 Anthropic/OpenAI API 不通或不稳** → LLM 出口配置海外中转端点(自备官方 key),中转地址作为 secrets 管理

## 6. 隐私与合规

- 访问统计自托管:IP 加盐哈希后落库,不存原始 IP;无第三方统计脚本
- 站点无用户注册、无用户上传;About 页仅 GitHub 公开数据

## 7. 供应链

- lockfile 固定版本;`npm audit` 进 CI;Dependabot 开启
- pi 依赖体量大(~130MB),部署镜像分层缓存,升级前先在本地过一遍事件兼容性
