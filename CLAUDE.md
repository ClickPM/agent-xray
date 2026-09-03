# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

> **本文只留五块**:项目定位、仓库结构、开发模式与轮次流程、硬性规则、本地开发与部署。
> 架构/安全/部署细节都在 `docs/`,轮次拆解在仓库根 [`ROUNDS.md`](ROUNDS.md),按需读。
> **书写约定:硬性规则编号只增不改、不重排**(代码注释会引用「CLAUDE.md 规则 N」);删掉的规则留「已废弃」占位。
> `AGENTS.md` 是给 codex 审查者的指针文件,指向本文,无需双份维护。

## 项目定位

**Agent X-Ray**:「Agent 运行时」网站——访客与 AI agent 对话的同时,右侧面板像 DevTools 一样实时展示 agent loop 内核轨迹(34 种扩展事件)。四个 Tab:Runtime 工作台 / Notes 研习库 / **Skills 技能库(R-SKILLS,2026-09-03 裁定、待实现)** / About;站点内容与配置由所有者经**无状态 MCP 管理服务**维护(`/api/mcp`,R6 已落地;原 `/admin` 后台与画板 3a–3e 于 2026-08-31 裁定废弃)。**站点已于 2026-09-02 投产**(https://www.kzgai.cloud/,R11),此后进入运维迭代:**较大迭代依旧延续轮次机制**(命名轮,所有者裁定 2026-09-03),小修补可直接 `main`;**每次生产发版必须记入 [`docs/releases.md`](docs/releases.md)**。

- **功能范围的唯一边界是设计稿**:[`design/`](design/README.md) 画板 1a–1g + 2a–2h(共 15 块)+ 可交互原型(规则 8;1f–1g 于 2026-09-02 新增,2f–2h 于 2026-09-03 新增,3a–3e 已废弃并于 2026-09-02 从画布删除)。管理面范围以 ROUNDS.md R6 裁定清单为准。
- 架构与既定决策:[`docs/architecture.md`](docs/architecture.md)(pi SDK in-process、Encore 类型化 RPC、SSE ×2、Postgres、单机 compose)。
- 安全强约束:[`docs/security.md`](docs/security.md)——威胁模型、四层沙箱、脱敏、凭据管理;**是约束不是建议**(规则 9)。

**用户回复默认中文**;代码、命令、路径、技术术语保持英文。

## 仓库结构

```
apps/web      Next.js 15 前端(App Router)。三 Tab 已按画板实现、第四个 Skills tab(画板 2f–2h)由 R-SKILLS 实现,接后端只换数据源
              (样式零改动,规则 7);/admin 六页已于 R6 整目录删除
apps/api      Encore.ts 后端 **app root 在这里,不是仓库根**。服务清单与各自边界以
              `apps/api/<服务>/README.md` 为准(about / agent / mcp / metrics / notes / system / trace,
              R-TABS 新增 site/ = 顶部 tab 呈现开关的只读面;R-SKILLS 将新增 skills/ = 技能库只读面);本文不再逐服务记状态
design/       设计稿终稿存档(.dc.html 画板 + 可交互原型 + token 速查)——实现时逐画板对照
deploy/       docker compose + Caddyfile + migrate.sh(预发/生产共用的部署资产,R9/R11 定稿)
docs/         架构 / 安全 / 部署环境矩阵 / 境内轻量服务器部署 / **生产发布记录(releases.md)**
rounds/       轮次任务卡与管理产出(约定见 rounds/README.md);roadmap 在根 ROUNDS.md
tools/        预留给本机构建期工具,**刻意在 Encore app root 之外**(规则 6)。
              目前**没有这个目录**:R5 的 notes-sync 管线已随 R6 删除,内容发布改走 MCP 管理服务
.claude/      encore 官方 skills(skills-lock.json 锁版本,升级 `npx -y skills update`)
              + MCP 启动脚本。`.mcp.json` 另注册了三个站点管理面(本机 / 130 / 生产),
              token 各走各的环境变量、都不入库,分工见下方「本地开发」的表;
              自建 skill sync-notes 已随 R6 删除
.agents/      `.claude/skills` 的镜像,给 codex 审查者用(生成物,`dev.ps1 skills` 同步)。
              实测:codex 只认仓库级 `.agents/skills` 与 `.codex/skills`,**不认 `.claude/skills`**
dev.ps1       Windows 本地 encore 唯一入口(规则 1)
```

## 开发模式与轮次流程

**Claude Code solo 开发,codex 独立审查**;不做视觉 review(规则 7 管住样式即可)。

```
开工:cp rounds/TEMPLATE.md rounds/round-NN/round-NN.md,按 ROUNDS.md 该轮拆解填任务卡
  → 实现(遵守规则 7/8/9)
  → 验证:dev.ps1 test / check + 任务卡验收项全过
  → codex 独立审查:默认 /codex:review;质疑设计取舍用 /codex:adversarial-review;
     改动超过 1–2 个文件带 --background,用 /codex:status、/codex:result 跟进
  → findings 逐条处理(采纳整改 / 不采纳写明理由),回填任务卡「代码审查」段
  → 只要有采纳整改的 findings → 再发一轮复审(缺陷门禁,非设计评审),范围按下方「审查范围」
  → commit + 更新 ROUNDS.md 进度表
```

- **审查范围(所有者裁定 2026-08-31)**:**只有前两轮**用固定的全量范围(`branch diff against main`);**第 3 轮起只审「上一轮 findings 整改后的 diff」**,即 `--base <上一轮已审提交>`。
  - 命令:`node <codex-companion.mjs> review --background --base <上一轮已审提交>`(companion 支持 `--base <ref>` 与 `--scope <auto|working-tree|branch>`;`/codex:review` 这个版本不接受自定义关注点,但接受这两个参数)。
  - 为什么:全量重扫一条百文件的分支单轮要 20 分钟上下,而第 3 轮起的复审职责只是「确认整改本身没引入新缺陷」。把范围收到整改 diff 既符合本条流程原本的措辞(「对**整改 diff** 再发一轮复审」),也避免审查器每轮在同一批未改动代码上重新起意。
  - 代价要认:整改 diff 之外的问题这几轮不会再被扫到。所以**前两轮必须是全量**,那是覆盖面的来源;第 3 轮起是门禁,不是覆盖。
- **复审收口标准(所有者裁定 2026-08-28)**:审查/复审循环不得带**阻塞性问题或明显 bug/漏洞类 findings**(high 级,或任何会丢数据、漏凭据、泄资源、逻辑错误的问题)收口——继续「整改 → 复审」直到此类 findings 清零才允许合并 `main`;低危改进项可写明理由记 `rounds/BACKLOG.md` 后放行。禁止以「spike 会被替换」「概率低」为由跳过整改(可作为**方案取舍**的理由写进任务卡,但对应风险必须有显式兜底)。
- **审查边界(所有者裁定 2026-08-28)**:**严禁以审查代替设计**——审查是缺陷门禁,不负责长出方案;findings 若指向设计缺陷,停下回任务卡/所有者层面重定方案,不在「整改 → 复审」循环里逐条堆补丁。**非严重阻塞性 findings 严禁新增机制类修复**(新队列/新协议/新抽象/新配置/新导出面):只允许最小改动(改判断、改文案、删代码)或写明理由记 `rounds/BACKLOG.md`;机制类修复仅限严重阻塞性 bug/漏洞。发起复审时把本条作为审查要求带给审查者:只判定并报告缺陷与严重级别,不展开设计方案。
- 降级到 Claude Code 自带 `/code-review` 只认硬失败(codex CLI 未安装/未登录/启动失败),降级原因写进任务卡;「等得久」「改动小」不是理由。
- 同一验收项针对性整改后连续 2 次仍不过 → 写 `rounds/round-NN/BLOCKED.md` 停下呼人,禁止放宽验收(rounds/README.md)。
- 分支:每轮在 `round-NN` 分支开发,审查通过后合并 `main`;纯文档与微修可直接 `main`。**投产后(2026-09-02 起)较大迭代依旧走本流程**(命名轮 `round-<名字>`);任何发到生产的 SHA 都要在 `docs/releases.md` 加一行。
- 跨轮次发现的问题写 `rounds/BACKLOG.md`,不当场顺手改。

## 硬性规则

**编号只增不改**。1–4 继承自 ticketBookingB2B 项目同机踩过的坑,原样适用。

1. **Windows 上所有 encore 命令必须走 `dev.ps1`**(或手动 `$env:LOCALAPPDATA="D:\encore-data"; $env:APPDATA="D:\encore-data\roaming"; $env:Path += ";$HOME\.encore\bin"`)。原因:encore daemon 的 unix socket 无法绑定在含中文字符的用户名路径(`bind: An invalid argument was supplied`),且 daemon 继承启动进程的 PATH。daemon 常驻且同机与 ticketBookingB2B 共用——用错误 env 启动过后要以正确 env 重跑 `encore daemon` 重启。
2. **测试只能 `encore test`**(`dev.ps1 test`),禁止裸跑 `vitest`(缺 `ENCORE_RUNTIME_LIB` 会炸)。引入 vitest 时 `apps/api/package.json` 的 test 脚本必须是 `vitest run --passWithNoTests`(不带 `run` 会进 watch 卡死)。
3. **含中文的 `.ps1` 必须存成 UTF-8 with BOM**。PowerShell 5.1 对无 BOM 的 UTF-8 按 ANSI(936) 解码,中文注释会吞掉行尾换行、把下一行并进注释——`param` 行曾因此被整行注释掉导致参数静默失效。`param` 放首行 + BOM 双保险;改完跑一次带参数命令确认行为正确。
4. **写 JSONB 一律 `${JSON.stringify(x)}::text::jsonb`,绝不写裸 `::jsonb`,也别改成直接传 JS 值**。`::jsonb` 会让驱动把 JS 字符串再编码一次,库里存成 JSON 字符串标量(`jsonb_typeof` 回 `string`),SQL 侧 `->`/`@>`/GIN 全部失效而 JS 侧读回来看似正常;直接传值则 `COALESCE(${null}, col)` 的裸 null 会被写成 `jsonb 'null'` 而非 SQL NULL。`::text::jsonb` 对 null 与非 null 是同一套语义。R2 建轨迹/消息表起就适用。
5. **`secret()` 只能在 service 目录内声明**(Encore 限制);共享库里不出现 `secret()`,需要密钥的共享代码收「已取好的值」作参数。
6. **`apps/api` 是 Encore app root,不做 npm workspaces 提升**(规避 encore#1723:app root 下无关 node_modules/.ts 干扰 parser)。web 与 api 不手工共享源码文件;类型经 `encore gen client` 产物(`apps/web/lib/api-client.ts`)流向前端,该文件是生成物,不许手改。
7. **非必要不得修改前端页面样式,不做视觉 review**。画板已是终稿且前端已实现:接后端只许换数据源(demo-data → API/SSE),不许动样式、布局、className、design token、动画参数。确因接线需要改结构时,任务卡写明理由与影响范围,且不得偏离 `design/` 对应画板。(2026-08-31 修订:3a–3e 废弃,对应 `/admin` 六页按所有者裁定于 R6 整目录删除——属本条允许的结构性改动;同轮的 `next.config.ts` 配图 rewrite 亦然,理由=图片改从 Postgres 供,对外 URL 不变。)
8. **严禁实现设计稿没有的功能**(所有者裁定 2026-08-28;2026-08-31、2026-09-02、2026-09-03 多次修订)。站点访客功能范围 = `design/` 画板 1a–1g + 2a–2h + 可交互原型;**3a–3e(/admin)已废弃**,管理功能由无状态 MCP 管理服务承担,其范围以 ROUNDS.md R6 裁定清单为准;`docs/` 的安全与部署要求是约束不是功能。新功能想法进 `rounds/BACKLOG.md` 等所有者裁定,不进任何轮次任务卡。
    - **2026-09-02 修订(R-TOOLS)**:所有者裁定新增 **Tools 工具面板**,设计稿随之扩到 12 块(新增 `1f` 列表态 / `1g` 展开态,同日删除废弃的 `3a–3e`)。**扩边界的正确顺序是「先改设计稿、再进轮次」**——本条不是被绕过,是先被改了。面板是访客可见的**只读**能力说明(工具名 / 中文标签 / 描述 / 入参 JSON Schema / 输出形态 / 工具分组),**不显示**启停开关、日限额与剩余次数、provider 与 model 名(那些是服务端配置,公开即泄配置面)。
    - **2026-09-03 修订(R-TABS)**:所有者裁定新增**顶部 tab 的呈现开关**(经 MCP 逐个开关三个 tab 露不露)。
      这**是**本条的例外(与 R-VISITOR 的会话删除入口同类,不同于 R-TOOLS 的「先改设计稿」):画板 1a 的导航条
      是三格固定的,没画过「某一格可以不出现」。理由是它不是产品功能,是一次**合规运维动作**的开关 ——
      备案审核窗口期要求内容可撤下,靠发版则一来一回两次构建 + 传镜像 + 重建容器。
      **边界只到呈现层**:隐藏 = 导航条不渲染 + 该 tab 的页面在 web 侧不可达(`runtime` 落在站点根路径上,
      改为 307 到第一个可见 tab),`/agent/*`、`/trace/*`、`/notes/*`、`/rss.xml` 等后端端点**照常服务**;
      要真的停掉 agent 用 `tool_config_set`。三个 tab 全部可见时前端与画板 1a 一字不差,不新增画板。
      tab 的闭集在 `apps/api/shared/site-tabs.ts`,**新增一个 tab 要改三处**(该文件 + 一条迁移种子 +
      `apps/web/lib/tabs.ts`),缺哪一处的表现各不相同,文件头列了。
    - **2026-09-03 修订(R-SKILLS)**:所有者裁定新增**第四个顶部 tab「Skills」技能库**(分享自研 + 精选第三方的 `SKILL.md` 目录包)。
      与 R-TOOLS 同一顺序、**不是**例外:设计稿先扩到 15 块(`2f` 首页 / `2g` 详情页 SKILL.md 态 / `2h` 详情页 Python 文件态,
      既有 12 块的导航条同步改四格),并入 `design/` 之后才开 `round-skills`。形态裁定:列表 + 详情页;详情页 = 目录树 + 逐文件预览
      (markdown 渲染 / 代码带行号)+ 复制安装命令 / GitHub 外链 / 站内 zip;按用途分类;**只读**(无搜索 / 筛选 / 点赞 / 安装量 / RSS)。
      **文件一律当文本渲染、永不执行、不收二进制**;新表不授权任何 agent 角色(规则 9,`docs/security.md` R-SKILLS 补记)。
      新增 tab 仍按 R-TABS 的「三处登记」走,`GlobalNav` 与既有三 tab 页面零改动。
    - **画板编号只增不改**,与本节硬性规则同一约定:`3x` 号段作废后不复用,新画板从 `2i` 顺延(`1a–1g`、`2a–2h` 已用)。
9. **`docs/security.md` 是强约束**,改动先改文档并说明理由。红线速记:`noTools:'all'` 起步、**bash/write/任意代码执行类工具永久禁止进 in-process 进程**;SSE 推送前白名单 sanitize,provider 凭据字段永不出服务端;LLM key 加密入库只回掩码;`.env`/密钥不入 Git、明文凭据不进日志。
    - **工具分三组**(R-WEBSEARCH 2026-09-01 定前两组、R-TITLE 同日补第三组;原文是「业务工具必须纯函数」,与第 4 层的「外呼型工具」自相矛盾):**纯函数组**(`notes_*`)不碰文件系统 / 子进程 / `process.env` / 动态 import / **网络**;**外呼组**(`web_search` / `generate_image`,后者 R-IMAGEGEN 2026-09-02 加入)可持服务端凭据发网络请求,但要过六条附加约束 —— 访客控不到网络原语(只能填一个 query / prompt,控不到 URL/host/headers/model)、**目标域白名单在代码里**(`shared/websearch-hosts.ts` / `shared/imagegen-hosts.ts`,同一份判据实现 `shared/outbound-hosts.ts`;env 只能追加不能替换)、双计时器(空闲 + 总时长,库级 CHECK 有上界)、计入日限额、结果有界且异常不外泄、返回内容视为不可信输入(生图那一侧是「不是图片就不存」)。文件系统 / 子进程 / 动态 import 对两组一样禁止。**会话绑定组**(`session_rename`;`generate_image` 同时也是会话绑定的)是「纯函数 / 数据面只读」的**唯一例外**:无网络、无凭据,只经专用 NOLOGIN 角色写**本会话那一行**的限定列(`agent_title` 只改 `sessions.title` 两列;`agent_image` 只 INSERT `generated_images`),会话 id 在建会话时闭包绑死、不是入参。完整口径见 `docs/security.md` §1「工具分两组」表与 R-TITLE / R-IMAGEGEN 补记。
10. **部署方式不混用**:本机开发 = `dev.ps1`(encore run);130 预发与生产 = docker compose(`deploy/`),镜像用 `encore build docker` + Next standalone。禁止在服务器上跑 encore run 当部署、也禁止本机用 compose 起开发环境。**镜像一律本机构建后传输,服务器不构建、不留仓库与工具链**;tag 必须是 git SHA,禁止 `latest`。矩阵与流程见 [`docs/deploy-environments.md`](docs/deploy-environments.md)。
11. **生产 JS 运行时统一为 bun,且「开实验位」与「换基座」必须成对出现**(所有者裁定 2026-08-29,R-BUN)。开发/测试/预发/生产四个环境的**运行时**都是 bun,**最终运行镜像(final runtime image)里不含 node**。三处配置缺一不可:`apps/api/encore.app` 的 `"experiments": ["bun-runtime"]`、构建时的 `--base oven/bun:<钉住版本>-slim`、`apps/web/Dockerfile` 的 bun 基座。
    - **边界要说清,别理解成「项目已经不依赖 node/npm」**:node 与 npm 仍保留在**构建工具链**里——`apps/web/Dockerfile` 的 builder 阶段装 `nodejs`/`npm` 并用 `npm ci` + `npx next build`,只是这些都不进 runner 阶段。准确表述是「**Node 已从生产 runtime 与最终运行镜像中移除;构建阶段与依赖解析仍用 Node/npm**」。
    - **别用 `command -v node` 去验这件事**(R9 在 130 实测):`oven/bun` 基座自带 `/usr/local/bun-node-fallback-bin/node`,那是**指向 `/usr/local/bin/bun` 的软链**(让 `#!/usr/bin/env node` 的脚本落到 bun 上),两个镜像里都查得到,按它判会得出「镜像里有 node」的错误结论。正确判据是 `node -p "process.versions.bun"` 有值 + 真实的 `/usr/bin/node`、`/usr/local/bin/node` 不存在 + `dpkg -l` 里没有 `nodejs` 包。命令见 `docs/deploy-environments.md` 冒烟清单第 12 条。
    - **只开实验位不换基座 = 产出一个必然启动失败的镜像**:Encore 会把 ENTRYPOINT 改成 `bun run …` 却仍用默认基座 `node:slim` 打包,`docker run` 报 `exec: "bun": executable file not found in $PATH`。`encore.app` 的 `build.docker.base_image` **对本地 `encore build docker` 无效**(仅作用于 Encore 自家 CI/CD),别往那里加。构建一律走 `dev.ps1 build`,不要手敲 encore 命令。
    - **调用 JS 可执行文件时必须 `bun --bun`**:不加时 bun 尊重脚本 shebang(`#!/usr/bin/env node`)而静默回落到 node。`apps/api` 的 test 脚本与 `apps/web` 的 CMD 都因此必须带 `--bun`;判据是 `process.versions.bun` 是否有值。
    - **运行时 ≠ 包管理器**:依赖安装仍走 `npm ci` + `package-lock.json`。pi SDK 自带 `npm-shrinkwrap.json` 锁定传递依赖而 bun 不读它,切 `bun install` 会丢掉这层供应链锁定且收益为零。`packageManager: "bun@…"` 字段只用于让 `encore test` 以 bun 执行脚本,不代表依赖由 bun 解析。
12. **生产两条硬约束:JS 运行时 = bun(规则 11),MCP 管理面协议 = 2026-07-28**(所有者裁定 2026-09-03,站点投产后)。任何依赖升级或迭代(encore CLI / `bun-runtime` 实验位 / MCP SDK / MCP 客户端 / pi SDK)只要**可能**让二者之一不再满足——实验位改名或移除、SDK 新版本不再提供 2026-07-28、客户端不再按该协议连——必须**在动手之前**向所有者做风险告知并拿到裁定,不得在轮次内自行降级或绕过(例如退回 node 基座、退回 legacy 协商路径)。判据:`process.versions.bun` 有值(`docs/deploy-environments.md` 冒烟清单第 12 条)与 `server/discover` 回 `supportedVersions: ["2026-07-28"]`(同清单第 4 条)。

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
.\dev.ps1 ship <host> [sha]   # 镜像 + 四件部署资产送到服务器(不传 .env);发版后记 docs/releases.md
.\dev.ps1 skills     # 把 .claude\skills 镜像到 .agents\skills(codex 审查者只认后者)
.\dev.ps1 wt-clean   # 列出 .claude\worktrees 残留;带 <名字|all> 清理,--force 跳过安全闸
cd apps\web; npm run dev   # 前端 next dev :3000
```

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
- **skill 升级或新增后必须 `dev.ps1 skills` 重新同步镜像**:codex 审查者只从 `.agents/skills` 加载(实测不认 `.claude/skills`),漏同步的表现是审查悄悄退回到旧版清单——不报错,只是少查东西。

## 部署环境矩阵

四个环境的 JS **运行时**统一为 **bun**(规则 11),最终运行镜像不含 node;node/npm 仅存在于构建工具链与依赖安装。

| 环境 | 位置 | 方式 | 运行时 | 状态 |
|---|---|---|---|---|
| 开发 | 本机 Windows | `dev.ps1` → encore run | bun | 可用 |
| 测试 | 本机 Windows | `dev.ps1 test` → `bun --bun vitest run` | bun | 可用(R-BUN) |
| 预发 | 130 服务器 | docker compose(`dev.ps1 build` 本机构建后传输)。**可选环境**:有需要时先在 130 发版验证,**不是发生产的前置**(所有者裁定 2026-09-03);130 与生产的 SHA 允许不一致 | bun | R9 落地 |
| 生产 | 境内轻量服务器 | docker compose,镜像同样本机构建、tag = git SHA;若经过 130 验证则原样提升同一个镜像、不重建 | bun | **已投产**(R11,2026-09-02,https://www.kzgai.cloud/);发布记录 `docs/releases.md` |

细节:[`docs/deploy-environments.md`](docs/deploy-environments.md);生产服务器初始化与 ICP 备案:[`docs/deploy-cn-lightweight.md`](docs/deploy-cn-lightweight.md)。
