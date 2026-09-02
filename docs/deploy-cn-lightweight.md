# 部署:境内轻量服务器(阿里云 / 腾讯云)

> 目标形态:一台轻量应用服务器,docker-compose 单机跑 caddy + web + api + postgres,Caddy 自动 TLS。

## 0. 采购建议与容量规划

- **规格**:**2 vCPU / 3.6–4 GiB / SSD 40GB+ 足够 V1**,不必上 4C8G。
- **镜像**:Ubuntu 24.04 LTS 或 Debian 12
- **地域**:境内(上海/广州等)。⚠️ 境内服务器绑域名必须 ICP 备案(见 §1);若最终不想备案,改买同厂商香港/新加坡轻量即可,本文其余步骤不变
- **加 1–2G swapfile**(`swappiness=10`):轻量机默认无 swap,这是 OOM killer 与「优雅降速」之间的零成本保险

### 容量怎么算(不要用「每会话固定 X MB」)

本文早期版本写过「每活跃会话叠 300–500MB」,那是**没有实测依据的估算,已被 R1 推翻**(实测空闲会话增量 0.04–0.4MB,差三个数量级)。但也不能反过来用 0.04MB 去推——真实活跃会话还会因上下文、消息历史、事件队列、工具输出、provider 在途响应而增长。用下面的公式:

```
API_RSS_p95 = B                                  # 基座:Encore runtime + pi import(实测口径)
            + N_active    × S_active_p95         # 活跃会话净增量(上下文 + 消息历史 + 会话对象)
            + N_streaming × S_stream_p95         # 正在流式的会话附加(provider 在途响应 + SSE 写缓冲)
            + N_active    × S_eventbuf_cap       # 事件缓冲上限(结构性常数,见下)
            + G                                  # GC / 分配器余量

mem_limit  = API_RSS_p95 × 1.3(突发余量)
并发上限   = MAX_ACTIVE_SESSIONS ≤ (mem_limit / 1.3 − B − G) / (S_active_p95 + S_eventbuf_cap)
主机校验   = Σ(所有容器 mem_limit) + OS/Docker + cache 保留 ≤ 物理内存
```

各系数的来源:

| 系数 | 取值 | 来源 |
|---|---|---|
| `B` | **~162MB**(bun 口径;node 口径 228MB) | R-BUN 实测,见 `rounds/round-bun/round-bun.md`。每次升级 bun / pi / encore 版本重测 |
| `S_eventbuf_cap` | 每会话对抗性最坏 ~56MB | **不用测,是代码里的结构性常数**:`MAX_EVENTS_PER_SESSION=2000` × 单事件 ≤8KB(`MAX_EVENT_BYTES`)≈16MB,加 `PENDING_FLUSH_MAX=5000`×8KB≈40MB(`apps/api/spike/runtime.ts`、`apps/api/spike/events.ts`)。R3 改这三个常数,预算随之改 |
| `S_active_p95` / `S_stream_p95` | **目前证据不足** | R1/R-BUN 只有空闲会话数字。R3/R4 落地后在预发用真实使用数据采 p95(长对话、大轨迹、并发流式各取),**不做压测** |
| `N_active` / `N_streaming` | 先给保守值(8 / 4) | 由 R3 的并发上限与空闲回收参数决定——是「配出来」的,不是「测出来」的 |
| `G` | bun 口径需重新标定 | bun 用 JSC 堆与自有分配器,RSS 语义与 V8 不同,Node 时代的余量系数不可迁移 |

主机预算参考(3.6 GiB 物理内存,与 `deploy/docker-compose.yml` 的 mem_limit 对齐):

| 组件 | 预算 |
|---|---|
| OS + systemd + sshd + fail2ban + dockerd | ~450–550 MB |
| postgres(`shared_buffers=256MB`,`mem_limit 768m`) | ~300–500 MB |
| api(`mem_limit 1g`) | 1 GiB 上限 |
| web(`mem_limit 384m`,常态 ~100–150MB) | 384 MB 上限 |
| caddy(`mem_limit 128m`) | ~30–50 MB |
| filesystem cache 与余量 | 剩余 ~600 MB–1 GiB |

