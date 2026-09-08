# 设计稿存档

来源:Claude Design 项目(claude.ai/design,项目名「Agent X-Ray 设计完成」,id `1a257a60-2f83-4795-9535-1d5a4677f21f`)。

| 文件 | 角色 |
|---|---|
| `Agent Runtime Workbench.dc.html` | **静态画板集(终稿,20 块)**:1a–1e Runtime 工作台(主屏 Timeline / 事件详情 / Chain View / Lifecycle Map / 空状态)、**1f–1g Tools 工具面板**(列表 / 展开 `web_search`;2026-09-02 新增)、2a–2e Notes/About(教程库首页 / 系列目录 / 文章阅读 / RSS 弹层 / 关于页)、**2f–2h Skills 技能库**(首页 / 详情页 SKILL.md 预览态 / 详情页 Python 文件预览态;2026-09-03 新增)、**2i–2k 加载态与错误态**(Skill 详情页加载 / Notes 章节页加载 / 错误态 A 出错 B 找不到;2026-09-03 新增)、**2l–2m 会话区一轮完成态**(处理过程折叠行 / 折叠行展开 + 卡片展开;2026-09-03 新增),实现时逐画板对照。**2026-09-08(R-CROSSLINK)只给 `1b` 加了一块「详情卡链接裁定」注释面板**(图形一个像素没动),画板数仍是 20 |
| `Agent X-Ray Prototype.dc.html` | **可交互原型**:单页状态机(Runtime/Notes/Series/Article/**Skills/Skill**/About **七**屏 + RSS 弹层 + 运行时面板**四** tab 切换 + Tools 面板逐工具展开/收起 + **Skill 详情页目录树点选切换预览、安装命令与文件两处 copy**),`data-dc-script` 里含全部演示数据与交互逻辑——**主站实现的首要参照** |
| `Agent X-Ray Mobile - Runtime.dc.html` | **移动端画板集 · Runtime(终稿,12 块)**:`4a` 空状态 / `4b` 对话进行中 / `4c` 一轮完成折叠态 / `4d` 折叠行展开 + 卡片展开 / `4e` 运行时 Sheet · Timeline(medium detent)/ `4f` 事件详情(large)/ `4g` Chain View / `4h` Lifecycle Map / `4i` Tools / `4j` 会话列表 Sheet;**`4v` 追问预填(Sheet 收起 + 输入框带文本 + 键盘弹起)/ `4w` 卡片 ↔ Timeline 双向定位(两屏并列)**,并给 `4f` 加了一块注释面板(图形不动);2026-09-08 新增(R-CROSSLINK)。2026-09-07 新增(R-MOBILE) |
| `Agent X-Ray Mobile - Notes Skills About.dc.html` | **移动端画板集 · 其余(终稿,12 块)**:`4k` Notes 首页 / `4l` 系列目录 / `4m` 章节阅读 / `4n` 本章目录 Sheet + RSS Sheet / `4o` Skills 首页 / `4p` Skill 详情 SKILL.md / `4q` 代码文件 + 文件树 Sheet / `4r` About / `4s` 加载骨架 / `4t` 错误态 A·B·断网 / `4u` 载体适配四态;**`4x` 章节阅读 · 「在 Runtime 里聊这一章」入口**(2026-09-08 新增,R-CROSSLINK)。2026-09-07 新增(R-MOBILE) |
| `Agent X-Ray Source.dc.html` | **桌面画板集 · Source 源码 tab(终稿,3 块)**:`2n` Source 首页(`/source` · README 态)/ `2o` 代码文件态(`/source/apps/api/agent/tools.ts`,copy 已按下)/ `2p` 文件加载态(骨架对位 2o)。2026-09-08 新增(R-SOURCE)。**放新文件**是因为 `Agent Runtime Workbench.dc.html` 离 256 KiB 截断线只剩十几 KB;后者本次只改导航条(20 块四格 → 五格) |
| `Agent X-Ray Crosslink.dc.html` | **桌面画板集 · 跨栏跨页联动(终稿,2 块)**:`2q` 追问预填 + 卡片 ↔ Timeline 双向定位(工具行详情卡右上并排两条链接 / 会话区展开体底部一条链接 / 输入框已带追问文本)/ `2r` Notes 章节页「在 Runtime 里聊这一章」入口(方案 A:meta 行末尾文本链接)。2026-09-08 新增(R-CROSSLINK)。**放新文件**是因为 `Agent Runtime Workbench.dc.html` 离 256 KiB 截断线只剩十几 KB |
| `support.js` | Claude Design 画布运行时(解析 `<x-dc>` 模板、挂载 React)。仅本地打开 .dc.html 预览时需要,实现不依赖它 |

