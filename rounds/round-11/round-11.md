# Round 11 — 生产部署上线

<!-- 保存为 rounds/round-NN/round-NN.md;该轮其他管理产出放同一目录。 -->

> 状态:进行中(2026-08-28 提前开工:仅「服务器初始化 + 备案启动」两项;compose 部署与上线冒烟等 R9/R10 收口后继续)

## 目标

生产服务器(106.54.238.52)完成安全基线初始化与备案/域名前置流程,并在 R9/R10 收口后以 docker compose 完成生产部署与上线冒烟。

## 前置

- ✅ 生产服务器采购完成:腾讯云轻量 lhins-ikjrb7pc,106.54.238.52,Ubuntu 24.04.4 LTS,2 vCPU / 3.6 GiB / 69G(2026-08-28,所有者提供 `ckclaude.pem`)
- ✅ compose 部署段的两个前置轮已收口:**R9**(镜像构建 + deploy/ 定稿 + 130 预发跑通)、**R10**(上线检查单在 130 上 1–11 全绿,留证 [`rounds/round-10/checklist.md`](../round-10/checklist.md);检查单在 **`docs/deploy-cn-lightweight.md` §6**,不在 security.md)。**M4 止损仍然适用于生产**:同一份检查单要在生产**重跑**才算数,R10 证的是预发
- ⬜ **R10 交接的四条,本轮逐条给结论**:①检查单在生产重跑(判据已按 R10 实测修准,别用旧措辞核);②`/api/mcp` 的 Caddy IP 白名单按**真实出口 IP** 启用(模板在 `deploy/Caddyfile` 第 45–51 行,R10 只核对未启用);③写生产 LLM provider 时 key **直接贴进 MCP 调用、不落盘**(130 上的 `~/deploy/.llm-key` 就是这么留下的,见 BACKLOG);④**安全响应头**与 **pg 备份**上线前再裁定(均在 BACKLOG;备份那条决定「不可逆迁移出错」有没有兜底)
- ⬜ ICP 备案(所有者操作,周期 1–3 周,见下「所有者 TODO」)

## 交付物

- 服务器安全基线配置(远端 `/etc/ssh/sshd_config.d/60-xray-hardening.conf`、`/etc/fail2ban/jail.d/sshd.local`、`/etc/apt/apt.conf.d/20auto-upgrades`、`/etc/docker/daemon.json`、ufw 规则)——记录见本卡「本轮实测」
- 本机 SSH 入口:`~/.ssh/ckclaude.pem` + `~/.ssh/config` 别名 `agent-xray-prod`(ubuntu 管理用)/ `deploy@106.54.238.52`(部署用)
- (R9/R10 后)生产 compose 部署执行记录 + 上线冒烟记录,回填本卡
- 生产 MCP 管理面凭据:服务器只有 sha256(`~/deploy/.env` 的 `MCP_AUTH_TOKEN_HASH`),token 原文只在所有者密码管理器 + 本机用户级环境变量 `XRAY_MCP_TOKEN_PROD`;`.mcp.json` 新增 `xray-admin-prod` 条目(备案通过前 url 走 `http://106.54.238.52:8080/api/mcp`,通过后换 `https://kzgai.cloud/api/mcp`)。**留存这一步是 R9 的教训**:130 那把 token 部署时没留存、不可恢复,2026-09-01 只能整体轮换一次

## 验收

| # | 检查 | 命令 / 期望 | 状态 |
|---|---|---|---|
| 1 | SSH 仅密钥登录 | `sudo sshd -T`:`passwordauthentication no`、`permitrootlogin no` | ✅ 2026-08-28 |
| 2 | 防火墙仅开必要端口 | `ufw status`:22/80/443/8080 ALLOW,其余默认拒;云控制台防火墙同步 | ✅ 2026-08-28 双层齐(外网实测 80/443/8080 均可达) |
| 3 | fail2ban sshd jail 运行 | `fail2ban-client status sshd` 有 filter/actions 输出 | ✅ 2026-08-28 |
| 4 | 自动安全更新开启 | `20auto-upgrades`:Update-Package-Lists=1 + Unattended-Upgrade=1 | ✅ 2026-08-28 |
| 5 | Docker + Compose 可用,拉镜像走加速 | `docker run hello-world` 成功;daemon.json 配 registry-mirrors | ✅ 2026-08-28 |
| 6 | deploy 用户可密钥登录并操作 docker | `ssh deploy@106.54.238.52 docker ps` 成功 | ✅ 2026-08-28 |
| 7 | ICP 备案通过,域名 A 记录解析到服务器 | 备案号下发;`dig <域名>` 指向 106.54.238.52 | ◐ 解析已生效(2026-08-28,`kzgai.cloud`/`www` 境内外 DNS 均指向服务器,`域名:8080` 实测 HTTP 200;`域名:80` 被备案拦截切断=预期);⬜ 备案审核中 |
| 8 | Caddy 自动 TLS,HTTPS 可访问 | 备案后放开 80/443,证书自动签发 | ⬜ 待 R9/R10 |
| 9 | 生产 compose 全链路冒烟 | 三 Tab + SSE ×2 + 限额,按 R9 预发同口径(**R6 起无 `/admin`**,管理面走 MCP,见 11/12) | ⬜ 待 R9/R10 |
| 10 | 备案号挂 footer | web footer 显示备案号 | ⬜ 待备案下发 |
| 11 | 生产 MCP token 已生成并留存,轮换路径验过 | **部署前**:按 `deploy/.env.example` 的 CSPRNG 口径生成一对,哈希进生产 `~/deploy/.env` 的 `MCP_AUTH_TOKEN_HASH`、原文进密码管理器 + 本机用户级 `XRAY_MCP_TOKEN_PROD`,**不复用 130 那把**(一把 token 只开一扇门)。轮换演练一次:改哈希 → `docker compose up -d api` **重建容器**(env 变了 `restart` 不生效)→ 旧 token 401 / 新 token 通,全程**不动** `CONFIG_ENCRYPTION_KEY` | ⬜ 待部署 |
| 12 | MCP 管理面在生产实连(协议 **2026-07-28**) | `server/discover` 回 `supportedVersions: ["2026-07-28"]` + `serverInfo`,`tools/list` 出 **28** 个工具(R10 留证里的 24 是 R-WEBSEARCH 之前的数,以 `apps/api/mcp/tools.ts` 的 `registerTool` 计数为准)——请求体形状照 [`rounds/round-10/checklist.md`](../round-10/checklist.md) §9(逐请求四件套缺一样就是 4xx,`_meta` 三键必须在 `params` 里);再经 `.mcp.json` 新增的 `xray-admin-prod` 用 Claude Code 实连一次。**必须早于「写生产 LLM provider」通过**(R6 起无引导密钥,不通则 `/agent/ask` 永远 503);**交接项②的 IP 白名单启用后要复验一次**(白名单先于 token 生效,漏验的表现是 token 明明对却 403) | ⬜ 待部署 |

