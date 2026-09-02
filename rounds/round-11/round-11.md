# Round 11 — 生产部署上线

<!-- 保存为 rounds/round-NN/round-NN.md;该轮其他管理产出放同一目录。 -->

> 状态:**已完成**(2026-09-02 收工,所有者裁定)。站点 https://www.kzgai.cloud/ 已上线并可用;收工时明确跳过的四项与代价见文末「收工」段。
>
> 历史:2026-08-28 提前开工(仅「服务器初始化 + 备案启动」两项);2026-09-02 备案通过后一日内完成访问层预检、部署、内容迁移、provider 配置与全链路验收
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
| 7 | ICP 备案通过,域名 A 记录解析到服务器 | 备案号下发;`dig <域名>` 指向 106.54.238.52 | ✅ 2026-09-02 备案通过,`苏ICP备2025204887号-2`;解析早于 2026-08-28 生效(`kzgai.cloud`/`www` 境内外 DNS 均指向服务器)。80 的状态最终是**刻意无响应**(所有者要求),不再需要「复核不被拦截」 |
| 8 | Caddy 自动 TLS,HTTPS 可访问 | 备案后放开 80/443,证书自动签发 | ✅ **2026-09-02 完成**:预检验过一次(`tls-alpn-01`),正式部署在 compose 的 `deploy_caddy_data` volume 里重新签发,首次 curl 失败(签发中)、第二次 **200**。HTTP/3 也通(修掉 compose 缺 udp 映射的缺陷后) |
| 9 | 生产 compose 全链路冒烟 | 三 Tab + SSE ×2 + 限额,按 R9 预发同口径(**R6 起无 `/admin`**,管理面走 MCP,见 11/12) | ✅ **13 项已过**(见下「生产部署与上线冒烟」):三 Tab / 七服务端点 / 废弃路由 404 / 安全头 / MCP 三种失败一致 / Tools 目录 / 访客 cookie 带 Secure / 内存 / 日志无真实错误。✅ **2026-09-02 补齐**:`/agent/ask` 真实对话、两条 SSE、web_search 端到端全通(见下「LLM / 搜索 provider 写入与全链路验收」)。**限额演练不适用** —— 所有者裁定不设限额,超限路径在生产无从演练,以 R9 在 130 的留证为准 |
| 10 | 备案号挂 footer | web footer 显示备案号 | ✅ **2026-09-02 线上实测**:`苏ICP备2025204887号-2` 在页面底部,链到 `beian.miit.gov.cn`。运行期注入生效(`SiteFooter` 的 `await connection()` 把渲染推到请求期,没被烧进构建产物)。**公安联网备案另算**,见「所有者 TODO」第 6 条 |
| 11 | 生产 MCP token 已生成并留存,轮换路径验过 | **部署前**:按 `deploy/.env.example` 的 CSPRNG 口径生成一对,哈希进生产 `~/deploy/.env` 的 `MCP_AUTH_TOKEN_HASH`、原文进密码管理器 + 本机用户级 `XRAY_MCP_TOKEN_PROD`,**不复用 130 那把**(一把 token 只开一扇门)。轮换演练一次:改哈希 → `docker compose up -d api` **重建容器**(env 变了 `restart` 不生效)→ 旧 token 401 / 新 token 通,全程**不动** `CONFIG_ENCRYPTION_KEY` | ◐ **生成与哈希写入已完成**(2026-09-02,所有者本机生成 token、只交哈希);⬜ 剩两项待部署后做:①`XRAY_MCP_TOKEN_PROD` 环境变量与密码管理器留存的确认(所有者);②轮换演练(要 api 起来才验得了 401/200) |
| 12 | MCP 管理面在生产实连(协议 **2026-07-28**) | `server/discover` 回 `supportedVersions: ["2026-07-28"]` + `serverInfo`,`tools/list` 出 **28** 个工具(R10 留证里的 24 是 R-WEBSEARCH 之前的数,以 `apps/api/mcp/tools.ts` 的 `registerTool` 计数为准)——请求体形状照 [`rounds/round-10/checklist.md`](../round-10/checklist.md) §9(逐请求四件套缺一样就是 4xx,`_meta` 三键必须在 `params` 里);再经 `.mcp.json` 新增的 `xray-admin-prod` 用 Claude Code 实连一次。**必须早于「写生产 LLM provider」通过**(R6 起无引导密钥,不通则 `/agent/ask` 永远 503);**交接项②的 IP 白名单启用后要复验一次**(白名单先于 token 生效,漏验的表现是 token 明明对却 403) | ✅ **2026-09-02 通过**:`supportedVersions: ["2026-07-28"]` · `serverInfo` = `agent-xray-admin/1.0.0` · `tools/list` **28 个**(与 `registerTool` 计数一致)· Claude Code 经 `xray-admin-prod` 实连成功。白名单按裁定不启用,无需复验 |

