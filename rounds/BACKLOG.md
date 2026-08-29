# Backlog

跨轮次发现的问题与想法都记这里,不当场顺手改;新功能类条目须经所有者裁定才可进轮次。
格式:`- [ ] <发现轮次> <一句话> (发现日期)`

## 工程

- [ ] R0 CI(GitHub Actions:web build + api check)——未在任何轮次内,需要时由所有者决定加在哪轮 (2026-08-28)
- [ ] R0 encore CLI 有更新 v1.57.13 → v1.58.4;升级前先确认对 ticketBookingB2B 项目无影响(同机共用 daemon) (2026-08-28)
- [x] R11 `docs/deploy-cn-lightweight.md` §3 部署/升级命令写的是服务器上 `docker compose build`,与 CLAUDE.md 规则 10「本机构建后传输」冲突——已在 R-BUN 改为不可变镜像流程(`dev.ps1 build` + save/load + `IMAGE_TAG` 强制 git SHA) (2026-08-28)
- [ ] R-BUN **Encore 上游缺陷,建议提 issue**:开启 `bun-runtime` 实验位后 `encore build docker` 把 ENTRYPOINT 改成 `bun run …`,基座却仍用默认 `node:slim`,产出的镜像里没有 bun,`docker run` 直接 `exec: "bun": executable file not found in $PATH`。当前靠 `dev.ps1 build` 固化 `--base oven/bun:1.4.0-slim` 绕过;上游修好后可简化 (2026-08-29)
- [x] R-BUN Encore 自托管镜像不执行数据库迁移(运行时无迁移逻辑,`encore db` 也无 migrate 子命令),空库直起则 `/health` 200 但触库端点 500——所有者裁定方案一,已落地 `deploy/migrate.sh`(SQL 取自被部署镜像、`schema_migrations` 与 Encore 同构、单事务、幂等),130 完整 compose 形态实测通过 (2026-08-29)
- [ ] R-BUN `deploy/migrate.sh` 目前硬编码只认 `agent` 库,遇到别的库名报错停下(不猜)。将来若新增数据库需扩该脚本;含 `CONCURRENTLY` 的迁移会被主动拒绝,该路径尚未实测 (2026-08-29)
- [ ] R-BUN 生产镜像形态下的 **SSE 冒烟无法演练**:两条 SSE 只在 spike 里而 spike 已被 `--services` 排除,正式 `/agent/ask`、`/trace/stream` 要等 R3/R4。R9 的 SSE 验收项需顺延 (2026-08-29)
- [ ] R-BUN `dev.ps1 build` 的 `--services agent,system` 白名单是维护热点:R4/R5/R7/R8 新增 trace/notes/admin/metrics 服务时必须同步补名字,漏补表现为该服务端点静默 404。考虑在 R9 冒烟里加一条「已声明服务全部可达」的断言 (2026-08-29)
- [ ] R-BUN Next dev proxy 对**未百分号编码**的中文 query 返回 400,直连 Encore 同样请求返回 200。浏览器会自动编码故对真实用户影响小,但手写 URL 的脚本/测试会踩 (2026-08-29)
- [ ] R-BUN **上线前必做(架构评审 P1-4)**:`apps/web/app/layout.tsx:17-21` 从 `fonts.googleapis.com` 加载 JetBrains Mono,是渲染阻塞样式表,境内首访会挂在字体请求超时上(数秒白屏)。改为自托管(`next/font/local` 或 woff2 放 `public/`),视觉零变化;属规则 7 允许的「接线需要的结构性改动」,任务卡写明理由即可。落地时记得在 `apps/web/Dockerfile` 补 `COPY … /app/public ./public`。R9 或 R10 完成 (2026-08-29)
- [ ] R-BUN `next build` 仍以 node 执行(web Dockerfile 的 builder 阶段装 node/npm);runner 阶段已是纯 bun。若要连构建期也去掉 node,需单独验证 Next 构建器在 bun 下的行为 (2026-08-29)
- [ ] R2 adversarial review 遗留:R3 正式 `/agent/ask` 需为助手消息持久化设计显式失败协议与幂等重试(turn 级去重键 / outbox),spike 现仅做「失败以 SSE error 收尾」的最小信号 (2026-08-28)
- [ ] R2 复审遗留:R3 正式 `/agent/ask` 的 SSE error 消息需统一脱敏口径——spike 现仍将 provider promptError 原文透出(R1 起既有行为,persistError 已在 R2 改为固定提示) (2026-08-28)
- [x] R1 脱敏自测 fixtures(`spike/events.ts` `runSanitizeSelfTests`,6 组凭据/超大对象用例)在 R2 测试基建落地后转正式 encore test——已落地 `apps/api/spike/events.test.ts`(R2,2026-08-28);测试随 R4 正式 sanitize 迁移到 trace 服务 (2026-08-28)

## 功能提案(需所有者裁定)

(空)
