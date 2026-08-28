# AGENTS.md

本仓库的全部开发约定、硬性规则与轮次流程见 **[CLAUDE.md](CLAUDE.md)**,请以其为准(本文件只是指针,避免双份维护)。

审查者速记:

- 功能范围唯一边界 = `design/` 15 块画板 + 可交互原型;设计稿没有的功能一律判超范围。
- 前端样式零改动是硬规则(CLAUDE.md 规则 7):接后端只许换数据源,样式/布局/className/token 的 diff 都应质疑。
- `docs/security.md` 是强约束:bash/write/执行类工具进 in-process、SSE 未脱敏、密钥入 Git/入日志,都是阻断级 finding。
- Encore 相关坑与 JSONB 写法见 CLAUDE.md 硬性规则 1–6。
