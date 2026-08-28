# rounds 目录约定

`rounds/` 保存轮次任务卡与轮次级管理产出,不保存源码、构建产物或大体积原始日志。轮次总览与 roadmap 见仓库根 [`ROUNDS.md`](../ROUNDS.md)。

## 目录结构

```text
rounds/
├── README.md
├── TEMPLATE.md
├── BACKLOG.md
└── round-NN/
    ├── round-NN.md      # 任务卡(开工时从 TEMPLATE.md 建立)
    ├── BLOCKED.md       # 仅在触发阻塞规则时创建
    └── <其他轮次级文档>.md
```

## 放置规则

- `rounds/` 根目录只放跨轮次文件:本说明、任务卡模板、全局 backlog。
- 每轮开工第一步:`cp rounds/TEMPLATE.md rounds/round-NN/round-NN.md`,按 ROUNDS.md 对应轮的拆解填好目标/交付物/验收,再开始实现。
- 任务卡范围**不得超出 ROUNDS.md 的功能边界**(设计稿 15 画板 + 原型;docs/ 安全与部署约束)。
- 实测记录默认回填任务卡;内容过长时拆成同目录独立 Markdown 并从任务卡链接。
- codex 审查的 findings 处理记录(逐条:采纳整改 / 不采纳及理由)回填任务卡「代码审查」段。
- 阻塞报告固定为 `rounds/round-NN/BLOCKED.md`:同一验收项针对性整改后连续 2 次验证仍不过 → 写 BLOCKED 停下呼人,禁止放宽验收自我通过。
- 源码、迁移、脚本、测试放各自标准位置(`apps/`、`deploy/`),不复制进轮次目录;大日志放 gitignored 位置,任务卡只记结论与路径。
- 跨轮次发现的问题写进 `BACKLOG.md`,不当场顺手改。
