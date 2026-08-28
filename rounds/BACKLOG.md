# Backlog

跨轮次发现的问题与想法都记这里,不当场顺手改;新功能类条目须经所有者裁定才可进轮次。
格式:`- [ ] <发现轮次> <一句话> (发现日期)`

## 工程

- [ ] R0 CI(GitHub Actions:web build + api check)——未在任何轮次内,需要时由所有者决定加在哪轮 (2026-08-28)
- [ ] R0 encore CLI 有更新 v1.57.13 → v1.58.4;升级前先确认对 ticketBookingB2B 项目无影响(同机共用 daemon) (2026-08-28)
- [ ] R11 `docs/deploy-cn-lightweight.md` §3 部署/升级命令写的是服务器上 `docker compose build`,与 CLAUDE.md 规则 10「本机构建后传输」冲突;R9 定稿部署脚本与文档时统一为本地构建 + save/load 或 TCR 传输 (2026-08-28)
- [x] R1 脱敏自测 fixtures(`spike/events.ts` `runSanitizeSelfTests`,6 组凭据/超大对象用例)在 R2 测试基建落地后转正式 encore test——已落地 `apps/api/spike/events.test.ts`(R2,2026-08-28);测试随 R4 正式 sanitize 迁移到 trace 服务 (2026-08-28)

## 功能提案(需所有者裁定)

(空)
