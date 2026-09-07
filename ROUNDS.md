# 轮次进度与 Roadmap

> 拆解方法参照 GPUI-Pi:小轮次、可证伪验收、风险前置、止损明确。目录规则见 [`rounds/README.md`](rounds/README.md),每轮任务卡在开工时从 [`rounds/TEMPLATE.md`](rounds/TEMPLATE.md) 建立为 `rounds/round-NN/round-NN.md`。
> 每轮收口时更新本表(状态 / 完成日期 / 审查记录指针)。范围与验收要点以下方「各轮拆解」为准;与 `docs/architecture.md`、`docs/security.md` 冲突时以后者为准。
>
> **功能边界(所有者裁定,2026-08-28;2026-08-31、2026-09-01、2026-09-02 三次修订)**:本 roadmap 与各轮任务卡**严禁新增设计稿没有的功能**——站点访客功能以 [`design/`](design/README.md) 画板 1a–1g + 2a–2m(共 20 块;2f–2h、2i–2k 与 2l–2m 于 2026-09-03 新增,见第六、第九、第十次修订)+ 可交互原型为唯一边界,加上 `docs/` 已定稿的安全与部署要求(它们是约束,不是功能)。**画板 3a–3e(/admin 后台)已废弃**:管理功能改由无状态 MCP 管理服务承担(无前端界面),其范围以 R6 拆解的裁定清单为准;画板已于 2026-09-02 从画布删除,`3x` 号段作废不复用。实现中想到的新功能一律进 [`rounds/BACKLOG.md`](rounds/BACKLOG.md) 等所有者裁定,不进任何轮次。
>
> **2026-09-01 修订(R-VISITOR)**:所有者裁定在会话列表新增**删除入口**——设计稿画板 1a–1e 没有这个东西,
> 属规则 8 的例外,理由是「站点公开可访问之后,访客需要一条自己清掉对话的通路」,是隐私功能而非产品功能。
> 交互取对画板偏离最小的形态(行 hover 露一个复用 `GhostButton` 的 ×,绝对定位不占布局宽度,
> 二次确认用浏览器原生 `confirm`),不 hover 时该行与画板一字不差。同轮引入的**访客 cookie**
> 不是功能而是安全约束,口径写在 `docs/security.md` §6(规则 9:先改文档再改代码)。
>
> **2026-09-01 第二次修订(R-TITLE)**:所有者裁定给 agent 配一个**会话命名工具** `session_rename`,
> 默认开启。设计稿画板 1a–1e 里会话列表本来就有标题(现在的标题是「首条用户消息的首行截 40 字」),
> 所以**前端零改动、无新界面**;新增的是「标题由谁写」这条通路,属规则 8 的例外,理由是
> 「首行截断在真实对话里几乎总是 `hi` / `你好` 这类无信息量的开场白,会话列表因此不可用」。
> 形态由所有者裁定为 **agent 工具**而不是服务端旁路生成:本站的卖点是右侧内核轨迹,
> 命名过程必须**在 Timeline 里看得见**(`tool_call · session_rename`)。
> 工具会写库,与 `docs/security.md` §1 第 1/2 层的「纯函数 / 数据面只读」相抵,
> 已按规则 9 先改文档(两处 R-TITLE 补记)再改代码。
>
> **2026-09-02 第三次修订(R-TOOLS)**:所有者裁定新增 **Tools 工具面板**——agent 现在真的会调工具
> (`notes_*` 三个 + `web_search` + `session_rename`),访客在 Timeline 里看得到 `tool_call · web_search`,
> **却无处得知这个 agent 有哪些工具、吃什么参数、吐什么结果**。与前两次修订不同,本次**不是**规则 8 的例外:
> 设计稿先扩到 12 块(新增 `1f` Tools 列表态 / `1g` 展开态,原型同步加第 4 个面板 tab 与逐工具展开),
> **然后**才有这一轮——「先改设计稿、再进轮次」是扩边界的唯一正确顺序。同日删除已废弃的 `3a–3e`。
> 形态裁定:落点是 Runtime 右栏第 4 个 tab(与 Timeline / Chain View / Lifecycle Map 并列),
> 理由是访客从「看到一次调用」到「想知道这是什么工具」的路径必须最短;内容**只读且静态**,
> 显示工具名 / 中文标签 / 描述 / 入参 JSON Schema / 输出形态 / 工具分组,
> **不显示**启停状态、日限额与剩余次数、provider 与 model 名(公开即泄服务端配置面)。
>
> **2026-09-03 第五次修订(R-TABS)**:所有者裁定新增**顶部 tab 的呈现开关**(经 MCP 逐个开关三个 tab 露不露)。
> 这是规则 8 的例外,与 R-VISITOR 的会话删除入口同类:画板 1a 的导航条是三格固定的,没画过「某一格可以不出现」,
> 管理面范围本来也以 R6 裁定清单为准。理由是**它不是产品功能,是一次合规运维动作的开关** ——
> 公安网备案的内容审核窗口期要求内容可撤下,而「撤下 / 放回」若靠发版,一来一回是两次本机构建 + 传镜像 + 重建容器。
> 边界由所有者明确收在**呈现层**:隐藏 = 导航条不渲染 + 该 tab 的页面在 web 侧不可达,
> `/agent/*`、`/trace/*`、`/notes/*`、`/rss.xml` 等后端端点照常服务(要真停 agent 用 `tool_config_set`)。
> 三个 tab 全部可见时前端与画板 1a 一字不差,**不扩设计稿、不加新画板**。
>
> **2026-09-02 第四次修订(R-IMAGEGEN)**:所有者裁定给 agent 配一个**生图工具** `generate_image`,
> 并要求**访客在对话框里直接看到生成的图**。工具本身**不是**规则 8 的例外(`docs/security.md` §1 开篇与第 4 层
> 从第一天起就写着「后续生图、联网搜索等插件」「外呼型工具(LLM / 生图 / 搜索)」,与 R-WEBSEARCH 同为补齐既定边界;
> Tools 面板按后端目录渲染,新工具自动出现);**对话框预览是例外**——画板 1a–1e 的聊天区没画过图片。
> 形态取对画板偏离最小的一种:图片以 **markdown 图片**出现在助手回复里,渲染器(`Markdown.tsx`)本来就有 `img`
> 一项(画板 2c 的正文配图样式,聊天区自 R9 起复用),**前端零改动**、不新造气泡与组件。
> 图片存 Postgres、随会话级联删除、按访客归属供图(隐私口径写进 `docs/security.md` §6);
> 端点 / 凭据 / 协议形态 / 限额经 MCP 配置,与 LLM、搜索 provider 同一套形态。
>
> **2026-09-03 裁定(投产后的运行口径)**:①站点已于 2026-09-02 正式投产,**后续较大迭代依旧延续轮次机制**(命名轮先例),
> 小修补直接进 `main`,但**每次生产发版都记入 [`docs/releases.md`](docs/releases.md)**;②**130 保留为预发环境,但是可选项**——
> 有需要时先在 130 发版验证,不是发生产的强制前置,130 与生产的 SHA 允许不一致(当前 130 停在 `7cc17fe` / 迁移 7);
> ③**生产 JS 运行时 = bun、MCP 管理面协议 = 2026-07-28 是强制要求**(CLAUDE.md 规则 12):后续迭代若可能使二者之一不再满足,
> 必须提前向所有者做风险告知,不得自行降级。
>
> **2026-09-03 第六次修订(R-SKILLS)**:所有者裁定新增**第四个顶部 tab「Skills」技能库**——分享自己写的与精选的第三方 skill
> (Claude Code / Codex 通用的 `SKILL.md` 目录包)。与 R-TOOLS 同一顺序,**不是**规则 8 的例外:设计稿先扩到 **15 块**
> (新增 `2f` 首页 / `2g` 详情页 SKILL.md 预览态 / `2h` 详情页 Python 文件预览态;既有 12 块画板的导航条同步改四格;原型加 Skills 两屏),
> 并入 `design/` **之后**才有这一轮。形态由所有者在设计前逐项裁定:**列表 + 详情页**;访客拿走的方式 = **复制安装命令 + GitHub 外链 + 站内 zip**;
> **按用途分类**(与 Notes 首页同构);收录 **自研 + 精选第三方**(卡片带出处与徽标);详情页必须**看得到目录树、能逐文件预览**(markdown 渲染、代码带行号)。
> 整个 tab **只读**:无搜索 / 筛选、无点赞评论、不显示安装量、无 RSS。内容经 MCP 整包发布(与 notes 同一读写分工),
> 文件一律当文本渲染、`.py` 永不执行,agent 侧本轮**不可读**(是否给 agent 加只读工具记 BACKLOG 待裁定)。
>
> **2026-09-03 第七次修订(R-SKILLS-2,`round-skills` 的 2.0 迭代)**:所有者裁定让 agent **使用** skills ——
> `skill_load` 把一个 skill 的 `SKILL.md` 送进上下文,`skill_run` 在**独立的无网络执行容器**里跑该 skill 声明过的 Python 脚本(venv 解释器、
> 一次性进程与工作目录),守卫 / 注入 / 运行三条轨迹在 Runtime 右栏看得见。这是产品能力扩面,所有者裁定「做」;
> 唯一要动设计稿的地方是 Tools 面板多出第四组「沙箱执行组」——**先改画板 1f/1g、再进轮次**(R-TOOLS 顺序,是开工前置);
> Timeline 的 `blocked` 徽标、详情卡的「EXTENSION RETURNED」、链式视图的多扩展步骤,画板 1a/1b/1c 早已画着,不新增画板。
> **哪些 skill 可用**(建在 1.0 之上):代码清单 `runner/skills/` ∩ 库里 `skills.agent_enabled`(默认 FALSE = 只展示不注入)∩ 展示副本与代码副本
> sha256 一致 ∩ 工具闸开着;**改可用 skill = 发版**(裁定 6),库里只能在代码集合之内开关。规则 9 的「一次性沙箱容器」同日改为
> 「独立容器可常驻 + 每次一次性进程」(裁定 2),130 预发非必经、隔离形态在生产冒烟验收(裁定 7)。七条裁定与依据见
> [`rounds/round-skills/research.md`](rounds/round-skills/research.md),交付清单见 [`round-skills-2.md`](rounds/round-skills/round-skills-2.md)。
>
> **2026-09-03 第八次修订(R-WEBFETCH,建在 R-SKILLS-2 之上)**:所有者裁定让 agent 读**访客指定的公网网页**。同日早些时候对预研的
> in-process 形态(`web_fetch` 工具 + Worker)裁定「暂不做」,R-SKILLS-2 裁定后重评:执行容器就是隔离边界,Worker 不再需要;
> 「访客定向外呼」不再是 api 进程里的第四档工具,而是沙箱执行组里一个声明了出网档次的 skill `web-fetch`,由同一 runner 镜像的第二个实例
> `skill-runner-egress`(只出公网、不在 `front` / `back`)跑。**不新增工具、画板、迁移、MCP 工具,前端零改动**;api 进程不碰 URL、不碰 HTML。
> 所有者十条裁定:两实例容器;**访客给的 URL 不设域名限制、不维护任何域名黑白名单**(太多,无法维护)—— 拒的是固定内网地址段;
> 外呼组「不接受 URL 参数」的唯一例外认下;残余风险「经 URL 外泄本访客会话内容」认下;准入清单加 egress 档例外;`network` 字段提前进 R-SKILLS-2;
> egress 实例 `256m` + 并发 1;宿主 `DOCKER-USER` 出网过滤进服务器基线;`web-fetch` 出现在 Skills tab 认下;限额超时复用 R-SKILLS-2。
> 方案与冲突清单见 [`rounds/round-webfetch/round-webfetch.md`](rounds/round-webfetch/round-webfetch.md),预研留档 [`study.md`](rounds/round-webfetch/study.md)。
>
> **2026-09-03 第九次修订(R-PERF)**:所有者在生产上报两个现象 —— `/skills/ppt-master` 白屏报
> `Application error`,以及「点 Skills 卡片经常没反应、点 Notes 有时候也会」。定位结论:①全站**没有任何
> `loading.tsx`**,而 7 个 page 全 `force-dynamic`,App Router 的软导航在服务端 RSC 返回前一个像素都不动
> —— 点 `diagram` 卡片实测 4.0 秒界面完全静止,「没反应」不是崩溃是在等;②`/skills/ppt-master` 的 HTML 有
> 1.92 MB、RSC 载荷 1.57 MB / 5.6–7.2 秒,水合时文档没到齐,React 报 #418 后整页重渲,重渲出岔就是那块白屏。
> 两者同一个根因:Skill 详情页把整包**全部 markdown** 在服务端预渲染,而页面只显示一个。
> **本轮的性质要分清**:T1(只渲染当前文件)**不碰任何设计稿**,是规则 7 明确允许的「只换取数来源与渲染时机」;
> T2(加载态)与 T3(错误态)则是**画板上没有的新视觉**,按 R-TOOLS / R-SKILLS 的同一顺序处理 ——
> **先把 `2i`(Skills 详情页加载态)/ `2j`(Notes 章节页加载态)/ `2k`(错误态 + 找不到)三块画进 `design/`,再进轮次**,
> 不是规则 8 的例外。给画布的提示词见 [`rounds/round-perf/design-prompt.md`](rounds/round-perf/design-prompt.md);
> **三块画板已于同日画好并拉回 `design/`(画板计数 15 → 18)**,T2/T3 的前置随之解除。
> 顺带记一笔:现在的 404 也是 Next 默认的英文 `This page could not be found`,已并入 `2k` 一起解决。
> 画板带来的唯一新语汇是 `2k` 的**品牌色实心主按钮**(既有按钮语汇只有 ghost),由画板明确定为出口层级,不是实现自造。
>
> **2026-09-03 第十次修订(R-TOOLCARDS)**:所有者发现会话区里**没有工具调用卡**,而画板 `1a–1d` / `1f–1g` 的会话区
> 一直画着两张(`read_file` / `bash`)。核对结论:首版 `bdc1ca4` 实现过,R3 `88dc2ae` 把对话区切到真实数据源时只映射了
> `role` / `content`,卡片断了来源;当时 `noTools:'all'` 没有工具可显示,没人发现;R4 `e6b3e3d` 删掉 demo 数据后
> `ToolChip` 留成死代码。ROUNDS.md / 任务卡 / BACKLOG 没有一条「去掉它」的裁定,属无意遗漏。**恢复卡片本身不是新功能**,
> 与规则 8 无关。**新增的是两个态**:一轮跑完后把处理过程折叠成一行(参考 pi-web 的「处理详情 · N 次工具调用」),
> 以及卡片箭头点开的入参 / 结果摘要 —— 画板没画过,按 R-TOOLS / R-PERF 的同一顺序**先画 `2l` / `2m` 再进轮次**,
> 不是规则 8 的例外。**两块画板已于同日画好并拉回 `design/`(画板计数 18 → 20;新稿相对本地零删除行,直接覆盖)**。
> 画板的裁定:折叠行是 13px `#6b7280` 的导航行不是卡片、行尾红点提示有失败、展开区左侧竖线做边界、卡片展开体每段最多
> 6 行超出接 `…(已截断)`、展开不做动画;会话区**不显示**模型名 / provider 名 / 分段 token 与费用 / 「思考」块。
> 所有者裁定做到「重新打开会话也要在同一位置」,所以落库形态要改:一轮仍是一条助手消息,`payload` 里加工具调用的
> **偏移表**(`messages.payload` 从 001 迁移起就为此留着),**无迁移**;旧行不回填,3 天保留期自然清空。
> 提示词见 [`rounds/round-toolcards/design-prompt.md`](rounds/round-toolcards/design-prompt.md),
> 拆解见 [`rounds/round-toolcards/round-toolcards.md`](rounds/round-toolcards/round-toolcards.md)。**所有者同日裁定按任务卡默认方案开工**
> (数据形态 = 偏移表、折叠范围 = 照 pi-web),分支 `round-toolcards` 从 R-PERF 合并后的 `main` 开出,代码同日落地。