## 所有者 TODO(Claude 无法代办)

1. ~~腾讯云控制台防火墙放行 80/443/8080~~ ✅ 2026-08-28 所有者已放行,外网实测三端口均可达
2. ~~**域名购买 + ICP 个人备案**~~ ✅ 域名 `kzgai.cloud` 已购(腾讯云,`.cloud` 有工信部信管函〔2018〕367号批复);备案 2026-08-28 提交,**2026-09-02 通过**,备案号 `苏ICP备2025204887号-2`(服务名称「个人知识分享站」,类目「其他,博客/个人空间」)
3. ~~备案通过前 80/443 被云厂商拦截 → 期间自测走 `IP:8080`~~ ✅ 已解除(备案通过);`IP:8080` 这条自测路径部署后可收掉(ufw 与云控制台两处都要关)
4. **生产 MCP token 原文存进密码管理器**(验收 11):服务端只存 sha256,原文丢了不能找回、只能轮换。轮换时 `CONFIG_ENCRYPTION_KEY` **绝不能跟着换**——换了 `llm_config` 里的 LLM key 密文全部解不开,agent 立刻停摆,得把每个 provider 的 key 经 `llm_provider_upsert` 重写一遍
5. ~~**提供 Caddy IP 白名单要放行的真实出口 IP**(R10 交接项②)~~ ✅ 2026-09-02 裁定**暂不启用**,不再需要 IP
6. **公安联网备案(待所有者确认口径)**:ICP 备案通过后,按规定还需在网站开通后 30 日内办理公安网安备案,并在页面底部同时挂公安备案号(链到 `beian.mps.gov.cn`)。**当前 `SiteFooter` 只支持一个 ICP 号**,要挂第二个号得改组件(与 ICP 号同属规则 8「docs 的部署约束不是新功能」口径)。请确认腾讯云侧提示的具体要求与时限后再定改不改
7. ~~**真实内容**:生产是空库~~ ✅ Notes 已从 130 库级拷入(4/13/205/103),Encore 系列 22 篇经 MCP 发布;⬜ **About 仍是 R9 样本**(intro 里那句「130 预发环境」已删,`repos` / `langBar` / `originUrl` 等所有者给真实内容,BACKLOG 有条目)

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

5. **Caddyfile 的域名化** ✅ **已落地**(提交 `c9e24b3`):130 用 `:80`、生产用 `kzgai.cloud`,两边共用一份部署资产。
   用 Caddy 的环境变量占位 `{$SITE_ADDRESS::80}` —— 130 不填保持 `:80`,生产在 `.env` 里填域名。
   「不填变量时行为不变」已在**本机 caddy 容器**回归实测(仍监听 `:80`、照常服务、5 个头齐、无 HSTS);
   130 上的实跑并进那次预发升级。

**同日追加的第六条要求**(所有者 2026-09-02,在五条之后提出):**生产只走 HTTPS,80 端口开着但不能有响应**。
   落点是全局 `auto_https disable_redirects` —— 不加它的话,站点地址填域名会让 Caddy 自动在 80 上起 308 跳转,
   那就是「有响应」。实现、代价与实测见下「生产访问层预检」。

## 禁止

- **上线期间不做不可逆迁移**(2026-09-02 裁定 2 的派生约束):没有备份就没有恢复点。
  如果 R-TOOLS 或后续轮次带来了不可逆迁移,先回所有者重裁备份那条,不在本轮里赌
- 不改前端页面样式(CLAUDE.md 规则 7);不加设计稿没有的功能(规则 8)
- 生产部署方式只用 docker compose,禁止服务器上 `encore run`(规则 10)
- R10 检查单不全绿不执行生产部署(M4 止损)
- `.env`/密钥不入 Git;`ckclaude.pem` 只存本机 `~/.ssh/`,不进仓库

## 代码审查

- 审查方式:**所有者裁定本轮不走 codex 审查**(2026-09-02 收工时,与 R9 同一先例)
- 本轮仓库改动清单(供将来补审或下一轮顺带扫到):`deploy/Caddyfile`(域名化 / 安全头 / HSTS / `disable_redirects` / 规范跳转)、`deploy/docker-compose.yml`(`SITE_ADDRESS` / `SITE_REDIRECT_FROM` / `SITE_ORIGIN` 传给 caddy、`443:443/udp`)、`deploy/.env.example`、`docs/security.md` §5 与 §5.1、`docs/deploy-*.md`、`.mcp.json`、`CLAUDE.md`。**`apps/` 一行未动**,镜像内容即 R-TOOLS 合并后的 `main`(已过 codex 两轮)
- 结论:未审查(所有者裁定)

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

