# Round 11 — 生产部署上线

<!-- 保存为 rounds/round-NN/round-NN.md;该轮其他管理产出放同一目录。 -->

> 状态:进行中(2026-08-28 提前开工:仅「服务器初始化 + 备案启动」两项;compose 部署与上线冒烟等 R9/R10 收口后继续)
>
> **2026-09-02:ICP 备案通过**,备案号 `苏ICP备2025204887号-2`(所有者提供)。同日所有者一次性裁定五条(见下「2026-09-02 备案通过后的裁定」),
> 其中「先做 R-TOOLS 再上线」把本轮的开工时点推到 R-TOOLS 合并之后。

## 目标

生产服务器(106.54.238.52)完成安全基线初始化与备案/域名前置流程,并在 R9/R10 收口后以 docker compose 完成生产部署与上线冒烟。

## 前置

- ✅ 生产服务器采购完成:腾讯云轻量 lhins-ikjrb7pc,106.54.238.52,Ubuntu 24.04.4 LTS,2 vCPU / 3.6 GiB / 69G(2026-08-28,所有者提供 `ckclaude.pem`)
- ✅ compose 部署段的两个前置轮已收口:**R9**(镜像构建 + deploy/ 定稿 + 130 预发跑通)、**R10**(上线检查单在 130 上 1–11 全绿,留证 [`rounds/round-10/checklist.md`](../round-10/checklist.md);检查单在 **`docs/deploy-cn-lightweight.md` §6**,不在 security.md)。**M4 止损仍然适用于生产**:同一份检查单要在生产**重跑**才算数,R10 证的是预发
- ◐ **R10 交接的四条**:②④已于 2026-09-02 由所有者裁定(见下),①③仍待部署时执行
  - ⬜ ①检查单在生产重跑(判据已按 R10 实测修准,别用旧措辞核)
  - ✅ ②`/api/mcp` 的 Caddy IP 白名单 —— **所有者裁定暂不启用,只靠 token**(2026-09-02),理由与残留风险见下
  - ⬜ ③写生产 LLM provider 时 key **直接贴进 MCP 调用、不落盘**(130 上的 `~/deploy/.llm-key` 就是这么留下的,见 BACKLOG)
  - ✅ ④**安全响应头**上线时一并加保守一组、**pg 备份继续不做**(2026-09-02 裁定,见下)