> **关于 api 的 1g**:这是**初始生产上限**,依据是「Bun 口径实测基座 162.5MB + 事件缓冲的结构性上限 + 3.6GiB 主机的总预算」三者取平衡。**它不代表「已证明 1GB 足够所有真实负载」**——`S_active_p95` 目前是空值,任何容量结论都还缺这一项。
>
> 同样地,**不要用空闲会话的 0.04MB 去推真实活跃会话的容量**。空闲会话不持有上下文、消息历史、在途 provider 响应与流式写缓冲,两者不是一个量级的东西。

**什么时候提高 limit / 升配**:容器 RSS p95 持续一周超 `mem_limit` 的 60%,或出现首次 OOM kill → 先查泄漏,确认是真实负载后按上式重算。若推出 api 常态 >700MB,**先做「把 PostgreSQL 拆到云托管」再考虑升配**——拆库比升配便宜,且顺路解锁多实例前置。

## 1. ICP 备案清单(境内必做)

1. 域名在阿里云/腾讯云购入(备案要求域名与服务器同厂商最顺)
2. 服务器购买 ≥3 个月(备案要求)
3. 在云厂商备案控制台提交:个人备案,网站名称避免「Agent/AI 服务」等敏感表述,建议以「个人技术学习分享」类目申报
4. 审核周期约 1–3 周;**备案通过前,云厂商会拦截 80/443 的 HTTP 服务** → 开发期用 `IP:8080` 等非标端口自测
5. 备案通过后:域名解析 A 记录 → 服务器 IP,`.env` 填 `SITE_ADDRESS=<域名>`,Caddy 在 443 自动签发 TLS。**生产 80 刻意不给响应**(所有者要求),证书走 TLS-ALPN-01(见 `docs/security.md` §5)——别按「放开 80/443」的老口径去核 80
6. 网站底部挂备案号(`.env` 的 `ICP_BEIAN`,运行期注入;web footer 预留位)。**ICP 之外还有公安联网备案**:网站开通后 30 日内办,底部要同时挂公安备案号并链到 `beian.mps.gov.cn`;当前 `SiteFooter` 只支持一个 ICP 号,要挂第二个得改组件(R11 上线时待所有者确认口径,未做)

## 2. 服务器初始化(一次性)

```bash
# 1) 新建部署用户 + SSH 仅密钥
adduser deploy && usermod -aG docker deploy
# sshd_config: PasswordAuthentication no; PermitRootLogin no

# 2) 防火墙(云控制台安全组同步配置)
ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp && ufw allow <SSH端口>/tcp && ufw enable
# 443/udp 是 HTTP/3(QUIC);云控制台安全组也要加一条 UDP 443,少一层都不通

# 3) fail2ban + 自动安全更新
apt install -y fail2ban unattended-upgrades

# 4) Docker(境内用镜像加速)
curl -fsSL https://get.docker.com | sh
# /etc/docker/daemon.json 配置 registry-mirrors(阿里云个人加速地址)
```

## 3. 应用部署(不可变镜像)

**服务器上不构建、不 clone 仓库、不装 encore/node/bun 工具链**(CLAUDE.md 规则 10)。服务器只需要 docker + docker compose + **四个部署资产**:`docker-compose.yml`、`Caddyfile`、`migrate.sh`、`.env`(由 `.env.example` 复制)。这四个文件首次部署随镜像一起 scp,之后仅在变更时重传——`migrate.sh` 是部署必经步骤,漏传就做不了迁移。