### 2026-09-02 生产访问层预检(不发布应用,只打通域名 / TLS / 访问口径)

所有者当日追加要求:**生产只走 HTTPS,80 端口开着但不能有响应**。据此改了部署资产(提交 `c9e24b3`),
并在生产服务器上用**真域名**跑了一次一次性 Caddy(不含应用镜像,上游缺失回 502)把访问层验到底。

**先说做法为什么要改**:站点地址填域名后,Caddy 默认会在 80 上自动起一个 308 跳转服务 —— 那是「有响应」。
关掉它的开关是全局 `auto_https disable_redirects`。**对 130 是空操作**(那边是 `:80` 纯 HTTP 站,本来就不产生跳转路由,已回归实测)。

**四条实测结论**:

1. **证书签发成功,走的是 `tls-alpn-01`**(日志原文:`served key authentication certificate … "challenge":"tls-alpn-01"`
   → `authorization finalized … "authz_status":"valid"` → `certificate obtained successfully`)。
   这正是关掉 80 之后的必然路径,也顺带证明了**境内服务器到 Let's Encrypt 的 ACME 通路是通的**。
   **由此产生一条运维事实:443 从「站点入口」变成了「证书续期的唯一命脉」** —— 443 不可达不再只是「站点打不开」,
   而是「证书也续不了」。应急路径:临时注释掉 `auto_https disable_redirects` + reload,让 HTTP-01 顶上。
2. **HTTPS 一切正常**:本机 curl **未加 `-k`** 直接通过证书校验;六个安全响应头齐全,含 `Strict-Transport-Security: max-age=300`。
3. **80 端口现在有两道保证,别把它们混为一谈**:
   - **云侧**:外网 → `106.54.238.52:80` 的 SYN 被静默丢弃(2.2s 超时),而 ufw 明明是 `80/tcp ALLOW` ——
     丢包发生在腾讯云那一层,不是我们配的。**这一条不受我们控制,不能当作保证**。
   - **Caddy 侧**:服务器本机 `curl http://127.0.0.1:80` 回 **Connection reset,无任何 HTTP 响应**。
     这是 `disable_redirects` 的直接结果(监听还在——真域名下 Caddy 会为 ACME 绑 80,但没有任何路由),
     **这一条才是配置层的保证**:哪天控制台放开了 80,站点也不会突然多出一个明文入口。
   - ⚠️ **一个测试陷阱**:用 `SITE_ADDRESS=localhost` 在本机测时 `netstat` 只有 `:443` ——
     那是因为 localhost 走内部 CA、根本没跑 ACME,所以没绑 80。**别用本机 localhost 的结果去推真域名的行为**,
     这两者在「是否监听 80」上结论相反(真域名下是监听的)。
4. **域名一暴露就被扫**:证书签发会把域名写进 CT log,预检那几分钟里日志已经出现对
   `/.env`、`/.env.local`、`/.env.prod`、`/.env.dev` 的探测(来源 `104.244.74.39`)。全部 502(上游没起)。
   记这条是为了两件事:①上线前别让裸 Caddy 长期挂在公网上;②`.env` 只在服务器 `~/deploy/` 且 600,
   本来就不在任何 web 根下 —— 这类探测打不中,但它证明扫描是即时的、不是「小站没人管」。

**服务器侧已就位**(均为不依赖镜像的部分):

- `~/deploy/` 建好,四个部署资产已传(`docker-compose.yml` / `Caddyfile` / `migrate.sh` / `.env.example`),`migrate.sh` 已 `chmod +x`
- 基础镜像已预拉:`caddy:2-alpine`(88.7MB)、`postgres:16-alpine`(420MB)—— 上线时不必现拉
- 预检签下的证书留在 volume `preflight_caddy_data`(`/data/caddy/certificates/…/kzgai.cloud.crt`)。
  **compose 用的是另一个 volume(`deploy_caddy_data`),所以正式部署会重新签一次** ——
  这是刻意的:手工造一个 compose 没造过的 volume 会撞上 Compose v5 的 label 校验。
  重签的代价只有几秒,且 Let's Encrypt 的重复证书限额是每周 5 张,用掉 1 张
- 预检容器已删,服务器当前**无任何容器运行**

**当日追加处理的三条**:

