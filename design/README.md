# 设计稿存档

来源:Claude Design 项目(claude.ai/design)。

| 文件 | 角色 |
|---|---|
| `Agent Runtime Workbench.dc.html` | **静态画板集(终稿,12 块)**:1a–1e Runtime 工作台(主屏 Timeline / 事件详情 / Chain View / Lifecycle Map / 空状态)、**1f–1g Tools 工具面板**(列表 / 展开 `web_search`;2026-09-02 新增)、2a–2e Notes/About(教程库首页 / 系列目录 / 文章阅读 / RSS 弹层 / 关于页),实现时逐画板对照 |
| `Agent X-Ray Prototype.dc.html` | **可交互原型**:单页状态机(Runtime/Notes/Series/Article/About 五屏 + RSS 弹层 + 运行时面板**四** tab 切换 + Tools 面板逐工具展开/收起),`data-dc-script` 里含全部演示数据与交互逻辑——**主站实现的首要参照** |
| `support.js` | Claude Design 画布运行时(解析 `<x-dc>` 模板、挂载 React)。仅本地打开 .dc.html 预览时需要,实现不依赖它 |

> **画板增删记录**(画板编号只增不改,与 CLAUDE.md 硬性规则同一约定):
> - `3a–3e`(管理后台 /admin 五页)于 2026-08-31 裁定废弃(管理功能改由无前端界面的 MCP 管理服务承担,见 ROUNDS.md R6),**2026-09-02 从画布删除**;`3x` 号段作废,不再复用。
> - `1f–1g`(Tools 工具面板)于 2026-09-02 新增:访客在 Timeline 里看得到 `tool_call`,却无处得知这个 agent 有哪些工具、吃什么参数、吐什么结果。面板是**只读**的能力说明(名称 / 中文标签 / 描述 / 入参 JSON Schema / 输出形态 / 工具分组),不含启停开关、日限额与 provider 名——那些是服务端配置,不对访客公开。

本地预览:直接用浏览器打开任一 `.dc.html`(同目录需有 `support.js`;需联网加载 React CDN 与 Google Fonts)。**注意别用 IDE 的预览面板**:它会把文件转成 `data:` URL,相对路径的 `./support.js` 因此加载不到,页面显示的是未展开的 `{{...}}` 模板原文(2026-09-02 实测)。

设计 token 速查(与实现共用):

- 画布:`#ffffff` 底 / `#f5f5f5` 面板 / `#eeeeee` hover / `#e8e8e8` 选中 / `1px #e0e0e0` 边框
- 文字:`#1a1a1a` / `#6b7280` / `#9ca3af`;品牌色 `#2563eb`(hover `#1d4ed8`)
- 语义:成功 `#16a34a` + `rgba(34,197,94,.04/.25)` 淡染;错误 `#ef4444` + `rgba(248,113,113,.05/.3)` 淡染
- 事件模式:notify=`#9ca3af` · veto=`#ef4444` · chain=`#2563eb` · takeover=`#f9c22e`
- 分类点:pm=`#2563eb` · deep-dive=`#16a34a` · engineering=`#f9c22e` · frontier=`#8b5cf6`
- 工具分组(1f–1g):纯函数组=`#6b7280` · 外呼组=`#2563eb` · 会话绑定组=`#f9c22e`(沿用既有语义色,未新造)
- 圆角:4 微徽标 / 5 小按钮 / 6–7 卡片 / 8 弹层 / 12 用户气泡;等宽字体 JetBrains Mono
- 动画:`omPulseBg`(流式行脉动,1.8s);Timeline 色条宽度 `min(198, max(4, round(sqrt(ms)*11)))`
