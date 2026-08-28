# notes 服务(待实现)

教程库存储、查询与 pi 只读工具组。

- 表:`notes_series` / `notes_chapters`(正文入库;由 vault `学习分享/` 编译摄入)
- 前端查询端点:系列列表 / 章节列表 / 文章内容 / RSS 生成(全站 + 四分类)
- **pi 只读工具组**(`defineTool`):`notes_list_series` / `notes_get_chapter` / `notes_search`
  - 连接串用 `AGENT_RO_DATABASE_URL`(`agent_ro` 角色,仅 SELECT notes 表)——pi 可读教程、物理上不可改(`docs/security.md` §1 第 2 层)