- ✅ **HTTP/3 打通**(所有者裁定:放行 udp/443、保留 HTTP/3)。发现的问题是 Caddy 响应带 `Alt-Svc: h3=":443"`
  而防火墙只放行 `443/tcp` —— 广告了一个连不上的协议,表现是浏览器试一次 QUIC 失败再回落 TCP。
  两层都放行后实测:`curl --http3-only https://kzgai.cloud/` 回 **`HTTP/3 502`**(502 = 上游没起,协议本身通),
  六个安全头齐全。ufw 侧 `443/udp ALLOW IN`(v4+v6),腾讯云控制台侧由所有者添加 UDP 443 规则。
  **验证工具要注意**:本机 curl 8.16.0 是 Schannel 构建,**不支持 HTTP/3**,验不了这件事;
  用 `docker run --rm ymuski/curl-http3 curl --http3-only …` 才测得出来。
- ⬜ **8080 自测端口留到上线冒烟之后再收**(所有者裁定)。理由是万一部署期需要一条绕开 Caddy 的旁路自测通道。
  收的时候 ufw 与腾讯云控制台两处都要关。
- ℹ️ **80 被丢包的原因已缩小范围,但仍未定论**:所有者的控制台截图显示 **TCP 80 规则是「允许」**,
  ufw 也是 `80/tcp ALLOW` —— **两层防火墙都放行,而外网 SYN 仍被丢**,所以拦截在更上游
  (最可能是备案接入信息尚未同步到云厂商的 80 拦截解除流程,备案当天通过)。
  **对本轮的影响是零**:所有者要的就是 80 无响应。但要记住这条随时可能变——哪天上游解除拦截,
  80 就会变成可达,**那时唯一的保证就是 Caddy 侧的 `disable_redirects`**,而它已经配好并实测过了。

**生产 `.env` 已备好(2026-09-02),只差两项**:

- 已填:`ICP_BEIAN=苏ICP备2025204887号-2` · `SITE_ADDRESS=kzgai.cloud` · `SITE_ORIGIN=https://kzgai.cloud` ·
  `POSTGRES_PASSWORD` / `CONFIG_ENCRYPTION_KEY` / `METRICS_IP_SALT`(三者均 43 字符 base64)
- **三个密钥在服务器上就地 `openssl rand -base64 32` 生成,原文一次都没经过本机或对话** ——
  这是 R10 那条「130 上留了一份明文 `.llm-key`」的反面教材的正面做法
- 权限 `-rw------- deploy:deploy` ✅
- ✅ **`MCP_AUTH_TOKEN_HASH` 已填**(2026-09-02,`47518f5e…a36fed59`,64 位小写 hex):
  token 原文由所有者在本机按 `deploy/.env.example` 的 CSPRNG 口径生成,**只有哈希交给我写进服务器**,原文一次都没进对话或仓库。
  写入前脚本卡了一道格式(`^[0-9a-f]{64}$`)—— 格式错的表现是 api 起来后**一律 401 且极难定位**,值得在写入时就拦下
- ⬜ **差 `IMAGE_TAG`**:等镜像构建后填 git 短 SHA
- ⚠️ **`CONFIG_ENCRYPTION_KEY` 所有者必须自行备份一份**(`ssh` 上去 `cat ~/deploy/.env` 取)。
  它是 `llm_config` / `websearch_config` 里凭据密文的唯一解开方式;丢了不是「重新生成」而是
  「所有 provider 的 key 都要经 MCP 重写一遍」。轮换 MCP token 时**绝不能顺手把它一起换掉**。

### 2026-09-02 生产部署与上线冒烟(SHA `5bd6ace`)

**所有者裁定跳过 130 预发,直接从 `main` 打包发生产**。前提事实先纠正过一次:130 停在 `7cc17fe`(迁移 7),
R-WEBSEARCH / R-TITLE / R-TOOLS 三轮**都没上过 130**。但跳过的结论成立,理由比「130 已经跑过」更硬:

- **生产是空库**,`migrate.sh` 从 0 跑到 9 是全新建 schema,不存在「存量数据被迁移改坏」——
  而那正是预发升级的主要价值(130 那次是 6→7,带 12 条存量会话)
- 欠着的那几条验收本来就要在生产重跑(M4:检查单在生产重跑才算数)
- 首发出问题的回滚代价 ≈ 0:没有数据可丢

**执行记录**:

| 步骤 | 结果 |
|---|---|
| `dev.ps1 build` | `local/xray-api:5bd6ace` 600MB + `local/xray-web:5bd6ace` 355MB。bun 基座已在本地,没踩「encore 绕过 mirror 直连 Docker Hub 卡几十分钟」那个坑 |
| `dev.ps1 ship agent-xray-prod-deploy` | **99 秒**(12:58:01 → 12:59:40)。tar 只有 **155.2 MB** —— `docker save` 对两个镜像共享的 bun 基座层做了去重,不是 600+355 的和。远端 load 成功、tar 已自动清理 |
| 迁移 | 0 → **9**,九个迁移逐个在独立事务内应用。事前核过:9 个迁移**都不含 `CONCURRENTLY`**(含了 `migrate.sh` 会拒绝执行) |
| `docker compose up -d` | 四个容器全 running,postgres healthy |

