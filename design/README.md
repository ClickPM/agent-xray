# 设计稿存档

来源:Claude Design 项目(claude.ai/design,项目名「Agent X-Ray 设计完成」,id `1a257a60-2f83-4795-9535-1d5a4677f21f`)。

| 文件 | 角色 |
|---|---|
| `Agent Runtime Workbench.dc.html` | **静态画板集(终稿,20 块)**:1a–1e Runtime 工作台(主屏 Timeline / 事件详情 / Chain View / Lifecycle Map / 空状态)、**1f–1g Tools 工具面板**(列表 / 展开 `web_search`;2026-09-02 新增)、2a–2e Notes/About(教程库首页 / 系列目录 / 文章阅读 / RSS 弹层 / 关于页)、**2f–2h Skills 技能库**(首页 / 详情页 SKILL.md 预览态 / 详情页 Python 文件预览态;2026-09-03 新增)、**2i–2k 加载态与错误态**(Skill 详情页加载 / Notes 章节页加载 / 错误态 A 出错 B 找不到;2026-09-03 新增)、**2l–2m 会话区一轮完成态**(处理过程折叠行 / 折叠行展开 + 卡片展开;2026-09-03 新增),实现时逐画板对照 |
| `Agent X-Ray Prototype.dc.html` | **可交互原型**:单页状态机(Runtime/Notes/Series/Article/**Skills/Skill**/About **七**屏 + RSS 弹层 + 运行时面板**四** tab 切换 + Tools 面板逐工具展开/收起 + **Skill 详情页目录树点选切换预览、安装命令与文件两处 copy**),`data-dc-script` 里含全部演示数据与交互逻辑——**主站实现的首要参照** |
| `support.js` | Claude Design 画布运行时(解析 `<x-dc>` 模板、挂载 React)。仅本地打开 .dc.html 预览时需要,实现不依赖它 |

> **画板增删记录**(画板编号只增不改,与 CLAUDE.md 硬性规则同一约定):
> - `3a–3e`(管理后台 /admin 五页)于 2026-08-31 裁定废弃(管理功能改由无前端界面的 MCP 管理服务承担,见 ROUNDS.md R6),**2026-09-02 从画布删除**;`3x` 号段作废,不再复用。
> - `1f–1g`(Tools 工具面板)于 2026-09-02 新增:访客在 Timeline 里看得到 `tool_call`,却无处得知这个 agent 有哪些工具、吃什么参数、吐什么结果。面板是**只读**的能力说明(名称 / 中文标签 / 描述 / 入参 JSON Schema / 输出形态 / 工具分组),不含启停开关、日限额与 provider 名——那些是服务端配置,不对访客公开。
> - **`2f–2h`(Skills 技能库)于 2026-09-03 新增**:所有者裁定加**第四个顶部 tab「Skills」**,分享自己写的与精选的第三方 skill(Claude Code / Codex 通用的 `SKILL.md` 目录包)。三块画板:`2f` 首页(按用途四分类的卡片列表;卡片 = 等宽 skill 名 + 「自研 / 精选」描边微徽标 + 一句话中文描述 + 出处与文件数的元信息行;页脚两行:统计 + 「skill = 一个目录」的解释),`2g` 详情页(面包屑 / 等宽 22px 大标题 + 徽标 / 右上 `GitHub ↗` 与 `下载 zip` 两枚 ghost 按钮 / `INSTALL` 面板一行 `npx skills add <owner>/<repo> --skill <name>` + copy / 下半左栏 240px 粘性目录树 + 「本页目录」/ 右栏文件预览卡,默认打开 `SKILL.md`:frontmatter 键值块 + 按 2c 排版的 markdown 正文),`2h` 同一页点选 `scripts/review.py` 的状态(带行号列的代码视图,「本页目录」消失,安装命令 copy 处于 `copied` 态)。既有 12 块画板的导航条同步改成**四格**(Runtime · Notes · Skills · About),每格样式不变。**范围说明**:整个 tab 只读——没有搜索 / 筛选、没有点赞评论、不显示安装量;卡片上不放按钮(复制 / 下载都在详情页)。实现轮次:ROUNDS.md R-SKILLS。