> **画板增删记录**(画板编号只增不改,与 CLAUDE.md 硬性规则同一约定):
> - `3a–3e`(管理后台 /admin 五页)于 2026-08-31 裁定废弃(管理功能改由无前端界面的 MCP 管理服务承担,见 ROUNDS.md R6),**2026-09-02 从画布删除**;`3x` 号段作废,不再复用。
> - `1f–1g`(Tools 工具面板)于 2026-09-02 新增:访客在 Timeline 里看得到 `tool_call`,却无处得知这个 agent 有哪些工具、吃什么参数、吐什么结果。面板是**只读**的能力说明(名称 / 中文标签 / 描述 / 入参 JSON Schema / 输出形态 / 工具分组),不含启停开关、日限额与 provider 名——那些是服务端配置,不对访客公开。
> - **`2f–2h`(Skills 技能库)于 2026-09-03 新增**:所有者裁定加**第四个顶部 tab「Skills」**,分享自己写的与精选的第三方 skill(Claude Code / Codex 通用的 `SKILL.md` 目录包)。三块画板:`2f` 首页(按用途四分类的卡片列表;卡片 = 等宽 skill 名 + 「自研 / 精选」描边微徽标 + 一句话中文描述 + 出处与文件数的元信息行;页脚两行:统计 + 「skill = 一个目录」的解释),`2g` 详情页(面包屑 / 等宽 22px 大标题 + 徽标 / 右上 `GitHub ↗` 与 `下载 zip` 两枚 ghost 按钮 / `INSTALL` 面板一行 `npx skills add <owner>/<repo> --skill <name>` + copy / 下半左栏 240px 粘性目录树 + 「本页目录」/ 右栏文件预览卡,默认打开 `SKILL.md`:frontmatter 键值块 + 按 2c 排版的 markdown 正文),`2h` 同一页点选 `scripts/review.py` 的状态(带行号列的代码视图,「本页目录」消失,安装命令 copy 处于 `copied` 态)。既有 12 块画板的导航条同步改成**四格**(Runtime · Notes · Skills · About),每格样式不变。**范围说明**:整个 tab 只读——没有搜索 / 筛选、没有点赞评论、不显示安装量;卡片上不放按钮(复制 / 下载都在详情页)。实现轮次:ROUNDS.md R-SKILLS。