**冒烟结果**:

| # | 检查 | 结果 |
|---|---|---|
| 1 | 首页 | `https://kzgai.cloud/` **200** |
| 2 | 三个 Tab | `/` `/notes` `/about` 全 200 |
| 3 | **备案号挂 footer** | ✅ `苏ICP备2025204887号-2`,链到 `beian.miit.gov.cn`(**验收 10 通过**) |
| 4 | 安全响应头 | 六个全在(nosniff / Referrer-Policy / X-Frame-Options / CSP frame-ancestors / Permissions-Policy / HSTS `max-age=300`) |
| 5 | 七个服务各取一端点 | 全部非 404:`/api/agent/sessions` 200 · `/api/agent/tools` 200 · `/api/trace/stream` 400(缺参,非 404)· `/api/notes/series` 200 · `/api/about` 200 · `/rss.xml` 200 · `/api/mcp` 401 |
| 6 | 废弃路由 | `/api/spike/ask` · `/admin` · `/admin/login` **全 404** |
| 7 | HTTP 80 | 无响应(外网连不上) |
| 8 | HTTP/3 | ✅ 修掉一个缺陷后 `HTTP/3 200`,见下 |
| 9 | MCP 三种失败 | 无 header / 错 token / 畸形 token **响应体完全一致**:`{"jsonrpc":"2.0","id":null,"error":{"code":-32001,"message":"unauthorized"}}` |
| 10 | Tools 目录 | 5 个工具齐、分三组(`pure` ×3 / `outbound` ×1 / `session` ×1);配置面字段 grep **0 命中** |
| 11 | 访客 cookie | 建会话响应带 `Set-Cookie: xr_visitor=…; HttpOnly; SameSite=Lax; **Secure**`。`Secure` 只在服务端确认请求经 HTTPS 到达时才加 —— 顺带证明 Caddy 的 proto 转发是对的。**R-VISITOR 欠着的那条在生产验掉了** |
| 12 | 容器内存 | caddy 11.4M/128M · web 81.9M/384M · api 29.8M/1G · postgres 60.1M/768M,全部远低于上限 |
| 13 | api 日志 error | 6 条,**全部是本次冒烟自己打的**(1 条 `trace/stream` 无参 400 + 5 条 MCP 未授权),无真实错误 |

**冒烟抓到一个真缺陷(已修,提交 `97fcdec`)**:`docker-compose.yml` 的 caddy 只映射了 `443/tcp`,
而 Caddy 照样在响应里广告 `Alt-Svc: h3=":443"` —— 浏览器于是去试 QUIC,宿主上 udp/443 却没人听,
**每个访客首访白等一次超时再回落 TCP**。根因是 compose 的 `"443:443"` 简写**默认只映射 tcp**。

**这个缺陷为什么预检没抓到,值得记一笔**:预检那次是手工 `docker run -p 443:443/udp` 起的容器,
udp 是我在命令行显式给的;**compose 这条路径直到真正部署才第一次走到**。
「预检用的启动方式和生产用的不是同一条」——这类差异只能靠跑真实部署路径来消除。
修复后实测 `HTTP/3 200`,TCP 路径不受影响。

**站点当前是「空壳可用」状态,还差三样(都要 MCP token,见「所有者 TODO」)**:

1. **没有 LLM provider** → `/agent/ask` 会回 503(R6 起没有引导密钥,唯一来源是 `llm_config` 表)。
   Runtime Tab 能打开、能建会话,但发不出消息
2. **Notes 是空的** —— 130 上那 13 系列 / 205 章节 / 103 张配图在 130 的库里,生产要经 MCP 重发
3. **About 是空的**

**验收 11 / 12(MCP token 留存与实连)与限额演练同样卡在这里** —— 都要 `XRAY_MCP_TOKEN_PROD` 就位、会话重启之后才能做。

### 2026-09-02 内容迁移:130 → 生产(所有者裁定「三样都按 130 的直接上传生产」)

**先说一样搬不了,而且是硬约束**:**LLM / 搜索 provider 的 key 拷不过来**。
`llm_config` / `websearch_config` 里存的是密文,用 **130 那把 `CONFIG_ENCRYPTION_KEY`** 加密,
而生产是新生成的另一把 —— 把密文行拷过去的结果是**解不开、agent 照样停摆**;
MCP 读回来也只有掩码(`sk-…443a`,设计如此)。所以 provider 必须由所有者给明文 key 重新写一遍。
(反过来说,「把 130 的 `CONFIG_ENCRYPTION_KEY` 拷到生产」是错误解法:那等于预发与生产共用一把密钥。)

