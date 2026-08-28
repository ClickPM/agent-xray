# Backlog

跨轮次发现的问题与想法都记这里,不当场顺手改;新功能类条目须经所有者裁定才可进轮次。
格式:`- [ ] <发现轮次> <一句话> (发现日期)`

## 工程

- [ ] R0 CI(GitHub Actions:web build + api check)——未在任何轮次内,需要时由所有者决定加在哪轮 (2026-08-28)
- [ ] R0 encore CLI 有更新 v1.57.13 → v1.58.4;升级前先确认对 ticketBookingB2B 项目无影响(同机共用 daemon) (2026-08-28)
- [ ] R11 `docs/deploy-cn-lightweight.md` §3 部署/升级命令写的是服务器上 `docker compose build`,与 CLAUDE.md 规则 10「本机构建后传输」冲突;R9 定稿部署脚本与文档时统一为本地构建 + save/load 或 TCR 传输 (2026-08-28)
- [ ] R2 adversarial review 遗留:R3 正式 `/agent/ask` 需为助手消息持久化设计显式失败协议与幂等重试(turn 级去重键 / outbox),spike 现仅做「失败以 SSE error 收尾」的最小信号 (2026-08-28)
- [ ] R2 复审遗留:R3 正式 `/agent/ask` 的 SSE error 消息需统一脱敏口径——spike 现仍将 provider promptError 原文透出(R1 起既有行为,persistError 已在 R2 改为固定提示) (2026-08-28)
- [x] R1 脱敏自测 fixtures(`spike/events.ts` `runSanitizeSelfTests`,6 组凭据/超大对象用例)在 R2 测试基建落地后转正式 encore test——已落地 `apps/api/spike/events.test.ts`(R2,2026-08-28);测试随 R4 正式 sanitize 迁移到 trace 服务 (2026-08-28)

## 功能提案(需所有者裁定)

(空)
