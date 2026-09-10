# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

> **本文只留五块**:项目定位、仓库结构、开发模式与轮次流程、硬性规则、本地开发与部署。
> 架构/安全/部署细节都在 `docs/`,轮次拆解在仓库根 [`ROUNDS.md`](ROUNDS.md),按需读。
> **书写约定:硬性规则编号只增不改、不重排**(代码注释会引用「CLAUDE.md 规则 N」);删掉的规则留「已废弃」占位。
> `AGENTS.md` 是给**外部审查者**的指针文件(2026-09-10 起执行器 = cursor CLI,codex 限流暂停),指向本文,无需双份维护。

## 项目定位

**Agent X-Ray**:「Agent 运行时」网站——访客与 AI agent 对话的同时,右侧面板像 DevTools 一样实时展示 agent loop 内核轨迹(34 种扩展事件)。五个 Tab:Runtime 工作台 / Notes 研习库 / **Skills 技能库(R-SKILLS,2026-09-03 裁定并落地)** / **Source 源码(R-SOURCE,2026-09-08 裁定,分支 `round-source`)** / About;站点内容与配置由所有者经**无状态 MCP 管理服务**维护(`/api/mcp`,R6 已落地;原 `/admin` 后台与画板 3a–3e 于 2026-08-31 裁定废弃)。**站点已于 2026-09-02 投产**(https://www.kzgai.cloud/,R11),此后进入运维迭代:**较大迭代依旧延续轮次机制**(命名轮,所有者裁定 2026-09-03),小修补可直接 `main`;**每次生产发版必须记入 [`docs/releases.md`](docs/releases.md)**。

- **功能范围的唯一边界是设计稿**:[`design/`](design/README.md) **桌面**画板 1a–1g + 2a–2v(共 29 块)+ **移动端**画板 4a–4z + 5a–5d(共 30 块,2026-09-07 新增 4a–4u,R-MOBILE)+ 可交互原型(规则 8;1f–1g 于 2026-09-02 新增,2f–2h、2i–2k 与 2l–2m 于 2026-09-03 新增,2n–2p 于 2026-09-08 新增(R-SOURCE,放新文件 `Agent X-Ray Source.dc.html`),2q–2r 与 4v–4x 于 2026-09-08 新增(R-CROSSLINK,桌面两块放新文件 `Agent X-Ray Crosslink.dc.html`),2s–2t 与 4y–4z 于 2026-09-09 新增(R-CARDS,桌面两块放新文件 `Agent X-Ray Cards.dc.html`),2u–2v 与 5a–5b 于 2026-09-09 新增(R-CARDS-2,各放新文件 `Agent X-Ray Cards 2.dc.html` / `Agent X-Ray Mobile - Runtime 2.dc.html`),5c–5d 于 2026-09-10 新增(R-MOBILE-2,放新文件 `Agent X-Ray Mobile - Shell.dc.html`),3a–3e 已废弃并于 2026-09-02 从画布删除)。移动端只重排既有功能、不新增,**两套画板的功能范围是同一个**。管理面范围以 ROUNDS.md R6 裁定清单为准。
- 架构与既定决策:[`docs/architecture.md`](docs/architecture.md)(pi SDK in-process、Encore 类型化 RPC、SSE ×2、Postgres、单机 compose)。
- 安全强约束:[`docs/security.md`](docs/security.md)——威胁模型、四层沙箱、脱敏、凭据管理;**是约束不是建议**(规则 9)。

**用户回复默认中文**;代码、命令、路径、技术术语保持英文。

## 仓库结构

```
apps/web      Next.js 15 前端(App Router)。五 Tab 已按画板实现(Skills 的 2f–2h 于 R-SKILLS、Source 的 2n–2p 于 R-SOURCE 落地),接后端只换数据源
              (样式零改动,规则 7);/admin 六页已于 R6 整目录删除
apps/api      Encore.ts 后端 **app root 在这里,不是仓库根**。服务清单与各自边界以
              `apps/api/<服务>/README.md` 为准(about / agent / mcp / metrics / notes / system / trace,
              R-TABS 新增 site/ = 顶部 tab 呈现开关的只读面;R-SKILLS 新增 skills/ = 技能库只读面,
              一包文件的判据在 shared/skill-pack.ts;R-SOURCE 新增 source/ = 站点源码快照只读面,
              判据在 shared/source-pack.ts、仓库常量在 shared/source-repo.ts);本文不再逐服务记状态
design/       设计稿终稿存档(.dc.html 画板 + 可交互原型 + token 速查)——实现时逐画板对照
deploy/       docker compose + Caddyfile + migrate.sh(预发/生产共用的部署资产,R9/R11 定稿)
docs/         架构 / 安全 / 部署环境矩阵 / 境内轻量服务器部署 / MCP 管理面说明(mcp.md) / **生产发布记录(releases.md)**
rounds/       轮次任务卡与管理产出(约定见 rounds/README.md);roadmap 在根 ROUNDS.md
tools/        本机构建期工具,**刻意在 Encore app root 之外**(规则 6)。R5 的 notes-sync 管线已随 R6 删除;
              现在有两个:`skills-manifest/generate.mjs`(R-SKILLS-2):读 runner/skills → 生成 api 与执行容器两份同源清单
              (`apps/api/shared/skills.generated.ts` + `runner/manifest.json`,都是生成物、都入库),`dev.ps1 skills-gen` 调它;
              `source-publish/publish.mjs`(R-SOURCE):只从 `git ls-tree <sha>` 取文件(永不读工作树),按代码里的闭集筛选后经 MCP
              把源码快照发进库(`begin` 带 manifest 增量 → `put` 分批 → `commit` 单事务);`dev.ps1 ship` 自动调,`build` 跑它的 `--check`
runner/       **R-SKILLS-2 已落地**:agent 可运行 skills 的执行容器(`Dockerfile` Python 基座按 digest 钉 + venv + `runner.py` /
              `launch.py`)与可被 agent 使用的 skill 源(`runner/skills/<name>/`:SKILL.md + 可选 xray.json + scripts/*.py)。
              刻意在 Encore app root 之外;它不是 JS 运行时,规则 11 不涉及。布局与协议见 `runner/README.md`。
              R-WEBFETCH(2026-09-04 落地):同一镜像起第二个只出公网的实例 `skill-runner-egress`(compose 专用 `egress` 网络 +
              宿主 `deploy/egress-filter.sh`),`runner/skills/web-fetch` 是首个 egress 档 skill;`runner/tests/` 是它的单元测试与
              病态输入夹具(`dev.ps1 runner-test` 在镜像里跑,目录不进镜像、不进清单、不进库)
.claude/      encore 官方 skills(skills-lock.json 锁版本,升级 `npx -y skills update`)
              + MCP 启动脚本。`.mcp.json` 另注册了三个站点管理面(本机 / 130 / 生产),
              token 各走各的环境变量、都不入库,分工见下方「本地开发」的表;
              自建 skill sync-notes 已随 R6 删除。**独立审查的两份也在这里**(2026-09-10):
              `cursor-review-prompt.md` = 审查任务书契约(入库),`cursor-review.ps1` = 启动脚本,
              运行产物落 `.claude/reviews/`(gitignored);流程见 `docs/review-workflow.md`
.agents/      `.claude/skills` 的镜像,给 codex 审查者用(生成物,`dev.ps1 skills` 同步)。
              实测:codex 只认仓库级 `.agents/skills` 与 `.codex/skills`,**不认 `.claude/skills`**。
              **2026-09-10 起休眠**:执行器换成 cursor CLI,它不自动加载这个目录(审查任务书让它按需读),
              但目录与同步命令原样留着 —— 切回 codex 只是换回命令
dev.ps1       Windows 本地 encore 唯一入口(规则 1)
```

## 开发模式与轮次流程

**Claude Code solo 开发,独立审查做缺陷门禁**;不做视觉 review(规则 7 管住样式即可)。
**审查执行器 2026-09-10 起 = cursor CLI(`cursor-agent`)+ 模型 `cursor-grok-4.6-high`**(所有者裁定:codex 被限流,暂停使用);
换的只是执行器,下面三条策略(范围 / 收口 / 边界)一字不改。发起命令、结果取回与坑清单在 [`docs/review-workflow.md`](docs/review-workflow.md)。

```
开工:cp rounds/TEMPLATE.md rounds/round-NN/round-NN.md,按 ROUNDS.md 该轮拆解填任务卡
  → 实现(遵守规则 7/8/9)
  → 验证:dev.ps1 test / check + 任务卡验收项全过
  → 独立审查:powershell -File .claude\cursor-review.ps1(默认全量分支 diff、后台跑);
     质疑设计取舍加 -Kind adversarial;小 diff 想直接看结果加 -Wait;结果落 .claude/reviews/<时间戳>-<kind>.out.md
  → findings 逐条处理(采纳整改 / 不采纳写明理由),回填任务卡「代码审查」段
  → 只要有采纳整改的 findings → 再发一轮复审(缺陷门禁,非设计评审),范围按下方「审查范围」
  → commit + 更新 ROUNDS.md 进度表
```

- **审查范围(所有者裁定 2026-08-31)**:**只有前两轮**用固定的全量范围(`branch diff against main`);**第 3 轮起只审「上一轮 findings 整改后的 diff」**,即只审 `<上一轮已审提交>..HEAD`。
  - 命令:`powershell -File .claude\cursor-review.ps1 -Scope since -Base <上一轮已审提交>`(默认 `-Scope branch` = `main...HEAD` 全量;`since` = `<Base>..HEAD` 整改 diff;`-Note` 传本轮要点)。
  - 为什么:全量重扫一条百文件的分支单轮要 20 分钟上下,而第 3 轮起的复审职责只是「确认整改本身没引入新缺陷」。把范围收到整改 diff 既符合本条流程原本的措辞(「对**整改 diff** 再发一轮复审」),也避免审查器每轮在同一批未改动代码上重新起意。
  - 代价要认:整改 diff 之外的问题这几轮不会再被扫到。所以**前两轮必须是全量**,那是覆盖面的来源;第 3 轮起是门禁,不是覆盖。
- **复审收口标准(所有者裁定 2026-08-28)**:审查/复审循环不得带**阻塞性问题或明显 bug/漏洞类 findings**(high 级,或任何会丢数据、漏凭据、泄资源、逻辑错误的问题)收口——继续「整改 → 复审」直到此类 findings 清零才允许合并 `main`;低危改进项可写明理由记 `rounds/BACKLOG.md` 后放行。禁止以「spike 会被替换」「概率低」为由跳过整改(可作为**方案取舍**的理由写进任务卡,但对应风险必须有显式兜底)。
- **审查边界(所有者裁定 2026-08-28)**:**严禁以审查代替设计**——审查是缺陷门禁,不负责长出方案;findings 若指向设计缺陷,停下回任务卡/所有者层面重定方案,不在「整改 → 复审」循环里逐条堆补丁。**非严重阻塞性 findings 严禁新增机制类修复**(新队列/新协议/新抽象/新配置/新导出面):只允许最小改动(改判断、改文案、删代码)或写明理由记 `rounds/BACKLOG.md`;机制类修复仅限严重阻塞性 bug/漏洞。发起复审时把本条作为审查要求带给审查者:只判定并报告缺陷与严重级别,不展开设计方案。
- 降级到 Claude Code 自带 `/code-review` 只认硬失败(`cursor-agent` 未安装/未登录/启动失败/限流),降级原因写进任务卡;「等得久」「改动小」不是理由。
- 同一验收项针对性整改后连续 2 次仍不过 → 写 `rounds/round-NN/BLOCKED.md` 停下呼人,禁止放宽验收(rounds/README.md)。
- 分支:每轮在 `round-NN` 分支开发,审查通过后合并 `main`;纯文档与微修可直接 `main`。**投产后(2026-09-02 起)较大迭代依旧走本流程**(命名轮 `round-<名字>`);任何发到生产的 SHA 都要在 `docs/releases.md` 加一行。
- 跨轮次发现的问题写 `rounds/BACKLOG.md`,不当场顺手改。

## 硬性规则

**编号只增不改**。1–4 继承自 ticketBookingB2B 项目同机踩过的坑,原样适用。

1. **Windows 上所有 encore 命令必须走 `dev.ps1`**。原因一句话:encore daemon 的 unix socket 绑不到含中文的用户名路径,且 daemon 常驻、同机与 ticketBookingB2B 共用。手动等价的三行 env 在 `dev.ps1` 头部;报错原文、用错 env 后如何重跑 daemon 等机器级细节在本机用户级 `~/.claude/CLAUDE.md`「本机 Windows 环境」(2026-09-03 提升到那里,本条不再重复)。
2. **api 侧测试只能 `encore test`**(`dev.ps1 test`),禁止裸跑 `vitest`(缺 `ENCORE_RUNTIME_LIB` 会炸)。web 侧的 `bun test lib` 与 runner 的 `dev.ps1 runner-test` 不是 vitest、不在此限(见「本地开发」;2026-09-08 补注)。引入 vitest 时 `apps/api/package.json` 的 test 脚本必须是 `vitest run --passWithNoTests`(不带 `run` 会进 watch 卡死)。
3. **含中文的 `.ps1` 必须存成 UTF-8 with BOM**,`param` 放首行 + BOM 双保险,改完跑一次带参数命令确认行为正确。原因(PowerShell 5.1 按 ANSI 解码无 BOM 文件、中文注释吞掉下一行,`param` 行曾因此整行失效)与 `xxd` 判据在用户级 CLAUDE.md「本机 Windows 环境」,本条不再重复。
4. **写 JSONB 一律 `${JSON.stringify(x)}::text::jsonb`,绝不写裸 `::jsonb`,也别改成直接传 JS 值**。`::jsonb` 会让驱动把 JS 字符串再编码一次,库里存成 JSON 字符串标量(`jsonb_typeof` 回 `string`),SQL 侧 `->`/`@>`/GIN 全部失效而 JS 侧读回来看似正常;直接传值则 `COALESCE(${null}, col)` 的裸 null 会被写成 `jsonb 'null'` 而非 SQL NULL。`::text::jsonb` 对 null 与非 null 是同一套语义。R2 建轨迹/消息表起就适用。
5. **`secret()` 只能在 service 目录内声明**(Encore 限制);共享库里不出现 `secret()`,需要密钥的共享代码收「已取好的值」作参数。
6. **`apps/api` 是 Encore app root,不做 npm workspaces 提升**(规避 encore#1723:app root 下无关 node_modules/.ts 干扰 parser)。web 与 api 不手工共享源码文件;类型经 `encore gen client` 产物(`apps/web/lib/api-client.ts`)流向前端,该文件是生成物,不许手改。
7. **非必要不得修改前端页面样式,不做视觉 review**。画板已是终稿且前端已实现:接后端只许换数据源(demo-data → API/SSE),不许动样式、布局、className、design token、动画参数。确因接线需要改结构时,任务卡写明理由与影响范围,且不得偏离 `design/` 对应画板。(2026-08-31 修订:3a–3e 废弃,对应 `/admin` 六页按所有者裁定于 R6 整目录删除——属本条允许的结构性改动;同轮的 `next.config.ts` 配图 rewrite 亦然,理由=图片改从 Postgres 供,对外 URL 不变。)
8. **严禁实现设计稿没有的功能**(所有者裁定 2026-08-28;2026-08-31、2026-09-02、2026-09-03、2026-09-07 多次修订)。站点访客功能范围 = `design/` 桌面画板 1a–1g + 2a–2v 与移动端画板 4a–4z + 5a–5d + 可交互原型(**两套画板同一个功能范围**,移动端只换呈现);**3a–3e(/admin)已废弃**,管理功能由无状态 MCP 管理服务承担,其范围以 ROUNDS.md R6 裁定清单为准;`docs/` 的安全与部署要求是约束不是功能。新功能想法进 `rounds/BACKLOG.md` 等所有者裁定,不进任何轮次任务卡。
    - **2026-09-02 修订(R-TOOLS)**:所有者裁定新增 **Tools 工具面板**,设计稿随之扩到 12 块(新增 `1f` 列表态 / `1g` 展开态,同日删除废弃的 `3a–3e`)。**扩边界的正确顺序是「先改设计稿、再进轮次」**——本条不是被绕过,是先被改了。面板是访客可见的**只读**能力说明(工具名 / 中文标签 / 描述 / 入参 JSON Schema / 输出形态 / 工具分组),**不显示**启停开关、日限额与剩余次数、provider 与 model 名(那些是服务端配置,公开即泄配置面)。
    - **2026-09-03 修订(R-TABS)**:所有者裁定新增**顶部 tab 的呈现开关**(经 MCP 逐个开关三个 tab 露不露)。
      这**是**本条的例外(与 R-VISITOR 的会话删除入口同类,不同于 R-TOOLS 的「先改设计稿」):画板 1a 的导航条
      是三格固定的,没画过「某一格可以不出现」。理由是它不是产品功能,是一次**合规运维动作**的开关 ——
      备案审核窗口期要求内容可撤下,靠发版则一来一回两次构建 + 传镜像 + 重建容器。
      **边界只到呈现层**:隐藏 = 导航条不渲染 + 该 tab 的页面在 web 侧不可达(`runtime` 落在站点根路径上,
      改为 307 到第一个可见 tab),`/agent/*`、`/trace/*`、`/notes/*`、`/rss.xml` 等后端端点**照常服务**;
      要真的停掉 agent 用 `tool_config_set`。全部 tab 可见时前端与画板 1a 一字不差,不新增画板。
      tab 的闭集在 `apps/api/shared/site-tabs.ts`,**新增一个 tab 要改三处**(该文件 + 一条迁移种子 +
      `apps/web/lib/tabs.ts`),缺哪一处的表现各不相同,文件头列了。
    - **2026-09-03 修订(R-SKILLS)**:所有者裁定新增**第四个顶部 tab「Skills」技能库**(分享自研 + 精选第三方的 `SKILL.md` 目录包)。
      与 R-TOOLS 同一顺序、**不是**例外:设计稿先扩到 15 块(`2f` 首页 / `2g` 详情页 SKILL.md 态 / `2h` 详情页 Python 文件态,
      既有 12 块的导航条同步改四格),并入 `design/` 之后才开 `round-skills`。形态裁定:列表 + 详情页;详情页 = 目录树 + 逐文件预览
      (markdown 渲染 / 代码带行号)+ 复制安装命令 / GitHub 外链 / 站内 zip;按用途分类;**只读**(无搜索 / 筛选 / 点赞 / 安装量 / RSS)。
      **文件一律当文本渲染、永不执行、不收二进制**;新表不授权任何 agent 角色(规则 9,`docs/security.md` R-SKILLS 补记)。
      新增 tab 仍按 R-TABS 的「三处登记」走,`GlobalNav` 与既有三 tab 页面零改动。
    - **2026-09-03 修订(R-SKILLS-2,`round-skills` 的 2.0 迭代;同日代码落地)**:所有者裁定让 agent **使用** skills —— `skill_load` 把 `SKILL.md`
      送进上下文,`skill_run` 在独立的无网络执行容器里跑该 skill 声明过的 Python 脚本。这是产品能力扩面,所有者裁定「做」;
      Tools 面板多出第四组「沙箱执行组」,**先改画板 1f/1g、再进轮次**(R-TOOLS 顺序,是 2.0 的开工前置)。Timeline / 详情卡 / 链式视图
      的拦截徽标与「EXTENSION RETURNED」卡画板 1a/1b/1c 早已画着,不新增画板。**哪些 skill 可用**:代码清单(`runner/skills/`)∩ 库里
      `skills.agent_enabled`(默认 FALSE,只展示不注入)∩ 展示副本与代码副本 sha256 一致 ∩ 工具闸开着;改可用 skill = 发版(所有者裁定)。
      Skills 页**不**显示「agent 可用」徽标(画板没有,记 BACKLOG)。七条裁定与依据见 `rounds/round-skills/research.md`,交付清单见 `round-skills-2.md`。
      **落地时的一处未闭合**:画板 1f/1g 的第四组在开工时云端与本地画布都还没画(所有者画布未改),前端 `ToolsPanel.tsx` 的第四组按任务卡建议值
      (`#8b5cf6`、组名「沙箱执行组」)先接上,待所有者在画布上定稿后按画板核对(记在任务卡「本轮实测」与 BACKLOG)。
    - **2026-09-03 修订(R-WEBFETCH,建在 R-SKILLS-2 之上;2026-09-04 代码落地,分支 `round-webfetch`)**:所有者裁定让 agent 读**访客指定的公网网页** —— 不是新工具,是沙箱执行组里
      一个声明了出网档次(`xray.json` 的 `network: egress`)的 skill `web-fetch`,由同一镜像的第二个执行容器实例 `skill-runner-egress`(只出公网,
      不在 `front` / `back`)跑;api 进程不碰 URL、不碰 HTML。不新增工具、画板、迁移、MCP 工具(仍是 46),前端零改动。**访客给的 URL 不设域名限制、
      不维护任何域名黑白名单**(所有者裁定:太多,无法维护);拒的是固定的内网地址段(SSRF 防线,见规则 9)。残余风险「经 URL 外泄本访客会话内容」
      所有者已认。方案与十条裁定见 `rounds/round-webfetch/round-webfetch.md`;预研的 in-process 形态(`study.md`)退役。
      落地时唯一碰到 api 侧 `skill_run` 通用行为的一处:非零退出时 stdout **恰好只有一个** `E_` 短码才附在固定失败文案后(`failureShortCode`),
      这是任务卡 §2.3 第 10 步预留的两种接缝之一,不是新机制。
    - **2026-09-03 修订(R-PERF)**:站点投产后所有者报障「点卡片经常没反应」与 `/skills/ppt-master` 白屏。定位结论是站点**没有任何加载态与错误边界**——
      软导航在服务端 RSC 返回前 UI 一动不动(点 `diagram` 实测 4.0 秒静止),渲染失败掉到 Next 默认英文白屏。与 R-TOOLS / R-SKILLS 同一顺序、**不是**规则 8 的例外:
      设计稿先扩到 **18 块**(`2i` Skill 详情页加载态 / `2j` Notes 章节页加载态 / `2k` 错误态 A 出错 B 找不到,2026-09-03 并入 `design/`),**再**进轮次。
      骨架不新造视觉语言(填充 `--bg-hover`、压灰面降一档 `--border`,动效只复用 `omPulseBg` / `omSpin`);**唯一新增的语汇是 `2k` 的品牌色实心主按钮**
      (既有按钮语汇只有 ghost),由画板明确定为出口层级。同轮的载荷瘦身(详情页只预渲染当前文件)**不碰设计稿**,属规则 7 允许的「只换渲染时机」。
    - **2026-09-03 修订(R-TOOLCARDS,同日开工)**:核对发现会话区的**工具调用卡丢了**——画板 1a–1d / 1f–1g 一直画着,首版 `bdc1ca4` 实现过,R3 `88dc2ae` 切真实数据源时
      只映射了 `role` / `content`,`ToolChip` 留成死代码。**恢复卡片本身不是新功能**,与本条无关。新增的是两个没画过的态:一轮跑完后把处理过程折叠成一行
      (参考 pi-web),以及卡片箭头点开的入参 / 结果摘要。与 R-TOOLS / R-PERF 同一顺序、**不是**例外:设计稿先扩到 **20 块**(`2l` 一轮已完成折叠态 /
      `2m` 折叠行展开 + 卡片展开,2026-09-03 并入 `design/`),**再**进轮次。所有者裁定做到「重新打开会话也在同一位置」,落库形态随之改
      (`messages.payload` 加工具调用偏移表,列从 001 起就留着,**无迁移**);会话区**不显示**模型名 / provider 名 / 分段 token 与费用 / 「思考」块。
      拆解见 `rounds/round-toolcards/round-toolcards.md`。
    - **2026-09-07 修订(R-MOBILE)**:所有者裁定做**移动端**。与 R-TOOLS / R-PERF / R-TOOLCARDS 同一顺序、**不是**例外:
      设计稿先扩出**移动端 21 块**(`4a`–`4u`,2026-09-07 并入 `design/`),**再**进轮次。六条裁定:
      ① **移动端是独立的一层**,与桌面并存、由视口宽度切换,**桌面 20 块画板与已实现页面零改动**(规则 7);
      ② 编号开 **`4x` 段**(见下条),画板放**两份新文件**(`Agent X-Ray Mobile - Runtime.dc.html` = `4a`–`4j`、
      `Agent X-Ray Mobile - Notes Skills About.dc.html` = `4k`–`4u`),桌面两份不碰;
      ③ 载体 = **PWA 只取轻量部分**(manifest + `display:standalone` + theme-color),**不做 Service Worker、不做「添加到主屏幕」引导**;
      manifest 的唯一作用是访客自行添加到主屏幕后能全屏。**2026-09-07 二次裁定:移动端按普通 H5 做,不为微信单独优化** ——
      画板是以微信 webview 为主场景画的(每屏画着「微信导航栏 44 · 不可控」占位),那些占位**本来就只是画布示意、代码从不渲染**,
      故画板不作废、无需重画;被这条砍掉的是**微信专项适配**:UA 判定、zip 下载与 GitHub 外链的「在微信中不可用」提示态、
      以及以微信栏为由的各页 `generateMetadata`(记 BACKLOG)。玻璃的 `@supports` 降级**保留** —— 它对任何 H5 都成立,不是微信专项。
      ④ **竖屏** —— 但**网页锁不了方向**
      (`screen.orientation.lock()` 在 webview 与 iOS Safari 都拿不到),只能 CSS 降级(画板 `4u`);
      ⑤ 移动端 **SSE 断线重连不做**(新机制,记 BACKLOG);⑥ **禁双指缩放** ——
      `user-scalable=no` 在 iOS 被忽略,必须 JS 拦 `gesturestart`(无障碍代价 WCAG 1.4.4 所有者已认)。
      **核心设计裁定是「两层语言」**:外壳(导航 / Tab Bar / Sheet / 按钮 / 列表)按 iOS 26 重画,
      **内核(Timeline 耗时色条 / Chain / Lifecycle / 工具卡 / 代码视图 / markdown 排版)照搬桌面 token,只做触控与换行适配** ——
      把 Timeline 做成 iOS 列表这个站就不是 X 光机了。**移动端不新增任何产品功能**,新增的只有交互原语
      (Sheet / 左滑 / 下拉刷新 / 大标题收起 / 键盘避让)与 `4u` 的载体适配态。
      提示词 `rounds/round-mobile/design-prompt.md` 与 `impl-prompt.md`;实现轮次:ROUNDS.md R-MOBILE。
    - **2026-09-08 修订(R-SOURCE)**:所有者裁定新增**第五个顶部 tab「Source」**(站点自身源码的只读浏览,页面标 git SHA)并让 agent **读站点源码**
      (三个纯函数组只读工具 `source_list` / `source_read` / `source_search`,默认开)。与 R-TOOLS / R-SKILLS / R-PERF 同一顺序、**不是**例外:
      设计稿先扩(桌面 `2n` 首页 README 态 / `2o` 代码文件态 / `2p` 加载态,放**新文件** `Agent X-Ray Source.dc.html`,因为 `Workbench` 离 256 KiB 截断线只剩 13 KB;
      既有 20 块导航改五格;原型加两屏),并入 `design/` 之后才开 `round-source`。八条裁定:tab 顺序 `Runtime · Notes · Skills · Source · About`;
      收录含 `rounds/`、不含 lockfile(闭集在 `tools/source-publish/`,改 = 发版);单文件 256 KB;三工具分开、默认开;
      **快照随每次生产发版发布,从源头保证展示 = 运行**(`dev.ps1 ship` 自动挂,不手动;不比对运行 SHA、不画「快照落后」态);
      不做站内搜索 / zip / 行号深链;**先桌面**(移动 Tab Bar 仍四格、不做 Source 页,agent 工具与视口无关,记 BACKLOG)。
      源码像 Notes / Skills 一样**当内容发布进 Postgres**(镜像里没有源码、api 不读文件系统),写面 MCP 五个 `source_*`(46 → 51,规则 13),
      发布脚本只从 `git ls-tree <sha>` 取文件;仓库本就是公开 MIT,agent 侧新增的只是「读公开源码」,新表按第 2 层既定口径显式 `GRANT SELECT` 给 `agent_ro`
      (`docs/security.md` R-SOURCE 补记是开代码的第一步)。提示词 `rounds/round-source/design-prompt.md`,拆解 `rounds/round-source/round-source.md`。
    - **2026-09-08 修订(R-CROSSLINK,文档就绪、设计稿待交付)**:所有者裁定把画板 `1b` / `4f` 上一直是死按钮的 `Ask why ↗` 做实,并加两条联动 ——
      会话区工具卡 ↔ Timeline 行**双向定位**(BACKLOG R-TOOLCARDS 那条)、Notes 章节页 → Runtime 的「在 Runtime 里聊这一章」入口。三件事共用**一个原语**:
      「把一句预设文本放进输入框,永不自动发送」。Ask why 取 **1-A 预填**(不做服务端拼上下文、不做独立解释器;答案就是一轮普通对话,非工具事件靠
      R-SOURCE 的 `source_*` 读源码解释);已定位态不新造(既有展开态 + 滚入视野),对不上不渲染;Notes 入口用通用模板经 `/?ask=`,零 MCP 变动、零迁移。
      与 R-TOOLS / R-PERF / R-TOOLCARDS / R-SOURCE 同一顺序、**不是**例外:桌面 `2q` / `2r` 放**新文件** `Agent X-Ray Crosslink.dc.html`(`Workbench` 离上限只剩 11 KB),
      移动 `4v` / `4w` 追加进 `- Runtime`、`4x` 追加进 `- Notes Skills About`,`1b` / `4f` 只加注释;并入 `design/` 之后才开 `round-crosslink`。
      **零后端机制**(api 侧只有 `runtime.ts` 一句追问条款);`docs/security.md` §0 第 10 条(经链接预填的诱导)按规则 9 先于代码写入。
      提示词 `rounds/round-crosslink/design-prompt.md`,拆解 `rounds/round-crosslink/round-crosslink.md`。
    - **2026-09-08 修订(R-CARDS;设计稿 2026-09-09 并入 `design/`,同日实现、审查收口并合并 `main`,待发版)**:所有者裁定让 agent 在回复里嵌**信息卡片**(所有者原话「UI 组件工具」),形态取 **2-A 内容级**:
      模型在正文里写 ` ```xray-card ` + JSON,`Markdown.tsx` 识别 `language-xray-card` 画卡;**不是 pi 工具**(工具级要给 `tool_end` 帧与 `payload` 加结构字段、
      还得给 `2l` 折叠规则加例外)。六种 `kind` 闭集(kv / table / list / stat / compare / tabs);交互**只允许声明式**(tabs / 折叠 / 排序 / 单选),
      动作按钮唯一动作 = R-CROSSLINK 的预填;所有值纯文本、上限闭合、任一不符整卡回落成代码块;流式期间围栏未闭合先画骨架;**只在会话区开**(Notes 不开);
      每次回复最多两张。已认代价:坏 JSON 时访客看到裸 JSON 代码块;Timeline 里没有「画了一张卡」的事件。同一顺序、**不是**例外:桌面 `2s` / `2t` 放**新文件**
      `Agent X-Ray Cards.dc.html`,移动 `4y` / `4z` 追加进 `- Runtime`;并入 `design/` 之后才开 `round-cards`。`docs/security.md` §0 第 11 条(模型输出渲染成 UI 组件)
      按规则 9 先于代码写入。提示词 `rounds/round-cards/design-prompt.md`,拆解 `rounds/round-cards/round-cards.md`。
    - **2026-09-09 修订(R-CARDS-2;设计稿同日并入 `design/`、同日在分支 `round-cards2` 实现)**:所有者裁定做 UI 组件 2.0(所有者原话「UI tools」),讨论时四档 A / B / C / D,圈定 **A + B**、C / D 暂不考虑:
      **A** = `xray-card` 新增 `choice`(单选 / 多选)与 `form` 两种**可回传** kind,**回传 = 发送**(单选点选项直接发、多选与表单点 submit 发;所有者同日调整,推翻讨论时的预填档),
      发出的文本**只由卡上可见文本组成**、只由访客一次点击触发、走既有 composer 发送路径,api 零改动;**B** = 新围栏 ` ```xray-html `,模型写 HTML + CSS,渲染进 `sandbox=""` 的 iframe
      (静态档:无脚本、opaque origin、帧内 meta CSP 不出网、窄清洗不出链;宽 = 正文宽,高由模型声明夹到 [160, 480],≤ 16 KB)。**每轮最多两个组件**(所有者二次确认,不收成一个;
      前端硬限最终回答段前两个围栏),位置只在最终回答**首或尾**(提示词约束)。**仍是内容级、不是 pi 工具**;无迁移 / 无端点 / MCP 仍 51 / 无新依赖 / 无运行期开关(关 = 发版,只停产出)。
      同一顺序、**不是**例外:桌面 `2u` / `2v` 放**新文件** `Agent X-Ray Cards 2.dc.html`,移动 `5a` / `5b` 放**新文件** `Agent X-Ray Mobile - Runtime 2.dc.html`(`5x` 号段待所有者确认);
      并入 `design/` 之后才开 `round-cards2`。`docs/security.md` §0 第 11 条修订、第 12 条(卡片点击即发 = 模型预制的访客消息,第 10 条的唯一例外)与第 13 条(自由 HTML,第 11 条的唯一例外)
      按规则 9 先于代码写入。提示词 `rounds/round-cards2/design-prompt.md`,拆解 `rounds/round-cards2/round-cards2.md`。
    - **2026-09-10 修订(R-MOBILE-2;设计稿同日并入 `design/`、同日在分支 `round-mobile2` 实现)**:所有者在真机 **standalone(添加到主屏幕)**下报障四条 —— 非 Runtime 页头部一条空白、
      Tab Bar 下方一条白带、备案号占屏底高度、Tab Bar 收起后剩一条只有图标的残条。根因是**移动端 21 块画板以微信 webview 为主场景画**(每屏画着「微信导航栏 44 · 不可控」占位,
      代码从不渲染它):在微信里我们那条两侧全空的功能条读起来是宿主标题栏的延续,standalone / 普通浏览器里宿主那条**不存在**,它就成了一条什么都不装的 44 白边;
      屏底三条是同一件事 —— 备案底栏(画板从未画过,属 `docs/` 部署约束)占着屏底,Tab Bar 贴的因此是「内容区底」。**本轮是修补,不新增任何功能**。
      与 R-TOOLS / R-PERF / R-TOOLCARDS 同一顺序、**不是**例外:移动 `5c`(一级页顶部两态)/ `5d`(屏底两态 + About 页尾备案行)放**新文件** `Agent X-Ray Mobile - Shell.dc.html`,
      并入 `design/` 之后才开工。四条裁定:① 备案两号在移动端搬进 **About 页尾**、不再占屏底高度(**桌面底栏零改动**);② 移动端屏底只有 Tab Bar、贴真正的屏底;
      ③ 收起时整条滑出屏外(位移量 = 条整高 49 + 安全区,不是 49);④ 一级页**到顶不出功能条**、大标题贴安全区,滚过大标题后玻璃条淡入、条内 **17/600 左对齐页名**
      (画板 `4k` 附早已定过、首版未实现的收起规则)。同轮把移动端 About **按画板 `4r` 收口**(去掉 `GitHub ↗`、头像行 = 头像 + @名 + repo 数一行 + 简介独立段)—— 补既有画板,不是新设计。
      **二级页(`4m` / `4p`–`4q`)的常驻功能条一个像素不动**。已认的残余风险:移动端首页(Runtime,自身不滚动)不再显示备案号;更稳的变体(Notes / Skills 页尾也挂)记 `rounds/BACKLOG.md`。
      拆解 `rounds/round-mobile2/round-mobile2.md`,提示词 `rounds/round-mobile2/design-prompt.md`。
    - **画板编号只增不改**,与本节硬性规则同一约定:`3x` 号段作废后不复用;**桌面**新画板从 `2w` 顺延
      (`1a–1g`、`2a–2v` 已用,**`2u–2v` 已于 2026-09-09 并入(R-CARDS-2,新文件 `Agent X-Ray Cards 2.dc.html`)**;`2n–2p` 在单独的 `Agent X-Ray Source.dc.html` 里;**`2q–2r` 已于 2026-09-08 并入(R-CROSSLINK,新文件 `Agent X-Ray Crosslink.dc.html`)、`2s–2t` 已于 2026-09-09 并入(R-CARDS,新文件 `Agent X-Ray Cards.dc.html`)**,各放新文件,
      两轮若调换顺序编号也不调换),**移动端**占 `4x` 段(`4a`–`4z` **已全部用完**;**`4v–4x` 已于 2026-09-08 并入(R-CROSSLINK)、`4y–4z` 已于 2026-09-09 并入(R-CARDS)**;`4z` 之后的号段由所有者定,
      建议移动端继续占 `5x` 段从 `5a` 起;**R-CARDS-2 已占 `5a–5b`**(新文件 `Agent X-Ray Mobile - Runtime 2.dc.html`,2026-09-09 并入;所有者交付的稿本身就标着 `5a` / `5b`,号段视为确认),移动端从 `5c` 顺延;**R-MOBILE-2 已占 `5c–5d`**(新文件 `Agent X-Ray Mobile - Shell.dc.html`,2026-09-10 并入),移动端从 `5e` 顺延)。
    - **`design/` 的单文件有 256 KiB 硬上限**(DesignSync `get_file`,2026-09-07 实测撞线):
      超了**静默截断、不报错** —— 表现是文件正好 262,144 字节、`</x-dc>` 与 `</html>` 都没有、`<div>` 开合不配平。
      移动端 21 块画板首次拉稿就是这么废掉的,所以才拆成两份文件。**桌面 `Agent Runtime Workbench.dc.html`
      现为 252,962 字节(R-CROSSLINK 给 1b 加注释后),离上限只剩 9 KB —— 下次给桌面加画板前必须先拆文件**(`2n–2p` / `2q–2r` / `2s–2t` 已经各放新文件);
      **移动 `Agent X-Ray Mobile - Runtime.dc.html` 在 R-CARDS 追加 `4y` / `4z` 后为 234,371 字节,只剩 27 KB —— 下次给移动 Runtime 加画板同样要先拆文件**。
      **R-CARDS-2 的四块画板据此全部放新文件**(桌面 `Agent X-Ray Cards 2.dc.html` 75,355 字节、移动 `Agent X-Ray Mobile - Runtime 2.dc.html` 125,528 字节,2026-09-09 并入),两份大文件都不碰。
      **R-MOBILE-2 的两块同样放新文件**(`Agent X-Ray Mobile - Shell.dc.html` 53,144 字节,2026-09-10 并入)—— `- Notes Skills About` 当时 198,838 字节、离上限只剩 63 KB,而一块移动画板约 27 KB。
      拉稿后一律先验:字节数 / 闭合标签 / div 开合 / 画板数,四项齐了才算拿到稿。
9. **`docs/security.md` 是强约束**,改动先改文档并说明理由。红线速记:`noTools:'all'` 起步、**bash/write/任意代码执行类工具永久禁止进 in-process 进程**(执行类能力只能在独立沙箱容器里:容器可常驻,每次运行必须是一次性的进程与工作目录 —— 所有者裁定 2026-09-03,R-SKILLS-2);SSE 推送前白名单 sanitize,provider 凭据字段永不出服务端;LLM key 加密入库只回掩码;`.env`/密钥不入 Git、明文凭据不进日志。
    - **工具分四组**(R-WEBSEARCH 2026-09-01 定前两组、R-TITLE 同日补第三组、R-SKILLS-2 2026-09-03 裁定并落地第四组「沙箱执行组」;原文是「业务工具必须纯函数」,与第 4 层的「外呼型工具」自相矛盾):**纯函数组**(`notes_*`)不碰文件系统 / 子进程 / `process.env` / 动态 import / **网络**;**外呼组**(`web_search` / `generate_image`,后者 R-IMAGEGEN 2026-09-02 加入)可持服务端凭据发网络请求,但要过六条附加约束 —— 访客控不到网络原语(只能填一个 query / prompt,控不到 URL/host/headers/model)、**目标域白名单在代码里**(`shared/websearch-hosts.ts` / `shared/imagegen-hosts.ts`,同一份判据实现 `shared/outbound-hosts.ts`;env 只能追加不能替换)、双计时器(空闲 + 总时长,库级 CHECK 有上界)、计入日限额、结果有界且异常不外泄、返回内容视为不可信输入(生图那一侧是「不是图片就不存」)。文件系统 / 子进程 / 动态 import 对两组一样禁止。**会话绑定组**(`session_rename`;`generate_image` 同时也是会话绑定的)是「纯函数 / 数据面只读」的**唯一例外**:无网络、无凭据,只经专用 NOLOGIN 角色写**本会话那一行**的限定列(`agent_title` 只改 `sessions.title` 两列;`agent_image` 只 INSERT `generated_images`),会话 id 在建会话时闭包绑死、不是入参。**沙箱执行组**(`skill_run`,R-SKILLS-2 已落地)是第四档:api 进程内同样不碰文件系统 / 子进程,只经 **unix socket** 调独立的 `skill-runner` 容器(默认实例 `network_mode: none`、只读、rlimit;R-WEBFETCH 2026-09-03 裁定加**同一镜像的 egress 实例**,只出公网、不在 `front` / `back`,只跑 `xray.json` 声明 `network: egress` 的 skill,首个是 `web-fetch` —— 它是「api 进程内工具不接受访客 URL」这条口径(`docs/security.md` 第 4 层)的唯一例外,且例外只开在沙箱执行组的 egress 档、不在外呼组,SSRF 防线 = 脚本逐地址校验 + 钉 IP 连、容器不在内部网络、宿主 `DOCKER-USER` 过滤;**不维护域名黑白名单**,拒的是固定内网地址段);入参只有 `skill` / `script`(闭集)与 `input`(JSON,过 schema),**可执行的 skill 集合在代码里**(`runner/skills/`,改 = 发版),库里只能在集合之内开关;八条附加约束见 `docs/security.md` §1 R-SKILLS-2 补记,egress 档的第九条见 R-WEBFETCH 补记。完整口径见 `docs/security.md` §1「工具分两组」表(标题是历史名、代码注释仍按它引用,表本身已扩到四组)与 R-TITLE / R-IMAGEGEN / R-SKILLS-2 补记。
10. **部署方式不混用**:本机开发 = `dev.ps1`(encore run);130 预发与生产 = docker compose(`deploy/`),镜像用 `encore build docker` + Next standalone。禁止在服务器上跑 encore run 当部署、也禁止本机用 compose 起开发环境。**镜像一律本机构建后传输,服务器不构建、不留仓库与工具链**;tag 必须是 git SHA,禁止 `latest`。矩阵与流程见 [`docs/deploy-environments.md`](docs/deploy-environments.md)。
11. **生产 JS 运行时统一为 bun,且「开实验位」与「换基座」必须成对出现**(所有者裁定 2026-08-29,R-BUN)。开发/测试/预发/生产四个环境的**运行时**都是 bun,**最终运行镜像(final runtime image)里不含 node**。三处配置缺一不可:`apps/api/encore.app` 的 `"experiments": ["bun-runtime"]`、构建时的 `--base oven/bun:<钉住版本>-slim`、`apps/web/Dockerfile` 的 bun 基座。
    - **边界要说清,别理解成「项目已经不依赖 node/npm」**:node 与 npm 仍保留在**构建工具链**里——`apps/web/Dockerfile` 的 builder 阶段装 `nodejs`/`npm` 并用 `npm ci` + `npx next build`,只是这些都不进 runner 阶段。准确表述是「**Node 已从生产 runtime 与最终运行镜像中移除;构建阶段与依赖解析仍用 Node/npm**」。
    - **别用 `command -v node` 去验这件事**(R9 在 130 实测):`oven/bun` 基座自带 `/usr/local/bun-node-fallback-bin/node`,那是**指向 `/usr/local/bin/bun` 的软链**(让 `#!/usr/bin/env node` 的脚本落到 bun 上),两个镜像里都查得到,按它判会得出「镜像里有 node」的错误结论。正确判据是 `node -p "process.versions.bun"` 有值 + 真实的 `/usr/bin/node`、`/usr/local/bin/node` 不存在 + `dpkg -l` 里没有 `nodejs` 包。命令见 `docs/deploy-environments.md` 冒烟清单第 12 条。
    - **只开实验位不换基座 = 产出一个必然启动失败的镜像**:Encore 会把 ENTRYPOINT 改成 `bun run …` 却仍用默认基座 `node:slim` 打包,`docker run` 报 `exec: "bun": executable file not found in $PATH`。`encore.app` 的 `build.docker.base_image` **对本地 `encore build docker` 无效**(仅作用于 Encore 自家 CI/CD),别往那里加。构建一律走 `dev.ps1 build`,不要手敲 encore 命令。
    - **调用 JS 可执行文件时必须 `bun --bun`**:不加时 bun 尊重脚本 shebang(`#!/usr/bin/env node`)而静默回落到 node。`apps/api` 的 test 脚本与 `apps/web` 的 CMD 都因此必须带 `--bun`;判据是 `process.versions.bun` 是否有值。
    - **运行时 ≠ 包管理器**:依赖安装仍走 `npm ci` + `package-lock.json`。pi SDK 自带 `npm-shrinkwrap.json` 锁定传递依赖而 bun 不读它,切 `bun install` 会丢掉这层供应链锁定且收益为零。`packageManager: "bun@…"` 字段只用于让 `encore test` 以 bun 执行脚本,不代表依赖由 bun 解析。
12. **生产两条硬约束:JS 运行时 = bun(规则 11),MCP 管理面协议 = 2026-07-28**(所有者裁定 2026-09-03,站点投产后)。任何依赖升级或迭代(encore CLI / `bun-runtime` 实验位 / MCP SDK / MCP 客户端 / pi SDK)只要**可能**让二者之一不再满足——实验位改名或移除、SDK 新版本不再提供 2026-07-28、客户端不再按该协议连——必须**在动手之前**向所有者做风险告知并拿到裁定,不得在轮次内自行降级或绕过(例如退回 node 基座、退回 legacy 协商路径)。判据:`process.versions.bun` 有值(`docs/deploy-environments.md` 冒烟清单第 12 条)与 `server/discover` 回 `supportedVersions: ["2026-07-28"]`(同清单第 4 条)。
13. **MCP 管理面工具变动必须同步更新 [`docs/mcp.md`](docs/mcp.md)**(所有者裁定 2026-09-03)。MCP 是站点唯一的写面与管理通道(原 `/admin` 后台与画板 3a–3e 已废弃),`docs/mcp.md` 是管理面契约的权威全景说明。任何轮次或改动只要涉及 MCP 工具的增删、签名/参数变更(入参 Zod schema)、返回值结构变更、权限/审计策略调整,或管理面协议与客户端接入机制变更,**必须在同轮次中同步修订该文档**,保持文档记载的工具总数、入参要求与行为说明与 `apps/api/mcp/tools.ts` 强一致;并在任务卡与提交中显式核对工具总数。

## 钉版本

| 依赖 | 版本 | 说明 |
|---|---|---|
| `@earendil-works/pi-coding-agent` | **0.84.3**(exact,lockfile 固定) | pi SDK 本体(`createAgentSession`/`defineTool`/扩展系统都在这个包);R1 实测通过。升级前先在本地过一遍 34 事件兼容性(`docs/security.md` §7) |
| **bun** | **1.4.0** | 唯一 JS 运行时(规则 11)。三处必须同版本:`apps/web/Dockerfile` 的两个 `FROM oven/bun:1.4.0-slim`、`dev.ps1` 的 `$bunBase`、`apps/api/package.json` 的 `packageManager`。升级时四处一起改,并重跑 R-BUN 验收(尤其内存基线——bun 用 JSC 堆,RSS 语义与 V8 不同)。**本机 bun 解释器也要对齐**(`packageManager` 只选运行时不校验版本,`dev.ps1 test` 对漂移会告警;对齐:`npm i -g bun@1.4.0`) |
| `@modelcontextprotocol/server`<br>`@modelcontextprotocol/node` | **2.0.0**(exact) | 官方 TS SDK **v2**,MCP 管理面用(R6)。**不是 `@modelcontextprotocol/sdk`**——那个包最新版(1.30.0)的 `LATEST_PROTOCOL_VERSION` 仍是 `2025-11-25`、没有 `server/discover`,支持 2026-07-28 的是以新包名发布的 v2。升级前确认 `createMcpHandler` 的 `legacy: 'stateless'` 默认值与 `maxSubscriptions` 语义未变(见 `apps/api/mcp/README.md` 的两条坑);**2026-07-28 协议是生产强制要求,升级若可能丢掉它须提前风险告知(规则 12)** |
| **encore CLI** | **1.57.13** | `bun-runtime` 实验位在该版本已可用(二进制内含 `bun-runtime` 字面量,实测)。升级前确认实验位未改名/未移除,且同机共用 daemon 的 ticketBookingB2B 不受影响;实验位若不可用属规则 12 的提前告知事项 |

## 本地开发

```powershell
.\dev.ps1            # 后端 encore run :4000(需 Docker Desktop 已启动,本地 Postgres 走容器)
.\dev.ps1 test       # encore test(经 bun --bun 跑 vitest)
.\dev.ps1 check      # encore check(编译校验)
.\dev.ps1 gen        # encore gen client → apps/web/lib/api-client.ts(排除 mcp 服务)
.\dev.ps1 db <名>    # encore db shell <数据库名>
.\dev.ps1 build      # 构建 api + web 生产镜像(tag = git 短 SHA;脏工作区会拒绝)
.\dev.ps1 ship <host> [sha]   # 镜像 + 五件部署资产送到服务器(不传 .env;R-WEBFETCH 起含 egress-filter.sh);发版后记 docs/releases.md
.\dev.ps1 skills     # 把 .claude\skills 镜像到 .agents\skills(codex 审查者只认后者;codex 暂停期间这条休眠)
.\dev.ps1 skills-gen # 读 runner\skills 生成两份同源清单(runner\manifest.json + apps\api\shared\skills.generated.ts;R-SKILLS-2)
.\dev.ps1 runner     # 本机起 skill-runner 执行容器(TCP 开发模式 127.0.0.1:8000;api 侧设 $env:XRAY_SKILL_RUNNER_URL="http://127.0.0.1:8000")
.\dev.ps1 runner egress   # 起 egress 档实例(127.0.0.1:8001,有公网;api 侧设 $env:XRAY_SKILL_RUNNER_EGRESS_URL="http://127.0.0.1:8001";R-WEBFETCH)
.\dev.ps1 runner-test     # 在 runner 镜像里跑 runner\tests(web-fetch 单元测试 + 病态输入夹具,--network none;R-WEBFETCH)
.\dev.ps1 source-publish <host> [sha]   # 把 <sha> 的源码快照经该 host 的 MCP 发进库(R-SOURCE;ship 会自动调,这条给首次发版、补发与本机)
.\dev.ps1 wt-clean   # 列出 .claude\worktrees 残留;带 <名字|all> 清理,--force 跳过安全闸
cd apps\web; npm run dev   # 前端 next dev :3000
```

- **`dev.ps1 test` 跑两处**(R-SKILLS-2 起):`encore test`(api)之后再在 `apps/web` 跑 `bun test lib`(前端纯函数投影测试,`node:test` 写法、零新增依赖);
  带文件参数时只筛 api 侧。`dev.ps1 build` 出**三个**镜像(api / web / runner),构建前先 `--check` 清单是否与 `runner/skills` 一致。
  **第三处是 `dev.ps1 runner-test`**(R-WEBFETCH 起):python `unittest` 与病态输入夹具要在 runner 镜像里跑(要 docker),不并进 `dev.ps1 test`;
  改了 `runner/` 下任何东西都要跑它。runner 镜像构建从 PyPI 下包(`requirements.txt` 全部带 hash),本机直连太慢时设 `$env:PIP_INDEX_URL` 指向镜像站即可。

- Encore 本地控制台 http://localhost:9400(看 trace)。
- Encore MCP 已在 `.mcp.json` 注册(stdio,经 `.claude/mcp-encore.ps1` 带正确 env 启动),新会话生效。
- **站点管理面在 `.mcp.json` 里注册了三个,别混用**——每个环境一把独立 token,一把只开一扇门:

  | server | 指向 | token 环境变量 | 期望哈希存在哪 |
  |---|---|---|---|
  | `xray-admin` | `127.0.0.1:4000/mcp`(本机) | `XRAY_MCP_TOKEN` | `apps/api/.secrets.local.cue` 的 `McpAuthTokenHash` |
  | `xray-admin-130` | `192.168.100.130/api/mcp`(预发) | `XRAY_MCP_TOKEN_130` | 130 上 `~/deploy/.env` 的 `MCP_AUTH_TOKEN_HASH` |
  | `xray-admin-prod` | `https://www.kzgai.cloud/api/mcp`(生产) | `XRAY_MCP_TOKEN_PROD` | 生产 `~/deploy/.env` 的 `MCP_AUTH_TOKEN_HASH` |

  用本机那个前先 `dev.ps1` 起后端。仓库里**只有哈希、没有 token 原文**,生成方式见 `deploy/.env.example`。首次使用需在 `claude` 里批准这三个项目级 MCP server。
  **url 必须写规范主机名 `www.`**:裸域 `kzgai.cloud` 现在 301 跳到 www(R11),
  而 MCP 客户端不跟随 POST 的重定向 —— 表现是 `requires re-authorization (token expired)`,
  看起来像 token 坏了,实际是请求根本没到端点(2026-09-02 实测:同一把 token 直连 www 拿得到 28 个工具)。
- **token 丢了不用慌,轮换即可**(2026-09-01 对 130 实测):服务端只存 sha256,原文不可恢复但可换。流程 = 本机按 `deploy/.env.example` 的 CSPRNG 口径生成新 token → 新哈希写进目标环境的 `MCP_AUTH_TOKEN_HASH` → **`docker compose up -d api` 重建容器**(env 变了 `restart` 不生效)。**`CONFIG_ENCRYPTION_KEY` 绝不能跟着换**,否则 `llm_config` 里的 key 密文全解不开、agent 直接停摆。
- **注册了但对端不在时,只在会话启动时报一次错**,中途起服务不会自动重连(见下条)。
- **`.mcp.json` 的改动要重启会话才生效**,而且 MCP client 连不上时只在会话启动时报一次 `ConnectionRefused`——中途起后端不会自动重连。急着用可以直接对 `/mcp` 发 JSON-RPC,但要带齐 2026-07-28 的逐请求契约,**正本在 `apps/api/mcp/README.md`「三条容易改错的地方」第 3 条**(精确请求形状照 `rounds/round-10/checklist.md` §9 抄)。最常中招的一条:`params._meta` 的三个键必须带 `io.modelcontextprotocol/` 命名空间前缀且不能少 `clientInfo`,否则 handler **静默**落到 2025-11-25 的 legacy 路径——`tools/*` 照常通、`server/discover` 却回 `-32601`,看起来像端点坏了,其实是请求走错了协议时代。
- `.claude/skills/` 有 8 个 encore 官方 skills(api/auth/code-review/database/frontend/secret/service/testing),写对应领域代码时按需触发,框架细节以 skills 为准;自建的 `sync-notes` 已随 R5 管道废除(R6 删除)。
- **worktree 用完必须 `dev.ps1 wt-clean` 删,别手删也别只跑 `git worktree remove`**(2026-08-31 实测):在 worktree 里跑过 encore 之后,目录会被那个会话的 `encore mcp run` 与注册过该 app 的 encore daemon 一起握着句柄,`git worktree remove` 报 `Permission denied`、目录删到一半只剩空壳,登记与磁盘长期不一致。`wt-clean` 把「安全闸 → 杀占用进程 → 长路径强删 → (仍在才)停 encore → prune → 拉回 daemon」固化成一条命令。**「仍删不掉」有两种原因,别一律当会话占用**(2026-09-02 实测):① 路径超过 MAX_PATH(残留在深层 `node_modules`,没有任何进程持句柄),脚本已先走 `rd /s /q` 长路径删除、只有它也失败才停同机共用的 daemon;② 另一个 Claude Code 会话以该 worktree 为 cwd(目录已空但 busy),用 CCD 的 `list_sessions` 按 `cwd` 找到那个会话、关掉后重跑(`archive_session` 得所有者明确同意,脚本不替你关)。两种情况的判据与处理细节以 `dev.ps1` 里 `wt-clean` 的注释头为准,本文不复述。
- **skill 升级或新增后必须 `dev.ps1 skills` 重新同步镜像**:codex 审查者只从 `.agents/skills` 加载(实测不认 `.claude/skills`),漏同步的表现是审查悄悄退回到旧版清单——不报错,只是少查东西。**2026-09-10 起 codex 暂停、执行器换 cursor CLI**(它不自动加载那个目录,靠审查任务书按需读),这条在切回 codex 之前只是保持镜像不腐;审查工作流见 [`docs/review-workflow.md`](docs/review-workflow.md)。

## 部署环境矩阵

四个环境的 JS **运行时**统一为 **bun**(规则 11),最终运行镜像不含 node;node/npm 仅存在于构建工具链与依赖安装。

| 环境 | 位置 | 方式 | 运行时 | 状态 |
|---|---|---|---|---|
| 开发 | 本机 Windows | `dev.ps1` → encore run | bun | 可用 |
| 测试 | 本机 Windows | `dev.ps1 test` → `bun --bun vitest run` | bun | 可用(R-BUN) |
| 预发 | 130 服务器 | docker compose(`dev.ps1 build` 本机构建后传输)。**可选环境**:有需要时先在 130 发版验证,**不是发生产的前置**(所有者裁定 2026-09-03);130 与生产的 SHA 允许不一致 | bun | R9 落地 |
| 生产 | 境内轻量服务器 | docker compose,镜像同样本机构建、tag = git SHA;若经过 130 验证则原样提升同一个镜像、不重建 | bun | **已投产**(R11,2026-09-02,https://www.kzgai.cloud/);发布记录 `docs/releases.md` |

细节:[`docs/deploy-environments.md`](docs/deploy-environments.md);生产服务器初始化与 ICP 备案:[`docs/deploy-cn-lightweight.md`](docs/deploy-cn-lightweight.md)。
