# 部署环境矩阵

> 所有者裁定(2026-08-28):本机开发用 encore cli;**预发(130)与生产都用 docker 方式部署**。方式不混用(CLAUDE.md 规则 10)。
> 注意与同机的 ticketBookingB2B 项目区分:那边 130 走 encore run + systemd,本项目 130 走 docker。
>
> 所有者裁定(2026-08-29,R-BUN):**开发 / 测试 / 预发 / 生产的 JS 运行时统一为 bun**。Node 不再出现在任何运行路径与任何镜像里(依赖安装仍用 npm,见下)。

| 环境 | 位置 | 方式 | 运行时 | 状态 |
|---|---|---|---|---|
| 开发 | 本机 Windows | `dev.ps1` → `encore run :4000`;本地 Postgres 由 encore 经 Docker Desktop 管理 | bun(`encore.app` 的 `bun-runtime` 实验位) | 可用(R0 起) |
| 测试 | 同上 | `dev.ps1 test` → `encore test` → `bun --bun vitest run` | bun | 可用(R-BUN 起) |
| 预发 | 130 服务器 | docker compose(`deploy/`) | bun(`oven/bun:1.4.0-slim` 基座) | R9 落地 |
| 生产 | 境内轻量服务器 | docker compose,与预发**同一个镜像**(SHA 相同,不重新构建) | bun | R11 |

**运行时与包管理器是两件事:** bun 只做 JS 运行时与脚本执行器;依赖安装仍走 `npm ci` + `package-lock.json`,不切 `bun install`。理由见 [`rounds/round-bun/round-bun.md`](../rounds/round-bun/round-bun.md)「包管理器为何不切」——pi SDK 自带 `npm-shrinkwrap.json` 锁定传递依赖,bun 不读它,切过去等于丢掉这层供应链锁定,而收益为零。

## docker 部署流(预发/生产共用)

镜像是**不可变制品**:同一个 git SHA 构建一次,预发验过之后原样提到生产,不重新构建。服务器上不装 encore CLI、不装 node/bun 工具链、不留 git 工作区,只有 docker + compose + `.env`。

1. **本机构建**(Windows,CLAUDE.md 规则 1/10):

   ```powershell
   .\dev.ps1 build
   ```

   该命令做三件事:拒绝在脏工作区构建 → `encore build docker --config deploy/infra-config.json --base oven/bun:1.4.0-slim --services agent,system` 出 api 镜像 → `docker build apps/web` 出 web 镜像。两个 tag 都是 git 短 SHA。

   > ⚠️ `--base` 不能省。Encore 开启 `bun-runtime` 后会把镜像 ENTRYPOINT 改成 `bun run …`,却仍按默认基座 `node:slim` 打包,产出的镜像里没有 bun,`docker run` 直接报 `exec: "bun": executable file not found in $PATH`。`encore.app` 里的 `build.docker.base_image` 对本地构建**无效**(只对 Encore 自家 CI/CD 生效)。已固化进 `dev.ps1 build`,不要手敲 `encore build docker`。

2. **镜像传输**:130 内网用 `docker save … | ssh … docker load`;生产按网络情况用同法或私有 registry。**任何环境都不用 `latest` tag**,compose 里 `${IMAGE_TAG:?}` 会拒绝空值。

3. **服务器部署**:

   ```bash
   cd deploy && cp .env.example .env && chmod 600 .env   # 首次
   # 填 IMAGE_TAG=<git-sha> / POSTGRES_PASSWORD / DEEPSEEK_API_KEY
   docker compose up -d
   ```

4. **数据库迁移 —— 必须带外执行,不会自动跑**(实测 2026-08-29):

   Encore 的自托管镜像**不含迁移执行逻辑**。迁移是本机 encore CLI(`encore run` / `encore check` 日志里的 "Running database migrations")或 Encore Cloud 控制面施加的;镜像里虽然打包了 `agent/migrations/*.up.sql`,但容器启动时不会应用。空库直接起服务的表现是:`/health` 200 正常,但任何触库端点 500 —— `relation "sessions" does not exist`。

   > **本项落地方案尚未定稿,是 R9 的阻塞项**(候选:一次性 migrate 容器 / 部署脚本用 psql 施加镜像内 SQL / 从构建机经隧道施加)。定稿前不得宣告预发部署成功。已验证的事实是:**迁移一旦带外应用,全链路即正常**(纯 bun 镜像 + 标准 `postgres:16-alpine`,会话创建/列表/落库/重启恢复全部通过)。

5. **验证**:`/health` + 三 Tab + `/admin` + SSE ×2 冒烟;并断言 `/spike/*` 全部 404(spike 是 R1 验证脚手架,无认证无限额,`--services` 白名单已在构建期把它挡在镜像外)。

6. **回滚**:镜像即回滚单元。把 `.env` 的 `IMAGE_TAG` 换回上一个 SHA,`docker compose up -d`。涉及不可逆迁移时先恢复备份(R10 衔接)。

## 环境差异要点

- 容器安全约束(非 root / read_only / cap_drop ALL / pids_limit / mem_limit / no-new-privileges / tmpfs noexec)在 `deploy/docker-compose.yml` 已定稿,预发与生产一致,不得为省事放宽(`docs/security.md` §1 第 3 层)。
- 网络分段:`front`(caddy/web/api)与 `back`(api/postgres,`internal: true`)。postgres 不在 front 网段,caddy 与 web 无法直连数据库。
- 端口契约:api 容器 `PORT=4000`,与 `deploy/Caddyfile` 的 `reverse_proxy api:4000` 成对;镜像默认是 8080,两处必须同改。
- 生产额外做服务器基线初始化(`docs/security.md` §5)与 ICP 备案/TLS(`docs/deploy-cn-lightweight.md`)。
- 预发(130)不备案,内网 IP + 端口直访即可;Caddy TLS 只在生产开。
- `.env` 各环境独立,永不入 Git;LLM key 不进镜像,经 `infra-config.json` 的 `{"$env": …}` 在运行时注入。
