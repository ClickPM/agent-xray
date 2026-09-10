# 设计稿存档

来源:Claude Design 项目(claude.ai/design,项目名「Agent X-Ray 设计完成」,id `1a257a60-2f83-4795-9535-1d5a4677f21f`)。

| 文件 | 角色 |
|---|---|
| `Agent Runtime Workbench.dc.html` | **静态画板集(终稿,20 块)**:1a–1e Runtime 工作台(主屏 Timeline / 事件详情 / Chain View / Lifecycle Map / 空状态)、**1f–1g Tools 工具面板**(列表 / 展开 `web_search`;2026-09-02 新增)、2a–2e Notes/About(教程库首页 / 系列目录 / 文章阅读 / RSS 弹层 / 关于页)、**2f–2h Skills 技能库**(首页 / 详情页 SKILL.md 预览态 / 详情页 Python 文件预览态;2026-09-03 新增)、**2i–2k 加载态与错误态**(Skill 详情页加载 / Notes 章节页加载 / 错误态 A 出错 B 找不到;2026-09-03 新增)、**2l–2m 会话区一轮完成态**(处理过程折叠行 / 折叠行展开 + 卡片展开;2026-09-03 新增),实现时逐画板对照。**2026-09-08(R-CROSSLINK)只给 `1b` 加了一块「详情卡链接裁定」注释面板**(图形一个像素没动),画板数仍是 20 |
| `Agent X-Ray Prototype.dc.html` | **可交互原型**:单页状态机(Runtime/Notes/Series/Article/**Skills/Skill**/About **七**屏 + RSS 弹层 + 运行时面板**四** tab 切换 + Tools 面板逐工具展开/收起 + **Skill 详情页目录树点选切换预览、安装命令与文件两处 copy**),`data-dc-script` 里含全部演示数据与交互逻辑——**主站实现的首要参照** |
| `Agent X-Ray Mobile - Runtime.dc.html` | **移动端画板集 · Runtime(终稿,14 块)**:`4a` 空状态 / `4b` 对话进行中 / `4c` 一轮完成折叠态 / `4d` 折叠行展开 + 卡片展开 / `4e` 运行时 Sheet · Timeline(medium detent)/ `4f` 事件详情(large)/ `4g` Chain View / `4h` Lifecycle Map / `4i` Tools / `4j` 会话列表 Sheet;**`4v` 追问预填(Sheet 收起 + 输入框带文本 + 键盘弹起)/ `4w` 卡片 ↔ Timeline 双向定位(两屏并列)**,并给 `4f` 加了一块注释面板(图形不动);2026-09-08 新增(R-CROSSLINK)。**`4y` 正文里的六种信息卡片(三屏:stat 两列 + kv 收起 + table 横滚 / compare 堆叠 / list + tabs 分段控件 + 卡底胶囊)/ `4z` 卡片流式骨架 · 回落代码块 · 交互态三连(对位 2t)**,2026-09-09 新增(R-CARDS)。2026-09-07 新增(R-MOBILE) |
| `Agent X-Ray Mobile - Notes Skills About.dc.html` | **移动端画板集 · 其余(终稿,12 块)**:`4k` Notes 首页 / `4l` 系列目录 / `4m` 章节阅读 / `4n` 本章目录 Sheet + RSS Sheet / `4o` Skills 首页 / `4p` Skill 详情 SKILL.md / `4q` 代码文件 + 文件树 Sheet / `4r` About / `4s` 加载骨架 / `4t` 错误态 A·B·断网 / `4u` 载体适配四态;**`4x` 章节阅读 · 「在 Runtime 里聊这一章」入口**(2026-09-08 新增,R-CROSSLINK)。2026-09-07 新增(R-MOBILE) |
| `Agent X-Ray Source.dc.html` | **桌面画板集 · Source 源码 tab(终稿,3 块)**:`2n` Source 首页(`/source` · README 态)/ `2o` 代码文件态(`/source/apps/api/agent/tools.ts`,copy 已按下)/ `2p` 文件加载态(骨架对位 2o)。2026-09-08 新增(R-SOURCE)。**放新文件**是因为 `Agent Runtime Workbench.dc.html` 离 256 KiB 截断线只剩十几 KB;后者本次只改导航条(20 块四格 → 五格) |
| `Agent X-Ray Crosslink.dc.html` | **桌面画板集 · 跨栏跨页联动(终稿,2 块)**:`2q` 追问预填 + 卡片 ↔ Timeline 双向定位(工具行详情卡右上并排两条链接 / 会话区展开体底部一条链接 / 输入框已带追问文本)/ `2r` Notes 章节页「在 Runtime 里聊这一章」入口(方案 A:meta 行末尾文本链接)。2026-09-08 新增(R-CROSSLINK)。**放新文件**是因为 `Agent Runtime Workbench.dc.html` 离 256 KiB 截断线只剩十几 KB |
| `Agent X-Ray Cards.dc.html` | **桌面画板集 · 会话区信息卡片(终稿,2 块)**:`2s` 助手正文里的六种信息卡片(一轮已完成态的会话区,顺序 stat → kv(collapsed 收起态)→ table(`sortable`,第二列降序)→ list(有序,两项带 note)→ compare(3 列 × 6 行)→ tabs(胶囊单选 + 卡底 2 条链接 + 1 枚 ghost 动作按钮))/ `2t` 流式骨架(段①整屏:发送按钮转圈 + 右栏末行扫光 + 卡片骨架同一时刻)· 回落成普通代码块(段②)· 交互态三连(段③:tabs 切到第二页 / 表头升序 / collapsed 卡点开)。2026-09-09 新增(R-CARDS)。**放新文件**是因为 `Agent Runtime Workbench.dc.html` 离 256 KiB 截断线只剩 9 KB |
| `Agent X-Ray Cards 2.dc.html` | **桌面画板集 · 会话区 UI 组件 2.0(终稿,2 块)**:`2u` 两种可回传卡(choice / form)+ 位置①(折叠行之后、正文之前)+ 单选点选项即发送后的锁定态与紧随的访客气泡,下方八块标本(单选未发送 / 多选未选 submit 禁用 / 多选选中两项 / 多选锁定 + 气泡 / form 必填未填 / form 全填 / form 锁定 + 气泡 / busy / 流式骨架)/ `2v` 静态 HTML 组件的沙箱帧 + 位置②(最后一段正文之后),标本:流式骨架(按声明高度立住)/ 回落代码块 / 高度夹取(900 → 480、100 → 160)/ 一轮两个组件 / 主题态说明。2026-09-09 新增(R-CARDS-2)。**放新文件**是因为 `Agent Runtime Workbench.dc.html` 离 256 KiB 截断线只剩 9 KB |
| `Agent X-Ray Mobile - Runtime 2.dc.html` | **移动端画板集 · Runtime 2(终稿,2 块)**:`5a` 两种可回传卡(十屏:锁定单选卡主体 / 单选未发送 / 多选未选 / 多选选中 / 多选锁定 / form 未填 / form 全填 / form 锁定 / 键盘弹起 / busy)/ `5b` 沙箱帧(四屏:帧主体 358×320 / 骨架 / 回落 / 夹取与两组件)。2026-09-09 新增(R-CARDS-2);**`5x` 号段从此启用**。**放新文件**是因为 `Agent X-Ray Mobile - Runtime.dc.html` 离截断线只剩 27 KB |
| `Agent X-Ray Mobile - Shell.dc.html` | **移动端画板集 · 壳层(终稿,2 块)**:`5c` 一级页顶部(三屏:About 滚到顶「状态栏之下没有任何条」/ About 滚过大标题后玻璃条淡入、条内 17/600 左对齐页名 / Notes 首页滚到顶、RSS 回大标题行右端,附「滚动后 RSS 进条」的 1:1 构造图)/ `5d` 屏底(三屏:Tab Bar 贴真正的屏底 / 收起后整条滑出屏外零残条 / About 页尾备案两行,附页尾两行的 1:1 构造图)。2026-09-10 新增(R-MOBILE-2)。**载体是 standalone 与普通移动浏览器** —— `4a`–`4u` 那条「微信导航栏 44 · 不可控」占位在这两块里**不画**,可视高 708 → 752 |
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
> - **`2s`–`2t`(桌面 · 会话区信息卡片,2 块)+ `4y`–`4z`(移动端,2 块)于 2026-09-09 新增**:所有者裁定让 agent 在回复里嵌**信息卡片**(2026-09-08 圈定 2-A 内容级:
>   模型在正文里写 ` ```xray-card` ` + JSON 围栏,渲染器识别 `language-xray-card` 画卡,**不是 pi 工具**)。桌面两块放**新文件** `Agent X-Ray Cards.dc.html`
>   (`Workbench` 离 256 KiB 只剩 9 KB);移动两块追加进 `- Runtime`。画板上的裁定:**这是第二种卡,不是第三种视觉语言** —— 工具卡 = 「agent 做了什么」,
>   信息卡 = 「agent 给你看什么」,外框一律照 `2m` 展开体(r6 + `rgba(0,0,0,.03)` 底 + 1px `#e0e0e0`),与工具卡的唯一区别是描边用中性色、不用状态色,**卡里一处不用语义色**;
>   标题行可选(mono 10/600 `#9ca3af` 0.08em,与 INPUT / RESULT 同一枚),**collapsed 卡的标题行不可省**(收起态唯一的把手,行首 12px 箭头 › / ˅ 与 `2l` 同一枚);
>   六种主体:`stat` 2–4 格一排(mono 22/650 tabular 大数字 + 12 单位 + 12 标签 + 11 note,格间 1px 竖分隔)/ `kv` ≤ 20 行(键列定宽 150 次级色)/ `table` ≤ 6 列 × 20 行
>   (照 `2c` 表格,**全出血、靠卡片描边当外边线**,数字列 mono tabular;`sortable` 时表头 10px 箭头 ˅ / ˄、当前排序列整格品牌色,列宽不随排序变)/ `list` 序号 mono 13 定宽 22 + 13/1.7 正文 + 可选 11 note /
>   `compare` 3 列 ≤ 20 行(首列次级色)/ `tabs` ≤ 5 页、每页装其它五种之一、不能再套 tabs,**形状定案胶囊单选组**(取 `2c` 顶栏导航那一枚,唯一改动 = 选中文字换品牌色;不做下划线 tab,
>   免得被读成第二个面板)。卡底可选:≤ 5 条 13px 品牌色文本链接(`↗` 只给站外)+ 至多一枚 ghost 32/r7 动作按钮(文案由模型给,点了只把那句话放进输入框、不发送);
>   所有值都是字符串 ≤ 200 字、**不解析 markdown**。**回落规则**:JSON 解析失败 / 超限 / 未知 kind 一律渲染成普通代码块(`2c` 画法,语言标签 `xray-card`,连 copy 一起继承),
>   **没有错误提示**。**流式骨架**:围栏已开、未闭合期间显示,卡框先立住 + 一条标题条(r6)+ 三条正文条(r4),不预测行数,骨架色叠在灰面上降一档 `#e0e0e0`,`omPulseBg` 只挂标题条;
>   闭合即整块换成卡或回落代码块。交互只有四种(tabs 切换 / 折叠 / 表头排序 / 单选切面板),**三种都不做动画**;**卡片留在最终回答里、不进折叠行**;卡片级没有「查看轨迹」入口。
>   **移动端(`4y` / `4z`)**:内核 token 一字未改,只动触控 / 换行 / 横滚 —— 横滚只有 `table` 一处(内容定宽 480,超出卡片右缘直接裁切,不加渐隐);`compare` 在 A / B 列各 < 160
>   (卡内宽 < 480)时**上下堆叠**(列名降级成行内 mono 10 小标题),≥ 480 走横滚;`stat` 改两列网格(第 2 格左分隔、第 3 格上分隔);`tabs` → `SegmentedControl`(`4e` 那一枚,
>   **选中态不套品牌色**);卡底动作按钮改胶囊(44 命中)并换到链接下方独占一行;collapsed 标题行 min-height 44;回落代码块正文 `overflow-x:auto + white-space:pre`。
>   **拉稿判据**:Cards 55,339 B / 2 块;`Mobile - Runtime` **234,371 B** / 14 块(**离上限只剩 27 KB**);`Prototype` 与 `support.js` md5 未变(原型本次未加卡片屏);
>   两份 `</x-dc>` / `</html>` / `<div>` / `<sc-for>` / `<sc-if>` 开合全过。**合并口径**:`- Runtime` 的 `diff | grep -c '^<'` 为 0(466 行纯新增),Cards 是新文件,直接覆盖、无三方合并。
>   提示词 `rounds/round-cards/design-prompt.md`;实现轮次:ROUNDS.md R-CARDS(2026-09-09 开工,分支 `round-cards`)。
>
> - **`2u`–`2v`(桌面 · 会话区 UI 组件 2.0,2 块)+ `5a`–`5b`(移动端,2 块)于 2026-09-09 新增**:所有者裁定做 UI 组件 2.0(A = `xray-card` 加 `choice` / `form` 两种**可回传** kind,回传 = 发送;
>   B = ` ```xray-html ` 围栏 → `sandbox=""` 静态帧;C / D 两档暂不考虑)。四块画板**全部放新文件**(桌面 `Agent X-Ray Cards 2.dc.html`,移动 `Agent X-Ray Mobile - Runtime 2.dc.html`):
>   `Workbench` 只剩 9 KB、`Mobile - Runtime` 只剩 27 KB,都放不下。画板上的裁定:**「这不是第三种卡」** —— 两种新 kind 长在 2s / 2t 的信息卡语汇上一处未改,
>   唯一新增的两个形状是选择指示(单选 15px 圆点 / 多选 15px r4 方框,常态 1px `#e0e0e0` + 白底,选中态描边与填充换 `#2563eb`,多选内嵌 9px 白色对勾);单选**没有按钮**、点任一选项即刻发出并锁定,
>   多选与 form 靠卡底一枚 submit(ghost 32 高 r7,缺省「提交」;多选至少选中一项 / form 必填填满前禁用,禁用 = 文字 `#9ca3af`、描边底色不变、无 hover);发出的就是一条普通访客气泡、**没有任何「来自卡片」的标记**,
>   文本组成 = choice「题干: label」(多选以「、」相连)/ form「题干 字段: 值; 字段: 值」,**title / note / placeholder / 按钮文案一律不进消息**;锁定态已选高亮保留、未选 label 降到 `#9ca3af`、文案不变(不改成「已提交」);
>   busy 态与底部发送按钮同一副禁用视觉;两种态都不做动画;选中与锁定都是本地状态,刷新回初始态。帧:**外框照代码块 / 工具卡展开体**(r7 + 1px `#e0e0e0`,帧内容不另画外框),**没有标题栏与任何工具栏**,
>   宽 = 正文宽(桌面 640 / 移动 358)、高由开围栏行声明夹到 160–480(移动 ≤ 360)缺省 320、超高帧内滚;帧内配色 = 站点主题变量;流式先按声明高度立骨架(三条 r4 骨架条,`omPulseBg` 一处锚点)、闭合原位换成帧、不做渐进渲染、不做动画;
>   写坏 / 超 16 KB → 普通代码块(语言标签 `xray-html`)无错误提示。移动端(`5a` / `5b`)只做三处触控适配:选项行整行 min-height 44、submit 换成胶囊独占一行 44 高(`rgba(120,120,128,.12)` 底 + 品牌色字)、
>   输入框取站内胶囊语汇(44 高、r10、15px,聚焦白底 + 品牌色描边);帧内比 358 宽的内容在帧内横滚、页面不横滚;键盘弹起时被聚焦字段整条落在可见区(⑨屏)。
>   **拉稿判据**:Cards 2 75,355 B / 2 块;Mobile - Runtime 2 125,528 B / 14 屏 2 块;两份 `</x-dc>` / `</html>` / `<div>` 开合全过;`support.js` md5 未变。**合并口径**:两份都是新文件,直接落盘、无三方合并;既有七份一个字节没碰。
>   提示词 `rounds/round-cards2/design-prompt.md`;实现轮次:ROUNDS.md R-CARDS-2(2026-09-09 开工,分支 `round-cards2`)。
>
> - **`5c`–`5d`(移动端 · 壳层,2 块)于 2026-09-10 新增**:所有者在真机 **standalone(添加到主屏幕)**下报障四条 ——
>   非 Runtime 页头部一条空白、Tab Bar 下方一条白带、备案号占屏底高度、Tab Bar 收起后剩一条只有图标的残条。
>   根因是**移动端 21 块画板以微信 webview 为主场景画**:每屏顶部画着「微信导航栏 44 · 不可控」占位,一级页那条两侧全空的
>   功能条在微信里读起来是宿主标题栏的延续,而 standalone / 普通浏览器里宿主那条**不存在**,它就成了一条什么都不装的 44 白边;
>   屏底三条则是同一件事 —— 备案底栏(画板从来没画过它,是 `docs/deploy-cn-lightweight.md` 的部署约束)占着屏底,
>   Tab Bar 于是贴的是「内容区的底」。两块画板定的是同一件事的两端:**这两个载体下一屏的顶部与底部各留多少、各长什么样**;
>   内容区(列表 / 卡片 / 内核层 / markdown 排版)一律不动。放**一份新文件**(`- Notes Skills About` 198,838 字节,离上限只剩 63 KB,不追加)。
>   画板上的裁定:一级页(Notes / Skills / About)**到顶整条不画**、大标题贴安全区下 8,滚过大标题后玻璃条淡入、条内 **17/600 页名左对齐**
>   (`4k` 附早已定过的收起规则,首版没实现);**二级页(`4m` / `4p`–`4q`)不变** —— 它们的条里有带文字的返回,本来就不是空条;
>   Notes 的 RSS 到顶时**原尺寸平移**回大标题行右端(位置照桌面 `2a`,视觉仍是 `4k` 那枚 30 圆 + `rgba(120,120,128,0.12)` 底、命中 44);
>   Tab Bar 贴**真正的屏底**、玻璃盒子高 = 49 + 安全区、收起时位移量 = **条整高**(现状那条 26 高残条正是量成 49 的结果);
>   备案两号进 **About 页尾**,各占一行居中、命中 390×44 相接、公安图标 18×20 在号码左侧、mono 11 `#9ca3af`,
>   **是页尾小字不是分组卡**(不加卡、不加分隔线、不加「备案信息」标题),不用 ellipsis;
>   `4r` 里「外观」上移到技术栈之前,让技术栈 + 导流句 + 页尾连成收尾(**本轮唯一一处内容顺序调整**)。**一个新 token 都不加**。
>   **拉稿判据**:Shell 53,144 B / 2 块 6 屏;`</x-dc>` / `</html>` 各 1、`<div>` 开合 196/196、无控制字符、LF。
>   **合并口径**:纯新增文件,直接落盘、无三方合并;既有九份一个字节没碰(`support.js` 本轮未重拉 —— 前两次拉稿 md5 均一致,且新增文件不依赖新的运行时特性)。
>   提示词 `rounds/round-mobile2/design-prompt.md`;实现轮次:ROUNDS.md R-MOBILE-2(2026-09-10 开工,分支 `round-mobile2`)。
>
> **⚠️ 单文件 256 KiB 硬上限(2026-09-07 实测撞线,下次扩画板前必读)**:DesignSync `get_file` 的上限是
> 262,144 字节,**超了静默截断、不报错**。移动端 21 块最初画在一份文件里,拉下来正好 262,144 字节、
> 末尾断在属性中间、`</x-dc>` 与 `</html>` 都没有、`<div>` 开合差 7 个 —— `4a–4t` 完整而 `4u` 只到一半。
> 拆成两份文件后重拉,两份分别 132,859 / 186,339 字节,四项判据(字节数 / 闭合标签 / div 开合 / 画板数)全过。
> **桌面 `Agent Runtime Workbench.dc.html` 现为 252,962 字节(2026-09-08 R-CROSSLINK 给 1b 加注释面板后),离上限只剩 9 KB —— 下次给桌面加画板前必须先拆文件**
> (R-SOURCE 的 `2n–2p`、R-CROSSLINK 的 `2q–2r`、R-CARDS 的 `2s–2t` 都已经是放新文件了;**连给既有画板加注释都要先算字节数**)。
> 移动端两份现为 **234,371**(`- Runtime`,R-CARDS 追加 `4y` / `4z` 后,**离上限只剩 27 KB —— 下次给移动 Runtime 加画板前也必须先拆文件**)/ 198,838 字节(`- Notes Skills About`,仍有余量)。
> R-CARDS-2 据此把四块画板全放进两份新文件:`Agent X-Ray Cards 2.dc.html` 75,355 字节、`Agent X-Ray Mobile - Runtime 2.dc.html` 125,528 字节(2026-09-09),两份都还有大量余量,下一轮桌面 / 移动 Runtime 的新画板优先追加到它们里。
> R-MOBILE-2 同样放新文件:`Agent X-Ray Mobile - Shell.dc.html` 53,144 字节(2026-09-10)—— `- Notes Skills About` 当时 198,838 字节、离上限只剩 63 KB,而一块移动画板约 27 KB,两块并列的更多,所以不追加。
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
