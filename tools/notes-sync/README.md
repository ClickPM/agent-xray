# notes-sync

> **已裁定废除(所有者 2026-08-31),R6 整目录删除,勿再运行**:内容发布改走无状态 MCP 管理服务
> (入参即标准 markdown,只校验不改写);存量库内数据不动,附件随 R6 迁入 Postgres。见 ROUNDS.md R6。

vault `学习分享/` → `notes_categories` / `notes_series` / `notes_chapters` + `apps/web/public/notes/` 的内容同步管线(R5)。

**入口是 `.\dev.ps1 notes`,操作规程在 [`.claude/skills/sync-notes/SKILL.md`](../../.claude/skills/sync-notes/SKILL.md)** —— 那里写了流程、验收、vault 结构变化怎么办、以及不能做的事。本文件只说代码怎么分的。

| 文件 | 职责 |
|---|---|
| `src/manifest.ts` | 13 个系列的映射表:vault 目录 → slug/分类/章节顺序。失效方式刻意是"报错停下" |
| `src/obsidian.ts` | Obsidian 语法 → 标准 markdown。**只在代码围栏与行内代码之外动手** |
| `src/images.ts` | 引用图收集 → WebP(≤1600px)→ `apps/web/public/notes/<系列>/<内容哈希>.webp`;顺带清孤儿 |
| `src/db.ts` | upsert 入库 / 产出声明式全量 SQL |
| `src/verify.ts` | 同步后自检(语法残留、内容边界),判据与改写器一致 |
| `src/main.ts` | CLI 与编排:读 vault → 建链接索引 → 改写 → 排序 → 哈希 → 写 |

**为什么不放进 `apps/api`**:那是 Encore app root,规则 6 不许出现无关 `.ts` 与依赖;
`sharp` / `gray-matter` / `pg` 是构建期依赖,也不该被打进 api 镜像。

依赖装在本目录(`npm install`),用 bun 执行(规则 11:运行时统一 bun,依赖仍走 npm)。
