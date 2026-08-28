# 部署环境矩阵

> 所有者裁定(2026-08-28):本机开发用 encore cli;**预发(130)与生产都用 docker 方式部署**。方式不混用(CLAUDE.md 规则 10)。
> 注意与同机的 ticketBookingB2B 项目区分:那边 130 走 encore run + systemd,本项目 130 走 docker。

| 环境 | 位置 | 方式 | 状态 |
|---|---|---|---|
| 开发 | 本机 Windows | `dev.ps1` → `encore run :4000`;本地 Postgres 由 encore 经 Docker Desktop 管理 | 可用(R0 起) |
| 预发 | 130 服务器 | docker compose(`deploy/`) | R9 落地 |
| 生产 | 境内轻量服务器(待采购) | docker compose,与预发同一套 | R11;所有者提供 SSH 入口与密钥后开工 |

## docker 部署流(预发/生产共用,R9 定稿细节)

1. 本机构建镜像:
   - api:`encore build docker`(自包含镜像,经 dev.ps1 同款 env)
   - web:Next.js standalone 输出打镜像(`apps/web` Dockerfile)
2. 镜像传输:`docker save | load`(130 内网)或私有 registry(生产按网络情况在 R9/R11 定)
3. 服务器上:`cd deploy && cp .env.example .env`(首次,权限 600)→ `docker compose up -d`
4. 数据库迁移:Encore 镜像启动时自跑 migrations;涉及角色/权限类带外变更(如 `agent_ro`)按 R9 定稿的文档执行
5. 验证:`/health` + 三 Tab + `/admin` + SSE ×2 冒烟

## 环境差异要点

- 容器安全约束(非 root / read_only / mem_limit / no-new-privileges)在 `deploy/docker-compose.yml` 已定稿,预发与生产一致,不得为省事放宽(`docs/security.md` §1 第 3 层)。
- 生产额外做服务器基线初始化(`docs/security.md` §5)与 ICP 备案/TLS(`docs/deploy-cn-lightweight.md`)。
- 预发(130)不备案,内网 IP + 端口直访即可;Caddy TLS 只在生产开。
- `.env` 各环境独立,永不入 Git;LLM key 不进 `.env`,走管理后台写入(加密入库)。