- ✅ **ICP 备案通过**(2026-09-02):`苏ICP备2025204887号-2`,主体「个人知识分享站」,域名 `kzgai.cloud`
- ⬜ **R-TOOLS 先于本轮**(所有者裁定 2026-09-02):本轮的镜像构建要等 R-TOOLS 合并 `main` 之后再起
- ⬜ **一次 130 预发升级是本轮的必经前置**,不是可选项:130 停在 `7cc17fe`(迁移 7),而 `main` 已含
  R-WEBSEARCH(迁移 008)与 R-TITLE(迁移 009)**两轮从未在部署形态下跑过的代码**;R-TITLE 的验收
  #1(真模型会不会调 `session_rename`)与 #7(经 MCP 关停)当初就明确交接给 130 实测、至今未验

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
| 7 | ICP 备案通过,域名 A 记录解析到服务器 | 备案号下发;`dig <域名>` 指向 106.54.238.52 | ✅ 2026-09-02 备案通过,`苏ICP备2025204887号-2`;解析早于 2026-08-28 生效(`kzgai.cloud`/`www` 境内外 DNS 均指向服务器)。**部署时复核一次 `域名:80` 不再被拦截**(备案前实测是切断) |
| 8 | Caddy 自动 TLS,HTTPS 可访问 | 备案后放开 80/443,证书自动签发 | ⬜ 待部署。**Caddyfile 要从 `:80` 改成域名**——130 与生产共用一份文件,改法见下「2026-09-02 裁定」第 5 条 |
| 9 | 生产 compose 全链路冒烟 | 三 Tab + SSE ×2 + 限额,按 R9 预发同口径(**R6 起无 `/admin`**,管理面走 MCP,见 11/12) | ⬜ 待 R9/R10 |
| 10 | 备案号挂 footer | web footer 显示备案号 | ⬜ 待部署。备案号已到手,填生产 `.env` 的 `ICP_BEIAN=苏ICP备2025204887号-2` 即可(**运行期注入**——`SiteFooter` 用 `await connection()` 把渲染推到请求期,不会被烧进构建产物;130 保持留空)。**公安联网备案另算**,见「所有者 TODO」第 6 条 |
| 11 | 生产 MCP token 已生成并留存,轮换路径验过 | **部署前**:按 `deploy/.env.example` 的 CSPRNG 口径生成一对,哈希进生产 `~/deploy/.env` 的 `MCP_AUTH_TOKEN_HASH`、原文进密码管理器 + 本机用户级 `XRAY_MCP_TOKEN_PROD`,**不复用 130 那把**(一把 token 只开一扇门)。轮换演练一次:改哈希 → `docker compose up -d api` **重建容器**(env 变了 `restart` 不生效)→ 旧 token 401 / 新 token 通,全程**不动** `CONFIG_ENCRYPTION_KEY` | ⬜ 待部署 |
| 12 | MCP 管理面在生产实连(协议 **2026-07-28**) | `server/discover` 回 `supportedVersions: ["2026-07-28"]` + `serverInfo`,`tools/list` 出 **28** 个工具(R10 留证里的 24 是 R-WEBSEARCH 之前的数,以 `apps/api/mcp/tools.ts` 的 `registerTool` 计数为准)——请求体形状照 [`rounds/round-10/checklist.md`](../round-10/checklist.md) §9(逐请求四件套缺一样就是 4xx,`_meta` 三键必须在 `params` 里);再经 `.mcp.json` 新增的 `xray-admin-prod` 用 Claude Code 实连一次。**必须早于「写生产 LLM provider」通过**(R6 起无引导密钥,不通则 `/agent/ask` 永远 503);**交接项②的 IP 白名单启用后要复验一次**(白名单先于 token 生效,漏验的表现是 token 明明对却 403) | ⬜ 待部署 |

## 所有者 TODO(Claude 无法代办)

1. ~~腾讯云控制台防火墙放行 80/443/8080~~ ✅ 2026-08-28 所有者已放行,外网实测三端口均可达
2. ~~**域名购买 + ICP 个人备案**~~ ✅ 域名 `kzgai.cloud` 已购(腾讯云,`.cloud` 有工信部信管函〔2018〕367号批复);备案 2026-08-28 提交,**2026-09-02 通过**,备案号 `苏ICP备2025204887号-2`(服务名称「个人知识分享站」,类目「其他,博客/个人空间」)
3. ~~备案通过前 80/443 被云厂商拦截 → 期间自测走 `IP:8080`~~ ✅ 已解除(备案通过);`IP:8080` 这条自测路径部署后可收掉(ufw 与云控制台两处都要关)
4. **生产 MCP token 原文存进密码管理器**(验收 11):服务端只存 sha256,原文丢了不能找回、只能轮换。轮换时 `CONFIG_ENCRYPTION_KEY` **绝不能跟着换**——换了 `llm_config` 里的 LLM key 密文全部解不开,agent 立刻停摆,得把每个 provider 的 key 经 `llm_provider_upsert` 重写一遍
5. ~~**提供 Caddy IP 白名单要放行的真实出口 IP**(R10 交接项②)~~ ✅ 2026-09-02 裁定**暂不启用**,不再需要 IP
6. **公安联网备案(待所有者确认口径)**:ICP 备案通过后,按规定还需在网站开通后 30 日内办理公安网安备案,并在页面底部同时挂公安备案号(链到 `beian.mps.gov.cn`)。**当前 `SiteFooter` 只支持一个 ICP 号**,要挂第二个号得改组件(与 ICP 号同属规则 8「docs 的部署约束不是新功能」口径)。请确认腾讯云侧提示的具体要求与时限后再定改不改
7. **真实内容**:生产是空库 —— 130 上那 13 系列 / 205 章节 / 103 张配图在 130 的库里,生产要经 MCP 重发一遍(幂等,130 上实测 22s);About 还是 R9 写的样本文案,需要所有者给真实内容(BACKLOG 有条目)