> - **`2i–2k`(加载态与错误态)于 2026-09-03 新增**:站点投产后所有者报障 —— 点 Skills 卡片「经常没反应」、点 Notes 有时候也会,以及 `/skills/ppt-master` 白屏报 `Application error`。定位发现站点**没有任何加载态与错误边界**:软导航在服务端 RSC 返回之前 UI 一动不动(点 `diagram` 实测 4.0 秒静止),渲染失败则掉到 Next 的默认英文白屏。三块画板:`2i` Skill 详情页加载态(照 2g 逐项对位的骨架 + 面包屑右侧 `omSpin`「正在取…」)、`2j` Notes 章节页加载态(照 2c;**阅读进度线裁定为「不出现」**——正文没到就不存在「读到哪」)、`2k` 错误态(A 页面出错 / B 找不到,同一版式 460px 单列,A 带可复制的 `err_ + UTC` 标识、B 回显访问路径)。**骨架不新造视觉语言**:填充 `#eeeeee`、压在灰面上降一档 `#e0e0e0`,圆角走现有 4/5/6/7 档,动效只复用 `omPulseBg` 与 `omSpin`。**唯一的新语汇是 2k 的品牌色实心主按钮**(既有按钮语汇只有 ghost),由画板明确定为出口层级。每块画板下方带一块「裁定」面板,记录取舍与理由。实现轮次:ROUNDS.md R-PERF。
> - **`2l–2m`(会话区 · 一轮完成态)于 2026-09-03 新增**:核对发现会话区的工具调用卡**丢了**——画板 1a–1d / 1f–1g 一直画着两张(`read_file` / `bash`),首版 `bdc1ca4` 实现过,R3 `88dc2ae` 切真实数据源时断了来源,`ToolChip` 留成死代码。恢复卡片本身不涉及设计稿;**缺的是两个没画过的态**:`2l` 一轮已完成(处理过程收成一行「处理详情 · 2 次模型往返 · 2 次工具调用 · 0.4s」,13px/1.7 `#6b7280` 导航行、行尾 6px `#ef4444` 圆点提示「里面有一次没成功」,发送按钮回常态、Timeline 末行不再扫光;板上三条规则:无工具调用不出折叠行 / 进行中不折叠 / 最终回答为空只剩折叠行)、`2m` 折叠行展开 + `bash` 卡展开(边界 = 左侧 1px `#e0e0e0` 竖线 + 左内边距 14;卡片展开体紧贴卡下 4px、r6 + `rgba(0,0,0,.03)` 底 + 卡片同色描边、`INPUT` / `RESULT` 小标题、mono 11/1.6 每段最多 6 行 `max-height:106px` 超出接 `…(已截断)`;折叠行箭头 › / ˅,卡片箭头 ˅ / ˄;展开不做动画)。参考 pi-web 的折叠行为,但**不带**模型名 / provider 名 / 分段 token 与费用 / 「思考」块。**这两块不带 44px 站点导航条**(照抄 1a,1a 的工作台主屏本来就没有)。`support.js` 两边 md5 一致未动;本次拉稿 `diff | grep -c '^<'` 为 0,直接覆盖。提示词 `rounds/round-toolcards/design-prompt.md`;实现轮次:ROUNDS.md R-TOOLCARDS(2026-09-03 开工,分支 `round-toolcards`)。
>
> - **`4a–4u`(移动端,21 块)于 2026-09-07 新增**:所有者裁定做移动端,**主要目标场景是微信等社交 webview**。
>   放在**两份新文件**里(`- Runtime` = `4a–4j`、`- Notes Skills About` = `4k–4u`),桌面两份一个字节没碰 ——
>   所以这次拉稿**没有合并动作**,是纯新增文件。核心裁定是**两层语言**:外壳(顶部功能条 / 底部 Tab Bar /
>   Sheet / 胶囊按钮 / inset grouped 列表)按 **iOS 26** 重画;**内核**(Timeline 耗时色条 / Chain / Lifecycle /
>   工具卡解剖 / 代码视图行号与三色高亮 / markdown 排版)**照搬桌面 token,只做触控与换行适配**。
>   载体裁定见 CLAUDE.md 规则 8 的 R-MOBILE 修订段(PWA 只取 manifest + standalone + theme-color,
>   不做 SW、不做安装引导;竖屏靠 CSS 降级因为网页锁不了方向;禁双指要 JS 拦 `gesturestart`)。
>   微信带来的三条画法约束都画进去了:**每屏顶部画出微信导航栏 44pt 占位**(不可隐藏,所以我们自己的顶条
>   是**功能条不是标题栏**、不重复标题)、**内容安全高度 708**(845 − 59 状态栏 − 44 微信栏 − 34 Home Indicator)、
>   **玻璃材质给 `backdrop-filter` 降级两套值**(Android 微信内核支持不确定)。
>   提示词 `rounds/round-mobile/design-prompt.md`;实现轮次:ROUNDS.md R-MOBILE。
>
> - **`2n–2p`(Source 源码 tab,3 块)于 2026-09-08 新增**:所有者裁定加**第五个顶部 tab「Source」**(站点自身源码的只读浏览,
>   快照随每次生产发版发布、页面标 git SHA)并让 agent 读同一份快照。三块画板放**新文件** `Agent X-Ray Source.dc.html`
>   (`Workbench` 离 256 KiB 截断线只剩十几 KB);既有 20 块桌面画板的导航条同步改成**五格**(`Runtime · Notes · Skills · Source · About`,
>   `2l` / `2m` 本来没有导航条、照旧);原型 `navTabs` 五格 + Source 两屏(首页 README 态 / 点目录树切换文件、目录行展开收起、copy 回落、`GitHub ↗` 外链),
>   演示数据含一条 `apps/web/app/(site)/notes/[series]/page.tsx`。画板上的裁定:目录树宽 **264**(2g 是 240;树最深 8 层、末层要留得下 `[chapter]/`),
>   默认只展开**当前文件所在的那条路径**、其余目录收起(直达 `/source` 时六个根目录全收起);**不要**「本页目录」(README 只有四个小节而目录树有 294 个文件);
>   meta 行顺序 = 快照 SHA(短 7 位)→ 发布日期 → 文件数 → 总字节,描述的是仓库快照不是当前文件;`GitHub ↗` 首页指 `/tree/<40 位 sha>`、文件页指 `/blob/<sha>/<path>`,
>   不带行号锚点;**长行只在代码列一个 `overflow-x:auto` 容器里横滚**(行号列钉住,行高写死 20.4px);copy 的 `copied` 态 1.5s 回落(同 2h);
>   加载态照 2i 规则(`omPulseBg` 只给 22px 标题条与代码区第一行,「正在取 <path>…」压在面包屑右侧);**不画空态**(没有快照走 `2k`-B)。
>   **拉稿判据**:Source 72,151 B / 3 块;`Workbench` 250,586 B(仍在上限内)/ 20 块;Prototype 107,457 B;`support.js` md5 未变;
>   三份 `</x-dc>` / `</html>` / `<div>` 开合全过。**合并口径**:`Workbench` 相对本地的 11 处差异**全部是导航行**(`About` → `Source` + `About`);
>   Prototype 的 17 处差异 = `hint-placeholder-count` 4 → 5、`navTabs` 五格、Source 两屏,以及会话区从静态 HTML 改成**数据驱动**
>   (`sessTitle` / `sessRunning` / `sessDone` / 折叠行 / 卡片展开体 —— 把 2l / 2m 的态补进了原型);本地 `design/` 自 2026-09-03 写回云端后**没有任何本地改动**
>   (`git log -- design/` 最近一次是 R-MOBILE 的纯新增),所以三份直接覆盖,没有三方合并。
>   提示词 `rounds/round-source/design-prompt.md`;实现轮次:ROUNDS.md R-SOURCE。
>
> - **`2q`–`2r`(桌面 · 跨栏跨页联动,2 块)+ `4v`–`4x`(移动端,3 块)于 2026-09-08 新增**:所有者裁定把画板 `1b` / `4f` 上一直是死按钮的
>   `Ask why ↗` 做实,并加两条联动 —— 会话区工具卡 ↔ Timeline 行**双向定位**、Notes 章节页 →  Runtime 的「在 Runtime 里聊这一章」入口。
>   三件事共用**一个原语**:「把一句预设文本放进输入框,**永不自动发送**」。桌面两块放**新文件** `Agent X-Ray Crosslink.dc.html`
>   (`Workbench` 离 256 KiB 上限只剩十几 KB);移动 `4v` / `4w` 追加进 `- Runtime`、`4x` 追加进 `- Notes Skills About`;`1b` / `4f` **只加注释面板、图形不动**。
>   画板上的裁定:两条新链接**照抄 `Ask why ↗` 的画法**(11px 品牌色 + r5 + padding 2/6 + hover 露 `#eeeeee` 底 + 尾部 `↗`;详情卡右上并排、间距 6、
>   **Ask why 永远在最右**),会话区那条在**卡片展开体之内**、`RESULT` 段下 10、mono 11 品牌色左对齐;**「定位」= 既有展开态 + 滚入视野**,
>   不新增高亮色 / 不加「已定位」徽标 / 滚动不画动效;**对不上(`toolCallId` 找不到)就整条不渲染**,不画禁用态、不弹「定位失败」;
>   追问文案**两种形状**(工具行带工具名与入参摘要,非工具行只有 Turn 标签 + 事件名),只用 Timeline 行上拿得到的字段(无行号 / 模型名 / provider 名);
>   `2r` / `4x` 的入口**取方案 A**(meta 行末尾文本链接,与「原文」同一语汇)而非 h1 右侧 ghost 按钮 —— 理由是同类信息同行、它不是本页主动作、A 不新增组件;
>   Runtime tab 被隐藏时整条链接不渲染(连同前面那个「·」)。移动端两处增量:`4x` 的 meta 行行高提到 **1.9** 并允许自然换行(命中区与「原文」同一取舍,不单独升 44);
>   `4w` 定案**只留 Ask why 胶囊**,「查看卡片」下沉成详情块底部一行链接(详情块内宽约 308,两枚胶囊会把 INPUT 挤到 148),与①屏的「在 Timeline 里查看 ↗」互为镜像。
>   **拉稿判据**:Crosslink 35,473 B / 2 块;`Mobile - Runtime` 169,125 B / 12 块;`- Notes Skills About` 198,838 B / 12 块;`Workbench` 252,962 B / 20 块(只多了 1b 那块注释);
>   四份 `</x-dc>` / `</html>` / `<div>` / `<sc-for>` / `<sc-if>` 开合全过;`support.js` md5 未变。**合并口径**:`Workbench` 与 `- Notes Skills About` 的 `diff | grep -c '^<'` 为 0,
>   `- Runtime` 唯一一处 `<` 是 `renderVals` 返回行被**就地改写**(补 `w2before, w2after` 两个数据源),不是本地行被删,所以四份直接覆盖、没有三方合并。
>   提示词 `rounds/round-crosslink/design-prompt.md`;实现轮次:ROUNDS.md R-CROSSLINK。
>
> **⚠️ 单文件 256 KiB 硬上限(2026-09-07 实测撞线,下次扩画板前必读)**:DesignSync `get_file` 的上限是
> 262,144 字节,**超了静默截断、不报错**。移动端 21 块最初画在一份文件里,拉下来正好 262,144 字节、
> 末尾断在属性中间、`</x-dc>` 与 `</html>` 都没有、`<div>` 开合差 7 个 —— `4a–4t` 完整而 `4u` 只到一半。
> 拆成两份文件后重拉,两份分别 132,859 / 186,339 字节,四项判据(字节数 / 闭合标签 / div 开合 / 画板数)全过。
> **桌面 `Agent Runtime Workbench.dc.html` 现为 252,962 字节(2026-09-08 R-CROSSLINK 给 1b 加注释面板后),离上限只剩 9 KB —— 下次给桌面加画板前必须先拆文件**
> (R-SOURCE 的 `2n–2p`、R-CROSSLINK 的 `2q–2r` 都已经是放新文件了;**连给既有画板加注释都要先算字节数**)。
> 移动端两份现为 169,125 / 198,838 字节(R-CROSSLINK 追加 `4v` / `4w` / `4x` 后),仍有余量。
> 拉稿后一律先验那四项,齐了才算拿到稿。
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
- Source 源码 tab(2n–2p,未新造 token):目录树宽 264(2g 是 240)、行高 26 / 每层缩进 12 / 目录行 12px 箭头(› 收起 / ˅ 展开,stroke `#9ca3af`,与 2l–2m 同一枚)/ 文件行留 12px 箭头位 / 文件行尾 11px `#9ca3af` 体积 / 选中行 `#e8e8e8` + 600;页头 = 面包屑 12px `#9ca3af`(链接段品牌色)+ mono 22/650 标题 + `MIT` 描边微徽标 + 13px `#6b7280` 一句话 + mono 11 `#9ca3af` meta 行 + 右上 ghost `GitHub ↗`;预览卡头部条与代码视图照 2g/2h,**长行只在代码列一个 `overflow-x:auto` 容器里横滚**(36px 行号列钉住,行高写死 20.4px = 12×1.7);页脚一行 12px `#9ca3af` 行高 1.9;加载态照 2i 规则,`omPulseBg` 只给 22px 标题条与代码区第一行
- 圆角:4 微徽标 / 5 小按钮 / 6–7 卡片 / 8 弹层 / 12 用户气泡;等宽字体 JetBrains Mono
- 动画:`omPulseBg`(Lifecycle 活跃节点脉动,1.8s)/ `omWaveSweep`(Timeline 进行中行自左向右扫光,1.8s)/ `omSpin`(发送按钮生成期间转圈,0.8s);Timeline 色条宽度 `min(198, max(4, round(sqrt(ms)*11)))`
