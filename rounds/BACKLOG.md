# Backlog

跨轮次发现的问题与想法都记这里,不当场顺手改;新功能类条目须经所有者裁定才可进轮次。
格式:`- [ ] <发现轮次> <一句话> (发现日期)`

## 工程

- [ ] R-MOBILE-2 **移动端首页(Runtime)不显示备案号**:所有者 2026-09-10 裁定把 ICP 与公安联网备案两号从屏底搬进 About 页尾(屏底那 26px 会把 Tab Bar 顶离屏幕底缘、收起时还剩残条)。
      备案抽查通常看**首页底部**,而移动端首页是 Runtime、自身不滚动、没有页尾。**所有者已认此风险**(桌面底栏照旧、移动 About 里有)。
      更稳的变体是 **C2:Notes / Skills 首页页尾也各挂一条**(三处版式都要定,故本轮未圈)。要上就得先定版式 (2026-09-10)
- [ ] R-MOBILE-2 **C1:一级页彻底不出功能条**(任何滚动位置都不出,动作按钮随内容滚走)。本轮圈的是 1-A(到顶不出、滚过大标题淡入 + 收起标题),
      C1 更省空间但失去「回到顶部」的锚点条与 iOS 惯例。所有者当时未圈 (2026-09-10)
- [ ] R-MOBILE-2 **移动端一级页的大标题文案与画板不一致**:画板 `4k` / `4o` / `5c` 的大标题是「Notes」「Skills」,实现里是桌面那份
      「Notes · 研习笔记」「Skills · 技能库」(`.m-h1` 只改字号字重、不改文案,首版 R-MOBILE 就是这样)。本轮新增的**收起标题按画板取短名**
      (条里是「Notes」),于是同一页出现「长标题收起成短标题」——iOS 的惯例本就如此,不算错,但两者不同源。
      要统一得让页面给移动端另出一份短标题(结构性改动,规则 7 要理由),按「跨轮次发现的问题不当场顺手改」记这里 (2026-09-10)
- [ ] R-MOBILE-2 **移动端 Skills / Notes 首页的收起标题只在一级页做**:二级页(章节页 / Skill 详情)条里放的是返回 + 章序,画板没画「二级页也收起标题」。
      要统一得先扩画板 (2026-09-10)