## 2026-09-02 备案通过后的裁定(所有者一次性定了五条)

备案通过解锁的是「域名 + TLS + footer 备案号 + 生产管理面走 HTTPS」这一组,但它不是可以直接开发版的信号。
所有者当日就以下五条给了结论:

1. **R-TOOLS 先于 R11**。理由:无论如何都要走一次「构建 → 130 预发验 → 生产发」(见上「前置」最后一条),
   把 R-TOOLS 一起带上就只走一次,生产首发即最终形态,也符合部署矩阵写的「生产与预发同一个 SHA 镜像、不重建」。
   代价是上线晚一轮。

2. **pg 备份继续不做**(维持 R10 裁定)。**代价是显式的**:`docs/deploy-environments.md` 第 7 条与
   `docs/deploy-cn-lightweight.md` §3 里「涉及不可逆迁移时先恢复备份」继续是**悬空引用**,镜像回滚能回代码、回不了数据,
   而生产马上会有真实内容(205 篇正文 + 103 张配图 + 加密入库的 LLM/搜索凭据)。
   → **由此派生一条本轮硬约束,写进下方「禁止」:上线期间不做不可逆迁移。** 没有恢复点的时候,
   「不可逆」这三个字就没有兜底可言。BACKLOG 那条不关闭,继续挂着。

3. **安全响应头:上线时一并加保守的一组**,按规则 9 先补 `docs/security.md` 一节再改 `deploy/Caddyfile`。
   范围 = `X-Content-Type-Options: nosniff` / `Referrer-Policy` / `X-Frame-Options`(或 CSP `frame-ancestors`)/
   `Permissions-Policy` + **HSTS**(现在有 TLS 了,R10 当时不开正是因为 130 是 http、提前发会把内网 IP 锁进 HTTPS)。
   **不含 CSP 主体** —— Next.js 的 inline script 需要 nonce 机制,属机制类改动,不在本轮。
   HSTS 上线时 `max-age` 先给小值(如 300)确认证书链没问题再调大,`preload` 不加。

4. **`/api/mcp` 的 Caddy IP 白名单暂不启用,只靠 token**(R10 交接项②结论)。
   **残留风险要认**:公网上一把可复用的高权限 bearer token 就是唯一防线。当前兜底是
   ①HTTPS(备案通过后 Caddy 自动 TLS,不再是 130 那种内网明文)②`mcp/audit.ts` 的审计
   ③token 是 CSPRNG 生成、服务端只存 sha256、轮换路径已在 130 实测过。
   **别忘了 BACKLOG 里那条**:`audit.ts` 的 `remoteOf` 取 XFF 第一段可被写入方伪造,当前靠 Caddy 覆盖 XFF 挡住 ——
   白名单不启用意味着这层保护在生产也只剩 Caddy 那一道,给 Caddy 配 `trusted_proxies` 或前面再加一层代理时会失效。

5. **Caddyfile 的域名化**(实现细节,尚未落地):130 用 `:80`、生产用 `kzgai.cloud`,两边共用一份部署资产。
   建议用 Caddy 的环境变量占位 `{$SITE_ADDRESS::80}` —— 130 不填保持 `:80`,生产在 `.env` 里填域名,
   比维护两份 Caddyfile 干净。**改完要在 130 上先验一次**(不填变量时行为不变),再用于生产。

## 禁止

- **上线期间不做不可逆迁移**(2026-09-02 裁定 2 的派生约束):没有备份就没有恢复点。
  如果 R-TOOLS 或后续轮次带来了不可逆迁移,先回所有者重裁备份那条,不在本轮里赌
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
