# Round R-MOBILE-2 — 移动端 standalone 壳层修补:顶部空条 + 屏底 Tab Bar + 备案号搬进 About

> 状态:进行中(`5c` / `5d` 已于 2026-09-10 并入 `design/`;A1 / A2 / B1 / B2 + `4r` 收口已实现,本机验收全过,独立审查中)
>
> 触发:所有者 2026-09-10 在真机 **standalone(添加到主屏幕)**下报障四条 + 两张截图。
> 分级方案与圈定:A1 / A2 / B1 / B2 全做,`GitHub ↗` 按画板 `4r` 收口;C1 / C2 不做(记 BACKLOG)。
> 画板提示词:[`design-prompt.md`](design-prompt.md)。ROUNDS.md 第十五次修订 = 本轮的边界裁定。
> **本轮起独立审查执行器 = cursor CLI + `cursor-grok-4.6-high`**(codex 限流暂停),见 [`docs/review-workflow.md`](../../docs/review-workflow.md)。

## 目标

standalone 与普通移动浏览器下,**一屏的顶部与底部不再有无主的空白**:非 Runtime 页头部不出现空功能条、
屏底只有贴着屏幕底缘的 Tab Bar、Tab Bar 收起后屏底零残条、备案两号改在 About 页尾且可见可点。
**桌面逐像素零改动,移动端不新增任何产品功能。**

## 前置

- `5c` / `5d` 并入 `design/`(B1 / B2 的前置;A1 / A2 不依赖)。
- 生产已在 `6b6a4cb`(两个备案号已上底栏),`docs/deploy-cn-lightweight.md` §1 第 6 步记着当前形态。

## 根因(生产实测,`375×812` + 模拟 `safe-top 59` / `safe-bottom 34`)

| 报障 | 实测 | 根因 |
|---|---|---|
| ① 非 Runtime 页头部空白 | 功能条 `0 → 103`(44 + safe-top),About / Skills 首页条内两侧全空 | 画板 `4a`–`4u` 以微信 webview 为主场景画,顶部假设「宿主导航栏 44」压在我们这条之上;standalone 下宿主那条不存在。且画板 `4k` 附的「大标题收起态」**首版从未实现**,所以滚起来条里也不会有内容 |
| ② Tab Bar 下方白带 | Tab Bar `703 → 786`(49+34),内容区底 786,备案底栏 `786 → 812` | 备案底栏参与移动端布局 ⇒ Tab Bar 贴的是内容区底,它那 34 的安全区留白没落在 Home Indicator 上 |
| ③ 备案号占屏底高度 | 同上 | R-MOBILE 任务卡当时即记「ICP 位置画板没画,要不要换位置请裁定」 |
| ④ Tab Bar 收起后被遮挡 | 收起后 `translateY(0, 83)`、`footerCovered = 26px`,屏底剩「只有图标没有文字」的残条 | 收起只平移自身高度(49 + safe-bottom),而它下面还压着 26 高的底栏。**普通手机浏览器同样中招**,与安全区无关 |

②③④ 是同一件事:**备案底栏占了屏底**。所以 A1 是 ②④ 的前置。

## 交付物

| # | 文件 | 改什么 |
|---|---|---|
| A1 | `apps/web/components/SiteFooter.tsx` | 拆出共用的备案行(两个号的 env 读取、`?code=` 取数、链接与图标口径只留一处);底栏容器加 `m-hide-narrow`,≤768px 不渲染 ⇒ 内容区自然长到屏底 |
| A1 | `apps/web/app/(site)/about/page.tsx` | 页尾(技术栈 + 导流句之后)渲染移动端专属的备案行(`m-show-narrow`),版式按 `5d` ③ |
| A1 | `apps/web/app/(site)/layout.tsx` | 只改注释:原注释写的「Tab Bar 贴内容区底是为了不盖住备案条」在移动端已不成立,要改成新事实(桌面仍有底栏,故定位容器保留) |
| A2 | `apps/web/components/mobile/MobilePageBar.tsx` | 新增可选的收起标题(画板 `4k` 附:34/700 → 条内 **17/600 左对齐**,不居中);滚动阈值 = 大标题滚出视野 |
| A2 | `apps/web/components/notes/NotesIndex.tsx`、`apps/web/components/skills/SkillsIndex.tsx`、`apps/web/app/(site)/about/page.tsx` | 三个一级页各把自己的标题传给功能条(收起规则三页共用) |
| B1 | 同上四个文件 + `apps/web/app/globals.css` | 一级页**滚到顶不出条**:大标题贴安全区(`.m-page-wrap` 顶部按 `--safe-top` 让位),滚过大标题后玻璃条淡入;Notes 的 RSS 到顶时在标题行右端、滚动后进条 |
| B2 | `apps/web/app/(site)/about/page.tsx` | 备案行版式按 `5d` ③ 定版(两号各一行居中、公安图标 18×20 在左、mono 11 `--text-dim`、可点) |
| 4r | `apps/web/app/(site)/about/page.tsx` + `globals.css` | 按画板 `4r` 收口移动端 About 头部:`GitHub ↗` ghost 按钮移动端不渲染(桌面保留)、头像行改「头像 + @名 + repo 数」一行 + 简介独立段 |
| 文档 | `docs/deploy-cn-lightweight.md` | §1 第 6 步与上线检查单:备案号在**桌面底栏 + 移动 About 页尾**两处,验收判据改成两种视口各看一次 |
| 文档 | 本任务卡 + `ROUNDS.md` + `rounds/BACKLOG.md` | 回填实测;C1 / C2 与「移动端首页无备案号」的残余风险入 BACKLOG |