- [ ] R-CARDS codex 第 2 轮一条 P2 **不采纳**:「移动端 `table` 应固定 480 内容宽、列宽不随视口变」。画板 4y 的 480 = 那张四列示例表(180/110/70/120)的内容宽,不是给任意列数的表定的规则;实现按画板的**规则句**做 —— 单元格 nowrap、表在卡内盒子里横滚、页面不横滚,表比卡窄时按 2c 表格的既有约定 `width:100%` 填满卡(否则表头灰底只到表尾、卡内右侧留白)。要「列宽绝对不随视口变」得把表改成内容定宽 + 不填满卡,那是新的视觉规则,要所有者裁定 (2026-09-09)
- [ ] R-CARDS 顺带发现的**既有**链接口径漏洞:`components/Markdown.tsx` 的 `a` 只做 react-markdown 默认的 `urlTransform`(挡协议),而 WHATWG URL 对 http(s) 把反斜杠当正斜杠 —— 正文里 `[x](/\evil.com)` 渲染出的 `href` 解析后是 `https://evil.com/`,与 `//evil.com` 同一类协议相对地址,却没有 `//` 那么显眼。Notes 正文由所有者经 MCP 写、风险低;**会话区的助手正文是模型写的**(威胁 9 的同族:第三方地址进对话框),值得补一道「以 `/` 开头的 href 解析后须仍在本源」的判断(`lib/xray-card.ts` 的 `cardHref` 已按这个口径做,可直接复用)。既有、与 R-CARDS 无关,按规矩不当场改 (2026-09-09)
- [ ] R-CARDS **pi 在 `systemPromptOverride` 的返回值之后还会追加自己的 `<project_context>`**(从 cwd 向上找到的 `AGENTS.md` 正文 + 一行「Current working directory: …」)。本机 `encore run` / `encore test` 的 cwd 是 `apps/api`,于是仓库根 `AGENTS.md`(给 codex 审查者的指针文件)整段进了发给 provider 的系统提示;`runtime.ts` 的 `ISOLATED_DIR` 只把 extensions / skills / settings 指向空目录,没有拦住 AGENTS.md 的向上查找。生产容器里 cwd 下应无 AGENTS.md、这段应为空,**未实测核实**。既有行为、与 R-CARDS 无关(`cards-e2e.test.ts` 因此不能断言「卡片段是最后一段」),按「跨轮次发现的问题不当场顺手改」记这里 (2026-09-09)
- [ ] R-CARDS 移动端 `compare` 堆叠与 `stat` 两列**按卡内宽判、用 CSS 容器查询**(`@container (max-width: 479px)`,画板 4y 的规则边界是卡宽不是视口)。不支持容器查询的老 webview(Chromium < 105 / iOS < 16)会退化成桌面三列版式挤在 358 宽里(不横滚、每格折行);所有者裁定「按普通 H5 做、不为微信单独优化」,故不加 `useIsMobile` 分流(那是第二套判据)。要兼容老内核时再裁定 (2026-09-09)
- [ ] R-CARDS 本机验收踩到:**编辑 `apps/api` 下任何文件(含测试文件)都会让 `encore run` 热重载**,在途的 `/agent/ask` SSE 被掐断、那一轮既无助手消息也无轨迹落库,前端停在「生成中」。浏览器验收期间别改 api 侧文件;真要改就重发那一轮。不是缺陷,是 dev 环境事实,记这里免得下次再查一遍 (2026-09-09)
- [ ] R-MOBILE **既有:`/skills/[name]` 在本机 dev 下卡在加载骨架不散**。表现:服务端 200(309ms)、`getSkill` 也 ok,页面真实内容**已经渲染进 DOM**,但 React 把它留在一个 `display:none` 的子树里、可见的始终是 `loading.tsx` 的骨架(「正在取…」),等 20s 不解。**已确证与 R-MOBILE 无关**:①把 `SkillDetail.tsx` 的改动 stash 掉后复现;②桌面宽度(1280)下复现;③**把 `apps/web` 整个 `git checkout main --` 还原成 main 版之后,`/notes/pi/01` 同样卡在骨架**(桌面导航条已渲染,确认是 main 版)—— 这条是决定性的,挂起是 main 上就有的。疑与 R-PERF 的详情页预渲染 + Suspense 边界在 dev 下的交互有关(R-PERF 任务卡里 `ppt-master` 白屏 + React #418 可能是同一族)。本轮为验证 4p/4q 版式,用 JS 临时把那棵隐藏子树显出来测量,量到的值全部正确。**需确认生产是否同样**,若是则是真 bug (2026-09-07)
- [ ] R-MOBILE **既有缺陷:全站 ghost 按钮字号是 14 不是设计稿的 12**。`components/ui.tsx` 的 `GhostButton` style 对象里 `font: "inherit"` 写在 `fontSize: 12` **之后**,简写把长写冲掉 —— 浏览器实测:`{fontSize:12, font:"inherit"}` → 14px,反过来 → 12px;线上真实按钮(32 高 r7)取到 `fontSize: 14px`。影响面是**所有** GhostButton(Notes RSS / Sessions 刷新 / Skills 两枚 / 上下章 …),属设计稿保真度问题,不是功能缺陷。**本轮不顺手改**:它是桌面既有渲染,一改就是全站按钮视觉变化,该由所有者确认「按设计稿收到 12」还是「就认现在的 14」。同类简写覆盖在本轮新写的 `SegmentedControl` 上出现过一次、已修 (2026-09-07)
- [ ] R-MOBILE 各页 `generateMetadata`(浏览器标签 / 分享标题现在全站都是 "Agent X-Ray")。原本作为微信导航栏标题的配套项列进 R-MOBILE,所有者 2026-09-07 裁定「不为微信单独优化」后从本轮移出;它对普通 H5 仍有价值(标签页、书签、分享),待裁定 (2026-09-07)
- [ ] R-MOBILE 移动端 SSE 断线重连:切后台再回前台当前只会掉进 `onError` 兜底文案。属新机制,所有者裁定本轮不做 (2026-09-07)
- [ ] R-SOURCE **移动端的 Source tab 与页面**(所有者裁定 2026-09-08 第 7 条「先桌面」):Tab Bar 第五格(iOS 五格上限,要重画 `4a`–`4u` 的 Tab Bar)+ `4v` 起的画板(首页 / 文件 / 文件树 Sheet,可照 `4o`–`4q` 的形态)。桌面轮里移动 Tab Bar 按 `desktopOnly` 把 `source` 过滤掉,`/source*` 在窄视口按桌面版式渲染。agent 的三个 `source_*` 工具与视口无关,移动端已可用 (2026-09-08)

- [ ] R-WEBSEARCH **门禁不做全量类型检查**:`dev.ps1 check`(`encore check`)与 `dev.ps1 test`(`bun --bun vitest`)都不跑 `tsc --noEmit`。R-WEBSEARCH 复审第 1 轮实测:两者全绿而 `tsc --noEmit` 报两条 TS2367(闭包赋值不参与 narrowing)。**不是构建阻塞**(Encore 自己的构建不跑 tsc),但意味着类型错误只能靠 IDE 或人工发现。修法是给 `dev.ps1` 加一个 typecheck 入口或并进 test —— 属新增机制,不在本轮整改范围,记此待所有者裁定 (2026-09-02)
- [ ] R0 CI(GitHub Actions:web build + api check)——未在任何轮次内,需要时由所有者决定加在哪轮 (2026-08-28)
- [ ] R0 encore CLI 有更新 v1.57.13 → v1.58.4;升级前先确认对 ticketBookingB2B 项目无影响(同机共用 daemon) (2026-08-28)
- [x] R11 `docs/deploy-cn-lightweight.md` §3 部署/升级命令写的是服务器上 `docker compose build`,与 CLAUDE.md 规则 10「本机构建后传输」冲突——已在 R-BUN 改为不可变镜像流程(`dev.ps1 build` + save/load + `IMAGE_TAG` 强制 git SHA) (2026-08-28)
- [ ] R-BUN **Encore 上游缺陷,建议提 issue**:开启 `bun-runtime` 实验位后 `encore build docker` 把 ENTRYPOINT 改成 `bun run …`,基座却仍用默认 `node:slim`,产出的镜像里没有 bun,`docker run` 直接 `exec: "bun": executable file not found in $PATH`。当前靠 `dev.ps1 build` 固化 `--base oven/bun:1.4.0-slim` 绕过;上游修好后可简化 (2026-08-29)
- [x] R-BUN Encore 自托管镜像不执行数据库迁移(运行时无迁移逻辑,`encore db` 也无 migrate 子命令),空库直起则 `/health` 200 但触库端点 500——所有者裁定方案一,已落地 `deploy/migrate.sh`(SQL 取自被部署镜像、`schema_migrations` 与 Encore 同构、单事务、幂等),130 完整 compose 形态实测通过 (2026-08-29)
- [ ] R-BUN `deploy/migrate.sh` 目前硬编码只认 `agent` 库,遇到别的库名报错停下(不猜)。将来若新增数据库需扩该脚本;含 `CONCURRENTLY` 的迁移会被主动拒绝,该路径尚未实测 (2026-08-29)
- [x] R-BUN 生产镜像形态下的 **SSE 冒烟无法演练**:两条 SSE 只在 spike 里而 spike 已被 `--services` 排除,正式 `/agent/ask`、`/trace/stream` 要等 R3/R4——两条正式端点已分别在 R3/R4 落地,R9 可以按原计划补冒烟 (2026-08-29)
- [x] R-BUN `dev.ps1 build` 的 `--services` 白名单是维护热点(R4 补 `trace`、R5 补 `notes`、R6 补 `mcp`、R8 补 `metrics`/`about`):漏补表现为该服务端点静默 404。**R9 已把「七个服务各取一个正式端点、全部非 404」写进 `docs/deploy-environments.md` 冒烟清单第 1 条,并在 130 上逐项跑过**;仍不引入自动服务发现 (2026-08-29)
- [ ] R-BUN Next dev proxy 对**未百分号编码**的中文 query 返回 400,直连 Encore 同样请求返回 200。浏览器会自动编码故对真实用户影响小,但手写 URL 的脚本/测试会踩 (2026-08-29)
- [x] R-BUN **上线前必做(架构评审 P1-4)**:`apps/web/app/layout.tsx` 从 `fonts.googleapis.com` 加载 JetBrains Mono,是渲染阻塞样式表,境内首访会挂在字体请求超时上(数秒白屏)——**所有者裁定放 R9,已落地**:改 `next/font/local` 自托管 JetBrains Mono 变量字体的 latin 子集(40.4 KB,`apps/web/app/fonts/`),130 线上实测页面零外部请求、字体由 `/_next/static/media/*.woff2` 供。原条目里「记得补 `COPY … /app/public ./public`」正好说反了:R6 把配图搬进 Postgres、删掉 public/ 之后,**那行让 web 镜像构建直接失败**,R9 把它删了(自托管字体走 `.next/static/media`,不经 public/) (2026-08-29)
- [ ] R-BUN `next build` 仍以 node 执行(web Dockerfile 的 builder 阶段装 node/npm);runner 阶段已是纯 bun。若要连构建期也去掉 node,需单独验证 Next 构建器在 bun 下的行为 (2026-08-29)
- [ ] R3 pi SDK **把 provider 失败吞在内部**:key 无效时 `session.prompt()` 正常 resolve,助手消息以 `stopReason:"error"` + 空正文收尾(实测 DeepSeek 401)。`/agent/ask` 已改判据为助手 `message_end` 的 stopReason;若上游改语义需同步。值得向 pi 反馈「provider 错误应有显式事件」 (2026-08-31)
- [ ] R3 `encore gen client` 产物里的 `Environment()` 域名 slug 随**生成所在目录**变化(主 checkout `936eu` / worktree `r5ugg`),在不同 checkout 重跑 `dev.ps1 gen` 会来回翻。该函数当前无人调用(前端 base 固定 `/api`),仅是 diff 噪音;`encore.app` 的 `id` 补成固定值即可消除,需所有者确认 app id (2026-08-31)
- [x] R3 R4 落地 trace 服务时,`apps/api/spike/` 整体移除;`agent/events.ts`(sanitize + 34 事件清单)已在 R3 迁入 agent 服务,届时按需再决定是否移到 trace 服务——**R4 已做**:spike 整目录删除;events.ts 留在 agent(采集点在那里),只把凭据脱敏原语下沉到 `shared/redact.ts` 供 trace 共用 (2026-08-31)
- [ ] R3 **进程内拿不到 SSE 客户端断开信号**(codex review P2 整改中实测,已放弃在 R3 修):
      `req` 的 close 在请求体读完后 2ms 就触发(据此 abort 会掐掉每一轮);改成常规正解
      `resp.on("close")` + `writableFinished` 后,4 秒掐断客户端,resp close 直到 t=+9763ms
      (本端 `resp.end()` 之后)才触发且 `writableFinished=true`;`req.socket`/`resp.socket`
      全程无 close/error、`destroyed` 恒为 false。原因是 Encore 网关代理:外部连接断开不
      传导到 JS 运行时拿到的 req/res/socket(encore 1.57.13 + bun)。影响:访客关页面后本轮
      仍会跑完(数秒 token),会话随即释放。
      **R9 已在 Caddy + 自托管镜像的真实拓扑下复测:仍然拿不到断开信号**(`kill -9` 掉
      8 条 SSE 客户端后名额一个都不释放,第 9 条仍 429;见 `rounds/round-09/smoke.md` §4)。
      加一层反代不改变结论,下一步只剩「心跳写失败探测」或向 Encore 上游提 issue (2026-08-31)
- [x] R6(MCP 管理服务,原 R7 职责)`llm_config` 加密入库落地后,收敛 `.env` 引导键 `DEEPSEEK_API_KEY` 的职责——**所有者 2026-08-31 裁定:彻底移除**。secret 声明、`deploy/infra-config.json` 的 secrets 段、compose 的 `DEEPSEEK_API_KEY` 三处已删;运行期 LLM 凭据唯一来源是 `llm_config`,未配置时 `/agent/ask` 回 503。代价(新环境首次部署后必须先经 MCP 写 provider)已写进 docs/deploy-environments.md 第 5 步 (2026-08-31)
- [x] R5 `tools/notes-sync` 没有自动化测试。它在 Encore app root 之外,跑不进 `dev.ps1 test` 的门禁;给它单配一个 vitest 又会多出一个「没人会跑」的入口。最该覆盖的是 `obsidian.ts` 的改写器(围栏/行内代码免疫、注释跨行、图片括号配平),本轮这 8 个用例是手工验证的,记录在 round-05 任务卡里——**2026-08-31 所有者裁定废除 R5 管道机制(内容发布改走 MCP,R6 删除该工具),本条随之关闭** (2026-08-31)
- [x] R5 改写器漏掉「标签里含行内代码」的相对链接:``[`truncate.ts`](repo/packages/…)`` 这种写法会被片段切分拆成 `[` / 代码段 / `](dest)` 三段,链接改写器看不到完整结构,于是原样留下一个会 404 的相对链接。实测剩 6 处(pi/08、pi/09,全指向被拆解仓库的源码路径)——**2026-08-31 所有者裁定:改写器随管道废除退役(MCP 入参即标准 markdown,只校验不改写),本条关闭;存量 6 处 404 链接若需修,经 MCP 直接改正文** (2026-08-31)
- [ ] R5 **vault 正文里 196 处「一行文本紧跟 `---` 且无空行」**(99 个文件),CommonMark 与 Obsidian 都会把这段文本渲染成 H2 标题:段落以大标题显示,且该章之后的「本章目录」锚点整体错位(实测 11 章受影响)。**所有者 2026-08-31 裁定:从 vault 源头解决(另开仓库写标准 markdown),不在同步管线上做容错**。codex 第 3 轮把它报为 P2 (2026-08-31)
- [x] R2 adversarial review 遗留:R3 正式 `/agent/ask` 需为助手消息持久化设计显式失败协议与幂等重试(turn 级去重键 / outbox)——R3 已落地:去重键复用 `UNIQUE(session_id, seq)`(助手 seq = 用户消息 seq + 1,`store.upsertMessage` 幂等 upsert + 角色护栏),写失败重试 3 次仍不成则以固定文案的 SSE `error` 收尾;未引入 outbox 表(不需要) (2026-08-28)
- [x] R2 复审遗留:R3 正式 `/agent/ask` 的 SSE error 消息需统一脱敏口径——R3 已落地:SSE 只出固定文案(`模型调用失败…` / `本轮回复未能保存…`),provider 与数据库原文只进服务端日志且过 `previewText` 脱敏。spike 的 `/spike/ask` 保持原样,R4 随 spike 整体移除 (2026-08-28)
- [x] R1 脱敏自测 fixtures(`spike/events.ts` `runSanitizeSelfTests`,6 组凭据/超大对象用例)在 R2 测试基建落地后转正式 encore test——已落地 `apps/api/agent/events.test.ts`(R2 建立,R3 随 events.ts 迁入 agent);R4 复核后**留在 agent**——采集点在 agent,trace 只读不采集 (2026-08-28)
- [ ] R4 **SSE 连接的名额只能靠超时回收**:客户端断开探测不到(R3 POST / R4 GET 两次实测),
      被遗弃的 `/trace/stream` 连接会占着名额直到 `MAX_STREAM_MS`(5min)。当前靠「同 clientId
      让位 + 单会话 8 / 全站 64 上限」把影响压住,但关掉标签页的访客仍会留一个名额 5 分钟。
      **R9 已复测(真实拓扑),断开仍探测不到 —— 这两条限制不放宽、让位机制不退役**
      (证据见 `rounds/round-09/smoke.md` §4「断连信号复测」) (2026-08-31)
- [ ] R4 Timeline 的行时长是「本行首个事件 → 下一行首个事件」的间隔,不是事件自身的处理耗时——
      pi 的扩展事件只带一个时间戳,进程内拿不到真实耗时。当前口径对瀑布图是合理近似,
      若将来要显示真实耗时,需要在观测者里对成对事件(start/end)做配对计时 (2026-08-31)
- [ ] R4 **轨迹流的观众标识在「复制标签页」下会撞车**(codex 复审 P2):浏览器复制标签页会连
      `sessionStorage` 一起复制,两个标签页共用同一个 `clientId`,后开的那个会把先前那个让位掉,
      先前那个收到 `superseded` 后停更(刷新或切会话可恢复)。改成「每次页面加载换新 id」能避开
      复制标签页,但会把代价换成更常见的刷新——每刷一次漏一个名额到 5min 超时。两头都占住需要
      「连接代次」这类协议字段,属机制类改动,按缺陷门禁规则不在非阻塞 findings 的整改范围。
      **R9 已重估:真实拓扑下断开仍探测不到,让位机制退役不了,本条继续挂着** (2026-08-31)
- [ ] R4 **快速切会话仍有一个窄窗口能让位错人**(codex 复审 P2 的残留):占名额已提到第一个
      `await` 之前,占槽顺序 = 请求到达顺序,消除了"谁的库查询先返回谁先占槽"这个主因;
      但若网络把两个请求的到达顺序也调换了(B 后于 C 到达),仍会由已经没人读的 B 把 C 让位掉。
      彻底解决同样需要「连接代次」;**R9 已随上一条重估,结论相同(断开探测不到,机制留着)** (2026-08-31)
- [ ] R4 单会话轨迹超过 `MAX_REPLAY_EVENTS`(5000)时,回放只给最新 5000 条,Timeline 的
      Turn 1 会从中间截断。长会话尚无「按 turn 分页往回翻」的设计,设计稿也没有这个功能;
      需要时进功能提案 (2026-08-31)

- [x] R6 **改 baseUrl / 换默认模型不会到达「已在内存里」的会话** —— **已在 R6 内解决,本条关闭**。
      当时的判断是「要不要让进行中的对话中途换端点/模型是产品取舍」,于是先记 BACKLOG。
      但随后两轮 codex review 表明这不是一个可以搁置的取舍:只让新会话跟上配置,会持续长出
      撤销类漏洞(删掉非默认 provider 后它的会话继续跑;同名重建 provider 后新 key 被发往旧端点)。
      最终收敛成一条统一规则:**配置指纹变了,会话在下一轮被重建到新配置上**(走空闲回收
      同一条重建路径,库内历史照常注入,访客无感);新配置解析不出模型时既有会话原地不动。
      代价是换默认模型也会作用于进行中的对话 —— 比原先的「有漏洞但不换模型」更好解释 (2026-08-31)
- [ ] R6 **会话重建与配置写入之间有一个极窄的竞态**(codex 第 5 轮 P2,写明理由放行)。
      热路径确认新配置可用(`resolveModel` 通过)之后才 dispose 旧会话,但 `createRuntimeSession`
      会在冷启动串行链里**重新读一次**配置;若恰好在这两步之间所有者又写入了一个解析不出模型的
      配置,旧会话已经没了、新会话建不起来,那一轮回 503 —— 与「新配置无效时既有会话原地不动」
      的承诺相抵。
      **为什么不在本轮修**:①代价有界且不丢东西 —— 消息早已落库、`disposeSession` 会先排干
      轨迹再释放,访客下一轮(所有者改回可用模型后)照常继续;②触发条件是「一次无效的管理写入
      恰好落在毫秒级窗口里」,而那个无效写入本身就会让**所有**新会话 503,多这一个会话不改变
      处境;③真正的修法是「先建新的、再拆旧的」,而那会动到 `disposing` 映射与 seq 续接那套
      保护(它们是前几轮 P1 的整改产物)—— 属机制类改动,按 CLAUDE.md 不在非阻塞 findings 的
      整改范围。若将来要动 `acquireSession` 的重建顺序,连这条一起重估 (2026-08-31)
- [ ] R6 `apps/web/lib/api-client.ts` 里的 Encore 应用 slug(如 `gbf6c` / `k2yas`)随**生成它的 checkout**
      变化:`encore.app` 的 `id` 为空,本地 app 由 cwd 定位并分配随机 slug。只出现在 `Environment()` /
      `PreviewEnv()` / User-Agent 三处,本项目自托管不用 Encore Cloud,功能无影响,但每次换 worktree
      重新 `dev.ps1 gen` 都产生噪音 diff。给 `encore.app` 定一个固定 `id` 能消掉,但那会影响 daemon 的
      本地 app 登记(与规则 1 的同机共用 daemon 有关),不顺手改 (2026-08-31)

- [ ] R-WEBFETCH **api 侧测试文件过不了 `npx tsc --noEmit`**(3 处):`agent/catalog.test.ts:214` 用
      `RunnerTarget.socketPath`(联合类型的 tcp 分支上没有这个属性)、`agent/skill-runner.test.ts:368/369`
      对 `string | Error` 取 `.message`。**不影响任何构建**:`encore test` 走 vitest + esbuild(transpile-only),
      api 也没有把 tsc 放进构建链。是 R-USAGE 为查一条 P1 顺手跑 tsc 时发现的,跨轮次不当场改 (2026-09-04)

- [ ] R-USAGE **顶栏 ctx 圆点在「拿不到值」时是否该压灰**(`Workbench.tsx` 统计条,现为恒绿 `#16a34a`)。
      本轮曾把无值态改成 `var(--text-dim)`,理由是 `ctx -` 配一个绿点等于在「不知道」的时候声称「正常」;
      codex 第 1 轮 P2 判定违反规则 7(画板 1a 只画过有值的常绿态),已整个撤回。
      要做的话正确顺序是**先在画板上画出这个态**再改代码(R-TOOLS / R-PERF 的先例),不是在轮次里顺手改。
      按百分比分档变色(黄 / 红)更不做 —— 那是新视觉语言 (2026-09-04)

- [x] ~~R8 **顶栏统计条的 tokens / cost / ctx 仍是 demo 值**(`apps/web/lib/demo-data.ts` 的 `statsBar`)。~~
      ~~需要所有者裁定归属:计量数据在 R7 的配额计数里已经有了,缺的是一条把它带到前端的通路~~ (2026-09-01)
      → **R-USAGE 已做**(2026-09-04):所有者当场裁定「不展示 cost、tokens 与 ctx 要实时」。
      tokens 走新增的 `sessions.total_tokens`(会话历史累计,回收重建后不回退),ctx 走 pi 的
      `getContextUsage().percent`,两条通路 = 收尾帧 + `GET /agent/sessions/:id`;cost 固定占位 `-`,
      不接数据也不删这一项。见 `rounds/round-usage/round-usage.md` 与 `docs/security.md` §2 R-USAGE 补记
- [ ] R8 `visits` 表没有保留期与清理。计数行结构让它长得很慢(天数 × 站内路径数 × 当日访客数),
      个人站量级下多年都不成问题,所以本轮不引入定时清理(那是新机制)。将来若要加保留期,
      一条 `DELETE FROM visits WHERE day < …` 的定时任务即可,注意它会改变历史趋势的可查范围 (2026-09-01)

- [ ] R8 **`apps/api/mcp/audit.ts` 的 `remoteOf` 取的是 `X-Forwarded-For` 的第一段**,而 Caddy 的
      `reverse_proxy` 是**追加**不是覆盖 —— 带 token 的调用方自己塞一个 XFF 就能左右审计里记的来源
      地址。R8 已把 metrics 侧改成取最后一段(codex 第 1 轮 P1),但没顺手改 audit(跨轮次问题不当场
      改,CLAUDE.md 开发约定)。影响有界:管理面只有一个使用者、认证不依赖这个头,它只是审计线索;
      但「审计里的来源地址可被写入方伪造」这件事本身值得修。改动是一行,连同 `server.ts` 的
      `remoteOfRequest` 一起(两处同样的逻辑)。
      **R9 在 130 实测补一个重要前提**:经 Caddy 2.11.4 时伪造**打不进来** —— 未配
      `trusted_proxies` 的 Caddy 会用真实对端 IP **覆盖**(而非追加)不可信的 XFF,审计里记的是
      `172.20.0.1`;而从 caddy 容器里绕过反代直连 `api:4000` 时,伪造值 `203.0.113.77` 原样进了
      审计表。即**代码层缺陷属实,当前部署形态下被 Caddy 挡住**,所以不紧急;但**一旦 Caddy 前面
      再加一层代理、或给 Caddy 配了 `trusted_proxies`,这层保护就没了** —— 修的时候把这个前提
      一起写进注释 (2026-09-01)
  → **2026-09-02 提级理由**:所有者裁定 `/api/mcp` 的 IP 白名单**暂不启用、只靠 token**(R11 交接项②),
    于是生产管理面的来源可信度就只剩 Caddy 这一道覆盖。本条从「不紧急」变成「上线后值得优先清掉的一行改动」
    (`audit.ts` 的 `remoteOf` 与 `server.ts` 的 `remoteOfRequest` 两处同样的逻辑,改取 XFF 最后一段)

- [ ] R9 **About 头像是页面上仅存的跨境资源**:前端按 `https://github.com/<githubUser>.png` 拼头像地址,
      130 上实测加载不出(浏览器显示 alt 文本)。字体那条修完之后,这是同一类「境内首访外部依赖」的
      最后一处。选项:①经 MCP 传一张附件当头像(复用 `notes_assets` 供图链路)②服务端代理并缓存
      ③保持现状,但让加载失败时不留破图框。属新增接口面/机制,需所有者裁定 (2026-09-01)
- [ ] R9 **优雅停机时在线的 SSE 收不到 `bye` 帧**:`docker compose stop api` 期间流仍在心跳,
      直到容器真正停止才在 TCP 层被切断(实测客户端 curl 退出码 18 —— 是明确断流不是静默挂起,
      浏览器 `EventSource` 会自动重连)。但服务端本可以在关闭钩子里给在线的流补一帧
      `bye{lastSeq, reason:"shutdown"}`,让客户端拿着 `lastSeq` 精确续连而不是从头猜。
      属机制类改动(要在 Encore 的 shutdown hook 里遍历 liveSlots),不在缺陷门禁范围 (2026-09-01)
- [x] R9 **130 预发上的样本内容要在真实内容到位后清掉** —— **notes 部分已完成**(2026-09-01):
      所有者按 `docs/notes-content-spec.md` 处理完内容后重新交付,校验 0 错 0 警,经 MCP 发布
      **13 系列 / 205 章节 / 103 张 WebP 配图**(用时 22s,零失败),冒烟占位系列已
      `notes_series_delete r9-smoke cascade=true` 删除。**About 仍是 R9 写的样本内容**,
      等所有者给真实文案后重写 `about_set` (2026-09-01)
      → **2026-09-02 R11**:生产的 notes 与 About 由 130 的库整体拷过来(pg_dump 五张内容表,
        4 分类 / 13 系列 / 205 章节 / 103 配图 / 1 条 About)。**顺带发现并当场修掉一处**:
        About 的 intro 结尾写着「这里是 130 预发环境,内容为 R9 部署验收的样本」——
        那句话跟着拷进了**公开的生产站**,已删(`about_set` 只改 intro 一个字段)。
        **其余仍是 R9 样本**:`repos` 只有一张 agent-xray 卡、`langBar` 四项占比、`originUrl` 为空,
        都等所有者给真实内容。本条继续挂着
- [ ] R9 **153/205 篇正文首行的一级标题与 `title` 重复**:文章页已经把 `title` 渲染成页面大标题,
      正文再以 `# <同一标题>` 开头,前端把它降级成 `<h2>`,于是标题连出两遍。属**内容侧**问题
      (server 只校验不改写),判据是「正文第一个非空行是 `# X` 且 `X == title` → 删掉那行」。
      已把这条补进 `docs/notes-content-spec.md` §4 第 7 条与 §8 自检清单;修完重新 upsert 即可
      (幂等,未变的篇目回 `unchanged`) (2026-09-01)
- [x] R9 **`deploy/.env.example` 的 `SITE_ORIGIN` 注释举的是 `:8080` 的例子**,而 R9 按所有者裁定
      用了 80(`http://192.168.100.130`,Caddyfile 与 compose 零改动)。注释本身没错(备案前两种都行),
      但和 130 上的真实配置不一致,照抄 8080 又不改 Caddyfile 就会得到一个连不上的站。
      下次动那个文件时顺手对齐 (2026-09-01)
      → **已对齐**:R11 改 `.env.example` 时注释已写成「130 预发 http://192.168.100.130 ← 用了 80,不是 8080」,2026-09-03 核过关闭

- [x] R10 **站点一个安全响应头都没有**:`deploy/Caddyfile` 与 `apps/web/next.config.ts` 均未设
      `X-Content-Type-Options` / `Referrer-Policy` / `X-Frame-Options`(或 CSP `frame-ancestors`)/
      `Permissions-Policy`;`docs/security.md` 也没有对应条款。全站唯一带 `nosniff` 的是 R6 为存储型
      XSS 单独加的供图端点。**所有者 2026-09-01 裁定本轮不做**(不在 R10 拆解内,属新增约束)。
      建议口径:先只上保守的一组(不含 CSP —— Next.js 的 inline script 需要 nonce 机制,属机制类改动);
      **HSTS 要等 R11 有 TLS 之后再开**,现在 130 是 http,提前发 HSTS 会把内网 IP 锁进 HTTPS。
      落地时按规则 9 先补 `docs/security.md` 一节 (2026-09-01)
  → **所有者 2026-09-02 裁定:R11 上线时一并加保守一组,HSTS 随 TLS 一起开**(备案已通过,`苏ICP备2025204887号-2`)。
    范围与 `max-age` 起步值见 [round-11 任务卡](round-11/round-11.md)「2026-09-02 备案通过后的裁定」第 3 条;
    **CSP 主体仍不做**(Next inline script 要 nonce,属机制类改动)。本条在 R11 落地后关闭
  → **已落地**(R11,`deploy/Caddyfile` 六个头 + HSTS `max-age=300` 起步,条款在 `docs/security.md` §5.1),2026-09-03 关闭;CSP 主体仍在 §5.1 里挂着
- [ ] R10 **Postgres 备份始终没有落地**:`docs/deploy-cn-lightweight.md` §5 写着「每日 `pg_dump` 到
      本机 + 异地各一份,保留 14 天」,R10 拆解里也有「备份脚本与恢复演练」——**所有者 2026-09-01
      裁定本轮不做**。代价是显式的:`deploy-environments.md` 第 7 条与 §3 的「涉及不可逆迁移时先恢复
      备份」目前是**悬空引用**,真出事没有可恢复的东西;镜像回滚只能回代码,回不了数据。
      R11 上线前须再裁定一次(生产有真实内容之后,这条的性质就变了) (2026-09-01)
      → **所有者 2026-09-02 复裁(备案通过后):继续不做**。本条**不关闭**,继续挂着。
        代价照旧显式:悬空引用不消失,镜像回滚回不了数据,而生产马上会有 205 篇正文 + 103 张配图
        + 加密入库的 LLM/搜索凭据。**派生出一条 R11 的硬约束:上线期间不做不可逆迁移**
        (写进 [round-11 任务卡](round-11/round-11.md)「禁止」段)——没有恢复点时,「不可逆」这三个字没有兜底可言
- [ ] R10 **130 上留着一份明文 LLM key**(`~/deploy/.llm-key`,600):R9 用 MCP 写 provider 时落的盘,
      之后没删。与 `docs/security.md` §3「运行期 LLM 凭据的唯一来源是 `llm_config` 表(密文)」不一致——
      多一份不受 `ConfigEncryptionKey` 保护的副本,而它对运行毫无用处。扩散面已查:`~/deploy` 其余
      文件 / `/tmp` / `~/.bash_history` 全 0 命中,库里存的是 79 字节密文(12+51+16,与文档布局吻合)。
      **没有当场删**——删了下次重写 provider 得回 provider 控制台重取,是所有者的东西。
      待确认后 `shred -u ~/deploy/.llm-key ~/deploy/asset.b64 ~/deploy/asset.name`。
      **R11 别把这个做法带进生产**:key 直接贴进 MCP 调用,不要先落盘 (2026-09-01)

- [ ] R-VISITOR **cookie 的合规告知未做**:`xr_visitor` 是「为提供服务所必需」的技术性 cookie
      (不跟踪、不跨站、不给第三方,口径见 `docs/security.md` §6),但站点上没有任何一句话告诉访客
      它的存在。要不要放一句告知、放在哪(footer 一行 / 关于页一段 / 备案要求的形态),
      属所有者与备案侧的裁定,不在本轮范围 —— 本轮**刻意没做** cookie 同意横幅,那属于
      设计稿没有的功能(规则 8) (2026-09-01)
- [ ] R-VISITOR **生成客户端在非浏览器上下文会对 `Set-Cookie` 调 `mustBeSet`**:
      `encore gen client` 为响应头字段生成的是 `if (!BROWSER) { rtn.visitorCookie =
      mustBeSet("Header \`set-cookie\`", resp.headers.getSetCookie()[0]) }`。浏览器侧被 `!BROWSER`
      跳过(浏览器本来也读不到 Set-Cookie),所以当前**没有影响**;但只要将来有人从 Next 的
      **服务端**(SSR / route handler)调 `client.agent.*`,一个没带 cookie 的请求就会抛
      `DataLoss`,而不是拿到空列表。`listSessions` 的字段明明是可选的,生成器仍然发了 `mustBeSet`
      ——属上游生成器缺陷。真要从服务端调这些端点时,绕法是别用生成客户端、直接 fetch (2026-09-01)
- [ ] R-VISITOR **`visits` 表的保留期现在有落点了**:BACKLOG 里那条「R8 `visits` 没有保留期与清理」
      当时的理由是「定时清理是新机制」。本轮已经为会话保留期建了一个进程内定时器
      (`apps/api/agent/purge.ts`,自托管镜像不执行 Encore CronJob)。若将来要给 `visits` 加保留期,
      在那里加一条 `DELETE FROM visits WHERE day < …` 即可,不需要再引入机制 ——
      注意它会改变历史趋势的可查范围,仍需所有者裁定保留多久 (2026-09-01)
- [x] **130 预发的 MCP 管理面走明文 HTTP —— 所有者裁定不修,本条关闭**(2026-09-01)。
      `.mcp.json` 的 `xray-admin-130` 指向 `http://192.168.100.130/api/mcp`,可复用的高权限
      bearer token 在局域网上明文传输,与 `docs/security.md` §4「仅 HTTPS(Caddy 终止)」冲突;
      codex 在一次 working-tree 扫描里报为 P1。**所有者裁定:130 是内网,不管安全问题。**
      记在这里只为两件事:①后续轮次的审查会反复扫到同一处,有本条即不必再逐轮重新裁定;
      ②**边界仅限 130 内网** —— R11 的生产管理面在公网上,同样的形态不成立,
      那里必须是 HTTPS(Caddy 自动 TLS,备案通过后即具备)。
- [ ] R-VISITOR **错误响应不重发访客 cookie**(codex 复审 P2,**写明理由不采纳**)。
      `resolveVisitor` 会先把库里的 `expires_at` 推到 `now()+24h`,但随后的
      `APIError`(404 / 409)带不了 `Set-Cookie` —— Encore 的 `APIError` 没有响应头这一层
      (实测,`encore.dev/api/error.ts` 里没有任何 header 支持)。**没有干净的修法**:
      要在错误上重发就得把 404 改成「200 + 错误字段」,那是更糟的接口;为它单开一条
      `api.raw` 属机制类改动,不在非阻塞 findings 允许的范围(CLAUDE.md 审查边界)。
      **兜底**:滑动窗口靠成功响应维持,而工作台每次挂载与每轮对话结束都会调用
      会成功的 `listSessions`(`Workbench.tsx` 的 `refreshSessions`),真实访客一直在续期。
      **残留风险**:一个**连续 24h 只收到错误响应**的调用方,库内身份还活着而浏览器那份
      已过期,于是它看不到自己此前的会话(库里那行由保留期清理带走)。那是 curl/爬虫的
      形态,不是访客的。将来若 Encore 支持在 APIError 上带响应头,这条可以一行修掉 (2026-09-01)

- [ ] R-TITLE **首句是招呼词时,`session_rename` 会把「打招呼」之类钉成永久标题 —— 所有者裁定接受,本条只为让后续审查不再逐轮重裁**(2026-09-02)。
      命名时机 = 第一轮(与参考实现 pi `auto-session-title` 一致),且每会话只命名一次(所有者 2026-09-01 裁定)。
      codex 第 3 轮以 P1 提出「等来意明确再命名」,我曾按措辞整改做了一版,所有者裁定那是给功能加戏、
      属新增机制,**已回滚**。代价:hi 开场的会话标题可能是「打招呼」,不比本轮之前的「hi」更差。
      若将来观察到这类标题占比高到影响会话列表可用性,可选项只有一个 —— 放开「允许后续重命名」,
      那要重裁「只命名一次」这条,不在任何轮次里顺手做。

- [ ] R11 **供图路径上 `X-Content-Type-Options` 出现两次**:R6 给供图端点单独加过一条 `nosniff`
      (存储型 XSS 防御),R11 又在 Caddy 站点块给全站加了一条,实测该路径响应里这个头出现 2 次
      (其余路径都是 1 次)——即 Caddy 的 `header` 对这条是**追加而非替换**。
      **功能上无害**(两个值完全相同,浏览器行为不变),但安全扫描器可能报「重复响应头」。
      修法都不划算:改 R6 那个端点要动 apps/ 并重新构建镜像,在 Caddyfile 里 delete-then-set
      又要赌 Caddy 内部的操作顺序。留着,等下次动这两处任一时顺手清 (2026-09-02)

- [ ] R-IMAGEGEN **`web_search` 把 provider / model / host 名带进了公开的轨迹流**:`makeWebSearchTool` 的结果 `details`
      含 `provider` 与 `model`,`runWebSearch` 的第一条进度文案含 `hostname` 与 `model=…` —— 两者分别经
      `tool_execution_end.resultPreview` 与 `tool_execution_update.partialResultPreview` 进 `/trace/stream`(公开)。
      与 R-TOOLS 的裁定「provider 与 model 名是服务端配置面,公开即泄」不一致。R-IMAGEGEN 的 `generate_image` 已按
      R-TOOLS 口径实现(details 只有 imageId / contentType / bytes,进度文案不带 host / model);websearch 那两处
      是跨轮次问题,不当场改。修法是两行:details 去掉那两个字段、进度文案去掉 hostname 与 model (2026-09-02)
- [ ] R-IMAGEGEN **`websearch.ts` 读非 2xx 错误体时 `.catch(() => "")` 会吞掉超时 / 超限的 kind**:上游给了个 5xx 的头然后
      挂住不发 body,空闲计时器掐断后被报成 `http_error`(模型拿到「搜索失败」而不是「搜索超时」的后路指引,日志 kind 也错);
      4xx 却回超过 4 MiB 的错误体同样报不出 `oversize`。codex 在 R-IMAGEGEN 初审对 `imagegen.ts` 的同款写法报了 P2,
      生图侧已改成「`WebSearchError` / `AbortError` 原样往外抛,只把读体本身的普通失败当空串」;搜索侧是跨轮次问题,
      不当场改,修法一行(`imagegen.ts` 的 `readCapped(res).catch(...)` 照抄) (2026-09-02)
- [ ] R-IMAGEGEN **`notes/assets.ts` 与 `notes/rss.ts` 对路径段裸调 `decodeURIComponent`**,畸形百分号编码(`/notes/x/%zz.webp`)
      会抛 `URIError` 冒成 500 而不是 404。`agent/images.ts` 新端点已包了 try/catch 回 404;那两处是跨轮次问题,不当场改,
      修法同款三行 (2026-09-02)

- [ ] R-TABS **About 页里指向 `/notes` 的那条链接在 Notes 被隐藏时会指到 404**(`apps/web/app/(site)/about/page.tsx:185`,
      「教程库全部内容开源并提供 RSS 订阅 → Notes」)。这是站点上唯一一条跨 tab 的硬编码链接;
      Notes 内部那几条面包屑不受影响(Notes 被藏起来时那些页面本身就不可达)。不当场改的理由:
      修法要在画板 2e 的定稿页面里加一个条件渲染(规则 7 的结构性改动),而所有者本轮的实际用法是隐藏
      **Runtime**、Notes 保持可见 —— 为一个不会发生的配置去动定稿页面不划算。将来真要隐藏 Notes 时再改,
      改法是 About 页多取一次 `visibleTabKeys()`,那一句按 notes 是否可见渲染 (2026-09-03)

- [ ] 预研 R-WEBFETCH **生产 api 镜像里带着本机的 `.secrets.local.cue`**:核对 `local/xray-api:da10f6e` 布局时发现
      `/workspace/apps/api/.secrets.local.cue`(451 B)在镜像里 —— `encore build docker` 把 app root 整目录打了进去。
      内容只是本机开发用的 `McpAuthTokenHash` / `ConfigEncryptionKey` 等,不含生产凭据(生产走 `.env`),
      但一份本机密钥材料不该出现在会被传输、留档的制品里。不当场改:要先核实 encore 有没有构建期排除机制
      (`.gitignore` 之外的 ignore 文件 / `encore.app` 的 build 段),再决定是排除还是构建前临时挪走 (2026-09-03)

- [ ] R-TOOLCARDS **本机验收缺一个能跑的 provider**:本机开发库 `llm_config` 为空,验收 #2–#5 靠会话 scratchpad 里一个与 `skills-e2e.test.ts`
      同款的假 OpenAI SSE 服务 + 手工种一行 `faux` provider(密文经本机 `ConfigEncryptionKey` 加密)跑完,验完删。这段是每次要在浏览器里验
      agent 行为的轮次都会重做的事;可以固化成 `dev.ps1 faux-llm`(起假服务 + 种 / 删 provider 行),属工具链新增机制,等所有者裁定 (2026-09-03)
- [ ] R-TOOLCARDS **展开体超过 6 行时 `…(已截断)` 标记被裁掉看不见**(codex 第 2 轮 P2,写明理由不采纳):服务端按与轨迹流同一上限(400 字)在切断处接标记,
      前端按画板 2m 做 `max-height:106px` + `overflow:hidden`;文本一换行 400 字就超过 6 行(实测 400 字 `scrollHeight` 211 px),标记落在裁切区里。
      三条约束(同一上限 / 标记在切断处 / 6 行裁切不滚动)都是裁定,改哪条都是设计取舍。候选:①展开体改 `-webkit-line-clamp: 6`(浏览器省略号顶替标记);
      ②标记单独画在裁切框外一行。要先在画布上改 2m,再改 `Workbench.tsx` 的 `ToolCard` 一处 (2026-09-03)
- [ ] R-TOOLCARDS **展开体 RESULT 的多行结果折成一段**:画板 2m 只给了 `word-break: break-all`,没给 `white-space`,所以像 schema 校验错误这种
      带换行的结果在 6 行框里读起来是一段;要不要 `pre-wrap` 得在画布上定(规则 7),定了再改一行样式 (2026-09-03)
- [ ] R-TOOLCARDS **卡片耗时格式**:实现沿用 Timeline 的 `formatDuration`(`26ms` / `4.7s`),画板 1a 示例写的是 `0.3s`;两种并存在同一块画板上,
      本轮取「一个格式器」。所有者若更想要卡片一律秒制,改 `lib/turn-view.ts` 的 `toolDuration` 一处 (2026-09-03)
- [ ] R-CARDS 发版冒烟实测:MCP **2026-07-28 的逐请求头**(每请求 `Mcp-Method: <method>`,`tools/call` 再加 `Mcp-Name: <工具名>`)在 `apps/api/mcp/README.md`(契约正本)里没有记载,只有 `_meta` 三个 camelCase 键在 `rounds/round-10/checklist.md` §9 记着。手写 JSON-RPC 冒烟脚本时会连撞三次(键名 kebab-case → 静默走 legacy、`server/discover` 回 `-32601`;缺 `Mcp-Method` → `-32020`;`tools/call` 缺 `Mcp-Name` → `-32020`)。补进正本的「三条容易改错的地方」即可,零代码改动 (2026-09-09)

## 功能提案(需所有者裁定)

- [x] **Ask why 做实 / 卡片 ↔ Timeline 定位 / Notes 章节 → Runtime 入口**(所有者 2026-09-08 从下一阶段分级方案里圈定「1-A、4、5 合成一轮」)——**已裁定「做」,落为 R-CROSSLINK**
      (任务卡 [`rounds/round-crosslink/round-crosslink.md`](round-crosslink/round-crosslink.md),画板提示词同目录 `design-prompt.md`;文档就绪、设计稿待交付)。
      Ask why 取预填(1-A),不做服务端拼上下文(1-B)与独立解释器(1-C);三件事共用「预填、永不自动发送」一个原语 (2026-09-08)
- [ ] R-CROSSLINK 备选 **章节级「示例提问」字段**(`notes_chapter_upsert` 加 `tryPrompt` + 迁移加列 + `docs/mcp.md`),由所有者逐章写更好的提问。
      本轮用通用模板不加字段;要做另裁定 (2026-09-08)
- [x] **会话区信息卡片(所有者原话「UI 组件工具」)**(所有者 2026-09-08 圈定「2-A」)——**已裁定「做」,落为 R-CARDS**
      (任务卡 [`rounds/round-cards/round-cards.md`](round-cards/round-cards.md),画板提示词同目录;文档就绪、设计稿待交付)。内容级围栏块,不是 pi 工具 (2026-09-08)
- [ ] R-CARDS 备选 **工具级 `render_card`**(schema 强校验、模型收得到校验错误、Tools 面板可见、轨迹可见;代价 = `tool_end` 帧与 `payload` 加结构字段 + `2l` 折叠规则加例外)
      与 **Notes 侧开卡片**(Notes 正文契约是标准 markdown,开了就是契约变更)。两条都要另裁定 (2026-09-08);工具级那条 2026-09-09 在 R-CARDS-2 讨论里作为 D 档再次被否
- [x] **会话区 UI 组件 2.0(所有者原话「UI tools」:标准模板可交互可回传 + 只定宽高的自由内容)**(所有者 2026-09-09 从四档 A / B / C / D 里圈定「A + B」)——**已裁定「做」,落为 R-CARDS-2**
      (任务卡 [`rounds/round-cards2/round-cards2.md`](round-cards2/round-cards2.md),画板提示词同目录;文档就绪、设计稿待交付)。同日两处调整:回传 = 发送(单选点即发、多选 / 表单 submit 发),每轮上限仍两个 (2026-09-09)
- [ ] R-CARDS-2 备选 **C 档:`xray-html` 帧给 `allow-scripts` + postMessage**——第一处模型 JS 在访客端执行,要重写 `docs/security.md` §0 第 13 条并加新威胁;postMessage 的 sink 也只能是预填或点击即发的同一套边界。所有者 2026-09-09 裁定暂不考虑 (2026-09-09)
- [ ] R-CARDS-2 备选 **D 档:pi 工具级 + 结构化回传(工具 `execute` 挂起等访客在组件里作答,elicitation 式)**——新端点 + pending 登记 + 超时清理 + SSE「等待输入」帧 + 回放两态,还要回答挂起期间访客普通消息怎么办;
      与上面「工具级 `render_card`」同族。所有者 2026-09-09 裁定暂不考虑 (2026-09-09)
- [ ] R-CARDS-2 **`xray-html` 的运行期开关**(不发版就能关):一张单行表 + MCP `cards_config_get` / `cards_config_set`(51 → 53,规则 13 同步 `docs/mcp.md`)+ 一个公开只读端点给 web 读。v1 裁定「关 = 发版、只停产出」;要开关另裁定 (2026-09-09)
- [ ] R-CARDS-2 **Notes 侧是否开两种新卡 / HTML 组件**:与上面「Notes 侧开卡片」同一条契约问题,本轮不开 (2026-09-09)
- [ ] **会话分享链接(只读回放)**:把某次会话的对话 + 轨迹以只读链接分享出去(「分享这张 X 光片」)。访客隔离(R-VISITOR)是刻意建的,分享要走显式 opt-in token、
      有效期、可撤销,且分享页不带输入框。属新功能、要画板,大;下一阶段分级方案里排在三轮之后待裁定 (2026-09-08)

- [x] **给 agent 加「使用 skills:注入 + 沙箱运行 Python 脚本」的能力**(所有者提出并于同日裁定,2026-09-03)——**已裁定「做」,落为 R-SKILLS-2**
      (`round-skills` 的 2.0 迭代;研究与七条裁定 [`rounds/round-skills/research.md`](round-skills/research.md),任务卡 [`round-skills-2.md`](round-skills/round-skills-2.md))。
      七条:做;规则 9「一次性容器」→「独立容器可常驻 + 一次性进程」;第四组「沙箱执行组」先改画板 1f/1g;`network_mode: none` + unix socket(spike 不通停下重估);
      首批 skills 在 1.0 里经 MCP 上传、默认只展示不注入;**改可用 skill = 发版**(可用集合在代码里,库只开关 + hash 一致性);130 非必经、生产冒烟验收。
      文档已按规则 9 先改(`docs/security.md` / `CLAUDE.md` / `docs/architecture.md` / `ROUNDS.md`),代码零改动。派生出下面三条新记录 (2026-09-03)
- [ ] R-SKILLS-2 **画板 1f/1g 的第四组「沙箱执行组」还没画**(2026-09-03 开工时核对:云端 Claude Design 项目与本地 `design/` 的 Tools 面板示例数据都只有三组)。
      任务卡把它列为开工前置、由所有者在画布上改;代码轮没有等,前端 `ToolsPanel.tsx` 按任务卡建议值接上(组名「沙箱执行组」、色 `#8b5cf6`、
      示例工具 `skill_run`)。所有者画完后按画板核对这三处;拉稿照 `design/README.md` 的合并口径(先 diff、找 base、三方合并) (2026-09-03)
- [ ] R-SKILLS-2 **前端纯函数测试的运行方式**:`apps/web/lib/trace-view.test.ts` 用 `node:test` 写法、由 `bun test lib` 跑(`dev.ps1 test` 收尾多跑这一步),
      零新增 npm 依赖。代价是 `next build` 的 tsc 也会扫到它(`import.meta`/`node:test` 类型来自 `@types/node`,目前过);将来若 web 侧测试变多,
      再考虑 vitest 与 tsconfig 排除。属工具链取舍,不是功能 (2026-09-03)
- [ ] R-SKILLS-2 **Skills 页(2f–2h)要不要显示「agent 可用」徽标**:哪些 skill 对站上 agent 开放,访客现在只能在 Runtime 的 `before_agent_start` 详情卡
      与 `skill_load` 调用里看到,Skills 页本身不区分。画板没有这个徽标,规则 8 下本轮不做;要做先在画布上给卡片 / 详情页头部加一枚(可沿用出处微徽标的形制) (2026-09-03)
- [ ] R-SKILLS-2 **注入型(纯文本)skill 能否直接从库注入、不发版**:与 `notes_get_chapter` 同一信任级(所有者经 MCP 发布的文本),
      技术上只需给 `agent_ro` 显式 `GRANT SELECT` skills 三表并走 `READ ONLY` 事务。但它与裁定 6「改可用 skill = 发版」相反,
      且会让「可用集合在代码里」这条原则对注入型失效(管理 token 泄漏 → 可往上下文里塞任意文本)。作为备选留档,要做先重裁裁定 6 (2026-09-03)
- [ ] R-SKILLS-2 **`ToolParametersSchema` 只认 string / integer**,`skill_run` 因此把入参做成一个 JSON 文本(`input`)而不是结构化字段。
      与 R-IMAGEGEN 那条「`size` 入参要加 `enum`」同一根源:扩 schema 关键字必须连 `ToolsPanel.tsx` 的约束徽标一起扩(面板永远不是第二个要改的地方)。
      属机制扩面,等所有者裁定;做了之后 `skill_run` 的 `input` 可以按脚本 schema 拆成真字段 (2026-09-03)

- [x] R-TOOLCARDS **卡片 ↔ Timeline 互相定位**:两边都有 `toolCallId`(`messages.payload.toolCalls[].toolCallId` 与轨迹的 `tool_execution_*`),
      点卡片高亮右栏对应行技术上现成;画板没画,等裁定 (2026-09-03)
      → **2026-09-08 所有者裁定「做」,落为 R-CROSSLINK**(双向:卡 → 行、行 → 卡;已定位态不新造;对不上不渲染)。任务卡 [`rounds/round-crosslink/round-crosslink.md`](round-crosslink/round-crosslink.md)
      → **2026-09-09 随 `995dc49` 发版关闭**:生产端到端实跑双向都成立(详情卡「查看卡片 ↗」→ 会话区卡展开;卡片「在 Timeline 里查看 ↗」→ 折叠过的行重新展开),见 [`docs/releases.md`](../docs/releases.md) 该行
- [ ] R-TOOLCARDS **`session_rename` 的卡片是否隐藏**:它也是一次工具调用,会以一张卡出现在首轮里(与 Timeline 的 `tool_call · session_rename` 对得上)。
      默认显示(透明是卖点);裁定隐藏再改 (2026-09-03)
- [ ] R-TOOLCARDS **会话区是否显示「思考」块**:pi-web 有;本站内核透明度靠右栏,画板 2l/2m 明确不放,默认不做 (2026-09-03)
- [ ] R-TOOLCARDS **本轮之前的助手行没有 `payload`**,重新打开只显示正文(合并后的整段话);访客会话 3 天保留期后自然消失,不回填,记一笔备查 (2026-09-03)
- [ ] R-IMAGEGEN **`generate_image` 是否给访客一个 `size` 入参**(横版 / 竖版 / 方图)。本轮裁定只控 `prompt`、尺寸是
      provider 配置(`image_size`)—— 外呼组约束 1 的最严读法。要做入参得两处一起动:`ToolParametersSchema` 加 `enum`
      关键字(pi 的 JSON Schema 校验器支持),`ToolsPanel.tsx` 的约束徽标学会画枚举值(R-TOOLS:面板永远不是第二个
      要改的地方,所以不能只加 schema 不改面板)。属机制扩面,等所有者裁定 (2026-09-02)
- [ ] R-IMAGEGEN **画板 1f/1g 的示例工具清单没有 `generate_image`**。面板由后端目录驱动,实际页面会显示它;
      只是 `design/*.dc.html` 里那份示例数据停在五个工具(R-TOOLS 时的全集)。设计稿是 Claude Design 的导出存档,
      本轮没有手改;要同步由所有者在画布上加 (2026-09-02)
- [x] 预研 **`web_fetch` 工具(集成 defuddle)**:预研报告在 [`rounds/round-webfetch/study.md`](round-webfetch/study.md)。
      结论是可做但要开**第四档**(无凭据、访客定向的外呼)—— 与 `docs/security.md` §1 外呼组约束 1
      「工具不接受任何形式的 URL 参数」正面冲突,且不在设计稿,属规则 8 + 规则 9 的双重例外。
      技术上两条硬前提已实测成立:bun 1.4.0 下 `node:https` 的 `lookup` 钩子可钉 IP(挡 DNS rebinding);
      Worker + 硬超时可隔离解析(defuddle 对嵌套深度超线性:11 KB 页 5.7 s、1.3 MB 表格页 883 MB RSS,
      Readability 同样超线性)。**所有者裁定 2026-09-03:暂不做。** `web_search` 已覆盖本站主流诉求
      (找资料 / 时效问答 / 多源综述 / 给来源);`web_fetch` 独有的「读指定网址 / 要原文 / 顺着来源继续读 / 未索引页」
      在本站频率偏低,代价却是新开一档安全约束 + Worker 新机制。报告留档不进轮次;访客贴网址的频率上来了再从报告 §5 重评 (2026-09-03)
      → **2026-09-03 同日重评(R-SKILLS-2 裁定「做」之后)**:那两条代价都有了别的落点 —— 执行容器就是隔离边界(Worker 不需要),
        「访客定向外呼」不再是 api 进程里的第四档工具而是沙箱执行组里一个声明了出网档次的 skill(`web-fetch`)。方案已重写为
        [`rounds/round-webfetch/round-webfetch.md`](round-webfetch/round-webfetch.md);**所有者同日裁定十条,全部按建议**:同一 runner 镜像起第二个
        只出公网的实例(默认实例的 `network_mode: none` 一字不改)、**访客给的 URL 不设域名限制、不维护任何域名黑白名单**(太多,无法维护;拒的是固定
        内网地址段)、外呼组「不接受 URL 参数」的唯一例外认下、残余风险「经 URL 外泄本访客会话」认下、`network` 字段提前进 R-SKILLS-2 等。
        已落为 **R-WEBFETCH**(文档就绪、未开工),规则 9「先改文档」已写入 `docs/security.md` / `CLAUDE.md` / `docs/architecture.md` / `ROUNDS.md`;
        代码零改动。预研 in-process 形态退役,`study.md` 降为实测附录
- [x] 预研 R-WEBFETCH 的**中间路径待验证**:把网址写进 `web_search` 的 query,由网关侧开页 —— 我们的进程不抓,零 SSRF 面。
      生产搜索 provider 是 OpenAI 系模型的 `web_search` 工具(有 search / open_page / find 三个动作),原则上可行。
      验证:在站上问「打开 <某网址> 并总结」,看 Timeline 里的来源是否就是那一个网址。成立则只改三处:
      `WEB_SEARCH_META` 描述与 `systemPromptFor` 里「不要放网址」两句、query 的 `maxLength`(现 300,放一个长网址就超)。
      属小修补,可直接 `main` (2026-09-03)
      → 2026-09-03 同日 R-WEBFETCH 裁定「做」之后,本条降为 R-WEBFETCH 落地前的**过渡验证**(零成本、与 skill 形态不互斥);R-WEBFETCH 落地后关闭
      → **2026-09-04 关闭**:R-WEBFETCH 代码落地(`round-webfetch`),过渡验证没做也不再需要;`web_search` 那两句「不要放网址」保持原样 —— 读网址走 `web-fetch` skill
- [ ] R-WEBFETCH **egress 容器的病态输入基线**:`dev.ps1 runner-test` 的夹具(`runner/tests/pathological.py`)量的是本机 docker 的数字,
      生产是 2 vCPU 轻量机、`cpus: 1.0`;发版后在生产跑一次同一夹具(bind mount `runner/tests` 进 `skill-runner-egress` 镜像的临时容器,
      `--network none`),把耗时与 VmHWM 记进 `docs/releases.md` 对应发版行。若某形状逼近 `sandbox_config.total_timeout_ms`(30 s)或 256m,
      先加 `fetch.py` 里的元素 / 深度计数(任务卡「失败处理」段),不放宽 `mem_limit` (2026-09-04)
- [ ] R-WEBFETCH **`fetch.py` 响应头阶段的总时长**:读体阶段已按 `read1` 每个 recv 核一次总时长(codex 第 2 轮 P2),但 `getresponse()` 读头
      仍只受 8 s 空闲超时约束,一个逐行滴头的服务器最坏能拖到 sandbox 总时长(默认 30 s、上限 120 s)才被 runner killpg,期间占着 egress 唯一并发名额。
      收紧的做法是一个 `threading.Timer` 在总时长到点时 `sock.close()`(阻塞中的 recv 立刻抛 OSError → `E_TIMEOUT`),对连接 / TLS / 头 / 体四段
      一并生效;属机制,先记着,egress 实例真被这样占过再做 (2026-09-04)
- [x] R-WEBFETCH **`web-fetch` 的展示副本要所有者经 MCP 上传**(裁定 6 的必然):`runner/skills/web-fetch/` 三个文件(SKILL.md / xray.json /
      scripts/fetch.py,LF)整包 `skills_upsert`,`sourceType: own`、`repo: ClickPM/skills-hub`(自研 skill 的既定出处,先推 skills-hub 再挂;
      `LICENSE` 核对见 [[skills-publish-license-check]] 那条口径:自研、无出处,不附)。上传前 `skills_agent_status` 报 `missing`,上传后 `ok` 才能
      `skills_agent_set web-fetch true`。分类建议「自研 · 工具」(任务卡 C9) (2026-09-04)
      → **2026-09-04 完成**(`2c503d3` 发版当日):所有者授权后先把目录推到 `ClickPM/skills-hub`(`b85ec5e`,README 目录表同步),再 `skills_upsert` 整包上传(created,3 文件 31601 字节);分类落 **`workflow`** —— 闭集里没有「自研 · 工具」,同为沙箱可执行的 `text-tools` 也在 workflow。`consistency: ok` 后 `skills_agent_set web-fetch true`,端到端四个用例实跑通过(留证 `docs/releases.md`)。**顺带记一条**:`skills_upsert` 的 `repo` 是**必填**,「先不填 repo、之后再补」这条退路在 schema 上不存在
- [ ] R-WEBFETCH **宿主出网过滤覆盖不到「容器 → 宿主自身地址」**(2026-09-04 生产冒烟实测,所有者当日裁定「照原计划打开 web-fetch,缺口记这里」):
      `deploy/egress-filter.sh` 的六条 DROP 写在 `DOCKER-USER`,而那是 **FORWARD** 链的第一跳;容器发往宿主自身地址
      (`10.0.0.5` 是 eth0,`172.30.0.1` / `172.17.0.1` 是网桥网关)的包在本机交付、走 **INPUT**,那六条看不见。
      实测 `skill-runner-egress` 可连 `10.0.0.5:22`(sshd),而 `-> 10.0.0.0/8` 那条计数为 **0**;
      转发出去的流量确实被挡(`-> 169.254.0.0/16` 计数增长),所以规则没写错,是**覆盖面少了「宿主本机」这一类目的地**。
      生产宿主 `0.0.0.0` 上的监听只有 22(sshd)与 80/443(docker-proxy → caddy),所以能够到的是 sshd 与站点自身。
      **另两层防线完好**:`fetch.py` 在名字/地址层拒 `10.0.0.0/8` / `172.16.0.0/12` / `169.254.0.0/16` 并钉 IP 连、只走 https/443;
      容器不在 `front` / `back`。要踩到这个洞得先有一个 `fetch.py` 地址校验的绕过 —— 今天的可利用性低,但这一层**没有做到它文档里声称的覆盖**。
      修法要谨慎、要实测,别想当然:给 INPUT 加同源同段的 DROP 时必须先确认不误伤 docker 内嵌 DNS(容器侧 `127.0.0.11` 由 dockerd 代理到宿主
      `127.0.0.53`,本次实测公网域名解析是通的,加规则后要重验)与 caddy 的 80/443。属**新增机制**,不在任何整改循环里顺手改,等所有者裁定进轮次 (2026-09-04)
- [ ] R-SKILLS **agent 能否读 skills**(给 pi 配 `skills_list` / `skills_get` 这类只读工具,与 `notes_*` 同形态,让 Runtime 对话里能引用技能库)。
      R-SKILLS 裁定本轮 agent 侧不可读、新表不授权任何 agent 角色;要做需在那次迁移里显式 `GRANT SELECT` 给 `agent_ro`、
      走 `READ ONLY` 事务,并且 Tools 面板会自动多出这组工具(1f/1g 示例数据要跟)。属新功能,等所有者裁定 (2026-09-03)
      → **2026-09-03 同日由 R-SKILLS-2 的裁定覆盖**:agent 不直接读库里的 skills;可用集合在代码里(`runner/skills/`),库只提供 `agent_enabled` 开关与
        hash 一致性判据,agent 角色对 skills 三表仍无权限。「从库直读」降为上面「注入型 skill 能否不发版」那条备选。本条关闭,不再单独裁定
- [ ] R-SKILLS **`notes/assets.ts` 与 `notes/rss.ts` 的 `decodeURIComponent` 未捕获 URIError**:`/notes/<系列>/%ZZ.webp`、`/rss/%ZZ.xml` 这类坏编码的公开地址会让 raw 端点回 500 而不是 404。codex 首轮审查在 R-SKILLS 的 zip 端点(`skills/zip.ts`)上报了同一模式(P2,已整改),这两处是既有代码、不在本轮 diff 里,按「跨轮次发现的问题不当场顺手改」记这里;修法就是 try/catch 后走同一个 404(小修补,可直接 `main`) (2026-09-03)
- [ ] R-PERF **引用块里的 H2 会拿到锚点 id,却不进「本页/本章目录」**:`extractToc` 按原始行匹配 `^\s{0,3}##\s+`,
      `> ## 标题` 这种被引用块包着的标题匹配不上(前面有 `>`);而渲染器把它当 h2 渲染,照样挂 id。
      R-PERF 的验收 #3 全量跑了 281 篇正文,发现 2 篇有这个偏差(`codex-harness/chapter-14` 多 1 个、
      `ppt-master:SKILL.md` 多 4 个 —— 后者是 `> [!IMPORTANT]` 里的标题)。**与本轮改动无关**:
      同一批正文对生产 HTML 的 id 逐条比对是零漂移,说明改动前就是这样。
      危害有限但真实:目录里少几条(无害),以及**引用块标题若与后文某个真标题同名,后者会被去重成 `xxx-1`
      而目录仍写着基名,锚点点了不跳**。修法二选一 —— ①`extractToc` 也跳过引用块内的 `##`(与渲染侧仍不一致,
      但目录与 id 的对应关系不受影响);②渲染侧不给引用块内的 h2 挂 id(改 `rehypeHeadingIds`,判父节点是不是
      `blockquote`)。②更贴近「目录 = 正文骨架」的语义。按「跨轮次发现的问题不当场顺手改」记这里 (2026-09-03)
