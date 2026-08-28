# 部署:境内轻量服务器(阿里云 / 腾讯云)

> 目标形态:一台轻量应用服务器,docker-compose 单机跑 caddy + web + api + postgres,Caddy 自动 TLS。

## 0. 采购建议

- **规格**:pi import 后 RSS 增量 ~112MB,每活跃会话再叠 300–500MB → 建议 **4GB 内存起**(2GB 只能撑极低并发),2 vCPU,SSD 40GB+
- **镜像**:Ubuntu 24.04 LTS 或 Debian 12
- **地域**:境内(上海/广州等)。⚠️ 境内服务器绑域名必须 ICP 备案(见 §1);若最终不想备案,改买同厂商香港/新加坡轻量即可,本文其余步骤不变

## 1. ICP 备案清单(境内必做)

1. 域名在阿里云/腾讯云购入(备案要求域名与服务器同厂商最顺)
2. 服务器购买 ≥3 个月(备案要求)
3. 在云厂商备案控制台提交:个人备案,网站名称避免「Agent/AI 服务」等敏感表述,建议以「个人技术学习分享」类目申报
4. 审核周期约 1–3 周;**备案通过前,云厂商会拦截 80/443 的 HTTP 服务** → 开发期用 `IP:8080` 等非标端口自测
5. 备案通过后:域名解析 A 记录 → 服务器 IP,放开 Caddy 80/443,自动签发 TLS
6. 网站底部挂备案号(web footer 预留位)

## 2. 服务器初始化(一次性)

```bash
# 1) 新建部署用户 + SSH 仅密钥
adduser deploy && usermod -aG docker deploy
# sshd_config: PasswordAuthentication no; PermitRootLogin no

# 2) 防火墙(云控制台安全组同步配置)
ufw allow 80/tcp && ufw allow 443/tcp && ufw allow <SSH端口>/tcp && ufw enable

# 3) fail2ban + 自动安全更新
apt install -y fail2ban unattended-upgrades

# 4) Docker(境内用镜像加速)
curl -fsSL https://get.docker.com | sh
# /etc/docker/daemon.json 配置 registry-mirrors(阿里云个人加速地址)
```

## 3. 应用部署

```bash
git clone https://github.com/cking000bigdemon/agent-xray.git && cd agent-xray/deploy
cp .env.example .env && chmod 600 .env   # 填入:POSTGRES_PASSWORD / ADMIN_PASSWORD_HASH / LLM 中转端点等
docker compose up -d
```

- `.env` 永不入 Git;LLM key 走管理后台写入(加密存 Postgres),不放 .env
- **LLM 出口**:境内直连 Anthropic/OpenAI 不通或不稳。在管理后台配置**海外中转端点**(自备官方 key + 自建或可信中转);中转基址属于 secrets
- 升级:`git pull && docker compose build && docker compose up -d`(工具集成/下线随代码发布)

## 4. Caddyfile 要点

见 [deploy/Caddyfile](../deploy/Caddyfile):`/` → web、`/api/*` → api;`/admin*` 可选 IP 白名单段;全局限速可用 caddy-ratelimit 插件或前置云厂商防护。

## 5. 数据备份

- Postgres:每日 `pg_dump` 到本机 + 异地(对象存储)各一份;保留 14 天
- `.env` 与 Caddy 证书目录纳入备份

## 6. 上线前检查单

- [ ] gitleaks 扫描仓库无密钥
- [ ] `.env` 权限 600;`docker compose config` 无明文 key 泄漏到镜像
- [ ] api 容器:非 root、read_only、无 docker.sock、mem_limit 生效
- [ ] `/admin` 强密码 + 登录限速生效;可选 IP 白名单
- [ ] SSE 事件流抽查:无 Authorization/api-key 字段
- [ ] 限额:小额度演练超限路径(拒新会话 + 前端提示)
- [ ] 备案号已挂 footer
