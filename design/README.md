# 设计稿存档

来源:Claude Design 项目(claude.ai/design,项目名「Agent X-Ray 设计完成」,id `1a257a60-2f83-4795-9535-1d5a4677f21f`)。

| 文件 | 角色 |
|---|---|
| `Agent Runtime Workbench.dc.html` | **静态画板集(终稿,15 块)**:1a–1e Runtime 工作台(主屏 Timeline / 事件详情 / Chain View / Lifecycle Map / 空状态)、**1f–1g Tools 工具面板**(列表 / 展开 `web_search`;2026-09-02 新增)、2a–2e Notes/About(教程库首页 / 系列目录 / 文章阅读 / RSS 弹层 / 关于页)、**2f–2h Skills 技能库**(首页 / 详情页 SKILL.md 预览态 / 详情页 Python 文件预览态;2026-09-03 新增),实现时逐画板对照 |
| `Agent X-Ray Prototype.dc.html` | **可交互原型**:单页状态机(Runtime/Notes/Series/Article/**Skills/Skill**/About **七**屏 + RSS 弹层 + 运行时面板**四** tab 切换 + Tools 面板逐工具展开/收起 + **Skill 详情页目录树点选切换预览、安装命令与文件两处 copy**),`data-dc-script` 里含全部演示数据与交互逻辑——**主站实现的首要参照** |
| `support.js` | Claude Design 画布运行时(解析 `<x-dc>` 模板、挂载 React)。仅本地打开 .dc.html 预览时需要,实现不依赖它 |

> **画板增删记录**(画板编号只增不改,与 CLAUDE.md 硬性规则同一约定):
> - `3a–3e`(管理后台 /admin 五页)于 2026-08-31 裁定废弃(管理功能改由无前端界面的 MCP 管理服务承担,见 ROUNDS.md R6),**2026-09-02 从画布删除**;`3x` 号段作废,不再复用。
> - `1f–1g`(Tools 工具面板)于 2026-09-02 新增:访客在 Timeline 里看得到 `tool_call`,却无处得知这个 agent 有哪些工具、吃什么参数、吐什么结果。面板是**只读**的能力说明(名称 / 中文标签 / 描述 / 入参 JSON Schema / 输出形态 / 工具分组),不含启停开关、日限额与 provider 名——那些是服务端配置,不对访客公开。
> - **`2f–2h`(Skills 技能库)于 2026-09-03 新增**:所有者裁定加**第四个顶部 tab「Skills」**,分享自己写的与精选的第三方 skill(Claude Code / Codex 通用的 `SKILL.md` 目录包)。三块画板:`2f` 首页(按用途四分类的卡片列表;卡片 = 等宽 skill 名 + 「自研 / 精选」描边微徽标 + 一句话中文描述 + 出处与文件数的元信息行;页脚两行:统计 + 「skill = 一个目录」的解释),`2g` 详情页(面包屑 / 等宽 22px 大标题 + 徽标 / 右上 `GitHub ↗` 与 `下载 zip` 两枚 ghost 按钮 / `INSTALL` 面板一行 `npx skills add <owner>/<repo> --skill <name>` + copy / 下半左栏 240px 粘性目录树 + 「本页目录」/ 右栏文件预览卡,默认打开 `SKILL.md`:frontmatter 键值块 + 按 2c 排版的 markdown 正文),`2h` 同一页点选 `scripts/review.py` 的状态(带行号列的代码视图,「本页目录」消失,安装命令 copy 处于 `copied` 态)。既有 12 块画板的导航条同步改成**四格**(Runtime · Notes · Skills · About),每格样式不变。**范围说明**:整个 tab 只读——没有搜索 / 筛选、没有点赞评论、不显示安装量;卡片上不放按钮(复制 / 下载都在详情页)。实现轮次:ROUNDS.md R-SKILLS。