- [x] 提示词加固 **`model_select` 事件的派生字段把 provider / model id / name 送进公开轨迹流**:`agent/events.ts` 的 `EVENT_DERIVED.model_select`
      经 `summarizeModel` 透出 `{provider, id, name}`,随 `/trace/stream` 推给访客、也落库(前端 detail 卡是否原样渲染未逐一核对,但数据已经出了服务端)。
      与规则 8 两次裁定(R-TOOLS「provider 与 model 名公开即泄配置面」、R-TOOLCARDS「会话区不显示模型名 / provider 名」)口径相反。
      2026-09-07 给系统提示加了「不透露底层模型」条款,但这条通道不归提示词管。修法是派生字段只留 `source`、或把 id / name 换成占位
      (`events.test.ts` 的白名单用例要跟);轨迹面板「像 DevTools」的定位要不要保留这一项属所有者裁定,不当场顺手改 (2026-09-07)
      → **2026-09-08 所有者裁定「修」,落为 R-LEAK**(派生项整个删掉,`data` 只剩 `{type, source}`;与下一条同轮)。任务卡 [`rounds/round-leak/round-leak.md`](round-leak/round-leak.md)。**已于 2026-09-08 `e8ac83e` 发版关闭**:派生项与 `summarizeModel` 整个删掉,`data` 只剩 `{type, source}`;`events.test.ts` 加了值级用例(完整 `Model` 对象进、键集合恰为 `{type, source}` 出)