**Notes 与 About 走库级拷贝,不走 MCP 逐篇上传**。理由:103 张 WebP 走 `notes_asset_put` 要把
base64 过一遍对话,上下文直接炸掉;而这五张表结构在两边完全一致(**核对过:39 列逐列相同** ——
130 是迁移版本 7、生产是 9,但 008/009 只动 websearch 与 session title,不碰 notes/about)。

| 步骤 | 结果 |
|---|---|
| 依赖顺序 | 外键链 `notes_categories → notes_series → {notes_chapters, notes_assets}`。**不能用一条 `pg_dump --data-only` 带多个 `-t`**:那样按字母序会把 `notes_assets` 排在 `notes_series` 前面,灌入时撞外键。改成**逐表 dump 再拼接**,顺序 categories → series → chapters → assets → about_content |
| 序列 | `notes_chapters_id_seq` 显式一起 dump(`setval` 到 208)。漏了它的表现是灌完数据后新插入撞主键 |
| dump | 19.85 MB(库内 11 MB,bytea 走 COPY 的十六进制编码会胀) |
| 灌入 | `psql -v ON_ERROR_STOP=1 --single-transaction`,任何一条失败全部回滚 |
| 校验 | 生产行数 **4 分类 / 13 系列 / 205 章节 / 103 配图 / 1 条 About**,与 130 逐项一致;dump 已从服务器删除 |

**线上复验**:`/notes` 200 · 文章页 `/notes/typescript-deep-dive/chapter-18` 200(128 KB)·
配图 `/notes/agent-basics/0d1812f5fa68e3f8.webp` 200 `image/webp` 88 KB · `/rss.xml` **30 条** · `/about` 200。

**顺带发现并当场修掉一处会挂在公开生产站上的错**:About 的 intro 结尾是
「这里是 130 预发环境,内容为 R9 部署验收的样本」—— 那句话跟着内容一起拷了过来。
已用 `about_set` 只改 intro 一个字段删掉(线上复验已无该字样)。
**About 其余字段仍是 R9 样本**(`repos` 只有一张卡、`langBar` 四项、`originUrl` 空),等所有者给真实内容,BACKLOG 有条目。

**还发现一处冗余,记 BACKLOG 不当场改**:供图路径上 `X-Content-Type-Options` 出现**两次**
(R6 给该端点单加过一条,R11 又在 Caddy 给全站加了一条;其余路径都是 1 次)。
两个值完全相同、浏览器行为不变,但说明 Caddy 的 `header` 对这条是追加而非替换。
修法都不划算(改端点要动 apps/ 并重建镜像;Caddyfile 里 delete-then-set 要赌内部操作顺序)。

**验收 12 通过**:`server/discover` 回 `supportedVersions: ["2026-07-28"]`,
`serverInfo` = `agent-xray-admin/1.0.0`(在 `result._meta["io.modelcontextprotocol/serverInfo"]` 下,
R10 留证只写了值没写位置);`tools/list` **28 个**,与 `apps/api/mcp/tools.ts` 的 `registerTool` 计数一致;
Claude Code 经 `.mcp.json` 的 `xray-admin-prod` 实连成功。

> **两个操作坑,下次照抄别再踩**:
> 1. **`_meta` 的三个键要带 `io.modelcontextprotocol/` 前缀**,还要有第三个 `clientInfo`。
>    CLAUDE.md 里写的是「`params._meta` 里的 `protocolVersion` 与 `clientCapabilities`」——
>    **那个措辞不够精确**,照它写会静默落到 2025-11-25 legacy 路径,`server/discover` 回 `-32601`
>    (精确形状在 `rounds/round-10/checklist.md` §9)。
> 2. **`docker compose exec -T` 仍然 attach stdin**。经 `ssh host bash -s <<'EOF'` 跑多行脚本时,
>    脚本里任何一句 `docker compose exec -T` 都会把 heredoc **剩下的行当输入吃掉**,
>    后续命令静默不执行(本轮 `migrate.sh` 第一次就是这么「跑完却没建表」的)。
>    解法:给这类命令加 `< /dev/null`,或干脆一条命令一个 ssh。

### 2026-09-02 站点地址改为 `https://www.kzgai.cloud/`(所有者要求)

做法不是「把 kzgai.cloud 换成 www.kzgai.cloud」,而是**定一个规范地址、其余的跳过去**:
两个主机名都进 `SITE_ADDRESS`(裸域不列就没有证书,连不上更谈不上跳转),裸域 **301** 到 www。
这样旧链接不断、地址栏统一、RSS 里的绝对链接也只有一个形态。