```powershell
# —— 本机(Windows)——
.\dev.ps1 build          # 出 xray-api:<sha> 与 xray-web:<sha>
# ⚠️ 传输走文件。不要在 PowerShell 里 `docker save … | ssh … docker load`:
#    PS 5.1 管道按文本重编码,二进制 tar 会被破坏,远端 load 必失败。
docker save -o xray-<sha>.tar local/xray-api:<sha> local/xray-web:<sha>
ssh <host> "mkdir -p ~/deploy"      # 首次:scp 不会自建目标目录
scp xray-<sha>.tar deploy/docker-compose.yml deploy/Caddyfile deploy/migrate.sh deploy/.env.example <host>:~/deploy/
ssh <host> "docker load -i ~/deploy/xray-<sha>.tar && chmod +x ~/deploy/migrate.sh"
```

```bash
# —— 服务器 ——
cd ~/deploy && cp .env.example .env && chmod 600 .env    # 首次
# 填 IMAGE_TAG=<sha> / POSTGRES_PASSWORD / MCP_AUTH_TOKEN_HASH / CONFIG_ENCRYPTION_KEY / METRICS_IP_SALT
#   / SITE_ADDRESS=<域名> / SITE_REDIRECT_FROM=<裸域> / SITE_ORIGIN=https://www.<域名> / ICP_BEIAN=<备案号>
#   / XRAY_WEBSEARCH_EXTRA_HOSTS=<LLM/搜索网关域名>   ← 生产首次部署最容易漏:内置白名单只有两个域,
#     不补这项 websearch_provider_upsert 直接拒(R11 实测;130 早就设了所以从没暴露)
# 密钥类三项在服务器上就地 `openssl rand -base64 32` 生成,原文不经本机、不进对话
# (R6 起没有 LLM 引导密钥:起完服务后经 MCP 的 llm_provider_upsert 写入 provider)

docker compose up -d --wait postgres   # 1) 只起库,等到 healthy
./migrate.sh                           # 2) schema 就位(镜像不会自跑迁移)
docker compose up -d                   # 3) 再起 api / web / caddy
```

- **升级** = 构建新 SHA → 传输 → 改 `.env` 的 `IMAGE_TAG` → **`docker compose stop api web`(先停旧版,否则旧二进制会踩着迁移中的新 schema 继续服务)** → `up -d --wait postgres` → `./migrate.sh` → `docker compose up -d`。不停机升级仅当迁移确认对旧版后向兼容时才允许,V1 默认不做该保证
- **回滚** = 把 `IMAGE_TAG` 改回上一个 SHA → `docker compose up -d`(镜像即回滚单元;迁移不自动回退,涉及不可逆迁移时先恢复备份)
- 禁止 `latest`:compose 里 `${IMAGE_TAG:?}` 会拒绝空值启动
- ⚠️ **迁移不会自动执行,且必须在 api/web/caddy 起来之前完成**。忘了跑或顺序颠倒的表现是:健康检查全绿、Caddy 已放流量,而业务接口 500(`relation "sessions" does not exist`)——监控发现不了,只能靠部署顺序消除。`migrate.sh` 幂等,可安全重复执行;详见 [`deploy-environments.md`](deploy-environments.md)
- `.env` 永不入 Git;LLM key 不进镜像,经 `deploy/infra-config.json` 的 `{"$env": …}` 在运行时注入
- **LLM 出口**:境内直连 Anthropic/OpenAI 不通或不稳。用**海外中转端点**(自备官方 key + 自建或可信中转);中转基址属于 secrets
- **未来若在前面加 CDN / 云防护**:必须为两条 SSE 路径(`/api/agent/*`、`/api/trace/stream`)单独关闭响应缓冲与空闲超时,否则轨迹面板会静默卡死

## 4. Caddyfile 要点

见 [deploy/Caddyfile](../deploy/Caddyfile):`/` → web、`/api/*` → api、`/notes/**.webp` 按扩展名分流到 api 供图;`/api/mcp*` 可选 IP 白名单段;全局限速可用 caddy-ratelimit 插件或前置云厂商防护。

## 5. 数据备份

- Postgres:每日 `pg_dump` 到本机 + 异地(对象存储)各一份;保留 14 天
- `.env` 与 Caddy 证书目录纳入备份

## 6. 上线前检查单

