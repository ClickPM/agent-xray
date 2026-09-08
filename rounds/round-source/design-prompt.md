# 给 Claude Design 的提示词 —— 新增第五个顶部 tab「Source」(桌面端画板 `2n` / `2o` / `2p` + 既有 20 块导航改五格 + 原型两屏)

用法:打开 Claude Design 项目「**Agent X-Ray 设计完成**」(id `1a257a60-2f83-4795-9535-1d5a4677f21f`),
把下面 `---` 之间的整段贴进去。画完后 **DesignSync 写回云端**,再按 `design/README.md`
「与云端稿的合并口径」拉回本地。

**文件安排(贴之前先看,这次有一个字节数的坑)**:

- 三块新画板放**一份新文件** `Agent X-Ray Source.dc.html`(`2n`–`2p`)。桌面 `Agent Runtime Workbench.dc.html`
  现为 **248,815 字节**,DesignSync `get_file` 的上限是 262,144 字节、**超了静默截断不报错**(2026-09-07 实测),
  所以新画板**不能**追加进它。
- `Workbench` 那份**只改导航条**:20 块画板的四格导航全部改成五格(`Runtime · Notes · Skills · Source · About`),
  每格样式不变。预计增加 2 KB 以内,离上限还有 13 KB;拉回后必验字节数,超线就先把 `2f`–`2m` 拆到第二份文件再重拉。
- `Agent X-Ray Prototype.dc.html`(79 KB)加 Source 两屏 + `navTabs` 五格。
- **移动端两份文件(`4a`–`4u`)一个字节都不碰**:所有者裁定本轮先做桌面,移动端 Tab Bar 保持四格、不做 Source 页面。

拉回 `design/` 之后,R-SOURCE 才允许开工(CLAUDE.md 规则 8:先改设计稿、再进轮次)。

---

## 所有者已裁定(2026-09-08)

| # | 裁定项 | 结论 |
|---|---|---|
| 1 | tab 名与位置 | **`Runtime · Notes · Skills · Source · About`**,Source 是第五格、在 About 之前 |
| 2 | 收录范围 | 含 `rounds/`(轮次任务卡),**不含** lockfile;`design/`、`.claude/`、`.agents/`、二进制不收(闭集在发布脚本里) |
| 3 | 单文件上限 | 256 KB(与 Skills 同) |
| 4 | agent 工具 | 三个分开(`source_list` / `source_read` / `source_search`),**默认开** |
| 5 | 版本一致性 | **快照随每次生产发版一起发布**,展示的就是正在跑的那一版;页面标 git SHA |
| 6 | 页面功能 | **不做**站内搜索、**不做** zip 下载、**不做**行号深链 |
| 7 | 端 | **先桌面**;移动端只保证 agent 工具可用,Source tab 与页面不做 |
| 8 | 发布方式 | 挂 `dev.ps1 ship` 自动,不手动 |

派生取舍(实现者定,画板照此画):**保留 `GitHub ↗`**(zip 没了,它是访客唯一「拿走」的路,指向该文件在该 SHA 的 blob 地址);
**没有快照时不画空态**,走既有 `2k`-B「找不到」;**不画移动端**。

---

## 提示词正文(从这里开始复制)

在项目里**新建一份画板集 `Agent X-Ray Source`**,画三块桌面画板 `2n`、`2o`、`2p`;
同时把既有画板集 `Agent Runtime Workbench` 的 20 块画板导航条从四格改成五格,
并给可交互原型 `Agent X-Ray Prototype` 加 Source 两屏。

**先读一遍现有画板再动手**:`2f`(Skills 首页)、`2g`(Skill 详情页 · SKILL.md 态)、`2h`(Skill 详情页 · Python 文件态)、
`2i`(Skill 详情页加载态)、`2c`(Notes 文章页的 markdown 排版)。
新画板画的是**同一套骨架**(左目录树 / 右文件预览),**不新造任何视觉语言**;凡是 `2g` / `2h` 已经定了的
(目录树行高、选中态、预览卡头部条、行号列、三色高亮、copy 的 `copied` 回落),原样沿用。

### 0. 这个 tab 是什么

**Agent X-Ray** 是一个已投产的桌面站:访客与 AI agent 对话,右侧像 DevTools 一样实时看 agent loop 的内核轨迹。
四个顶部 tab(Runtime / Notes / Skills / About)是终稿、已实现。

现在加第五个 tab **Source**:**这个站自己的源码**,只读浏览。仓库是公开的 MIT 项目 `ClickPM/agent-xray`;
站内展示的是**正在生产上跑的那一版**的快照,每次发版随之更新,页面上标着 git SHA。
访客能做的事只有三件:在目录树里点文件、看文件内容(markdown 渲染 / 代码带行号)、复制当前文件或跳到 GitHub 上的同一文件。
同时站内的 agent 也能读这份源码(工具面板会多三张卡,由既有 `1f` / `1g` 的数据驱动,**不用画**)。