**不交付**:后端任何改动 / 迁移 / MCP 工具(仍 51)/ 新依赖 / 桌面任何视觉改动 / 二级页(章节页、Skill 详情)的功能条形态 / 移动端新功能。

## 验收

| # | 检查 | 命令 / 期望 |
|---|---|---|
| 1 | 编译与测试 | `dev.ps1 check`、`dev.ps1 test`(api + web 全绿)、`apps/web` 里 `npx tsc --noEmit` 通过 |
| 2 | 一级页到顶 | 390×845 模拟 `safe-top 59`:About / Skills / Notes 首页 **状态栏之下第一个可见元素就是大标题**,`.m-pagebar` 不占高(或不渲染) |
| 3 | 一级页滚动后 | 同上三页向上滚过大标题:玻璃条出现,条内标题 **17px / 600 / 左对齐**,内容从条下穿过 |
| 4 | 二级页不变 | Notes 章节页、Skill 详情页的功能条从到顶起就在,带文字返回,与 `4m` / `4p` 一致 |
| 5 | Runtime 不变 | 站点根路径的顶部功能条(会话 / 运行时)与改前逐项一致 |
| 6 | 屏底只有 Tab Bar | ≤768px:`getBoundingClientRect().bottom` 的 Tab Bar 底 == `innerHeight`;备案底栏 `display:none`、不占高 |
| 7 | 收起零残条 | 向下滚触发收起后,Tab Bar 的 `rect.top >= innerHeight`(整条出屏);屏底除安全区留白外无任何元素 |
| 8 | 备案两号可见可点 | 移动 About 页尾:两号都渲染,ICP 链 `beian.miit.gov.cn`,公安链 `beian.mps.gov.cn/#/query/webSearch?code=<数字串>`,图标是 `public/beian-mps.png` 原文件、18×20 |
| 9 | 未配置时不渲染 | 本机 / 130(两个 env 都空):About 页尾整块不出现,版式与画板一致 |
| 10 | 桌面零改动 | 1280×800:底栏两号并排一行、26 高;五 Tab 版式与改前逐项一致(导航条 h44 / 左栏 260 / 右面板 428) |
| 11 | About 按 `4r` | 移动端:无 `GitHub ↗` 按钮、头像行是「头像 + @名 + repo 数」一行、简介独立段;桌面 About 与画板 `2e` 一字不差 |
| 12 | 画板逐项 | `5c` ①②③ / `5d` ①②③ 与实现逐项比对(尺寸、字号、字重、对齐、留白) |
| 13 | 零横向溢出 | 四 Tab 在 390 / 320 / 430 三个宽度下 `body.scrollWidth === innerWidth` |
| 14 | 文档同步 | `docs/deploy-cn-lightweight.md` 两处已改;本任务卡「代码审查」「本轮实测」已回填;`design/README.md` 增删记录已随拉稿更新 |

## 禁止

- 不改桌面任何样式 / 布局 / className / token(规则 7);桌面底栏形态一个字节不动。
- 不加设计稿没有的功能(规则 8):**不许**出现「返回顶部」按钮、页尾链接组、备案信息标题、Notes / Skills 页尾的备案行(那是 C2,未圈定)。
- 不动后端、迁移、MCP、依赖。
- 不碰二级页功能条形态,不碰 Runtime 壳层几何。

## 代码审查

<!-- 完成后回填。审查路由见 CLAUDE.md「开发模式」与 docs/review-workflow.md。 -->

- 审查方式:<cursor-review.ps1(默认档)| -Kind adversarial | /code-review(写明降级原因)>
- 审查器与模型:cursor CLI `cursor-grok-4.6-high`(本轮是切换执行器后的第一轮,耗时基线要回填)
- findings 处理:<逐条:采纳整改 / 不采纳及理由>
- 结论:<PASS | 整改后 PASS>