> **每个环境各过一遍**,不是过一次就完。130 预发的留证见
> [`rounds/round-10/checklist.md`](../rounds/round-10/checklist.md)(R10,SHA `5c98b3e`,1–11 全绿);
> 生产在 R11 重跑同一份。下面括号里的**判据**是 R9/R10 实测校准过的,照着核不会误判。

- [ ] gitleaks 扫描仓库无密钥。**两条都要跑**:`gitleaks dir <repo>`(工作区)与 `gitleaks git <repo>`(历史),期望均为 `no leaks found`。判据由仓库根的 [`.gitleaks.toml`](../.gitleaks.toml) 定义(排除构建产物与 gitignored 的本地密钥文件,并按**具体的值**放行脱敏测试的假密钥字面量——不按文件放行,否则那两个文件会变成盲区)。**不带这个配置裸跑会报十几条全是噪音的命中**;改动这个配置后要跑一次证伪探针(往几处各插一行新的真实形状 key,确认都被抓到),做法见 [`rounds/round-10/checklist.md`](../rounds/round-10/checklist.md) §1
- [ ] `.env` 权限 600;`docker compose config` 无明文 key 泄漏到镜像。判据:把 `.env` 里的密钥值逐个拿去比对 `docker history --no-trunc` 与镜像的 `Config.{Env,Cmd,Entrypoint,Labels}`,期望命中 **0**;密钥只应出现在**容器**的运行期 env 里
- [ ] api 容器:非 root、read_only、无 docker.sock、`cap_drop ALL`、`pids_limit`、mem_limit 生效(`docker inspect` 逐项核)。docker.sock 要对**全机所有运行中容器**扫一遍挂载源,不只是本 compose 的四个
- [ ] **最终运行镜像**内无 node、只有 bun。**判据见 [`deploy-environments.md`](deploy-environments.md) 冒烟清单第 12 条**(`node -p "process.versions.bun"` 有值 + 真实 `node`/`nodejs` 二进制不存在 + `dpkg -l` 无 `nodejs` 包)。~~`node --version` 应失败~~ **别用这条**:`oven/bun` 基座自带一个指向 bun 的 `node` 软链,它确实会以退出码 1 失败,但报的是 `Missing script to execute … Node.js-compatible REPL` —— 一句会让人得出相反结论的错误信息。注:web 镜像的 builder 阶段本来就有 node/npm,这里查的是 runner 阶段产物
- [ ] `/spike/*` 全部 404(R1 验证脚手架不得进公网镜像;`--services` 白名单已在构建期挡住)。**同时跑一组正式端点作对照**——全站都 404 时这条会假通过
- [ ] `IMAGE_TAG` 是 git SHA 而非 latest;该 SHA 与预发验过的完全一致
- [ ] 迁移已带外施加且版本可追溯;空库直起会 500 的坑已规避
- [ ] postgres 仅在 `back` 内部网段可达(caddy/web 连不上)。**域名 NXDOMAIN 不够**,还要按容器 IP 直连 5432 也不通
- [ ] `/api/mcp` 无 token / 错 token / 格式不对的 token / **未认证的** GET 全拒(401)且有审计记录;三种 401 的响应体必须**完全一致**、不回显失败原因。注:带**正确** token 的 GET 是 **405**,不是 401(认证闸在方法校验之前)。可选 IP 白名单
- [ ] SSE 事件流抽查:无 Authorization/api-key 字段。**判据是结构化的**——遍历每帧 JSON 看有没有凭据形状的**键**;`grep -i authorization` 会命中对话正文里的那个英文单词(R10 实测 7 次全是误报)
- [ ] SSE 优雅关闭:`docker compose stop api` 时客户端**在停机同刻(+0s)拿到确定的终止**而非挂到超时。**别钉死 curl 退出码**(R9 见 `18`、R10 见 `0`,取决于断开落在响应分块的哪个位置)
- [ ] 限额:小额度演练超限路径(拒新会话 + 前端提示)
- [ ] 备案号已挂 footer