## 进度表

| 轮 | 内容 | 状态 | 完成 |
|---|---|---|---|
| **R0** | 工程初始化:CLAUDE.md · rounds 框架 · dev.ps1 · skills · MCP · 依赖安装冒烟 | ✅ 已完成 | 2026-08-28 |
| **R1** | ⚠️ pi 内核风险门禁 spike(in-process · 34 事件 · SSE ×2 · 内存基线) | ✅ 全门禁通过([任务卡](rounds/round-01/round-01.md),codex 审查整改后 PASS) | 2026-08-28 |
| **R2** | 数据层:迁移 · 会话/消息/轨迹落库 · encore test 基建 · gen client | ✅ 已完成([任务卡](rounds/round-02/round-02.md),codex 审查整改后 PASS) | 2026-08-28 |
| **R-BUN** | 运行时统一 bun(开发/测试/预发/生产)+ 部署方式按架构评审整改 | ✅ 已完成([任务卡](rounds/round-bun/round-bun.md),13 项门禁全过;codex 初审 4P1+4P2 与三轮复审共 14 条 findings 全采纳整改,第 3 轮零 findings,缺陷门禁 PASS) | 2026-08-31 |
| **R3** | Runtime 对话流真实化(/agent/ask SSE + 前端切真实数据源) | ✅ 已完成([任务卡](rounds/round-03/round-03.md),10 项验收全过;codex 初审 5 条(3×P1)+ 复审第 1 轮 3 条(2×P1)findings 全采纳整改,复审第 2 轮零 findings,缺陷门禁 PASS) | 2026-08-31 |
| **R4** | 轨迹流 + 三视图真实化(/trace/stream + sanitize + 回放) | ✅ 已完成([任务卡](rounds/round-04/round-04.md),12 项验收全过(#11 按所有者裁定改为静态核验,镜像实跑冒烟并入 R9);codex 初审 3 条(2×P1)+ 复审三轮 5 条(全 P2)共 8 条 findings,7 条采纳整改、1 条写明理由记 BACKLOG,复审第 4 轮零 findings,缺陷门禁 PASS) | 2026-08-31 |
| **R5** | notes 服务:摄入管线 · 查询端点 · RSS · Notes 页对接 | ✅ 已完成([任务卡](rounds/round-05/round-05.md),8 项验收全过;codex 7 轮共 17 条 findings,15 条采纳整改、2 条所有者裁定不采纳并留兜底,末轮零 findings,缺陷门禁 PASS) | 2026-08-31 |
| **R6** | MCP 管理服务(无状态 2026-07-28:notes 内容/About/LLM 多 provider/工具启停;/admin 与 R5 管道退役) | ✅ 已完成([任务卡](rounds/round-06/round-06.md),10 项验收全过;codex 五轮共 18 条 findings,16 条采纳整改、1 条实跑证伪不采纳、1 条写明理由记 BACKLOG,末轮零 P1,缺陷门禁 PASS) | 2026-08-31 |
| **R7** | 沙箱与配额落地(只读工具组 · agent_ro · daily_quota,消费 R6 配置表) | ✅ 已完成([任务卡](rounds/round-07/round-07.md),12 项验收全过;codex 三轮共 6 条 findings(1×P1 · 4×P2 · 1×P3)**全部采纳整改**,末轮零 findings,缺陷门禁 PASS) | 2026-09-01 |
| **R8** | metrics 打点 + About 真实化 + 统计查询 MCP 工具 | ✅ 已完成([任务卡](rounds/round-08/round-08.md),15 项验收全过;codex 三轮共 3 条 findings(P1/P2/P3 各一)全采纳整改,第 3 轮零 findings,缺陷门禁 PASS) | 2026-09-01 |
| **R9** | 容器化 + 130 预发部署(docker compose 全链路) | ✅ 已完成([任务卡](rounds/round-09/round-09.md) · [冒烟留证](rounds/round-09/smoke.md)),18 项验收全过,130 预发可用;**所有者裁定本轮不走 codex 审查**(过程与残留风险见任务卡「代码审查」段)。同日按 `docs/notes-content-spec.md` 经 MCP 入库 13 系列 / 205 章节 / 103 配图 | 2026-09-01 |
| **R10** | 安全加固 + 上线前检查单逐项 | ✅ 已完成([任务卡](rounds/round-10/round-10.md) · [检查单留证](rounds/round-10/checklist.md)),检查单 1–11 项在 130(SHA `5c98b3e`)全绿;**所有者裁定本轮不做限额演练(引 R9 留证)与 pg 备份**,不做安全响应头与 IP 白名单(均记 BACKLOG) | 2026-09-01 |
| **R-VISITOR** | 访客会话隔离(24h 滑动 cookie · 归属过滤 · 3 天保留期 · 会话删除) | ✅ 已完成([任务卡](rounds/round-visitor/round-visitor.md) · [130 部署留证](rounds/round-visitor/round-visitor.md#130-预发部署留证2026-09-01)),12 项验收全过;codex 三轮共 6 条 findings(3×P1 · 3×P2),4 条采纳整改、1 条所有者裁定不修(130 内网)、1 条写明理由不采纳记 BACKLOG,第 3 轮零 findings,缺陷门禁 PASS。同日 130 预发升级到 `7cc17fe`(迁移 6→7),8 项冒烟全过,**本机验不了的「新建会话首帧带 Set-Cookie」在 130 上验掉,不再交接给 R11** | 2026-09-01 |
| **R-WEBSEARCH** | agent 联网搜索工具(Responses API 网关 · 域白名单 · MCP 配 provider · DeepSeek 零分支兼容) | ✅ 已完成([任务卡](rounds/round-websearch/round-websearch.md)),本机验收 #1–#10、#14 全过;codex 四轮共 6 条 findings(3×P1 · 3×P2)**全部采纳整改**,第 4 轮零 findings,缺陷门禁 PASS;**所有者裁定本轮不构建镜像、不发 130**(#2/#11/#12/#13 四条 130 实跑验收并入下一次预发升级——R11 按裁定跳过了 130,`web_search` 端到端已在**生产**实跑通过;130 那四条改为按需,130 已降为可选预发,2026-09-03 裁定) | 2026-09-02 |
| **R-TITLE** | 会话命名工具(`session_rename`:agent 自己给会话起名,轨迹可见,默认开启) | ✅ 已完成([任务卡](rounds/round-title/round-title.md),8 项验收全过:6 项本机,#1/#7 **由所有者在生产验过**(#1 R11 当日 `title_source=agent`,#7 于 2026-09-03 确认);codex 五轮共 4 条 findings(2×P1 · 2×P2):2 条 P2 采纳整改,1 条 P1 **所有者裁定不采纳并回滚**(记 BACKLOG),1 条 P1 随回滚作废,末轮零 findings,缺陷门禁 PASS) | 2026-09-03 |
| **R-TOOLS** | Tools 工具面板(右栏第 4 tab:工具名/描述/入参 schema/输出形态,只读) | ✅ 已完成并合并 `main`([任务卡](rounds/round-tools/round-tools.md);7 项验收全过,codex 两轮:1×P2 采纳整改 + 末轮零 findings,缺陷门禁 PASS)。**所有者 2026-09-02 裁定:先于 R11** —— 反正要走一次「构建 → 130 预发验 → 生产发」,带上它就只走一次,生产首发即最终形态;本轮无迁移、无新依赖;R11 跳过了 130,随生产首发 `5bd6ace` 实跑,Tools 目录在生产冒烟 ✅(R11 验收 9) | 2026-09-02 |
| **R11** | 生产部署上线(服务器初始化 · 域名/备案/TLS) | ✅ 已完成([任务卡](rounds/round-11/round-11.md))。站点 **https://www.kzgai.cloud/** 于 2026-09-02 上线(SHA `5bd6ace`):备案号挂 footer、仅 HTTPS(80 无响应)、HTTP/3、六个安全头、裸域 301 到 www;内容从 130 库级拷入 + Encore 系列 22 篇经 MCP 发布;LLM/搜索 provider 不设限额;全链路(对话 / SSE ×2 / web_search / session_rename)生产实跑通过。验收 12 项中 11 项 ✅。**所有者裁定收工时不做四项**:上线检查单在生产重跑 / codex 审查 / token 轮换演练 / 首日观察 —— 代价见任务卡「收工」段 | 2026-09-02 |
| **R-IMAGEGEN** | agent 生图工具(`generate_image`:单工具 · provider 的 `api_style` 分两种协议 · 图片存库按访客归属供图 · 对话框 markdown 预览 · MCP 四个 `imagegen_*`) | ✅ 已完成并合并 `main`([任务卡](rounds/round-imagegen/round-imagegen.md));17 项验收 16 过、#17 外呼半边交接生产配好 provider 后跑(本机无凭据;前端半边已用种子数据实跑:对话框渲染出图、无 cookie 404);codex 三轮共 3 条 findings(0×P1 · 3×P2)**全部采纳整改**,第 3 轮零 findings,缺陷门禁 PASS;`dev.ps1 test` 15 文件 373 用例。**所有者裁定与后续更新一起发生产** —— 已于 2026-09-02 随 SHA `b291eb1` 上生产(迁移 v9→v10;生产 `.env` 已补 `XRAY_IMAGEGEN_EXTRA_HOSTS` 并重建 api)。**`generate_image` 已于 2026-09-02 在生产配好 provider 并打开**(`imagegen_provider_upsert` 经 MCP 写入、key 只贴进调用不落盘,`tool_config_set` 开;`.env` 补 `XRAY_IMAGEGEN_EXTRA_HOSTS` 并重建 api),验收 #17 外呼半边生产实跑通过(约 72s 出图、PNG 落 `generated_images`、对话框正常渲染);此后 6 个工具全开,发布细节见 `docs/releases.md` | 2026-09-02 |

| **R-TABS** | 顶部导航 tab 的呈现开关(MCP 逐个开关三个 tab 露不露;隐藏 = 导航条不渲染 + 页面不可达,后端端点照常) | ✅ 已完成([任务卡](rounds/round-tabs/round-tabs.md));11 项验收全过,`dev.ps1 test` 16 文件 388 用例;真实 MCP 协议路径本机实跑通过(34 工具、enum 下发、拒未知 key、拒关最后一个可见 tab)。codex 首轮**零 findings**,缺陷门禁 PASS。**所有者裁定边界只到呈现层**,不碰任何后端端点。待发预发/生产(迁移 v10→v11) | 2026-09-03 |
| **R-SKILLS** | Skills 技能库 tab(第四个顶部 tab:按用途分类的 skill 卡片 → 详情页目录树 + 逐文件预览(markdown / 代码带行号)+ 复制安装命令 / GitHub 外链 / 站内 zip;内容经 MCP 整包发布) | ✅ **已合并 `main` 并发版生产**(`789007e`,2026-09-03,迁移 11 → 12;[发布记录](docs/releases.md));codex 三轮审查收口(整改后 PASS)([任务卡](rounds/round-skills/round-skills.md),分支 `claude/round-skill-phase-one-abc0e6`):迁移 `012` 三张表 + `apps/api/skills/` 只读面(首页 / 详情 / zip)+ `shared/skill-pack.ts` 判据与 fflate 打包 + mcp 八个 `skills_*`(工具 34 → 42)+ 前端 2f/2g/2h + 四格 tab 三处登记;`check` / `test` 全绿(18 文件 / 413 用例)、本机验收 ①–⑪ / ⑬ / ⑭ 通过(真实 MCP 路径发布 `encore-api` 等四个 skill,zip 解压逐文件一致);codex 三轮(全量 / 全量 / 整改 diff)共 4 P2 + 1 P3 全部整改,high 级为零;镜像验收 ⑫ 已在 `789007e` 发版时完成(`--services` 含 `skills`,生产 `/api/skills` 200)。设计稿 `2f–2h` 已于同日并入 `design/`;四条裁定(zip = `fflate`、第三方 LICENSE 与仓库链接**非必填**、仓库名按 skill 逐个必填、高亮三 token)全部按裁定落地 | — |
| **R-SKILLS-2** | agent 使用 skills(`round-skills` 2.0 迭代):`skill_load` 注入 + `skill_run` 在独立无网络容器里跑 skill 自带的 Python 脚本(第四组「沙箱执行组」,首个 `dangerous=TRUE` 工具)· 守卫 / 注入 / 运行三条轨迹进既有 34 事件 · 可用集合 = 代码清单 ∩ 库里开关 ∩ hash 一致 | ✅ **已发版**(生产 `c1ee245`,2026-09-03,与 R-PERF / R-TOOLCARDS 同批;[任务卡](rounds/round-skills/round-skills-2.md) · [研究与七条裁定](rounds/round-skills/research.md)):`runner/` 执行容器 + `tools/skills-manifest` 生成器 + 迁移 013 + 两个工具 / 两个扩展 / MCP +4(46)+ 前端三处投影;`dev.ps1 test` 全绿(api 24 文件 500 用例 + web 9 用例),含 faux provider 驱动真实 pi loop 的轨迹形状测试。spike 通过(两个 `network_mode: none` 容器经 unix socket,bun `fetch({unix})` 通)。画板 1f/1g 的第四组所有者尚未在画布上画,前端按任务卡建议值接上,**所有者裁定「正常展示出来就好了」**(不阻塞;补画记 BACKLOG)。**已收口**:审查 → 合并 → 生产发版 `c1ee245`(双闸随迁移种成关闭)→ 冒烟第 19 条隔离四项全过 → 当日按任务卡「运维」段五步打开双闸 → 第 20 条端到端逐项留证(text-tools 词频 `exit=0 · 117ms` / guard 拦截且全程无 `tool_result` / 脱敏 0 次 / `tool_config_set skill_run false` 止损即时生效),见 [`docs/releases.md`](docs/releases.md) | — |
| **R-WEBFETCH** | agent 读访客指定的公网网页(建在 R-SKILLS-2 之上):不是新工具,是沙箱执行组的 egress 档 skill `web-fetch`,跑在同一 runner 镜像的第二个实例 `skill-runner-egress`(只出公网)里 · SSRF 防线 = 脚本逐地址校验 + 钉 IP 连 / 容器不在内部网络 / 宿主 `DOCKER-USER` 过滤 · 不维护域名黑白名单 · 零新工具 / 画板 / 迁移 / MCP 工具 / 前端改动 | ✅ **已发版**(生产 `2c503d3`,2026-09-04;审查收口整改后 PASS;[任务卡](rounds/round-webfetch/round-webfetch.md) · [预研留档](rounds/round-webfetch/study.md)):codex 七轮(前两轮全量、第 3 轮起只审整改 diff)共 12 条 findings、high 级为零;首轮 3 P1 + 1 P2(ship 漏传 egress-filter / Dockerfile `|| true` 掩盖 pip 失败 / 元数据未消毒 / 残缺 gzip)采纳,第 2–6 轮 8 条全部落在自建 markdown 消毒器上,**所有者裁定回退为一行转义**(`![` → `!\[`,链接不过滤;「严禁以审查代替设计」),第 7 轮零 findings。`runner/skills/web-fetch/`(SKILL.md + xray.json `network: egress` + 单文件 `scripts/fetch.py`,七点 SSRF 判据在文件头逐条对应)+ `runner/requirements.txt`(trafilatura 2.2.0 及 16 个传递依赖全部 hash 钉)+ `runner/tests/`(29 个 unittest + 病态夹具,`dev.ps1 runner-test`)+ compose `skill-runner-egress` / `egress` 网络 / `runner_egress_sock` + `deploy/egress-filter.sh`(幂等 + systemd 单元)+ api 两档 `RunnerTargets` 路由 / 可用集合按档次过滤 / 提示词三句纪律 / 短码附固定文案后。抽取库在 rlimit AS 256 MB 下实测最坏 125 MB / 0.64 s,预研的元素 / 深度计数**不加**。零迁移 / 零 MCP 工具(46)/ 零前端 / 零 npm 依赖。所有者十条裁定已落(2026-09-03)。**已收口**:审查 → 合并 → 生产发版 `2c503d3` → 冒烟第 21 条 ①②③ → 推 `ClickPM/skills-hub`(`b85ec5e`)→ `skills_upsert` → `skills_agent_set web-fetch true` → 端到端 ④ 四个用例实跑 + 止损实测(验收 ⑮⑯,留证 [`docs/releases.md`](docs/releases.md))。冒烟顺带发现**宿主出网过滤覆盖不到「容器 → 宿主自身地址」**(`DOCKER-USER` 在 FORWARD 链上,本机交付走 INPUT),所有者裁定照原计划打开、缺口记 `rounds/BACKLOG.md` | — |
| **R-PERF** | 软导航反馈 + 详情页载荷瘦身 + 错误边界(生产报障直接触发):T1 Skill 详情页只服务端渲染当前文件、标题 id 改 rehype 阶段赋值 · T2 `loading.tsx` · T3 `error.tsx` / 404 | ✅ **已发版**(生产 `c1ee245`,2026-09-03,与 R-SKILLS-2 / R-TOOLCARDS 同批;审查收口整改后 PASS;[任务卡](rounds/round-perf/round-perf.md) · [画布提示词](rounds/round-perf/design-prompt.md));画板 `2i`/`2j`/`2k` 已并入 `design/`(15 → 18 块),T1/T2/T3 三块代码已落。基线:`ppt-master` RSC 1.57 MB / 5.6–7.2 s、`diagram` 484 KB / 2.2–3.9 s、点击到 URL 变化 4.0 s、React #418 只在 `ppt-master` 复现。已量到:**标题 id 对 225 篇生产章节零漂移**(验收 #3)、详情页预渲染体积 −90.7%(ppt-master)/ −89.4%(diagram)、切文件零新请求;`test` 18 文件 414 用例全绿。codex 两轮(全量 / 全量)共 1 条 finding(0×high · 1×P2「隐藏 tab 的 404 主按钮指回自身」)**采纳整改**,末轮零 findings,缺陷门禁 PASS。验收 #2/#4/#7 的真实数字**至今没有在生产复量**——发版当日冒烟没跑这三项,也没有别的轮次补过;要么补跑要么记 `rounds/BACKLOG.md`,别再当成「待发版」挂着 | — |
| **R-TOOLCARDS** | 会话区工具调用卡:实时内联(`1a`)+ 跑完后折叠(`2l`)/ 展开(`2m`)+ `payload` 偏移表落库回放;无迁移、无新端点、前端一条渲染路径 | ✅ **已发版**(生产 `c1ee245`,2026-09-03,与 R-SKILLS-2 / R-PERF 同批;审查收口整改后 PASS;[任务卡](rounds/round-toolcards/round-toolcards.md);分支 `round-toolcards`,`c4d6f59` + 整改 `d5ee910`);codex 两轮(全量 / 全量)共 2 条 P2、0×high:第 1 轮「`MessageRow.payload` 必填后测试夹具漏字段,tsc 报错」采纳整改,第 2 轮「展开体超 6 行时 `…(已截断)` 被裁切区盖住」属画板 2m 三条裁定互斥的设计取舍、写明理由记 BACKLOG。`check` / `test` 全绿(api 26 文件 514 用例 + web 15 用例);本机 `llm_config` 为空,验收 #2–#5 / #8 用与 `skills-e2e.test.ts` 同款的本地假 provider 驱动**真实** pi loop 跑通五个剧本(文本→工具→文本→工具→文本 / 工具出错 + 入参含 `apiKey` 已脱敏 / 一句话没说先调工具并以工具收尾 / 超长入参截到 400 接 `…(已截断)` / 无工具),F5 前后会话区 innerHTML 的 sha256 一致、无工具的一轮只有气泡 + `md-chat`;真实 provider 的复核(#11)**已在发版当日冒烟里做掉**:一轮真实对话后回放 `GET /agent/sessions/:id` 拿到 `turn.toolCalls`(`at` 偏移 / `durationMs` / 入参与结果摘要 / `isError`),见 [`docs/releases.md`](docs/releases.md) | — |
| **R-USAGE** | 顶栏统计条的 tokens 与 ctx 接真实数据(首版起 `tokens` / `cost` / `ctx` 是 `demo-data.ts` 三个常量,四项里只有 `events` 是真的):迁移 014 给 `sessions` 加 `total_tokens`(会话累计,与按天的 `daily_quota` 两个维度)、收尾帧与 `GET /agent/sessions/:id` 各给一条通路、cost 按裁定固定占位 | ✅ **已发版**(生产 `09e7fd2`,2026-09-04;[任务卡](rounds/round-usage/round-usage.md);分支 `round-usage`,合并 `09e7fd2`):codex 两轮(全量 / 全量)共 6 条、**零 high**:第 1 轮 1 P1 + 3 P2 全部采纳(先落库再发帧消除 F5 回退窗口、切会话时统计条与 items 同时作废、ctx 圆点不压灰(违反规则 7 的未画态)、ctxPercent 缺席就缺字段),第 2 轮 2 条采纳(`Number.isFinite` 挡 `Infinity`/`NaN` 永久污染 `rec.totalTokens`);整改后 PASS。`check` / `test` 全绿(api 26 文件 528 用例 + web 21 用例)。**生产实测**:两轮对话 `done` 帧 5315 → 8059 与库内累计逐次一致、F5 不回退,`ctxPercent` 0.988 → 1.008;顶栏显示「5.4k tokens · - · ● ctx 1% · 76 events」(留证 [`docs/releases.md`](docs/releases.md)) | — |
| **R-GSEARCH** | `web_search` 接 Gemini 原生 Google Search grounding(第二条线协议):provider 的 `toolType=google_search` 时打 `/v1/chat/completions` + `tools:[{google_search:{}}]`,由 Google 后端服务端检索综述;来源从正文抽 · 迁移 015 扩 CHECK 闭集 · 不新增工具 / MCP 工具(仍 46)/ 前端 | ✅ **已合并 `main`,待发版**([任务卡](rounds/round-gsearch/round-gsearch.md) · [探针留证](rounds/round-gsearch/verify.md);分支 `round-gsearch`):所有者给的机制说法**先验证再实现** —— 9 个探针 / 3 个模型,核心成立(`{google_search:{}}` 是唯一通路,签名重定向链接为证);两处与说法不同(`{type:"web_search"}` 打 chat/completions 是**静默忽略**而非失败;流式下 grounding 偶发无结果)。现行 Responses 线对 gemini 拿不到 grounding,故开第二条线,线协议由 `toolType` 唯一决定、不加 apiStyle 开关。codex 四轮(前两轮全量、第 3 轮起只审整改 diff)共 4 条、**全 P2、零 high**:①URL 内括号被当分隔符(采纳);②裸 URL 终止集混进 ASCII `? : ,`(采纳,根因是源码里的「全角标点」实际是半角)+ chat 流无收尾信号仍当成功(采纳,`finish_reason` / `[DONE]` 任一算收尾);③裸 URL 紧跟 ASCII 逗号 + 中文被吞 —— 三轮全落在裸 URL 边界上,按「审查循环不是设计」**删掉裸 URL 扫描、只认 markdown 链接**(自行裁定,可推翻);第 4 轮零 findings,整改后 PASS。E2E 直连真实网关:`gemini-3.8-flash-high` 3–4 条 vertexaisearch 来源,Responses 线回归 `gpt-5.6-terra` 行为不变。`check` / `test` 全绿(api 553 + web 21)。发版后经 MCP 配 `toolType:"google_search"` 的 provider 即启用,切回原 provider 即回滚 | — |

## 里程碑

| | 覆盖 | 含义 | 止损 |
|---|---|---|---|
| **M0** | R0–R1 | 环境 + 风险门禁 | R1 任一门禁不过 → **停**,重新评估 sidecar 形态并改写本表 |
| **M1** | R2–R4 | Runtime 核心真实化(站点核心卖点跑通) | — |
| **M2** | R5–R7 | 内容库 + MCP 管理面 + 安全沙箱(公开可访问的安全底线) | R7 沙箱验收不过 → 不得进入任何公网部署轮 |
| **M3** | R8 | 统计 + About(功能完备) | — |
| **M4** | R9–R11 | 预发 → 生产上线 | `docs/security.md` 上线检查单不全绿不上生产。**R11 收工时所有者裁定放行**:检查单在 130 全绿(R10),生产只做了部署冒烟(13 项)+ 全链路验收,检查单本身**未在生产重跑**;差的 6 项记任务卡「收工」段 |

## 各轮拆解

### R1 — pi 内核风险门禁 spike(⚠️ 全项目最大风险,先做)

架构决策「pi SDK in-process 嵌入 Encore 进程」此前只做过三层冒烟(import / session / Encore 请求内执行),本轮把它验证到可承诺的程度:

- 钉定 pi SDK 的 npm 包名与版本,写入 CLAUDE.md「钉版本」段;lockfile 固定
- Encore 请求内 `createAgentSession({ noTools: 'all' })` 跑通一轮**真实 LLM 对话**(经海外中转端点,key 走本地 secret)
- 观测者扩展订阅全部 **34 种事件**并采集 `{eventType, mode, timestamp, data}`,逐一核对四模式计数(notify 18 / veto 6 / chain 7 / takeover 2)与 `docs/architecture.md` 一致;有出入以实测为准回改文档
- `api.raw` SSE ×2 原型(对话流 + 轨迹流),Next dev proxy 与直连 :4000 两条路径都不缓冲、不断流
- 内存基线实测:import 增量、单活跃会话增量、`dispose()` 后回收,数字回填任务卡(部署规格依据)
- **止损**:任一门禁不过且无法当轮解决 → 写 BLOCKED.md 停下,与所有者重新评估 sidecar 方案

产出物是 spike 代码 + 实测数据,允许粗糙,但事件清单与内存数字必须真实。

### R2 — 数据层与会话持久化

- `SQLDatabase` + 迁移 001:`sessions` / `messages` / `trace_events`(含回放所需索引);JSONB 写入遵守 CLAUDE.md 规则 4
- agent 服务:会话创建/续接/列表端点;对话消息与轨迹事件落库(重启不丢,`docs/architecture.md` 既定决策)
- `encore test` 基建(vitest,`dev.ps1 test` 可跑),对库读写路径出首批测试
- `encore gen client` 产出接入 `apps/web/lib/`(仅类型与数据层,不动 UI)

### R-BUN — 运行时统一 bun + 部署方式整改(跨轮基础设施轮)

不属于 R0–R11 的线性序列,是一轮横切基础设施改造:把开发/测试/预发/生产四个环境的 JS 运行时统一为 bun 1.4.0,同时把 `deploy/` 从「框架版」推进到可用状态(依据 2026-08-29 的架构评审 P1 清单)。

- 运行时:`apps/api/encore.app` 开 `bun-runtime` 实验位;构建配 `--base oven/bun:1.4.0-slim`;`apps/web/Dockerfile` 同基座;测试经 `bun --bun vitest run`
- 部署:compose 从 `build:` 改 `image:<git-sha>`(不可变镜像)、补 `deploy/infra-config.json`、安全参数补齐(`cap_drop ALL`/`pids_limit`/tmpfs 限容/网络分段/healthcheck/`stop_grace_period`)、`mem_limit` 2g → 1g
- 文档:容量段从「每会话固定 X MB」改为公式;升级流程从服务器 `git pull + build` 改为不可变镜像拉取(消化 BACKLOG 里那条与规则 10 的冲突)
- 验收:R1/R2 的全部门禁在 bun 下复刻通过(34 事件 / SSE ×2 / 落库与重启 / 脱敏 / 内存基线重新建档)
- **止损**:任一门禁在 bun 下不过且当轮无法解决 → 回退成本为零(实验位 + 基座参数各一行,npm lockfile 全程未动),弃分支即可

> 本轮暴露并解决了一个原本会卡死 R9 的问题:Encore 自托管镜像**不执行数据库迁移**(实测,空库直起则 `/health` 200 但触库端点 500)。所有者 2026-08-29 裁定采用「部署脚本用 psql 施加镜像内 SQL」,已落地为 `deploy/migrate.sh`(版本记录与 Encore 的 `schema_migrations` 同构、单事务、幂等),并在 130 上按完整 compose 形态实测通过。

### R3 — Runtime 对话流真实化

- `POST /agent/ask` 正式实现:`api.raw` SSE ← `session.subscribe()`;并发 session 上限、空闲回收、`dispose()` 及时
- 前端对话区 + 会话列表从 `demo-data.ts` 切到真实 API/SSE;**样式零改动**(CLAUDE.md 规则 7)
- 验收:新访客建会话 → 对话流式渲染 → 刷新后会话与历史可恢复

### R4 — 轨迹流与三视图真实化

- `GET /trace/stream?sessionId=…` SSE:观测者扩展内存队列 → 推送;推送前按**白名单字段** sanitize(`docs/security.md` §2:provider 凭据字段永不出服务端;入参/出参截断)
- 前端 Timeline / Chain View / Lifecycle Map 三视图消费真实事件流;历史会话轨迹从库回放
- 验收:对话进行中右栏实时出事件;抽查 SSE 原始流无 Authorization/api-key 字段

### R5 — notes 服务与内容摄入

- 迁移:`notes_categories` / `notes_series` / `notes_chapters`(建在既有 agent 库,`deploy/migrate.sh` 只认这一个库)
- vault `学习分享/` → `tools/notes-sync` 同步管线(本地执行,幂等可重跑);入口 `dev.ps1 notes`,操作规程收敛成 skill `sync-notes`
- 查询端点(系列/章节/正文)+ RSS 生成(全站 + 四分类,地址在站根,Caddy 与 next dev 各一条路由)
- Notes 三级页面 + RSS 弹层对接真实数据
- 验收:RSS 通过校验器;摄入脚本重跑不产生重复数据

> **摄入方案由所有者逐条裁定(2026-08-31)**:库里存标准 markdown、Obsidian 语法在同步阶段改写、
> 前端渲染;frontmatter 不保留;图片压缩后进 web 静态资源;AI 资料只收中译并保留 source 原链;
> `原始资料/` 不摄入且不生成指向它的链接;内容分享不同步。完整裁定表与实测数字见任务卡。

### R6 — MCP 管理服务(替代 /admin 后台;所有者裁定 2026-08-31)

> 原 R7 的 admin 服务与 `/admin` 五页(画板 3a–3e)整体废弃,与原 R6 对调进位。管理面改为**无状态 MCP server**,所有者以 MCP 客户端(Claude Code 等)对站点内容与配置直接操作。R5 的 notes-sync 管道与 sync-notes skill 同时废除(**存量文章与数据不动**)。安全条款见 `docs/security.md` §4(已按本裁定重写)。

- 协议:**2026-07-28 规范为目标版本**(无状态核心:无 initialize 握手、无 `Mcp-Session-Id`,每请求 `_meta` 带版本与能力;`server/discover` 必须实现;POST 带 `Mcp-Method`/`Mcp-Name` 头)。用官方 TS SDK 并**保留向下协商**(客户端支持仍在铺开,所有者裁定);不实现 `subscriptions/listen`(管理面无订阅需求,纯 POST 单端点)
- 挂载:`api.raw` 端点 `/api/mcp`(走既有 `/api/*` 反代,无需新增 Caddy 路由);bun 下跑官方 TS SDK 属轮内验证项
- 认证与审计:静态 bearer token(高熵随机、服务端只存哈希、经 secret 注入;solo 维护不上 OAuth)+ 可选 Caddy 层 IP 白名单;认证失败与全部写操作入审计日志
- 迁移(原 R6/R7 的配置表在本轮一次建齐,R7 只消费):`llm_config`(多 provider:provider / key **加密** / baseURL / 默认模型 / 限额配置)· `tool_config` · `about_content`(github/origin 双链等)· `notes_assets`(附件二进制)· 审计表
- MCP tools 首批:notes 三张表 CRUD(**入参即标准 markdown,server 只校验不改写**——Obsidian 改写器随管道退役,与 BACKLOG「vault 源头写标准 markdown」裁定自洽)· 附件上传/删除 · About 内容 · LLM provider 管理(key 任何读回只给掩码)· 工具启停(双闸之一)。**统计查询 tools 不在本轮**(数据面在 R8,所有者裁定后挪)
- LLM 多 provider:**直接用 pi-ai 统一对接,不另起炉灶**(所有者裁定):`ModelRuntime.setRuntimeApiKey` 按 provider 注册、models.json 定义模型;`agent/runtime.ts` 硬编码的 `MODEL_PROVIDER`/`MODEL_ID`/单 secret 改从 `llm_config` 读。轮内验证:中转 baseURL 在 pi-ai 配置面的表达、key/模型变更热生效;`.env` 引导键 `DEEPSEEK_API_KEY` 去留在本轮裁定(BACKLOG 既有条目)
- 附件供图:**镜像内不烧任何 notes 内容(所有者裁定),全部从 Postgres 读**——存量 `apps/web/public/notes/` 图片回填 `notes_assets` 后从 web 删除;API raw 端点从库读、带长缓存头;**图片 URL 保持既有 `/notes/<系列>/<哈希>.webp` 不变**(免改写存量 markdown),Caddy 按扩展名把该路径分流到 api,next dev 加对应 rewrite(RSS 先例)
- 退役与删除:`apps/web/app/admin/` 六页整目录删除(所有者裁定;规则 7 结构性改动,理由=功能废弃)· `apps/api/admin/` 占位已换 `apps/api/mcp/` · `tools/notes-sync/` + `dev.ps1 notes` + `.claude/skills/sync-notes` 删除并 `dev.ps1 skills` 重同步镜像 · `dev.ps1 build --services` 补 `mcp`
- 验收:①本机 Claude Code 实连打通(**第一验收项**,客户端对 2026-07-28/向下协商的支持在此验证);②无 token/错 token 全拒且有审计记录;③经 MCP 发布一篇含附件新文章全链路(写入 → 前端渲染 → RSS 更新);④存量文章与图片零回归(URL 不变);⑤LLM key 读回只见掩码;⑥切换默认模型后新会话生效

> **落地补记(2026-08-31,与上面计划的四处偏离,详见任务卡)**
>
> 1. **SDK 换包名**:2026-07-28 由官方 TS SDK **v2** 提供,包名是 `@modelcontextprotocol/server` / `@modelcontextprotocol/node`(2.0.0)。原包 `@modelcontextprotocol/sdk` 最新版(1.30.0)的 `LATEST_PROTOCOL_VERSION` 仍是 `2025-11-25`、没有 `server/discover`。
> 2. **`subscriptions/listen` 要显式关**:它是 SDK 自带的,而 Claude Code 一连上来就调(抓包实测)。留着等于在管理端点上开一条断连探测不到的长连 SSE,已用 `maxSubscriptions: 0` 关掉。
> 3. **供图端点换前缀**:Encore 路由里 `/notes/:series/:file` 与既有的 `/notes/series/:slug` 冲突,API 侧改为 `/assets/notes/:series/:file`;**对外 URL 不变**,由 Caddy 与 next dev 按扩展名分流。
> 4. **`DEEPSEEK_API_KEY` 所有者裁定彻底移除**(不保留为部署引导):运行期 LLM 凭据只有 `llm_config` 一个来源;新环境首次部署后必须先经 MCP 写 provider,`/agent/ask` 在那之前回 503。已写进 `docs/deploy-environments.md` 部署步骤。
>
> 另:Claude Code **原生说 2026-07-28**(抓包见 `MCP-Protocol-Version: 2026-07-28` + `Mcp-Method` 头),向下协商这次没被用到,但按所有者裁定保留。

### R7 — 沙箱与配额落地(原 R6;`docs/security.md` §1 第 1/2/4 层)

- 只读工具组:`notes_list_series` / `notes_get_chapter` / `notes_search`——纯函数,取数走 `agent_ro` 只读角色
- 迁移:`agent_ro` 角色(仅 SELECT notes 三张表);注册集合按 **R6 已建的 `tool_config`** 启停配置决定
- `daily_quota`:每日 token/费用计数,超限拒新会话;单会话 turn 上限;限额值从 R6 的 `llm_config` 配置读
- prompt injection 自测清单过一遍(诱导执行/读配置/改数据),结果回填任务卡
- 验收:以 agent_ro 连接尝试写库必须失败;超限路径有明确拒绝行为

> **落地补记(2026-09-01,与上面计划的两处偏离,详见任务卡)**
>
> 1. **`agent_ro` 不用 `AGENT_RO_DATABASE_URL`**(所有者裁定):角色建成 **NOLOGIN**,由应用连接在事务里
>    `SET LOCAL ROLE agent_ro` 临时降权。权限仍由 Postgres 强制,但省掉一个 pg 驱动依赖、一份角色口令
>    (`.env`/initdb/secret 各一处)和一个 Encore 管不到的第二连接池。**决定性理由是验收能不能自动跑**:
>    本机 encore 的库由 CLI 托管,agent_ro 的登录口令进不去,「以 agent_ro 写库必须失败」只能推到部署轮
>    人工核验——而 M2 的止损正是「R7 沙箱验收不过不得进入任何公网部署轮」。改法之后这条进了 `dev.ps1 test`。
>    **连带**:下面 R9 的「`docker-entrypoint-initdb.d` 建角色」一项取消(角色由迁移 006 建)。
> 2. **不用 pi 的 `defineTool()` 运行时导出**,只用它的类型:那是个恒等函数,唯一作用是保住 TypeBox 的泛型推断,
>    而工具 schema 用的是普通 JSON Schema 对象(pi 校验器显式支持);静态 import 它会把整个 pi 包在 API 启动时
>    拉进来,破坏 `runtime.ts` 刻意做的惰性加载。

### R8 — metrics 与 About 真实化 + 统计查询 MCP 工具

- `POST /t` pageview beacon:date / path / **加盐 IP 哈希** / UA 摘要,不存原始 IP(`docs/security.md` §6);web 端打点接入
- 聚合查询(PV/UV/路径分布/近 30 天趋势)——**展示面是 MCP 统计查询 tools**(画板 3c Traffic 页已废弃;统计 tools 按所有者裁定挪到本轮,数据面就绪后落地)
- About 页从 `about_content` 读真实数据(github/origin 双链,表与管理 tools R6 已建);footer 备案号占位
- 验收:库中无原始 IP;MCP 统计查询结果与打点一致;About 内容经 MCP 修改后前端生效

> **落地补记(2026-09-01,与上面计划的四处偏离,详见任务卡)**
>
> 1. **所有者裁定扩 `about_content` 两列**(`repos` / `lang_bar`):画板 2e 的「公开仓库 / 语言构成」
>    两块 R6 没进表,仍是 `demo-data.ts` 的硬编码。不扩表就没法说 About「真实化」了。
>    同轮 `about_set` 从「整体覆盖」改成**部分更新**——字段涨到 6 个之后,整体覆盖会变成一个
>    「改一句 intro 静默清空七张仓库卡」的接口。
> 2. **origin 链接按所有者裁定加同款 ghost 按钮**(画板 2e 只画了一个 GitHub 按钮)。
>    `originUrl` 为空时整个按钮不渲染,此时页面与画板一字不差。
> 3. **新增了两个服务目录**,不是一个:`metrics`(打点)与 `about`(访客面的只读读取)。
>    About 的读路径没有合适的既有落点;`about` 与 notes(读)/ mcp(写)的分工同构。
>    两个名字都已补进 `dev.ps1` 的 `--services` 白名单。
> 4. **多一个 `traffic_agents`(UA 摘要分布)**:打点规格要求存 UA 摘要,存了却没有读路径
>    等于存了个只能靠手写 SQL 才看得到的列。聚合 SQL 与另外两个同构,不引入新机制。
>
> 另:**访客标识按天轮换**(哈希输入含日期),所以「区间 UV」这个数在本方案下不存在 ——
> 统计只给各日 UV 之和,tool 里叫 `visitorDays` 而不是 UV。这是隐私设计的直接后果。

### R9 — 容器化与 130 预发部署

> R-BUN 已把镜像构建、compose 定稿、安全参数、文档四块前移完成(bun 基座、不可变镜像、`infra-config.json`、`cap_drop`/`pids_limit`/网络分段/healthcheck)。R9 只剩「在 130 上真跑一遍 + 补齐尚未落地的部分」。

- 数据库迁移已由 R-BUN 的 `deploy/migrate.sh` 解决(所有者裁定方案一);R9 只需把它纳入部署流程文档与冒烟清单
- ~~`agent_ro` 初始化:`docker-entrypoint-initdb.d` 建角色~~ —— **本项取消**(R7 落地补记 1):角色是 NOLOGIN、
  没有口令,由迁移 `006` 连同授权一起建。R9 这边只剩一条既有约束:**`migrate.sh` 必须在起 api 之前跑完**
  (本来就是既定顺序);冒烟时顺带核一句「以 agent_ro 写库失败」
- 130 部署流程文档 + 脚本:`dev.ps1 build` → 文件方式传输(`docker save -o` → `scp` → `docker load -i`;**勿在 PowerShell 用管道直传,二进制会被文本重编码破坏**)→ 130 上按**先迁移后起服务**的顺序(`up -d --wait postgres` → `./migrate.sh` → `up -d`),避免「健康检查全绿但业务接口 500」的中间状态;升级另需先 `docker compose stop api web`(见 docs/deploy-environments.md「升级顺序」)
- 预发全链路验证:三 Tab + `/api/mcp` 管理端点(带 token 实连)+ notes 附件供图路由(Caddy 扩展名分流)+ 限额;安全约束逐项核验(非 root / read_only / `cap_drop ALL` / `pids_limit` / mem_limit / **最终运行镜像**内无 node / postgres 仅 `back` 网段可达)。spike 服务已于 R4 整目录删除,`/spike/*` 不再存在,该项从冒烟清单撤下
- **服务白名单核验**:`dev.ps1 build` 的 `--services` 是维护热点——冒烟时必须逐个确认**当前已落地的正式 service 端点都可达**(不只是 `/health`),漏改的表现是镜像构建正常、健康检查正常、而该服务端点静默 404
- **SSE 冒烟**(R3/R4 已就绪,可以做了):正式端点 `POST /agent/ask` 与 `GET /trace/stream` 均已落地并进白名单。冒烟内容:心跳 15s、断线重连 `afterSeq` 回放、`docker compose stop api` 时客户端收到明确断流而非静默挂起、SSE 脱敏抽查。**另需复测两条 R4 挂起的限制**(见 `rounds/BACKLOG.md`):Caddy + 自托管镜像的真实拓扑下能否拿到 SSE 客户端断开信号——若能,`/trace/stream` 的让位机制与 `MAX_STREAM_MS` 硬上界都可以放宽甚至退役
- 回滚演练:`IMAGE_TAG` 换回上一 SHA + `up -d` 真跑一次
- 验收:130 上从干净环境按文档一次部署成功,且回滚演练通过

> **落地补记(2026-09-01,与上面计划的四处偏离,详见任务卡)**
>
> 1. **开工第一个卡点是 web 镜像根本构建不出来**:`apps/web/Dockerfile` 的
>    `COPY --from=builder /app/public ./public` 在 R6 把配图搬进 Postgres、删掉整个 public/ 之后
>    就指向了一个不存在的路径。R6 之后没人再构建过 web 镜像,所以「R9 才第一次真构建」正好把它翻出来。
>    删掉那行即可(自托管字体走 `.next/static/media`,不经 public/)。
> 2. **字体自托管按所有者裁定并进 R9**(BACKLOG 的 R-BUN P1-4,原标「R9 或 R10」),
>    顺带解决回滚演练缺真实代码差异的问题 —— 本轮提交刻意拆成 v1(构建修复 + `dev.ps1 ship`)
>    与 v2(字体自托管),升级与回滚都有肉眼可验的差别,而不是两个内容相同只差 tag 的镜像。
> 3. **断连信号复测给出否定结论**:BACKLOG 里三条(R3 一条 / R4 两条)都挂着「等 R9 在真实拓扑下
>    复测,能拿到断开信号就放宽」。实测**拿不到** —— 开满 8 条 `trace/stream` 后 `kill -9` 掉全部
>    客户端,第 9 条仍 429。加一层 Caddy 不改变 Encore 网关不传导断开这件事。
>    **让位机制与 `MAX_STREAM_MS` 上界都要留着**,三条 BACKLOG 全部保持打开。
> 4. **多出一份 `docs/notes-content-spec.md`**:所有者中途给了 `D:\tmp\agent-xray-notes`
>    (211 篇 md + 56 图,是 vault 原导出而非标准化内容)并裁定「先给一份修改要求,
>    我让 AI 处理后再发」。全量内容入库不在本轮 —— 那会重新造一遍 R6 已退役的 notes-sync 改写管线。
>    R9 只发了验收所需的样本(四分类 + 系列 `r9-smoke` + 2 篇 + 1 图 + About),真实内容到位时清掉。
>
> 另:「最终运行镜像里不含 node」这句话要加限定 —— `oven/bun` 基座自带一个**指向 bun 的
> `node` 软链**,`command -v node` 会命中它。结论仍成立,判据已改(CLAUDE.md 规则 11 与
> `docs/deploy-environments.md` 冒烟清单第 12 条)。

### R10 — 安全加固与上线检查单

- ~~`docs/security.md` §~~ **`docs/deploy-cn-lightweight.md` §6**「上线前检查单」逐项过并留证:gitleaks / .env 权限 / 容器约束 / admin 强认证 / SSE 抽查 / 限额演练(检查单实际在 cn-lightweight 那篇,security.md 里没有这一节)
- 备份:Postgres 每日 pg_dump(本机 + 异地)脚本与恢复演练
- 可选:/admin IP 白名单(Caddy 层)
- 验收:检查单全绿,证据回填任务卡

> **落地补记(2026-09-01,与上面计划的三处偏离,详见[任务卡](rounds/round-10/round-10.md)与[检查单留证](rounds/round-10/checklist.md))**
>
> 1. **所有者裁定砍掉两项,本轮收敛成纯验证轮**:限额演练**不重跑**(R9 `smoke.md` §5 已在同一部署
>    形态下留证,`daily_tokens` / `turn_limit` 双路径 429 + 恢复后立即可用),**pg 备份整项不做**。
>    备份的代价是显式的:`deploy-environments.md` 与 §3 里「涉及不可逆迁移时先恢复备份」目前是
>    **悬空引用**,镜像回滚能回代码、回不了数据。已记 BACKLOG,R11 上线前须再裁定一次。
>    IP 白名单同样不启用(130 是内网预发,源 IP 同网段,白名单在这里没有验证价值),
>    留 R11 按真实出口 IP 开;Caddyfile 第 45–51 行的模板本轮核对过。
> 2. **本轮的实际产出是「把检查单的判据修准」,不是「打勾」**:5 条发现里有 3 条是判据本身会误判 ——
>    ①「镜像内无 node」写的 `node --version 应失败` 会给出相反结论(bun 的 node 兼容层不支持单独的
>    `--version`,报错却写着 `Node.js-compatible REPL`);②「GET 一律 401」漏了限定,带**正确** token
>    的 GET 是 **405**;③「SSE 优雅关闭」钉死 `curl exit 18`,而 R10 实测是 `0`(两者都对,差别只在
>    断开落在响应分块的哪个位置,要判的是「停机同刻终止」)。三条已就地改进 `docs/`。
>    另外新增 `.gitleaks.toml`:裸跑 gitleaks 会报 15 条(全是构建产物与**刻意写成假密钥的测试夹具**),
>    「每次要人眼过一遍 15 条」正是真泄漏藏得住的地方,把判据钉死后这项的期望值才是 0。
> 3. **两条加固被裁定出本轮,写进 BACKLOG**:①全站**一个安全响应头都没有**(Caddyfile 与
>    next.config.ts 均未设 nosniff / Referrer-Policy / X-Frame-Options);②130 上留着一份明文
>    LLM key(`~/deploy/.llm-key`,R9 残留,与 security.md §3「唯一来源是加密入库」不一致)——
>    扩散面已查清只有这一份,**没有当场删**(删了要回 provider 控制台重取,是所有者的东西)。

### R-VISITOR — 访客会话隔离(插在 R11 之前的加固轮;所有者裁定 2026-09-01)

> 沿用 R-BUN 的「命名轮」先例:不属于 R0–R11 的线性序列。ICP 备案未下来、生产尚未开站,
> 是做这件事代价最小的时间点 —— 生产库还是空的,保留期规则可以直接生效。

**开工时的实际状态比「缺个 cookie」严重**:`sessions` 表没有任何归属列,`GET /agent/sessions`
是**全站**列表 —— 任何访客打开 Runtime 就能看到所有人的会话标题,点进去能读全文;
`GET /trace/stream?sessionId=` 也只校验会话存在,轨迹面板里是完整的 prompt 与回复。
站点公开可访问,这在上线前必须堵掉,且必须同时覆盖 agent 与 trace 两个服务。

- 迁移 007:`visitors`(token 只存 sha256 / 24h 滑动 `expires_at`)+ `sessions.visitor_id`(可为 NULL,
  存量会话因此对所有人不可见)+ 归属索引
- cookie `xr_visitor`:HttpOnly / SameSite=Lax / Path=/ / Max-Age 86400,`Secure` 跟 `X-Forwarded-Proto`
  走(备案期是 HTTP,写死 Secure 会让浏览器静默丢弃整个 cookie)。**只在会话被创建时发放**,
  读路径只认领 —— 否则 `GET /agent/sessions` 就是个无认证的建行入口
- 归属过滤覆盖:会话列表 / 单查 / 续接提问 / 删除 / 轨迹流。不匹配一律 `not_found` 而非 403
- 保留期:会话最后活跃满 3 天硬删(级联 messages / trace_events),访客行过期满 3 天删。
  **不能用 Encore `CronJob`**(自托管镜像不执行 cron),落点是进程内 `unref` 定时器
- 会话删除(所有者裁定新增,见上面的功能边界修订):`DELETE /agent/sessions/:id` + 前端 hover ×
- 文档先行(规则 9):`docs/security.md` §6 加 R-VISITOR 补记,§4/§6 里「无 cookie」的措辞收窄到
  「管理面无 cookie」「打点侧无 cookie」

> **本轮最值得记住的实测**:Encore 的静态解析器**不穿透类型别名**。把响应 cookie 字段写成
> `type VisitorCookie = Cookie<string, "xr_visitor">` 再复用,Encore 会**静默**把它当成普通响应体字段 ——
> 不发 `Set-Cookie`,而是把整个 cookie 对象(含**明文 token**)序列化进 JSON:
> `{"session":{…},"visitorCookie":{"httpOnly":true,…,"value":"<明文>"}}`。编译过、请求 200、字段也在,
> 只有抓响应头才看得出来。内联写全就正常。最终选 `Header<string, "Set-Cookie">` 而不是内联的
> `Cookie<>`,是为了让 cookie 属性只有 `buildSetCookie` 一个来源 —— 两条 `api.raw` 只能拼字符串,
> 用 `Cookie<>` 等于让同一个 cookie 的属性在两处各写一遍。

### R-WEBSEARCH — agent 联网搜索工具(插在 R11 之前的能力轮;所有者裁定 2026-09-01)

> 沿用 R-BUN / R-VISITOR 的「命名轮」先例。**插在上线之前**的理由很直接:
> 这一轮动的是 agent 的工具集与出网面,上线之后再动等于让生产环境当第一个试验场。

**先说清楚它不违反规则 8**:`design/Agent Runtime Workbench.dc.html:1162` 就画着
`mkTool('web_search', 'MCP', '外呼', '联网搜索(服务端 key · 域白名单 · 计入日限额)', 'on')`,
`docs/security.md` §1 开篇与第 4 层也一直写着「后续生图、联网搜索等插件」「外呼型工具(LLM / 生图 / 搜索)」。
本轮是**补齐既定边界**,不是长新功能;实现口径连括号里那三条都照搬了。

- **协议**:OpenAI 系 Responses API 的服务端内置搜索(`POST {base}/v1/responses`,
  `tools:[{type:"web_search"}]` + `stream:true`)。**DeepSeek 与自建 AI 网关是同一套协议**,
  差异只有 baseUrl / modelId / toolType 三个配置字段 —— 一份实现,零分支
- **不做 Perplexity**(所有者裁定):参考插件里那三个是收费直连,与本站「服务端持凭据 + 域白名单」
  是另一套取舍;只取插件的第 1 个工具
- **文档先行**(规则 9):`docs/security.md` 威胁模型加第 5 条(外部内容注入);§1 第 1 层
  加「工具分两组」表 —— 原文只写了「每个工具必须是纯函数」,而第 4 层同时写着「外呼型工具」,
  两处此前是矛盾的。本轮把外呼组的**六条附加约束**写死(访客控不到网络原语 / 域白名单 /
  双计时器 / 计入日限额 / 结果有界且异常不外泄 / 返回内容视为不可信输入)
- 迁移 008:`websearch_config`(与 `llm_config` 同构但**不合表**)+ `daily_quota.searches` +
  `web_search` 启停种子(**默认关**)
- MCP 四个管理 tool:`websearch_providers_list` / `_provider_upsert` / `_set_default` / `_provider_delete`
- **右栏可见性**(所有者追加要求):一次搜索最长 180s,不上报的话 Timeline 上就是一行干等三分钟。
  阶段上报走 pi 的 `onUpdate` → `tool_execution_update`(34 事件之一,已在白名单里),
  Lifecycle 的 `tool_call` / `tool_execution` / `tool_result` 三个节点也随之从 pending 点亮 ——
  **前端零改动**(三视图本来就是泛型投影),规则 7 完好
- 验收:域白名单挡得住(含后缀伪装 / 明文 http / 内嵌凭据)· 访客控不到网络原语 ·
  双计时器与 4 MiB 上界 · 凭据不进错误对象 · 限额原子 · 未配 provider 不注册 ·
  配置变更下一轮生效 · 130 上 DeepSeek 与网关两条配置各跑通一次

> **本轮最值得记住的实测**:测试抓到过一个真 bug —— 上游 4xx 的响应体被原样放进了
> `WebSearchError.message`,而网关**会把请求头回显进错误体**,于是明文 key 进了错误对象。
> 只在日志那一行调 `safeErrorText` 是不够的:一个带着凭据的 `Error` 会被传递、被别处 catch、
> 被将来某个人直接 `console.error(err)`。**凭据要在构造错误的地方就抹掉**,而且通用模式
> (`sk-` 前缀 / `Bearer`)兜不住纯十六进制的自定义网关 key —— 必须再叠一道本次 key 的精确替换。

### R-TITLE — 会话命名工具(插在 R11 之前的小轮;所有者裁定 2026-09-01)

> 沿用 R-BUN / R-VISITOR 的「命名轮」先例:不属于 R0–R11 的线性序列。放在上线前做的理由是
> 它只改 agent 侧一条通路、不动部署形态,而生产库还是空的 —— 迁移 009 落在没有存量数据的库上。

**问题**:`sessions.title` 现在由 `store.deriveTitle` 派生(首条用户消息取首行、截 40 字)。
真实对话的第一句几乎总是 `hi` / `你好` / `在吗`,于是左栏会话列表全是同一个词,点进去才知道是哪一段。
参考实现是 pi 的 `auto-session-title` 扩展(首条输入后另起一个 `--no-tools` 子进程起标题)。

**形态裁定**:不照搬「服务端旁路生成」,改成**给 agent 一个工具**。理由是本站的卖点就是右侧内核轨迹——
命名过程要在 Timeline 里以 `tool_call · session_rename` 看得见;顺带还省掉一条独立的 LLM 出网路径
(标题由本轮对话顺产,token 落在既有 `daily_quota` 计数里)。代价已认:模型偶尔不调用,那时标题
退回现在的首行截断,不比现状差。

- 迁移 009:`sessions.title_source`(`derived` | `agent`,默认 `derived`)· NOLOGIN 角色 `agent_title`
  + **列级**授权(只有 `sessions` 的 `title` / `title_source` 两列可写)· `tool_config` 种下
  `session_rename` 且 **enabled = TRUE**(所有者可经 MCP `tool_config_set` 关掉)
- `apps/api/agent/tools.ts`:新增**会话绑定**工具注册表 —— 工具定义在建会话时按当前会话 id
  闭包绑死,入参只有一个 `title`;既有三个只读工具的注册路径与语义不变
- `apps/api/agent/title-db.ts`:写通道(`SET LOCAL ROLE agent_title` + `statement_timeout`),
  与 `ro-db.ts` 同构但**不是** `READ ONLY` 事务
- `runtime.ts`:冷启动查一次「本会话是否还需要命名」,已命名的会话**不注册**这个工具;
  系统提示按实际注册到的工具生成(现有那句「它们只能读教程内容,不能写任何数据」不能再一刀切)
- `docs/security.md` §1 第 1/2 层补记(规则 9 先行):纯函数与只读两条约束的**唯一例外**及其边界
- 前端**零改动**:标题在会话列表里本来就渲染,每轮对话结束的 `refreshSessions()` 会带回新标题

- 验收:①新会话首轮结束后左栏标题不再是首行截断,且右侧 Timeline 有 `tool_call · session_rename`
  一行、入参预览就是那个标题;②同一会话第二轮不再改标题(冷启动不注册 + SQL 双闸);
  ③以 `agent_title` 角色改 `sessions` 其他列 / 写 `messages` / 删会话 / 读 `llm_config` 全部失败;
  ④经 MCP `tool_config_set` 关掉后新会话不再有这个工具,标题回落首行截断;⑤`dev.ps1 test` 全绿
- **止损**:回退成本是一条迁移与一个工具;真出问题时 `tool_config_set session_rename enabled=false`
  即可当场停用,不需要发版

### R-TOOLS — Tools 工具面板(命名轮;所有者裁定 2026-09-02)

> 又一个不属于 R0–R11 线性序列的命名轮。**与 R11 的先后待所有者裁定**:它只加一个只读端点与一个前端 tab,
> 无迁移、无新依赖、不动部署形态,放在上线前后都成立。

**问题**:R7 落地只读工具组、R-WEBSEARCH 加了联网搜索、R-TITLE 加了会话命名,现在 agent 手上有 5 个工具。
访客在 Timeline 里看得到 `tool_call · web_search` 这一行,**却无处得知这个 agent 一共有哪些工具、
每个工具吃什么参数、吐什么结果**——「Agent 运行时 DevTools」这个定位缺了「能力清单」这一块。

**形态裁定**:Runtime 右栏**第 4 个 tab `Tools`**,与 Timeline / Chain View / Lifecycle Map 并列。
它与前三个的性质不同:前三个回答「本次运行发生了什么」,Tools 回答「这个 agent 具备什么能力」,
**与有没有正在运行的会话无关**,空会话时也有内容。设计稿 `1f`(列表态)/ `1g`(展开 `web_search`)
与原型已于 2026-09-02 就位,实现逐画板对照。

- 只读端点(`apps/api/agent/`):吐工具元信息 —— 名称 / 中文标签 / 描述 / 入参 JSON Schema / 输出形态说明 / 分组。
  **端点不得吐**:`execute` 函数、`ActiveWebSearchConfig` 的任何字段(baseUrl / key / model / provider)、
  `dailySearchLimit` 与当日用量、`tool_config` 的 enabled 状态(所有者裁定:公开即泄服务端配置面)。
- **派生式,不手工维护目录**(所有者裁定 2026-09-02,针对「每次发版还得顺便处理一下面板」)。
  数据来源要认一件事:`TOOL_REGISTRY` 只有纯函数组三个;`web_search` 由 `makeWebSearchTool(cfg)` 现构造、
  没配置就不存在,`session_rename` 是按会话闭包绑定的工厂 —— 但这三条路径里 `name` / `label` /
  `description` / `parameters` **都是常量**,只有 `execute` 闭包才用到 `cfg` / `ctx`。于是:
  每个工具一份 **META 常量**(定义由它构造 `{...META, execute}`),端点收集 META 并按白名单序列化。
  **面板永远不是第二个要改的地方**。
- 画板上有两样 pi 的 `ToolDefinition` 没有的东西,它们才是会反复要人手补的地方,各给一条出路:
  **工具分组按注册路径派生**(在哪个注册表里就是哪一组,手写只会写错);
  **输出形态是 META 的必填字段**,漏写是**编译不过**而不是「面板少一行」—— 拦在写工具那一刻,不是发版前。
- META 定义在闭包**外面**,`cfg` / `ctx` 在那个作用域里不存在,所以「description 里插进限额数字」
  这类泄配置面的写法**在结构上做不到**,不靠自觉也不靠 grep。
- 前端(`apps/web/components/workbench/`):新增 Tools 面板组件 + `Workbench.tsx` 的 tab 数组加第 4 项。
  这是规则 7 允许的结构性改动 —— 依据是设计稿已扩到 12 块(见上方 2026-09-02 修订),不是「顺手加的」。
- **一条待裁定**:目录是**静态**的(5 个工具全列)。若 `web_search` 未配置或被 `tool_config` 关掉,
  面板仍会列出它 —— 这与「不显示启停状态」的裁定是同一枚硬币的两面。所有者若认为「列了但用不了」
  比「泄配置面」更糟,再单独裁定改口径,不在本轮循环里自行决定。

- 验收:①右栏出现第 4 个 tab,样式/间距/选中态与前三个一致,空会话下也有内容;②5 个工具齐、分三组,
  每条的 name / label / description / 入参约束与 `apps/api/agent/tools.ts` **逐字一致**(用测试钉死,不靠眼看);
  ③端点响应里 grep 不到 key / baseUrl / model / provider / 限额数字 / enabled;④展开态按画板 `1g` 对照;
  ⑤`dev.ps1 test` 全绿、`dev.ps1 gen` 后前端类型对得上
- **止损**:回退成本是一个端点文件 + 一个前端组件 + tab 数组里的一行,无迁移、无数据变更

### R11 — 生产部署上线

- 前置:生产服务器采购完成,所有者提供 SSH 入口与密钥
- 服务器初始化(`docs/security.md` §5 基线:仅密钥登录 / 防火墙 / fail2ban / 自动安全更新)
- docker compose 部署;域名解析 + ICP 备案流程(`docs/deploy-cn-lightweight.md` §1)+ Caddy 自动 TLS;备案号挂 footer
- 上线冒烟 + 首日观察(限额、内存、日志)
- **前置(2026-09-02 更新)**:①ICP 备案已通过,`苏ICP备2025204887号-2`;②**R-TOOLS 先做**(所有者裁定);
  ③~~**先把 `main` 发一次 130 预发**~~(**实际跳过**:所有者裁定直接从 `main` 打包发生产,理由见任务卡「跳过 130」段;2026-09-03 进一步裁定 130 为可选预发)——130 停在 `7cc17fe`(迁移 7),`main` 已含 R-WEBSEARCH(008)与 R-TITLE(009)
  两轮**从未在部署形态下跑过**的代码,且 R-TITLE 的验收 #1/#7 当初就交接给 130 实测、至今未验;
  ④生产是空库,notes 内容与 About 文案要在上线后经 MCP 重发
- **R10 交接过来的四条**(②④已于 2026-09-02 裁定:白名单**不启用只靠 token**、安全响应头**上线时加**、
  pg 备份**继续不做**并派生「上线期间不做不可逆迁移」的硬约束;①③仍待部署时执行):①检查单在生产**重跑一遍**(R10 只证了 130,判据已修准,见 `rounds/round-10/checklist.md`);②`/api/mcp` 的 Caddy IP 白名单**按真实出口 IP 启用**(模板在 `deploy/Caddyfile` 第 45–51 行);③写生产 LLM provider 时 key **直接贴进 MCP 调用,不落盘**(130 上那份 `.llm-key` 就是这么留下的);④**安全响应头**与 **pg 备份**在上线前再裁定一次(两条都在 BACKLOG,备份那条决定了「不可逆迁移出错」有没有兜底)

### R-IMAGEGEN — agent 生图工具(上线后的第一个能力轮;所有者裁定 2026-09-02)

> 沿用 R-WEBSEARCH / R-TITLE 的「命名轮」先例。参考实现是 pi 的 `image-generation` 扩展
> (`~/.pi/agent/extensions/image-generation.ts`:两个工具各打一条生图链路、图片落盘、凭据读 `models.json`),
> **三处都不能照搬**:本站 provider 是「唯一默认」语义、容器根文件系统只读、凭据只能来自加密表。

**先说清楚它与规则 8 的关系**:工具本身是补齐既定边界(`docs/security.md` 早写着「生图」);
**对话框预览**是所有者裁定的例外,落点是助手回复里的 markdown 图片 —— 渲染器已有,前端零改动(见头部第四次修订)。

- **一个工具 `generate_image`,协议形态是 provider 的配置字段** `api_style`(`images` = `/v1/images/generations` 的
  `data[0].b64_json`;`chat` = `/v1/chat/completions` 的 `message.images[0].image_url.url` data URL)。
  插件的两个工具差异只在线上协议,那是 provider 的属性;本站 provider 表是唯一默认,两个工具等于要同时激活两个 provider
- **访客只控 `prompt`**:尺寸是 provider 配置(`image_size`),张数恒为 1。外呼组约束 1 的最严读法;
  `size` 做入参要给 `ToolParametersSchema` 加 `enum`、面板才画得出来,属机制扩面 → 记 BACKLOG 待裁定
- **图片存 Postgres**(`generated_images`,8 MiB 上界,随 `sessions` 级联删除),**只有生成它的访客看得到**
  (`GET /agent/images/<uuid>.<ext>` 按 `sessions.visitor_id` 判归属,不匹配 404;`Cache-Control: private`)。
  `<img>` 是同源 GET,cookie 自动带上,前端不需要做任何事
- **写库走第三个 NOLOGIN 角色 `agent_image`**(与 R-TITLE 同构):只有 `generated_images` 的 INSERT,
  没有 SELECT / UPDATE / DELETE;会话 id 闭包绑定不是入参。文档先行(规则 9):`docs/security.md` §1 第 1/2/4 层各一段补记 + §3 + §6
- **域白名单独立一份**(`shared/imagegen-hosts.ts`,内置只有 `api.openai.com`;同轮所有者裁定个人项目不进公司网关域名,搜索白名单的内置也收成只剩 `api.deepseek.com`;env
  `XRAY_IMAGEGEN_EXTRA_HOSTS` 只能追加),判据实现与搜索共用(`shared/outbound-hosts.ts` 工厂);同轮把魔数判定、
  带上界的响应体读取、本次 key 的精确脱敏三样也抽到 `shared/`,搜索与生图各自调用同一份
- **双计时器的一处不同**:生图是非流式的,上游出图前一个字节都不发,**空闲计时器只在响应头到达后才起**
  (默认 总 180s / 空闲 30s,CHECK 上界同搜索);等头期间每 10s 上报一次「生成中」,Timeline 不空转
- 迁移 010:`imagegen_config` + `daily_quota.images` + `generated_images` + `agent_image` + `generate_image` 种子(**默认关**)。
  只有 CREATE / ADD COLUMN / GRANT,无不可逆语句(R11「上线期间不做不可逆迁移」)
- MCP 四个管理 tool:`imagegen_providers_list` / `_provider_upsert` / `_set_default` / `_provider_delete`(28 → 32)
- 验收:域白名单挡得住(且与搜索白名单分开)· 访客控不到网络原语 · 两种协议都解析正确且只收内联数据 ·
  等头不受空闲超时约束 · 两道字节上界 · 不是图片就不存 · 凭据不外泄 · 限额原子 · 未配不注册 · 指纹变化 ·
  `agent_image` 写面限死 · 按归属供图 · 目录对齐 · MCP 四 tool · 前端零改动 · **本机实跑对话框里看得到图**(需所有者凭据)
- **止损**:回退成本是一条迁移(纯追加)+ 一个工具;真出问题时 `tool_config_set generate_image enabled=false` 当场停用,不需要发版

### R-SKILLS — Skills 技能库 tab(命名轮;所有者裁定 2026-09-03;文档就绪、未开工)

> 投产后的第二个功能轮(第一个是 R-IMAGEGEN)。所有者裁定「先写全文档、不写代码」,任务卡见 [`rounds/round-skills/round-skills.md`](rounds/round-skills/round-skills.md)。
> 与 R-TOOLS 同一顺序:设计稿**先**扩到 15 块(`2f–2h`,2026-09-03 并入 `design/`),**再**进轮次,不是规则 8 的例外。

**问题**:所有者日常 agent 开发里攒了一批反复用的 skill(自己写的 + 精选的第三方),站点没有地方分享它们;
读者想用,得先知道它长什么样(目录里有什么、SKILL.md 怎么写、脚本做什么),再一条命令装进自己的 Claude Code / Codex。

**形态裁定**(所有者在设计前逐项答复,直接决定画板):
- **列表 + 详情页**:`/skills` 按用途四分类的卡片(与 Notes 首页同构:分类表 + 色点 + 网格;卡片 = 等宽 skill 名 + 「自研 / 精选」徽标 + 一句话 + 出处与文件数);`/skills/<name>` 详情。
- **详情页 = 头部 + 「左目录树 / 右文件预览」**:头部有面包屑、等宽大标题、`GitHub ↗` 与 `下载 zip` 两枚 ghost 按钮、`INSTALL` 面板(一行 `npx skills add <owner>/<repo> --skill <name>` + copy);
  左栏 240px 粘性目录树(选中行 `#e8e8e8` + 字重 600;当前文件是 markdown 时下面多一块「本页目录」),右栏预览卡(头部条 = 路径 · 类型 · 大小 · 行数 · copy;markdown → frontmatter 键值块 + 既有 2c 排版;代码 → 行号列 + 三 token 高亮)。默认打开 `SKILL.md`,`?file=` 深链。
- **访客拿走的三条路**:复制安装命令、GitHub 外链、站内 zip(服务端从库内文件现打,对外 URL `/skills/<name>.zip`,API 侧 `/assets/skills/…`,Caddy / next dev 按 `.zip` 扩展名分流——与 notes 配图同一手法)。
- **内容经 MCP 整包发布**:八个 `skills_*` 工具(分类三个 + skill 五个),`skills_upsert` 收 `files[{path, content}]` 整包替换;只收文本、限 64 文件 / 单文件 256 KB / 整包 512 KB、路径规则、`SKILL.md` 必填且 frontmatter `name` 与 skill 名一致。
- **三处登记**(R-TABS 定下的):`shared/site-tabs.ts` + 迁移种子 + `web/lib/tabs.ts`;`GlobalNav` 零改动、既有三 tab 页面零改动(规则 7)。
- **安全口径**(已按规则 9 写进 `docs/security.md` §1 第 2 层 / §4 补记):文件当文本渲染、不执行、不收二进制、不做 markdown 改写;新表不授权任何 agent 角色;zip 响应 `nosniff` + `attachment`;`repoUrl` http(s) 两道校验。

- 验收(14 项,细则在任务卡):①`check` + `test` 全绿;②三处登记一致、enum 下发四值;③写面十二种非法输入逐条拒;④幂等;⑤级联删除与分类保护;⑥读面顺序 / 404;⑦zip 两条路径都通且解压回读一致;⑧⑨画板 2f / 2g / 2h 逐项对照(含 `?file=` 与两处 copy);⑩呈现开关藏 / 露;⑪安全(脚本注入只是文本、`javascript:` 拒、`agent_ro` 读新表被拒);⑫镜像白名单含 `skills`;⑬真实 MCP 协议路径发布仓库自带的 `encore-api` 全链路;⑭gen client
- **所有者裁定四条(2026-09-03)**:zip 库 = `fflate`;第三方 skill 的 `LICENSE` 与仓库链接 `repoUrl` **均非必填**(写面不拦,`repoUrl` 空时 GitHub 按钮与出处链接不渲染,与 About `originUrl` 同一口径;许可合规由所有者收录时自行把关);仓库名不设全局默认,`repo` 是每个 skill 发布时的必填字段(画板里 `ClickPM/agent-skills` 只是示例数据);代码高亮按画板做三 token
- **止损**:回退 = 删两个目录 + 登记表两行 + 两条路由 + 一条 `DROP` 迁移;临时下架只需 `site_tab_set{skills,false}`

### R-SKILLS-2 — agent 使用 skills:注入 + 沙箱运行(`round-skills` 的 2.0 迭代;所有者裁定 2026-09-03;同日代码落地、待审查合并)

> 建在 R-SKILLS(1.0)之上,不另起一套 skill 存储。任务卡 [`rounds/round-skills/round-skills-2.md`](rounds/round-skills/round-skills-2.md),
> 研究与七条裁定 [`research.md`](rounds/round-skills/research.md)(pi 0.84.3 内核实测依据在附 A)。实测与偏离记在任务卡「本轮实测」。

**问题**:1.0 让访客看得到、拿得走 skill,但站上的 agent 自己用不了它们 —— 而「agent 怎么用 skill、守卫怎么拦、脚本怎么跑」正是本站右栏最想展示的一段内核轨迹。
所有者的原始要求六条:能运行 skills;能跑 skill 内的 Python 脚本;运行阶段有 pi 守卫插件;脚本必须在虚拟环境里;只能是内置 skill 与脚本、不许临时写脚本;三条轨迹在右栏可见。

**为什么不能按字面做**:「pi 守卫插件 + 虚拟环境」是策略层,不是隔离边界;规则 9 写死了任意代码执行永久禁止进 in-process 进程。
所以执行只能在独立容器里,守卫的价值在策略与可见性。

**形态(七条裁定的落点)**:
- **可用集合在代码里**(裁定 6):`runner/skills/<name>/`(`SKILL.md` + `scripts/*.py` + `xray.json` 声明脚本与入参 schema)是唯一执行来源,构建期生成 api 的 `skills.generated.ts` 与执行容器的 `manifest.json`(每文件 sha256)。
  一个 skill 对 agent 可用 = 代码里有 ∩ 库里 `skills.agent_enabled`(迁移 013,默认 FALSE;裁定 5「默认只展示不注入」)∩ 库内 `skill_files` 与清单逐文件 hash 全等 ∩ `tool_config` 闸开着。漂移即不注入。
  两个档次:**注入型**(只有 SKILL.md,`skill_load`)/ **可运行型**(有 `xray.json`,另可 `skill_run`);可运行脚本的准入清单在 research.md §2.2(stdin JSON → stdout、标准库或钉住的依赖、无 subprocess / socket / eval、确定性、有 schema)。
- **两个工具**:`skill_load(name)` 纯函数组(读代码清单,不碰库);`skill_run(skill, script, input)` **第四组「沙箱执行组」**(裁定 3),入参只有这三个 string,没有 code / path / argv / interpreter;`tool_config` 种子 `dangerous=TRUE` —— R7 双闸首次真正用上。
- **执行容器 `skill-runner`**(裁定 2、4):`network_mode: none`、api 经命名卷里的 unix socket 调它;只读根 FS + `tmpfs /run/work`(noexec)每次一个目录;非 root / `cap_drop ALL` / `mem 384m` / `pids 64` / `cpus 1`;子进程 `/opt/venv/bin/python -I -B`、env 清空、rlimit、超时 kill 进程组;并发 2;stdout / stderr 流式截 256 KiB;脚本 sha256 三方核对。
- **pi 侧两个扩展**:`xray-guard`(`tool_call` 五条规则,命中即 `{block, reason}`,自身异常按拦截)与 `xray-skills`(`before_agent_start` 追加 `<available_skills>`);两者永远注册、**不 `registerCommand`**;「谁裁决谁记录」—— 它们各自把裁决作为派生字段 `handlers` 写进那条事件,观测者不再订阅这两个事件。理由是实测的短路语义(首个 block 后续 handler 看不到)。
- **右栏可见性**:守卫拦截 = `tool_execution_start → tool_call[blocked] → tool_execution_end(isError)`(pi 先发 start 再问 call,与画板 1a 示例顺序不同,是现状);注入 = `before_agent_start` 详情卡 EXTENSION RETURNED · xray-skills;运行 = `tool_execution_update` 四阶段。不新增事件类型;前端只改 `trace-view.ts` 投影、`TimelineView.tsx` 一行注记绑定、`ToolsPanel.tsx` 加第四组,零样式改动。
- **配置面**:MCP +4(`skills_agent_set` / `skills_agent_status` / `sandbox_config_get` / `sandbox_config_set`,42 → 46);`daily_quota.skill_runs`;打开顺序 = 发版(双闸关)→ 生产冒烟 4 条 → `skill_load` 开 → 逐 skill `agent_enabled` → `.env` 加 `XRAY_UNLOCK_DANGEROUS_TOOLS=1` 重建 api → `skill_run` 开。
- **部署**:`dev.ps1 build` 第三个镜像 `xray-runner:<sha>`(Python 基座按 digest 钉,不是 JS 运行时、规则 11 不涉及);compose 五容器;主机预算 +384 MB;本机开发 runner 走 `docker run` + TCP 覆盖(`XRAY_SKILL_RUNNER_URL` 代码级闭集)。**130 非必经**(裁定 7):出不去 / 只读 / 拒非清单脚本三件事在生产冒烟验收。

- 验收(16 项,细则在任务卡):①`check` + `test` 全绿;②spike 留证;③清单同源(重跑 `skills-gen` 零 diff,篡改一字节即红);④四个条件真值表;⑤入参闭集;⑥守卫五条 + 异常即拦截;⑦轨迹形状(faux provider 驱动真实 loop);⑧注入轨迹;⑨前端投影 + 无 `handlers` 时回归;⑩画板对照且 diff 无样式属性;⑪限额原子 / 超时 CHECK / 进程组不残留;⑫输出有界;⑬MCP 四工具、总数 46;⑭三镜像 + `-I` 生效;⑮**生产冒烟 4 条**(双闸关闭下跑);⑯生产端到端 + 两种关法各验一次
- **前置(三个都要齐)**:R-SKILLS(1.0)合并 `main`;画板 1f/1g 加第四组;spike 通过。**止损**:`tool_config_set skill_run false` 当场停;`skills_agent_set <name> false` 单个下线;`compose stop skill-runner` 后工具以固定文案失败、站点其余照常;spike 不过 → BLOCKED 回所有者重裁裁定 4,不自行退到共网

### R-WEBFETCH — agent 读访客指定的公网网页:`web-fetch` skill + egress 执行容器(建在 R-SKILLS-2 之上;所有者裁定 2026-09-03;2026-09-04 代码落地、待审查)

> 任务卡 [`rounds/round-webfetch/round-webfetch.md`](rounds/round-webfetch/round-webfetch.md)(§3 十条裁定、§4 八条默认、文末「本轮实测」);预研留档 [`study.md`](rounds/round-webfetch/study.md)
> (§3.1 请求链路与 §4 病态输入数据仍被引用)。代码在分支 `round-webfetch`。

**问题**:`web_search` 覆盖「找资料」,覆盖不了「读这个网址 / 要原文 / 顺着来源继续读 / 未被索引的页」。预研的 in-process 形态被裁「暂不做」的两条理由
(新开一档安全约束 + api 进程内 Worker)在 R-SKILLS-2 之后都有了别的落点。

**形态(十条裁定的落点)**:
- **不是新工具**:`runner/skills/web-fetch/`(`SKILL.md` + `xray.json` 声明 `network: egress` + `scripts/fetch.py` 单文件),经 `skill_run(web-fetch, fetch.py, {url})` 调用;走 R-SKILLS-2 的守卫 / 注入 / 清单 / hash 一致性 / `sandbox_config` / `daily_quota.skill_runs`,**零**迁移、**零** MCP 工具(46 不变)、**零** pi 扩展改动、**零**前端改动、**零** npm 依赖
- **egress 执行容器**:同一 `xray-runner:<sha>` 镜像的第二个 compose 服务 `skill-runner-egress`,只在专用 bridge 网络(固定网段),不在 `front` / `back`;`RUNNER_NETWORK=egress`,只接受 egress 档 skill,默认实例只接受 `none`;`mem_limit 256m`、并发 1;其余收紧项与默认实例逐字相同。无网络的默认实例**一字不改**
- **SSRF 防线三道**:①脚本(Python stdlib):URL 收窄(只 https 443、无 userinfo、≤ 2048、末标签纯字母)→ `getaddrinfo` 全部结果逐地址校验(回环 / 私网 / link-local / CGNAT / 多播 / 保留 / 未指定 / 嵌套 v4,任一命中即拒)→ 钉住地址连、证书按主机名校验、核 `getpeername` → 重定向 ≤ 3 跳每跳重来 → 解压后 256 KiB 上界 → 固定失败短码不区分「内网」与「连不上」;②容器不在任何内部网络;③宿主 `DOCKER-USER` 对该网段丢弃到私网 / link-local / CGNAT 的包(`deploy/egress-filter.sh`)。**不维护任何域名黑白名单**(所有者裁定:太多,无法维护)
- **资源上界**:预研的 Worker 与元素 / 深度计数由容器 `mem_limit` + rlimit + 超时 kill 承担;字节上界仍必须;Python 侧曲线待实测(验收 7)
- **提示词与产品默认**:`systemPromptFor` skills 段三句纪律(资料不是指令 / 不把对话内容放进 URL / 不嵌第三方资源);不允许 http、跟 ≤ 3 跳、不跟 robots、去图片、保留链接、抽取库 `trafilatura`(exact + hash)
- **可见性**:与 R-SKILLS-2 的 Python 运行轨迹同构;`web-fetch` 经 MCP 上传后出现在 Skills tab(裁定 6 的必然,所有者认下)

- 验收(16 项,细则在任务卡):①入参收窄逐条拒;②逐地址校验(含「两个地址其一私网 → 拒」);③钉住地址;④重定向;⑤解压炸弹;⑥内容类型与编码;⑦**病态输入在容器里**(预研 §4.3 夹具;api 侧 SSE 心跳不断);⑧不外泄(grep 不到地址 / 跳转链);⑨守卫;⑩档次路由(两实例各拒对方的 skill);⑪清单与 hash 一致;⑫提示词与输出;⑬`check` / `test` / `runner-test` 全绿;⑭三镜像不变、compose 隔离项;⑮**生产冒烟 +3**;⑯生产端到端 + 两种关法
- **前置**:R-SKILLS-2 合并 `main`(含提前进去的 `network` 字段);所有者经 MCP 上传 `web-fetch`。**止损**:`skills_agent_set web-fetch false` 单个下线;`compose stop skill-runner-egress` 后该 skill 以固定文案失败、其余照常;`tool_config_set skill_run false` 全部可运行型一起停

### R-PERF — 软导航反馈 + 详情页载荷瘦身 + 错误边界(命名轮;生产报障触发 2026-09-03;进行中)

> 任务卡 [`rounds/round-perf/round-perf.md`](rounds/round-perf/round-perf.md),
> 给画布的提示词 [`design-prompt.md`](rounds/round-perf/design-prompt.md)。
> **不是功能轮,是生产可用性修复轮**:所有者在真实使用中撞到,定位过程与基线数字全部写在任务卡「背景」段。

**问题(两个现象、一个根因)**:
- 「点了没反应」——`apps/web/app/` 下**没有任何 `loading.tsx`**,7 个 page 全 `force-dynamic`。
  App Router 的软导航在服务端 RSC 返回之前 UI 一动不动。实测点 `diagram` 卡片 **4.0 秒**界面完全静止;
  Notes 章节 0.1–3.4 秒(`stage-01-lecture` 49 KB 却要 3.35 s,是**服务端渲染耗时在抖**,不是载荷)。
- 「Application error 白屏」——只有 `/skills/ppt-master` 复现 React **#418**(hydration failed),且是间歇的。
  逐字节比对证明**不是服务端与客户端渲染结果不同**(SSR HTML 与水合后 DOM 113,498 字节完全一致),
  而是那一页 1.92 MB、分段到达,水合时文档没到齐 → 整页客户端重渲 → 偶发出岔即白屏。
- 根因同一个:`skills/[name]/page.tsx` 把整包**全部 markdown**(`ppt-master` 21 个 / 289 KB 原文)
  在服务端预渲染成 ReactNode,而页面只显示一个 —— 载荷 1.57 MB,且每次请求都要把 21 篇各过一遍
  remark + rehype-katex(耗时的大头)。

**三个任务**:
- **T1(零样式改动,可立即开工)**:只为 `initialPath` 预渲染;其余 markdown 切到时在客户端渲染
  (整包原文本来就在客户端,`copy` 与 `CodeView` 在用 —— **口径「切换文件不打后端」不变**)。
  为此把 `Markdown.tsx` 的标题 id **从渲染期计数改为 rehype 阶段一次性赋值**,与渲染次数解耦
  (顺带根治 dev StrictMode 下 id 漂移成 `xxx-1` 的隐患)。**硬约束:id 与今天逐字相同**,
  否则 Notes 正文里已有的 `[见](#锚点)` 会集体失效 —— 这条不许放宽,量不出零差异就回滚改窄口径。
- **T2**:`skills/[name]/loading.tsx` + `notes/[series]/[chapter]/loading.tsx`;> 300 ms 的路由才加。
- **T3**:`(site)/error.tsx`(带 `reset()` 重试)+ 404 文案(现在是 Next 默认英文页)。

- 验收(9 项,细则在任务卡):①`check`/`test` 全绿;②`ppt-master` RSC **< 500 KB**、`diagram` **< 200 KB**;
  ③**标题 id 零漂移**;④连开 5 次零 #418;⑤切文件零新请求、`?file=` 与两处 copy 行为不变;
  ⑥`git diff` 里没有样式属性改动、`2g`/`2h` 仍一字不差;⑦软导航 200 ms 内出现加载态且对照 `2i`/`2j`;
  ⑧人为抛错走 `2k` 而非默认白屏、重试可恢复;⑨发版后在生产复量 ②④⑦
- **前置(已满足)**:画板 `2i`/`2j`/`2k` 于 2026-09-03 由所有者画好、经 DesignSync 拉回 `design/`
  (`grep -c '^<'` 判据为 0,直接覆盖;`support.js` md5 两边一致未动),画板计数 15 → 18,
  `CLAUDE.md` 规则 8 与本文功能边界段已同步改数。**止损**:T1 是纯渲染时机改动,回退 = revert 单个提交;
  T2/T3 各自独立文件,删掉即回到今天的行为

### R-TOOLCARDS — 会话区工具调用卡:实时内联 + 跑完后折叠 + 落库回放(命名轮;所有者裁定 2026-09-03;代码已落地、审查中)

> 任务卡 [`rounds/round-toolcards/round-toolcards.md`](rounds/round-toolcards/round-toolcards.md),
> 给画布的提示词 [`design-prompt.md`](rounds/round-toolcards/design-prompt.md)。
> **不是新功能,是丢了的功能**:画板 `1a–1d` / `1f–1g` 一直画着两张工具卡,首版 `bdc1ca4` 实现过,R3 `88dc2ae`
> 切真实数据源时只映射了 `role` / `content`,`ToolChip` 留成死代码(头部第十次修订)。缺的两个态 `2l` / `2m` 先画、再开工。

**形态裁定(所有者 2026-09-03,按任务卡默认方案)**:
- 一轮仍是**一条**助手消息,`content` 语义与 `seq` 幂等键不动;`payload` 里加工具调用的**偏移表**
  (`at` = 工具开始执行时正文已累积的 JS 字符串长度,前端按它切段把卡片插回去),没有工具调用的一轮**不写 payload**
  —— 与今天的行完全一样,**无迁移**(`messages.payload` 从 001 起就留着);旧行不回填,3 天保留期自然清空
- 会话区**不从轨迹流派生**:`/agent/ask` 与 `/trace/stream` 是两条独立 SSE,跨连接没有顺序保证;一份数据(recorder)、
  两个消费者(实时帧 / 落库),实时与回放走同一条渲染路径 —— 「F5 之后 DOM 逐字节相同」靠的就是这个
- 折叠范围照 pi-web:最终回答之前的一切(中间的话 + 全部卡片)进折叠行;`session_rename` 的卡**默认不隐藏**(透明是卖点)
- 会话区**不显示**模型名 / provider 名 / 分段 token 与费用 / 「思考」块;两种预览一律 `previewText` 摘要,帧与库里都不带原始入参 / 出参
  (`docs/security.md` §2 R-TOOLCARDS 补记,先于代码)

**交付(五件)**:`agent/turn-recorder.ts` 纯函数(喂 pi 事件 → 帧 + payload;+ 测试)· `ask.ts` 的 `tool_start` / `tool_end` 帧与收尾帧的
`modelRoundTrips` / `turnMs` · `store.ts` / `sessions.ts` 带 payload 并经 `turnFromPayload` 白名单投影成 `ChatMessage.turn` ·
前端 `lib/turn-view.ts`(`splitTurn`,+ 测试)与 `Workbench` 的 `AssistantTurn` 三态 / `ToolCard` 展开体 / `FoldRow` 折叠行 · `docs/security.md` §2 补记。
**不交付**:迁移、新端点、新 MCP 工具、轨迹流 / 三视图改动、卡片 ↔ Timeline 互相定位(记 BACKLOG)。

- 验收(11 项,细则与结果在任务卡):①`check` / `test` 全绿、生成物 diff 只有 `ChatMessage.turn`;②实时三态对照 `1a` / `2l` / `2m`;
  ③F5 后会话区 DOM 逐字节相同;④无工具的一轮零变化、`payload IS NULL`;⑤旧行只显示正文;⑥脱敏与截断;⑦偏移正确;
  ⑧帧里没有配置面;⑨同一 seq 重复 upsert 幂等、`jsonb_typeof = object`;⑩样式零改动;⑪发版后生产复核
- **前置(已满足)**:画板 `2l` / `2m` 已并入 `design/`(18 → 20 块);R-PERF 已合并 `main`。**止损**:无迁移,回退 = revert;
  已写入的 `payload` 只是被忽略的 JSONB

### R-USAGE — 顶栏统计条的 tokens 与 ctx 接真实数据(命名轮;所有者裁定 2026-09-04;审查整改后 PASS;已合并 `main` 并发版 `09e7fd2`)

> 任务卡 [`rounds/round-usage/round-usage.md`](rounds/round-usage/round-usage.md)。
> 所有者看着生产页面问「右上角这个数据是不是金额是写死的」触发 —— 是:`tokens` / `cost` / `ctx` 三项从首版起
> 就是 `demo-data.ts` 里的三个常量(`12.4k tokens` / `$0.038` / `ctx 6%`),四项里只有 `events` 是真的(R4 起)。
> 这条已在 [`BACKLOG`](rounds/BACKLOG.md) 挂了很久(R8 遗留,「需要所有者裁定归属」),本轮由所有者当场裁定。

**三条裁定(所有者 2026-09-04)**:
- **不展示 cost**:第二项固定占位 `-`,**不接数据也不从统计条里删**;以后想加回来时再做动态的
  —— 那时是「换数据源」不是改结构。服务端连会话级的费用累计列都不建。
- **设计稿不改**:四项结构与画板 `1a` 完全一致,`-` 是值不是结构,规则 7 的「不得偏离对应画板」仍然满足。
  **本轮不碰 `design/`** —— 与 R-TOOLS / R-SKILLS / R-PERF 的「先改画板再开工」不同,因为这里根本没有结构变更。
- **tokens 取会话历史累计**,不是 pi 实例的累计:与并排的 `events` 同语义(都是从库里回放的会话尺度的数),
  且会话被空闲回收重建后实例内计数会归零、访客会看到数字突然变小。代价是加一列 + 一条迁移。

**与既有安全条文的冲突已按规则 9 处置**:`docs/security.md` §2 R-TOOLCARDS 补记原文写着收尾帧
「不带 model / provider / baseUrl / **token 数** / 费用」。本轮**先改文档**(§2 追加 R-USAGE 补记)再动代码:
放开的只有两个**聚合**值(会话累计 token、ctx 百分比),费用 / model / provider / baseUrl / `contextWindow` 绝对值 /
分轮次明细一律照旧不出。已认风险写在补记里:第一轮时 `totalTokens ÷ ctxPercent` 能粗略反推 contextWindow 量级。

**交付(六件)**:迁移 `014_session_tokens`(`sessions.total_tokens BIGINT`)· `store.ts` 的
`sessionTotalTokens` / `addSessionTokens`(BIGINT 一律 `::double precision` 读回)· `runtime.ts` 的
`RuntimeSession.totalTokens`(重建时从库续接,与 `maxTraceSeq` 同一处)· `ask.ts` 的 `usageFrame` 与
`finally` 里的累加落库 · `sessions.ts` 的 `SessionSummary.totalTokens` / `GetSessionResponse.ctxPercent` ·
前端 `lib/stats-bar.ts`(纯函数格式化 + 测试)与 `Workbench` 的统计条改用 state。
**不交付**:cost 的任何数据通路、设计稿改动、新端点 / 新 MCP 工具、按百分比给 ctx 点分档变色(新视觉语言)。

- 验收(10 项,细则与实测在任务卡):①`check` / `test` 全绿;②生成物 diff 只有两个新字段;③连问两轮单调增;
  ④F5 不回退;⑤ctx 随轮次增长、拿不到时显示 `-`;⑥cost 恒为 `-`;⑦帧里没有配置面;⑧样式零改动;
  ⑨迁移到 14、存量会话读回 0;⑩新会话无 NaN。**关键实测**:重启后端清空注册表 → 打开会话仍是 `4.1k` +
  `ctx -` → 再问一轮变 `7.9k`(4100 + 3800),证明重建时从库读了初值
- **止损**:迁移是纯加列带默认值,回退 = revert 代码(列留着不读即可)
- **codex 第 1 轮 4 条(1 P1 + 3 P2)全部采纳整改**:①`getSession` 手写返回类型漏了 `ctxPercent` → 生产
  `next build` TS2339(`dev.ps1 check` 只覆盖 api,查不到;**改服务端响应形状后要另跑 `npx tsc --noEmit`**);
  ②落库改为**先于收尾帧**,消除「看到数字更新就 F5 会读到旧值」的竞态;③切会话时清 usage;
  ④ctx 圆点无值压灰违反规则 7,**已整个撤回**、恒为画板的 `#16a34a`,诉求记 BACKLOG
- **第 2 轮 2 条 P2 亦全部采纳**:⑤`runtime.test.ts` 的夹具缺新必填字段;⑥`typeof === "number"` 拦不住
  `Infinity`(自定义端点报 `1e400`),流进长寿的 `rec.totalTokens` 后是永久污染 —— 三处改 `Number.isFinite`
  并补回归测试。**结论:2 轮 / 6 条 / 零 high,整改后 PASS**

### R-GSEARCH — `web_search` 接 Gemini 原生 Google Search grounding(命名轮;所有者 2026-09-07 要求「先验证、成立再扩展」;审查整改后 PASS;已合并 `main`,待发版)

> 任务卡 [`rounds/round-gsearch/round-gsearch.md`](rounds/round-gsearch/round-gsearch.md),探针留证 [`verify.md`](rounds/round-gsearch/verify.md)。
> 所有者给出一份「CPA 端点下 Antigravity Gemini 模型的 Google Search 发起机制」汇总(`tools:[{google_search:{}}]` 打
> `/v1/chat/completions` 触发服务端 grounding),要求验证成立后把本项目的 websearch 扩到支持 Google search。

**验证(2026-09-07,9 个探针 / 3 个模型)**:核心成立 —— 带 `{google_search:{}}` 时 gemini 模型给出真实日期 2026-09-07 与
`vertexaisearch.cloud.google.com/grounding-api-redirect/…` 签名重定向链接(模型编不出来),不带时停在 2024-05;流式与非流式都通。
两处与说法不同:`{type:"web_search"}` 打 chat/completions 是 **HTTP 200 静默忽略**(不是失败 / 拒答,比失败更糟);流式下 grounding
后端偶发无结果(3 次里 1 次,模型自述)。**对本项目的直接含义**:现行 `/v1/responses` + `web_search` 线对 gemini 模型拿不到 grounding
(换 modelId 没用),要接 Google search 必须开第二条线协议。

**方案(自行裁定)**:线协议由 `toolType` **唯一**决定(`google_search` → chat/completions,其余 → Responses),**不加 apiStyle 开关**
—— 对 gemini 模型,「端点 × 工具声明」能拼出的四种组合里只有一种通,一个字段就没有「配了却静默不联网」的组合。分叉只在拼请求体与读事件流两处,白名单 /
`redirect:"manual"` / 双计时器 / 字节上界 / 脱敏 / 日限额与 Responses 线共用同一段代码;六条外呼组约束一条不松。网关不透出 grounding
元数据,来源**只从正文的 markdown 链接**里抽(只收 http(s)、去重、封顶 10 条;**不扫裸 URL** —— codex 三轮各一条边界 findings 后按
「审查循环不是设计」改为只认边界确定的形态),与 `url_citation` 走同一个出口。规则 9 先改
`docs/security.md`(§1 R-GSEARCH 补记,含两条已认残余)再动代码;规则 13 同步 `docs/mcp.md`(工具总数仍 46)。

**交付**:迁移 `015_websearch_google`(CHECK 闭集扩一项 + 改 `tool_config.web_search` 的 note)· `websearch.ts` 的 `wireOf` /
`chatCompletionsUrl` / `buildSearchRequestBody` / `extractChatText` / `extractLinkCitations` 与 `runWebSearch` 分叉 · `mcp/tools.ts` 的
zod 闭集与说明 · 两处测试 · 两处文档。**不交付**:新工具 / 端点 / MCP 工具 / 前端改动 / 模型名白名单 / 「是否真的检索了」的二次判定。

- 验收 9 项(细则在任务卡):`check` / `test` 全绿(api 26 文件 549 用例 + web 21);E2E 直连真实网关 `gemini-3.8-flash-high`
  11.2 s / 4 条签名重定向来源、`gemini-pro-agent` 28.3 s / 5 条;Responses 线回归 `gpt-5.6-terra`(生产现行)行为不变;
  迁移从零应用通过;zod 与 CHECK 同一闭集;请求体 keys 恰为四个、query 只在 `messages[0].content`;凭据脱敏;前端零改动。
- **止损**:迁移只改 CHECK 与一行 note,回退 = revert 代码(CHECK 放宽了一项不影响既有行)。生产要用它 = 经 MCP
  `websearch_provider_upsert{toolType:"google_search", modelId:"gemini-3.8-flash-high"}`(可另起一个 provider 名,`websearch_set_default`
  切换;切回原 provider 即回滚,不用发版)。
- **codex 四轮共 4 条、全 P2、零 high,整改后 PASS**(前两轮全量,第 3 轮起 `--base` 只审整改 diff):
  第 1 轮 1 条(URL 内括号被当分隔符 → 允许一层配对括号);第 2 轮 2 条(裸 URL 终止集混进 ASCII `? : ,`,根因是源码里的
  「全角标点」实际是半角 → 显式转义;chat 流被干净关闭却无收尾信号仍当成功 → `finish_reason` / `[DONE]` 任一算收尾,缺了报失败);
  第 3 轮 1 条(裸 URL 紧跟 ASCII 逗号 + 中文被吞)—— **三轮全落在裸 URL 的边界判据上**,按「审查循环不是设计」不补第四条判据,
  **删掉裸 URL 扫描、只认 markdown 链接**(实测三个 gemini 模型给来源一律用它;自行裁定、可推翻);第 4 轮零 findings。
  收口门禁 `check` 过、`test` api 553 + web 21 全绿,最终代码在真实网关上复跑两档模型各 3 条来源。

## 轮次外事项

跨轮次发现的问题进 [`rounds/BACKLOG.md`](rounds/BACKLOG.md),不当场顺手改(CLAUDE.md 开发约定)。

### 修补记录(不成轮次)

| 日期 | 内容 | 处置 |
|---|---|---|
| 2026-09-01 | R9 部署后所有者在 130 上发现两处:① Runtime 聊天区把助手回复当纯文本渲染,模型给的 markdown 全糊成一段;② 站点没有图标文件,浏览器落兜底图标 | 合入 `main`(merge `4b572c1`,含提交 `1d42a91` / `bcc39d6`)。**所有者裁定不走 codex 审查**。130 预发已由 `dbf61ce` 升级到 `4b572c1`(无新迁移,`migrate.sh --status` 停在版本 6),两处修复与三 Tab / 七服务端点 / RSS 均实测正常,流式渲染在 130 上实跑确认 |
| 2026-09-01 | R-VISITOR 合并后 130 预发升级:`5c98b3e` → `7cc17fe`,迁移 `6 → 7`(007 访客隔离) | 按「先停 api/web、再 `migrate.sh`、后 `up -d`」顺序升级。8 项冒烟全过(留证在[任务卡](rounds/round-visitor/round-visitor.md#130-预发部署留证2026-09-01));**本机验不了的「新建会话首帧带 Set-Cookie」在这里验掉**。存量 12 条冒烟会话迁移后归属为 NULL、对所有访客不可见,由 3 天保留期清掉 |
| 2026-09-01 | 所有者继续提两处:① 导航条没有 logo;② 右侧 Timeline 不跟随滚动,新事件到了还要手动划 | 合入 `main`(merge `5c98b3e`,含提交 `0f0325b`)。**所有者裁定不走 codex 审查**。logo 按 Pulse X 定稿的导航条实测图实现(44px / mark 20px / gap 9px / accent 明暗两态),`components/XrayMark.tsx` 与 `app/icon.svg` 是同一图形的两份载体、改图形要一起改。Timeline 改为**贴底才跟随**:上翻查看历史时不被新事件拽回,滚回底部自动恢复。130 已升到 `5c98b3e`,三种行为(跟随 / 上翻不被拽 / 回底恢复)在真实事件流下逐项实测 |
| 2026-09-02 | Notes 正文里的数学公式原样漏出 `$…$`,且公式内的 `_` 被 markdown 当强调吃掉 | `b291eb1`:渲染器接 remark-math + rehype-katex(服务端编译,`trust:false`,katex.css 同源自托管),并按 Pandoc 美元规则挡住散文里的货币金额(本地 226 篇全量跑过:3 处金额拦下、162 个真公式全过)。随 R-IMAGEGEN 一起上生产,见 [`docs/releases.md`](docs/releases.md) |
| 2026-09-02 | ① Timeline 进行中行整行明暗脉动没有方向感,长工具调用看着像卡住;② 生成期间发送按钮仍可点 | `9dd0c89`:进行中行改成自左向右的波浪扫光(只动 `background-position`,合成器属性),发送按钮生成期间转圈禁用、输入框不禁用;两份画板同步(规则 7/8) |
| 2026-09-02 | 文章页顶端阅读进度线永远停在 31%(照抄了画板 2c 定格的那一帧) | `d2a87d0`:新增 `ReadingProgress.tsx` 接真实滚动(`transform: scaleX` + rAF 合帧写 ref,找最近可滚动祖先),样式一字未动;画板加注释说明 31% 是示意。与上一条一起以 `d2a87d0` 上生产,见 [`docs/releases.md`](docs/releases.md) |