### 1. 设计时只能用这些数据(别画出拿不到的信息)

- **快照**:git SHA(短 7 位 + 全 40 位)、发布日期、文件数、总字节;仓库名 `ClickPM/agent-xray`、许可 `MIT`
- **目录树**:每个文件的路径、种类、字节、行数;目录由路径派生。真实规模:**约 294 个文件、3.1 MB、最深 8 层**
  (例如 `apps/web/app/(site)/notes/[series]/[chapter]/page.tsx` —— 路径里有圆括号与方括号,目录树要能放得下)
- **文件**:原文。种类闭集:`markdown / typescript / javascript / python / shell / powershell / sql / json / yaml / toml / css / dockerfile / text`。
  **高亮只对 python / typescript / javascript / shell**,只用 `2h` 的三个 token(关键字 / 字符串 / 注释);其余种类等宽正文色 + 行号
- **不存在**:commit 历史、作者、blame、修改时间、目录 README 摘要、搜索、下载、star 数、行号深链、分享

### 2. 三条硬约束

1. **不新造视觉语言**:颜色、圆角、字号、间距、字体全部取自下面的 token 表;骨架照 `2g` / `2h`。
2. **画板上没有的功能不画**:没有搜索框、没有 zip 按钮、没有行号锚点、没有「在对话里问这个文件」之类的入口。
3. **动效只能从现有三个里选或不用**:`omPulseBg` / `omWaveSweep` / `omSpin`。目录展开 / 收起不做动画。

### 3. 现有 design token(照抄,勿改)

- 画布:`#ffffff` 底 / `#f5f5f5` 面板 / `#eeeeee` hover / `#e8e8e8` 选中 / `1px #e0e0e0` 边框
- 文字:`#1a1a1a` 正文 / `#6b7280` 次级 / `#9ca3af` 弱化;品牌色 `#2563eb`(hover `#1d4ed8`)
- 语义:成功 `#16a34a`;错误 `#ef4444`
- 顶部导航条:高 44,**五格**(Runtime · Notes · Skills · Source · About),Source 选中态与 `2f` 里 Skills 的选中态同一画法
- 目录树(`2g`):行高 26 / 每层缩进 12 / 选中行 `#e8e8e8` 底 + 字重 600;目录行的箭头用 `2l` / `2m` 的 12px 箭头(› 收起 / ˅ 展开,stroke `#9ca3af`)
- 预览卡(`2g` / `2h`):头部条 = 路径 · 类型 · 大小 · 行数 · copy;markdown 走 `2c` 排版;代码视图行号列宽 36、mono 11 `#9ca3af`、右侧 1px 边框;
  高亮三 token:关键字 `#2563eb` · 字符串 `#16a34a` · 注释 `#9ca3af`
- 小标题:mono 10px/600 `#9ca3af` 字距 0.08em(同 `1g` 的 INPUT / OUTPUT、`2g` 的 INSTALL / FILES)
- 微徽标:描边、mono 10px、圆角 4(`2f` 的「自研 / 精选」画法)
- 按钮:ghost(`2g` 的 `GitHub ↗` / `下载 zip`)
- 加载态(`2i`):骨架填充 `#eeeeee`,叠在灰面上降一档 `#e0e0e0`;圆角 4 文本条 / 5 小节标题条 / 6 大标题条 / 7 按钮块与卡片;
  只用 `omPulseBg`(全页一两块锚点)与 `omSpin`(「正在取…」)
- 圆角:4 微徽标 / 5 小按钮 / 6–7 卡片 / 8 弹层;等宽字体 JetBrains Mono

---

### 画板 `2n` —— Source 首页(`/source`,README 态)

从上到下:

1. **44px 导航条**,五格,Source 选中。
2. **页头**(与 `2g` 同一节奏):面包屑 `Source`;等宽 22px 大标题 `ClickPM/agent-xray` + 一枚描边微徽标 `MIT`;
   右上一枚 ghost 按钮 `GitHub ↗`。标题下一行 meta(`#6b7280` 12px):
   `快照 be6c074 · 发布 2026-09-08 · 294 files · 3.1 MB`(措辞你定,信息量别多于第 1 节列的几项)。
   页头**没有** `INSTALL` 面板(那是 Skills 的东西)。
3. **下半两栏**,与 `2g` 同构:
   - **左栏目录树,粘性**。宽度你定并标注(`2g` 是 240,这里树最深 8 层、名字更长,可以放宽到 260–280)。
     **目录可折叠**:默认只展开当前文件所在的路径,其余目录收起;目录行带箭头,文件行不带。
     根级顺序:`apps` `deploy` `docs` `rounds` `runner` `tools`,然后是根文件(`CLAUDE.md` `README.md` `ROUNDS.md` `dev.ps1` `LICENSE` …)。
     请在画板上画出至少一个**收起的目录**和一个**展开到三层以上的目录**,证明两种状态都有画法。
     `2g` 里 markdown 态下目录树下方那块「本页目录」,在这里**可以不要**(README 不长而目录树很长),你定并标注。
   - **右栏预览卡**:头部条 `README.md · markdown · 3.8 KB · 96 行 · copy`;正文按 `2c` 排版渲染仓库根的 `README.md`
     (请用 3–5 段像样的项目介绍占位,别用 lorem)。