> **与云端稿的合并口径(2026-09-03 实操记录,下次拉稿照此)**:本地两份 `.dc.html` 在 2026-09-02 之后有三处**本地**优化——Timeline 进行中行的波浪扫光(`omWaveSweep`,提交 `9dd0c89`)、发送按钮生成期间转圈禁用(`omSpin`,同一提交)、文章页阅读进度线的示意注释(`d2a87d0`)——而云端 Claude Design 项目是从更早的 `16a82bd`(R-TOOLS 收 1f–1g 那版)上加的 Skills 画板,**不含这三处**。所以**没有用云端稿覆盖本地**,而是以 `16a82bd` 为 base 做三方合并(`git merge-file`,两份文件零冲突;云端 Workbench 相对 base 是纯增量,Prototype 相对 base 只改了 tab 占位数 / state 初值 / navTabs 三行):本地三处优化全部保留,云端新增(2f–2h、四格 tab、原型 Skills 两屏与交互逻辑)全部并入。`support.js` 两边 md5 一致未动。**同日收尾:合并稿已经 DesignSync 写回云端项目**(两份 `.dc.html`,写回后再拉一次比对 md5 完全一致),**云端从此是正本、与本地一字不差**。之后的口径:本地 `design/` 只拉不改——想改设计稿去画布上改,或改完立刻写回;拉新稿时先跑 `diff "design/<文件>" "<新稿>" | grep -c '^<'`,为 0(新稿没丢本地任何一行)就直接覆盖,不为 0 说明两边又分叉了,才回到上面的「找 base → `merge-file` → 核验」。

本地预览:直接用浏览器打开任一 `.dc.html`(同目录需有 `support.js`;需联网加载 React CDN 与 Google Fonts)。**注意别用 IDE 的预览面板**:它会把文件转成 `data:` URL,相对路径的 `./support.js` 因此加载不到,页面显示的是未展开的 `{{...}}` 模板原文(2026-09-02 实测)。

设计 token 速查(与实现共用):

- 画布:`#ffffff` 底 / `#f5f5f5` 面板 / `#eeeeee` hover / `#e8e8e8` 选中 / `1px #e0e0e0` 边框
- 文字:`#1a1a1a` / `#6b7280` / `#9ca3af`;品牌色 `#2563eb`(hover `#1d4ed8`)
- 语义:成功 `#16a34a` + `rgba(34,197,94,.04/.25)` 淡染;错误 `#ef4444` + `rgba(248,113,113,.05/.3)` 淡染
- 事件模式:notify=`#9ca3af` · veto=`#ef4444` · chain=`#2563eb` · takeover=`#f9c22e`
- 分类点:pm=`#2563eb` · deep-dive=`#16a34a` · engineering=`#f9c22e` · frontier=`#8b5cf6`
- 工具分组(1f–1g):纯函数组=`#6b7280` · 外呼组=`#2563eb` · 会话绑定组=`#f9c22e`(沿用既有语义色,未新造)
- Skills(2f–2h,同样未新造 token):分类点沿用 Notes 四色(framework=`#2563eb` · workflow=`#16a34a` · review=`#f9c22e` · writing=`#8b5cf6`);出处微徽标 自研=`#2563eb` · 精选=`#9ca3af`(描边,mono 10px,圆角 4);目录树行高 26 / 每层缩进 12 / 选中行 `#e8e8e8` 底 + 字重 600;代码视图行号列宽 36、mono 11 `#9ca3af`、右侧 1px 边框,高亮只用三个 token:关键字=`#2563eb` · 字符串=`#16a34a` · 注释/docstring=`#9ca3af`;`INSTALL` / `FILES` 小标题 = mono 10px/600 `#9ca3af` 字距 0.08em(同 1g 的 INPUT/OUTPUT)
- 圆角:4 微徽标 / 5 小按钮 / 6–7 卡片 / 8 弹层 / 12 用户气泡;等宽字体 JetBrains Mono
- 动画:`omPulseBg`(Lifecycle 活跃节点脉动,1.8s)/ `omWaveSweep`(Timeline 进行中行自左向右扫光,1.8s)/ `omSpin`(发送按钮生成期间转圈,0.8s);Timeline 色条宽度 `min(198, max(4, round(sqrt(ms)*11)))`