## 失败处理

同一验收项针对性整改后连续 2 次验证仍不过 → 写 `rounds/round-mobile2/BLOCKED.md`,停下呼人。禁止放宽验收标准自我通过。

## 本轮实测

<!-- 完成后回填:实际数字、踩的坑、与设计/计划的偏离及原因 -->

- 报障复现的原始数字已记在上方「根因」表(生产 `6b6a4cb`,Browser pane `375×812`,`--safe-top` / `--safe-bottom` 注成 59 / 34 模拟 standalone)。
- 已认的残余风险:**移动端首页(Runtime,自身不滚动)不再显示备案号**;备案抽查通常看首页底部。所有者 2026-09-10 认此风险(桌面底栏照旧、移动 About 里有),更稳的变体(C2)记 BACKLOG。

### 拉稿(2026-09-10)

`Agent X-Ray Mobile - Shell.dc.html` 是**纯新增文件**,直接落盘、无三方合并;既有九份一个字节没碰。
四项判据:**53,144 字节** / `</x-dc>` 与 `</html>` 各 1 / `<div>` 开合 **196 : 196** / 画板 2 块 6 屏(`5c` ①②③、`5d` ①②③),另加验了无控制字符与 LF 行尾。
`support.js` 本轮未重拉(前两次拉稿 md5 均一致,新增文件不依赖新的运行时特性),已在 `design/README.md` 注明。

### 实现取舍(三处值得记)

1. **「到顶不出条」用的是负外边距,不是不渲染、也不是 `fixed`**(`.m-pagebar-float`,只在 ≤768px 生效)。
   条实高 = `44 + safe-top`,`margin-bottom: -44px` 只抵掉那 44,**剩下的 `safe-top` 正好成了内容顶部的安全区留白** ——
   于是 `.m-page-wrap` 的顶部内边距一个字节没改,大标题靠 `.m-h1` 既有的 `margin-top:8` 落在「安全区下 8」(实测 top = 67 = 59 + 8)。
   反面两条都试过在纸上:**整条不渲染**会让条出现的那一刻把内容推下 44,内容一动、「大标题滚出了没有」的判定跟着翻,来回抖;
   **`fixed`** 要另找定位祖先(各页的滚动容器在 layout 那一层之下),等于新机制。
2. **收起阈值按大标题的位置量,不按滚动了多少像素**:`title.getBoundingClientRect().bottom <= bar.getBoundingClientRect().bottom`。
   画板 `5c` 的规则原文就是「功能条只在**大标题滚出后**出现」,阈值随字号 / 折行 / 安全区变,量元素比量常数稳(320 / 430 / 横屏都不用另配数)。
   大标题靠**既有的 `.m-h1` 类**找(三个一级页共用,globals.css 里 34/700 那条规则就是按它写的);找不到时退回「条常驻」——
   宁可多一条空条,也不能把条里的动作(Notes 的 RSS)永久藏掉。滚动监听沿用 `MobileTabBar` 的手法(document 捕获阶段 + rAF 合帧)。
3. **条内 gap 在收起态取 0**:二级页三个位子之间留 4,而画板给的是「左内边距 6 + 8 的隔条」= 页名距屏边 **14**;
   保留 gap 会变成 18(第一次实测就是 18,据此改的)。右位子在最右端,不受影响。

### 与计划的偏离(两处,都是画板要求的补齐)

- **About 页多了一个移动端专属的大标题「About」**(`m-h1 m-show-narrow`)。画板 `4r` / `5c` ① 都画着它,但桌面 `2e` 从头像行起、
  首版 R-MOBILE 是纯 CSS 重排、变不出一个不存在的元素,所以移动 About 一直没有页标题 —— 没有大标题,「到顶不出条」就等于这一页没有标题。
  只在窄屏渲染,桌面逐像素不变。
- **移动端的简介是「同一份文本的两处呈现」**:桌面那段留在头像行里(加 `m-hide-narrow`),移动端在行外独立成段(`m-show-narrow`)。
  画板 `4r` / `5c` 要求简介出头像行,而它嵌在头像行的中间列里、CSS 搬不出去。与 Notes 的 `RssModal` / `MobileRssSheet` 同一手法,桌面那份一个字节没动。

### 验收实测(390×845,`--safe-top:59` / `--safe-bottom:34` 注入模拟 standalone;桌面 1280×800)