| 变量 | 值 |
|---|---|
| `SITE_ADDRESS` | `www.kzgai.cloud, kzgai.cloud` |
| `SITE_ORIGIN` | `https://www.kzgai.cloud` |
| `SITE_REDIRECT_FROM`(新增) | `kzgai.cloud` |

**跳转目标直接复用 `SITE_ORIGIN`,没有另开变量** —— 于是「跳到哪」与「RSS 写出去的绝对链接是哪」
永远是同一个值,配不歪。代价是 caddy 容器也要拿到 `SITE_ORIGIN`(compose 里补了一行)。

**踩到并挡住一个会让 caddy 起不来的坑**:compose 里这个新变量的默认值**必须是哨兵而不是空串**。
Caddy 的 `{$VAR:default}` 只在变量**不存在**时取默认值,变量存在但为空时取空 ——
matcher 于是变成 `host `(缺参数),Caddyfile 直接解析失败。
**这不是推测,是实测出来的**:`-e SITE_REDIRECT_FROM=` 起容器报
`module name 'host': module value cannot be null`。若照最自然的 `${SITE_REDIRECT_FROM:-}` 写法,
**130 下次重启就会起不来**(它不会设这个变量,而 compose 会把它设成空串)。
现在 compose 默认值是 `__unset__`,Caddyfile 侧再兜一层同名哨兵。

四种取值组合本机 `caddy validate` 逐个验过(130 口径 / 变量全不设 / 生产口径 / 空串必须报错),
另用本机容器验了真实跳转行为:`old.localhost/notes/x?a=1` → **301** → `canon.localhost/notes/x?a=1`
(路径与 query 原样带过),规范主机名自身不被跳转。

**线上复验**:`https://www.kzgai.cloud/` **200** · `https://kzgai.cloud/notes` **301 → https://www.kzgai.cloud/notes** ·
跟随跳转后最终 URL 落在 www · RSS 绝对链接已全部是 `https://www.kzgai.cloud/…` ·
六个安全头齐 · 备案号仍在 footer · 80 仍无响应 · **HTTP/3 200**。
www 的证书由 Caddy 在重建后自动签发(`tls-alpn-01`)。

### 2026-09-02 LLM / 搜索 provider 写入与全链路验收(站点真正可用)

所有者要求**不设限额,token 与搜索都不设**。四项写入 + 一处白名单调整:

| 项 | 值 |
|---|---|
| LLM provider | `cliproxy-dmit` · `https://api.64-186-228-154.sslip.io/v1` · `gpt-5.6-terra` · 默认 |
| LLM 限额 | `maxTurnsPerSession=0` / `dailyTokenLimit=0` / `dailyCostLimitCents=0`(**全 0 = 不限**) |
| 自定义模型目录 | 从 130 的 `llm_config.models` 原样取来(该列不加密,只有 key 是密文)。**漏了它模型解析不出来** —— `gpt-5.6-terra` 不是 pi 内置模型 id,`hasCustomModels: true` 就是这个意思 |
| websearch provider | 同网关同模型 · `dailySearchLimit=0`(**不限**)· idle 45s / total 180s · 默认 |
| `tool_config` | `web_search` 由 `false` 置 **`true`** —— 种子行默认是关的,配好 provider 也不会自动注册 |
| 白名单 | 生产 `.env` 补 `XRAY_WEBSEARCH_EXTRA_HOSTS=api.64-186-228-154.sslip.io` 并**重建 api**(env 变了 restart 不生效) |

**白名单这条是必须先做的前置**:生产的 `allowedHosts` 起初只有内置两个
(`aigateway.variflight.com` / `api.deepseek.com`),网关域名不在其中 —— 不补这一项,
`websearch_provider_upsert` 会直接拒掉。130 上之所以能用,是因为它的 `.env` 早就设了这个变量。

**全链路验收(至此 R11 的验收 9 补齐)**:

| 检查 | 结果 |
|---|---|
| `/agent/ask` 真实对话 | ✅ SSE `session` → `delta` 流式输出正常 |
| 消息落库 | ✅ 该会话 2 条(user + assistant) |
| **R-TITLE 验收 #1**(欠了一直没验) | ✅ **`title_source=agent`**,标题「介绍你的身份」是模型自己调 `session_rename` 起的 —— 首行是「用一句话说明你是什么」,证明不是首行截断 |
| 第二条 SSE `/trace/stream` | ✅ 回放出 `session_start` / `resources_discover` / `input` / `before_agent_start`,`seq` / `eventType` / `mode`(notify·chain·takeover)齐全 |
| **web_search 端到端** | ✅ 新会话里模型自行发起搜索并给出带来源的回答;轨迹中 **4 次 `tool_call` / 4 次 `tool_result`**,`web_search` 出现 17 次 |
| 五个工具启停 | ✅ 全部 `enabled=true` |