## 所有者 TODO(Claude 无法代办)

1. ~~腾讯云控制台防火墙放行 80/443/8080~~ ✅ 2026-08-28 所有者已放行,外网实测三端口均可达
2. **域名购买 + ICP 个人备案**:✅ 域名 `kzgai.cloud` 已购(腾讯云,`.cloud` 有工信部信管函〔2018〕367号批复);备案 2026-08-28 已提交审核——服务名称「个人知识分享站」,类目「其他,博客/个人空间」,备注按「个人非经营性技术博客、无 UGC、无前置审批内容」口径;⬜ 等审核结果(腾讯云初审 1–2 天 → 管局 1–3 周)
3. 备案通过前 80/443 被云厂商拦截 → 期间自测走 `IP:8080`
4. **生产 MCP token 原文存进密码管理器**(验收 11):服务端只存 sha256,原文丢了不能找回、只能轮换。轮换时 `CONFIG_ENCRYPTION_KEY` **绝不能跟着换**——换了 `llm_config` 里的 LLM key 密文全部解不开,agent 立刻停摆,得把每个 provider 的 key 经 `llm_provider_upsert` 重写一遍
5. **提供 Caddy IP 白名单要放行的真实出口 IP**(R10 交接项②):启用后非白名单来源访问 `/api/mcp` 一律 403,与 token 是否正确无关;家宽出口 IP 会漂,需要确认是固定 IP 还是接受「漂了就改 Caddyfile」

## 禁止

- 不改前端页面样式(CLAUDE.md 规则 7);不加设计稿没有的功能(规则 8)
- 生产部署方式只用 docker compose,禁止服务器上 `encore run`(规则 10)
- R10 检查单不全绿不执行生产部署(M4 止损)
- `.env`/密钥不入 Git;`ckclaude.pem` 只存本机 `~/.ssh/`,不进仓库

## 代码审查

<!-- 完成后回填。本轮当前无仓库代码改动(仅远端服务器配置 + 本任务卡),compose 部署段完成后走 codex 审查。 -->

- 审查方式:待 compose 部署段完成后定
- findings 处理:—
- 结论:—

## 失败处理

同一验收项针对性整改后连续 2 次验证仍不过 → 写 `rounds/round-11/BLOCKED.md`,停下呼人。禁止放宽验收标准自我通过。

## 本轮实测

### 2026-08-28 服务器初始化(docs/security.md §5 + docs/deploy-cn-lightweight.md §2)

- **连接**:root 登录被拒(镜像默认),密钥绑定用户为 `ubuntu`;本机密钥 ACL 需 `icacls /inheritance:r /grant:r <user>:R` 收紧,否则 Windows OpenSSH 报 UNPROTECTED PRIVATE KEY FILE 拒用
- **sshd**:镜像出厂已 `PasswordAuthentication no`(cloud-init);补 `PermitRootLogin no` 于 `60-xray-hardening.conf`,`sshd -t` 校验后重启生效
- **ufw**:allow 22/80/443/8080 后 enable;8080 为备案前非标端口自测用,上线后可收掉
- **fail2ban**:Ubuntu 24.04 无 rsyslog,sshd jail 必须 `backend = systemd` 才能起
- **Docker**:get.docker.com `--mirror Aliyun` 安装 Docker 29.7.2 + Compose v5.5.0;`daemon.json` registry-mirrors 配腾讯内网 `https://mirror.ccs.tencentyun.com`(秒拉),另限 json-file 日志 50m×3
- **deploy 用户**:`adduser --disabled-password` + docker 组,authorized_keys 复用 ubuntu 同一把公钥;`ssh deploy@… docker ps` 验证通过
- **外网连通实测**(2026-08-28,所有者放行控制台防火墙后):服务器临时 `python3 -m http.server`(timeout 45s 自动退出),本机 curl `http://106.54.238.52:{80,443,8080}` 全部 HTTP 200、~0.07s——两层防火墙齐,备案前 `IP:8080` 自测路径可用;80/443 当前 IP 直连未见拦截,域名接入后以备案状态为准
- **踩坑**:PowerShell 5.1 向 ssh 传含双引号的多行脚本会剥引号,写坏远端配置文件(`printf "a\nb"` 变多参数);改用 Git Bash heredoc(`ssh host bash -s <<'EOF'`)后正常——后续远端脚本一律走 heredoc