| # | 结果 |
|---|---|
| 1 | `dev.ps1 check` 通过;`dev.ps1 test` **api 614/614 + web 149/149 全绿**;`apps/web` 里 `npx tsc --noEmit` 通过。**中途挂过一次**:`agent/source-tools.test.ts` 那条断言迁移 016 种子的用例回 `[]` —— 是 BACKLOG 里 2026-09-08 已记的**既有竞态**(多个测试文件 `DELETE FROM tool_config`,与本轮零关系:本轮 diff 不含 `apps/api` 任何文件)。判据:单跑该文件 9/9 过;`git stash` 掉本轮改动后整套也过;`stash pop` 后整套再跑仍过 |
| 2 | 到顶三页均无条:`.m-pagebar` 高 103(= 44 + 59)但 `opacity:0` / `pointer-events:none`;大标题 top **67** = 59 + 8,34px / 700 |
| 3 | 滚过大标题后 `opacity:1` / `pointer-events:auto`,条内标题 **17px / 600 / 左对齐 left = 14**;玻璃实测 `rgba(255,255,255,0.72)` + `blur(24px) saturate(1.8)`;内容从条下穿过 |
| 4 | 二级页(`/skills/ppt-master`、`/notes/pi`)className 里**没有** `m-pagebar-float`、`margin-bottom: 0px`、`opacity:1`,条后第一个元素从 103 起 —— 与改前一致 |
| 5 | Runtime(`/`)壳层几何未动:输入栏 704 → 762,Tab Bar 762 → 845 紧贴 |
| 6 | Tab Bar `rect.bottom = 845.1` ≈ `innerHeight 845`;底栏 `display:none` |
| 7 | 收起后 `transform: translateY(83)`(= 49 + 34,条整高)、`rect.top = 845.1 ≥ innerHeight` —— **屏底零残条**(改前是 `footerCovered = 26px`) |
| 8 | About 页尾两行各 **44 高、整行 354.3 宽居中**、mono 11 `--text-dim`、`white-space:nowrap`、两行命中区相接(701.9 = 上行底 = 下行顶);ICP → `beian.miit.gov.cn`;公安 → `beian.mps.gov.cn/#/query/webSearch?code=<数字串>`;图标 natural 36×40、渲染 18×20、在号码左侧。末行底 745.9 + `.m-page-wrap` 底部内边距 99(= 49 + 34 + 16)= 844.9,与画板「↓16 → 内容区底」一致 |
| 9 | 两个 env 都清空后重启 dev server:整块不渲染(页面最后一行是导流句),`beianLinks = 0` |
| 10 | 1280×800:底栏仍是 26 高一行、两号并排(ICP 482.9→601.7、公安 615.7→797.1);About 头部仍是「头像 64 + 中列 + `GitHub ↗` 32 高」三段并排;`.m-pagebar` 与全部 7 个 `.m-show-narrow` 元素 `display:none` |
| 11 | 移动 About:无 `GitHub ↗`;头像行 = 头像 64 + (@名 mono 15/600 + 「5 repositories」13px `--text-dim`)一行、`align-items:center`、行高 64;简介 15/1.75 独立成段 |
| 12 | `5c` ①②③ / `5d` ①②③ 逐屏比对通过(截图留在会话里)。**唯一不同源的一处**:大标题文案实现里是「Notes · 研习笔记」而画板是「Notes」,是 R-MOBILE 首版的既有取舍,记 BACKLOG |
| 13 | 390 / 320 / 430 三个宽度 × 四 Tab:`body.scrollWidth === innerWidth` 全部相等;320 下备案两行仍各 44 高(未折行) |
| 14 | `docs/deploy-cn-lightweight.md` §1 第 6 步与上线检查单在开工前的文档轮里已按本轮口径写好,实现与之逐条一致,无需再改;`design/README.md`(文件表 + 增删记录 + 256 KiB 预警)、`CLAUDE.md`(规则 8 修订段 + 三处计数)、`ROUNDS.md`(功能边界计数 + 进度表 + 小节标题)已同步 |

**本机验收的两件工具事**(下次省时间):① 开发库是空的,About / Notes / Skills 三页得先经**本机 MCP** 种内容才滚得起来
(脚本走 `node` + `XRAY_MCP_TOKEN`,2026-07-28 协议除 `params._meta` 三键外还要 **`Mcp-Method` 与 `Mcp-Name` 两个请求头**,少了回 `-32020`);
② 备案号靠 `apps/web/.env.local`(gitignored)注两个假号,**删掉后必须重启 dev server**才生效 —— Next 不认 `.env.local` 的删除。
③ Browser pane 被隐藏时 `requestAnimationFrame` 与 scroll 事件都不发,滚动态量出来永远是旧值;截图会强制走一帧,**先截图再量**。
