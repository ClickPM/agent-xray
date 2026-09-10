# AGENTS.md

本仓库的全部开发约定、硬性规则与轮次流程见 **[CLAUDE.md](CLAUDE.md)**,请以其为准(本文件只是指针,避免双份维护)。

**执行器**(2026-09-10,所有者裁定):独立审查由 **cursor CLI(`cursor-agent`)+ `cursor-grok-4.6-high`** 执行,codex 被限流暂停。
每次审查的任务书(范围 / 判据 / 严重级 / 输出格式)由 `.claude/cursor-review.ps1` 从 `.claude/cursor-review-prompt.md`
实例化后给到审查者;工作流与坑见 [`docs/review-workflow.md`](docs/review-workflow.md)。本文是**长期口径**,任务书是**每轮口径**,冲突时以任务书为准。

审查者速记:

- 功能范围唯一边界 = `design/` 的全部画板(桌面 `1a–1g` + `2a–2v`、移动端 `4a–4z` + `5a–`;**清单与计数以 `design/README.md` 为准**,`3x` 号段已废弃)+ 可交互原型;设计稿没有的功能一律判超范围。
- **审查是缺陷门禁,不负责长出方案**(CLAUDE.md「审查边界」,所有者裁定 2026-08-28):只判定并报告缺陷与严重级别,不展开设计方案;finding 若指向设计缺陷,标明「设计层面」即可,由所有者层面重定方案。
- **非严重阻塞性 finding 不得建议机制类修复**(新队列 / 新协议 / 新抽象 / 新配置 / 新导出面):只建议最小改动(改判断、改文案、删代码)或记 `rounds/BACKLOG.md`;机制类修复仅限严重阻塞性 bug / 漏洞。
- 前端样式零改动是硬规则(CLAUDE.md 规则 7):接后端只许换数据源,样式/布局/className/token 的 diff 都应质疑。
- `docs/security.md` 是强约束:bash/write/执行类工具进 in-process、SSE 未脱敏、密钥入 Git/入日志,都是阻断级 finding。
- Encore 相关坑与 JSONB 写法见 CLAUDE.md 硬性规则 1–6。
- 生产两条硬约束(CLAUDE.md 规则 12):JS 运行时 = bun、MCP 管理面协议 = 2026-07-28。改动若可能使其中之一不再满足(换基座 / 去实验位 / 换 MCP SDK 或降协议),判**阻断级**并要求先向所有者做风险告知。
- MCP 工具变动同步文档是硬规则(CLAUDE.md 规则 13):增删改 MCP 工具必须同步更新 docs/mcp.md,工具总数与契约行为需强一致。
- Encore 框架用法与缺陷清单以 8 个 encore 官方 skill 为准(api / auth / code-review / database /
  frontend / secret / service / testing)。它们镜像在 **`.agents/skills/`**——codex 会把这里当作
  仓库级 skill 根目录自动加载;**cursor CLI 不自动加载**,要 Encore 判据时按需读那个目录里的文件。
  `encore-code-review` 那份是框架缺陷 10 项清单。
