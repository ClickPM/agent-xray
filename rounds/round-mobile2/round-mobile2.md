# Round R-MOBILE-2 — 移动端 standalone 壳层修补:顶部空条 + 屏底 Tab Bar + 备案号搬进 About

> 状态:进行中(文档就绪;`5c` / `5d` 设计稿由所有者交付中,A1 / A2 不依赖画板可先落地)
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
