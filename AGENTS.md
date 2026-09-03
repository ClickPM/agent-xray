# AGENTS.md

本仓库的全部开发约定、硬性规则与轮次流程见 **[CLAUDE.md](CLAUDE.md)**,请以其为准(本文件只是指针,避免双份维护)。

审查者速记:

- 功能范围唯一边界 = `design/` 12 块画板(1a–1g + 2a–2e)+ 可交互原型;设计稿没有的功能一律判超范围。
- 前端样式零改动是硬规则(CLAUDE.md 规则 7):接后端只许换数据源,样式/布局/className/token 的 diff 都应质疑。
- `docs/security.md` 是强约束:bash/write/执行类工具进 in-process、SSE 未脱敏、密钥入 Git/入日志,都是阻断级 finding。
- Encore 相关坑与 JSONB 写法见 CLAUDE.md 硬性规则 1–6。
- 生产两条硬约束(CLAUDE.md 规则 12):JS 运行时 = bun、MCP 管理面协议 = 2026-07-28。改动若可能使其中之一不再满足(换基座 / 去实验位 / 换 MCP SDK 或降协议),判**阻断级**并要求先向所有者做风险告知。
- Encore 框架用法与缺陷清单以 8 个 encore 官方 skill 为准(api / auth / code-review / database /
  frontend / secret / service / testing)。它们镜像在 **`.agents/skills/`**——codex 会把这里当作
  仓库级 skill 根目录自动加载,无需本文复述内容;`encore-code-review` 那份是框架缺陷 10 项清单。