4. 页脚一行说明(与 `2f` 页脚同一语汇,`#9ca3af` 12px):`这是本站自己的源码,与线上运行版本一致;快照随每次发版更新。`(措辞你定)。

### 画板 `2o` —— 代码文件态(`/source/apps/api/agent/tools.ts`)

同一页,点选了一个 TypeScript 文件:

- 面包屑 `Source › apps › api › agent`,大标题 `tools.ts`(mono 22);meta 行与 `GitHub ↗` 照 `2n`。
  `GitHub ↗` 在这里指向**该文件在该 SHA 的地址**(`github.com/ClickPM/agent-xray/blob/<sha>/apps/api/agent/tools.ts`),
  画板注释里写明这一点。
- 目录树展开 `apps › api › agent`,选中 `tools.ts`;其余根级目录收起。
- 预览卡头部条 `apps/api/agent/tools.ts · typescript · 81.4 KB · 1,930 行 · copy`,copy 处于 `copied` 态(1.5s 回落,同 `2h`)。
- 代码视图带行号 + 三色高亮,内容用一段像样的 TypeScript(注释 / 字符串 / 关键字都要出现)。
  **长行的处理**:横向溢出在卡内滚动,页面本身不横滚 —— 画一行足够长的代码把这条规则画出来并标注。
  文件很长时**整页自然增高、目录树粘性**(与 `2g` 一致),不做卡内竖向滚动。

### 画板 `2p` —— 加载态(照 `2i` 的规则)

对位 `2o` 的骨架:页头(标题条 r6 + meta 条 r4 + 按钮块 r7)、左栏目录树 12 行 r4、右栏预览卡头部条 + 20 行代码骨架(行号列留白);
面包屑右侧 `omSpin` +「正在取 apps/api/agent/tools.ts…」;`omPulseBg` 只做一两块锚点。
**不画空态**(没有快照时走既有 `2k`-B「找不到」)。

### 既有 20 块桌面画板:导航条改五格

`1a`–`1g`、`2a`–`2m`(有导航条的那些;`2l` / `2m` 本来就没有,照旧)全部改成 `Runtime · Notes · Skills · Source · About`,
每格样式不变,各画板原来的选中格不变。**只动导航条,别的一个像素不动**。

### 可交互原型 `Agent X-Ray Prototype`

- `navTabs` 从四格改五格,Source 从任一屏可达。
- 加两屏:**Source 首页**(README 态)与 **Source 文件**(点目录树切换预览;目录行点击展开 / 收起;copy 1.5s 回落;`GitHub ↗` 外链)。
  演示数据放 6–8 个文件、两三层目录即可,其中放一个带 `(site)` 与 `[series]` 的路径。
- 移动端原型不加。

### 交付

- 新画板集 `Agent X-Ray Source`,三块画板编号严格用 `2n` / `2o` / `2p`(**编号只增不改,不复用作废的 `3x` 号段**);桌面画板计数 20 → 23。
- 每块画板留一段注释写清:目录树宽度、折叠规则(默认展开到哪一层)、「本页目录」的取舍、meta 行的内容与顺序、长行的横向溢出策略、
  `GitHub ↗` 的指向。
- `Workbench` 20 块只改导航条;原型加两屏。

## 提示词正文(到这里结束)

---

## 拿回来之后要做的事(给实现者)

1. **先验四项再算拿到稿**(每份文件):字节数 < 262,144 / `</x-dc>` 与 `</html>` 都在 / `<div>` 开合配平 / 画板数对得上。
   `Workbench` 尤其要看字节数;超线就在画布上把 `2f`–`2m` 拆到第二份文件、重新拉。
2. 按 `design/README.md` 的合并口径落盘:`Agent X-Ray Source.dc.html` 是纯新增文件,直接落;`Workbench` 与 `Prototype`
   先跑 `diff "design/<文件>" "<新稿>" | grep -c '^<'`,为 0 直接覆盖,不为 0 走 `git merge-file` 三方合并。
3. `design/README.md`:文件表加一行、「画板增删记录」补 `2n`–`2p`、token 速查补「目录树折叠 / 长行溢出」两行。
4. 同步画板计数:`CLAUDE.md` 项目定位与规则 8(20 → 23;「桌面新画板从 `2n` 顺延」改成从 `2q` 顺延)、`ROUNDS.md` 功能边界段。
5. 然后才开 R-SOURCE 的代码;代码的第一步是按规则 9 先写 `docs/security.md` 的 R-SOURCE 补记(草案在 [`round-source.md`](round-source.md)「安全口径」段)。