- [ ] 修补 2026-09-07 **系统提示的【时间基准】按轮刷新**:这一行定格在会话创建时(pi 的 resource loader 只在 reload 时算一次
      override),持续活跃的会话不回收、它会旧几小时(codex 复审第 2 轮 P2)。措辞已改成「真正的现在不早于它、晚于它的先查证」兜住;
      精确做法是在 before_agent_start 注入时每轮重写(xray-skills 注入器已经在那个事件上追加 systemPrompt,可顺路),属机制,等所有者裁定 (2026-09-07)
- [x] 发版 `d9fefb4` **`web_search` 的 `[request]` 阶段文案把搜索网关 hostname 与模型名送进公开轨迹流**:
      `agent/websearch.ts:314` 的 `progress("request", …)` 直接拼 `new URL(cfg.baseUrl).hostname` 与 `cfg.modelId`,
      经 `tool_execution_update` 的 `partialResultPreview` 随 `/trace/stream` 推给访客 —— 触发过一次搜索的一轮里,
      访客在 Timeline 就能读到 `向 api.<网关地址>.sslip.io 发起搜索请求(model=gemini-3.8-flash-high)`。
      与上一条 `model_select` 是**同族不同通道**(那条在派生字段,这条在工具阶段文案),口径同样与规则 8 的
      R-TOOLS / R-TOOLCARDS 两次裁定相反(「provider 与 model 名公开即泄配置面」)。**不含凭据,key 没泄**;
      `/agent/ask` 那条流干净,只有轨迹流带。**引入于 R-WEBSEARCH `4c353fb`,自生产首发 `5bd6ace` 起一直在线**,
      不是任何一轮的回归;历次冒烟没查到是因为 7 项扩展脱敏此前只对 `/agent/ask` 跑过,`/trace/stream` 那侧
      只查字面词 `baseUrl` 而泄的是它的**值**。修法三档待裁定:①阶段文案删掉 host 与 model(改成「已向搜索网关发起请求」);
      ②只保留 model、去掉 host;③给 sanitize 加**值级**白名单(拿当前 provider 配置的 host / modelId 做遮蔽,
      比①贵但能一次覆盖同族通道)。属跨轮次发现,按规矩不当场顺手改 (2026-09-07)
      → **2026-09-08 所有者裁定「修」,落为 R-LEAK,取 ①**(固定文案「已向搜索网关发起请求」;③ 是新机制,留作备选);同轮把冒烟第 8 条改成值级、同族排查列为交付项。**已于 2026-09-08 `e8ac83e` 发版关闭**:发版当日的值级冒烟六个配置值 × 两条流 0 命中(`docs/releases.md`)。**同族还抓出第三条**:`tools.ts` 里 `web_search` 结果的 `details` 带 `{provider, model}`,同轮一并修掉(只留 `citations`)——它是集成探针 `agent/leak-e2e.test.ts` 第一次跑抓到的,静态排查没照出来