**「限额演练」这一项的性质变了,要写明**:所有者裁定不设限额(三项全 0 + 搜索 0),
**超限路径在生产就没有东西可演练** —— 它不是「没做」,是「被配置取消了」。
R9 在 130 上有超限行为的留证(`rounds/round-09/smoke.md` §5),需要时以那份为准。
将来若改回有限额,这条要重新跑。

**遗留两点**:

1. **生产库里留了 4 条冒烟会话**。它们按访客归属只对当时那个 curl cookie 可见,
   且 3 天保留期会清掉(R-VISITOR),不手工删。
2. **key 的明文进过本次会话上下文**。所有者本意是「key 在文本文件里、不要传进上下文」,
   但读取动作已经发生、内容已在对话里。**已如实告知并建议在网关侧轮换一次**;
   轮换后经 `llm_provider_upsert` + `websearch_provider_upsert` 各重写一次即可
   (**`CONFIG_ENCRYPTION_KEY` 不要动**)。落盘那条约束是守住了 —— 服务器上没有任何明文 key 文件
   (R10 交接项③要求的正是这个,130 上那份 `~/deploy/.llm-key` 就是反面教材)。

## 收工(2026-09-02,所有者裁定)

所有者裁定 R11 到此完成,**明确不做**以下四项。逐条把「不做的代价」写清楚,不是为了追责,是为了下次有人碰到相关症状时知道这里没验过:

| 不做的项 | 代价 / 残留风险 |
|---|---|
| **上线检查单在生产重跑**(M4 止损原话「在生产重跑才算数」) | 检查单 13 项里**6 项从未在生产核过**:`.env` 600 + 明文 key 不落镜像(新镜像 `5bd6ace`,R10 核的是 `5c98b3e`)· 容器安全约束(`docker inspect` 逐项)· 最终镜像无 node · postgres 仅 back 网段可达 · SSE 脱敏结构化扫描 · SSE 优雅关闭。这些都是 compose / Dockerfile 层的**静态属性**,130 上全绿且部署资产未在这几处改动,**大概率成立但没证据** |
| **codex 审查** | 本轮部署资产改动(Caddyfile / compose)没有第二双眼睛看过。已知的一处冗余(供图路径 nosniff 重复)记了 BACKLOG;是否还有别的,不知道 |
| **token 轮换演练**(验收 11 ②) | 轮换路径只在 130 验过(2026-09-01),生产没走过一遍。真要轮换时照 CLAUDE.md 那段做,**`CONFIG_ENCRYPTION_KEY` 绝不能跟着换** |
| **首日观察**(限额 / 内存 / 日志) | 上线当天只看了一个快照(api 30 MB / web 82 MB,日志无真实错误)。没设限额,所以「限额」这项本来也没东西可观察;内存与日志的趋势要靠所有者之后自己看 `docker stats` / `docker compose logs` |

**收工时的生产状态快照**:

- SHA `5bd6ace`,四容器 running,迁移版本 9
- 内容:4 分类 / 14 系列 / 226 章节 / 103 配图(130 拷入 205 + Encore 新发 21 正式篇)
- provider:`cliproxy-dmit` 一个,LLM 与搜索共用,**全部不设限额**;五个工具全开
- 访问:`https://www.kzgai.cloud/` 规范地址,裸域 301,80 无响应,HTTP/3 通,HSTS `max-age=300`(**上线稳定后可调大**,当前值是给证书链留的 5 分钟反悔期)
- 服务器上没有任何明文 key 文件;`.env` 600;`.env.bak-*` 已 shred

**本轮踩过的坑已全部落进文档**(2026-09-02 收工前逐条核):`docs/deploy-environments.md`(compose exec -T 吃 stdin / docker save 去重 / 预检必须走 compose / HTTP/3 三处齐 / 环境间内容迁移 / 生产口径)、`docs/deploy-cn-lightweight.md`(80 刻意无响应 / udp 443 / 公安备案 / `.env` 清单)、`docs/security.md` §5(udp 443 / 443 是续期命脉)、`CLAUDE.md`(`_meta` 键要带命名空间前缀与 `clientInfo` / `xray-admin-prod` 指 www)。本机特有的(ssh 中文路径用 8.3 短路径 / CR 计数用 `tr` 不用 `grep` / python 写文件 `newline=""` / commit message 走 `-F-` heredoc)进了 memory,不进仓库。