> - **`2i–2k`(加载态与错误态)于 2026-09-03 新增**:站点投产后所有者报障 —— 点 Skills 卡片「经常没反应」、点 Notes 有时候也会,以及 `/skills/ppt-master` 白屏报 `Application error`。定位发现站点**没有任何加载态与错误边界**:软导航在服务端 RSC 返回之前 UI 一动不动(点 `diagram` 实测 4.0 秒静止),渲染失败则掉到 Next 的默认英文白屏。三块画板:`2i` Skill 详情页加载态(照 2g 逐项对位的骨架 + 面包屑右侧 `omSpin`「正在取…」)、`2j` Notes 章节页加载态(照 2c;**阅读进度线裁定为「不出现」**——正文没到就不存在「读到哪」)、`2k` 错误态(A 页面出错 / B 找不到,同一版式 460px 单列,A 带可复制的 `err_ + UTC` 标识、B 回显访问路径)。**骨架不新造视觉语言**:填充 `#eeeeee`、压在灰面上降一档 `#e0e0e0`,圆角走现有 4/5/6/7 档,动效只复用 `omPulseBg` 与 `omSpin`。**唯一的新语汇是 2k 的品牌色实心主按钮**(既有按钮语汇只有 ghost),由画板明确定为出口层级。每块画板下方带一块「裁定」面板,记录取舍与理由。实现轮次:ROUNDS.md R-PERF。
> - **`2l–2m`(会话区 · 一轮完成态)于 2026-09-03 新增**:核对发现会话区的工具调用卡**丢了**——画板 1a–1d / 1f–1g 一直画着两张(`read_file` / `bash`),首版 `bdc1ca4` 实现过,R3 `88dc2ae` 切真实数据源时断了来源,`ToolChip` 留成死代码。恢复卡片本身不涉及设计稿;**缺的是两个没画过的态**:`2l` 一轮已完成(处理过程收成一行「处理详情 · 2 次模型往返 · 2 次工具调用 · 0.4s」,13px/1.7 `#6b7280` 导航行、行尾 6px `#ef4444` 圆点提示「里面有一次没成功」,发送按钮回常态、Timeline 末行不再扫光;板上三条规则:无工具调用不出折叠行 / 进行中不折叠 / 最终回答为空只剩折叠行)、`2m` 折叠行展开 + `bash` 卡展开(边界 = 左侧 1px `#e0e0e0` 竖线 + 左内边距 14;卡片展开体紧贴卡下 4px、r6 + `rgba(0,0,0,.03)` 底 + 卡片同色描边、`INPUT` / `RESULT` 小标题、mono 11/1.6 每段最多 6 行 `max-height:106px` 超出接 `…(已截断)`;折叠行箭头 › / ˅,卡片箭头 ˅ / ˄;展开不做动画)。参考 pi-web 的折叠行为,但**不带**模型名 / provider 名 / 分段 token 与费用 / 「思考」块。**这两块不带 44px 站点导航条**(照抄 1a,1a 的工作台主屏本来就没有)。`support.js` 两边 md5 一致未动;本次拉稿 `diff | grep -c '^<'` 为 0,直接覆盖。提示词 `rounds/round-toolcards/design-prompt.md`;实现轮次:ROUNDS.md R-TOOLCARDS(2026-09-03 开工,分支 `round-toolcards`)。
>
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
- 加载态与错误态(2i–2k,未新造色值):骨架填充 `#eeeeee`,叠在 `#f5f5f5` / `#eeeeee` 面上的条降一档取 `#e0e0e0`;骨架圆角 4 文本条 / 5 小节标题条 / 6 大标题条 / 7 按钮块与卡片;动效只用 `omPulseBg`(全页一两块作锚点)与 `omSpin`(「正在取…」),另有一条纯延迟用的 `omSkeletonIn`(0→1 不透明度,延迟 200ms,不参与视觉语汇);错误态 460px 单列 + 10px 方点(出错 `#ef4444` / 找不到 `#9ca3af`)+ **品牌色实心主按钮 32px/r7**(全站唯一一处实心按钮,由 2k 定为出口层级)+ 12px `#6b7280` 次级文字链
- 会话区一轮完成态(2l–2m,未新造色值):折叠行 13px/1.7 `#6b7280`(hover `#2563eb`)+ 行首 12px 箭头(stroke `#9ca3af`,› 收起 / ˅ 展开)+ 行尾 6px `#ef4444` 圆点(有工具出错或被拦截时);展开区左侧 1px `#e0e0e0` 竖线 + 左内边距 14,内部沿用会话区节奏(项间距 14、正文 14/1.7、卡片解剖与 1a 一字不差);卡片展开体紧贴卡下 4px、r6 + `rgba(0,0,0,.03)` 底 + 与卡片同色的 1px 描边(错误 `rgba(248,113,113,.3)` / 成功 `rgba(34,197,94,.25)`),`INPUT` / `RESULT` 小标题 mono 10/600 `#9ca3af` 0.08em,正文 mono 11/1.6 每段 `max-height:106px`(6 行)`overflow:hidden` 超出接 `…(已截断)`,RESULT 出错时字色 `#ef4444`;卡片箭头收起 ˅ / 展开 ˄;展开 / 收起不做动画
- 圆角:4 微徽标 / 5 小按钮 / 6–7 卡片 / 8 弹层 / 12 用户气泡;等宽字体 JetBrains Mono
- 动画:`omPulseBg`(Lifecycle 活跃节点脉动,1.8s)/ `omWaveSweep`(Timeline 进行中行自左向右扫光,1.8s)/ `omSpin`(发送按钮生成期间转圈,0.8s);Timeline 色条宽度 `min(198, max(4, round(sqrt(ms)*11)))`