- [ ] R-SOURCE **`agent/source-tools.test.ts` 与 `agent/sandbox.test.ts` 在同一个测试库里抢 `tool_config`**:前者有一条用例断言
      「迁移 016 的种子行 `source_list` / `source_read` / `source_search` 默认开」,直接从库里 `SELECT`;而后者的多个用例
      `DELETE FROM tool_config` 后自己重新种。`encore test` 下两个文件由 vitest 并行跑、共用同一个库,于是这条用例是**竞态**:
      单跑 `dev.ps1 test agent/source-tools.test.ts` 9/9 全过,整套 `dev.ps1 test` 偶发挂在
      `expected [] to deeply equal [ Array(3) ]`(2026-09-08 发版前的全套跑就挂了这一条,其余 601 用例与 web 侧 28 用例全绿)。
      **只是测试缺陷,产品代码与迁移种子都是对的**(生产冒烟第 22 条实测三个工具默认开、agent 端到端跑通)。
      修法二选一:①这条断言不读库,改读迁移 SQL 文本或 `TOOL_REGISTRY` 的静态口径;②`sandbox.test.ts` 改成只删自己关心的
      那几行(`DELETE ... WHERE name = ANY($1)`)而不是清空全表 —— ②更贴近「测试之间不互相踩」,但动的是既有文件。
      按「跨轮次发现的问题不当场顺手改」记这里 (2026-09-08)
- [ ] R-MOBILE **移动端展开 Timeline 某一行时 React 报 `Cannot update a component (MobileWorkbench) while rendering a different component (TimelineView)`**:
      `TimelineView.tsx` 的 `onToggle` 把 `onExpand?.()`(= `setRuntimeDetent("large")`,画板 4f 的「展开即升档」)
      写在了 `setExpandedKey` 的**更新函数里**,而更新函数由 React 在渲染阶段执行 —— 于是「渲染 A 时 setState B」。
      功能表现正常(Sheet 确实升到 large),代价是 dev 下每展开一行报一条 error、Next 的错误角标常亮,
      真正的问题会被这条噪声盖住。修法是最小改动:把 `onExpand?.()` 挪到更新函数外面、先算 `next` 再决定调不调
      (`const next = expandedKey === key ? null : key; setExpandedKey(next); if (next) onExpand?.();`)。
      **引入于 R-MOBILE,与 R-CROSSLINK 无关**(`git diff main` 里这一段一字未动),按「跨轮次发现的问题不当场顺手改」记这里;
      R-CROSSLINK 本机验收时在移动壳的控制台里发现 (2026-09-08)
