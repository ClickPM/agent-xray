# Backlog

跨轮次发现的问题与想法都记这里,不当场顺手改;新功能类条目须经所有者裁定才可进轮次。
格式:`- [ ] <发现轮次> <一句话> (发现日期)`

## 工程

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

- [ ] R8 **顶栏统计条的 tokens / cost / ctx 仍是 demo 值**(`apps/web/lib/demo-data.ts` 的 `statsBar`)。
      原注释写「R7/R8 计量」,但 R8 的拆解里没有它,R7 的拆解里也只有 `daily_quota` 的**拒绝**行为、
      没有「把本会话用量推给前端」这一条。需要所有者裁定归属:计量数据在 R7 的配额计数里已经有了,
      缺的是一条把它带到前端的通路(SSE 帧 or 会话查询字段),属新增接口面,不顺手做 (2026-09-01)
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
- [ ] R9 **153/205 篇正文首行的一级标题与 `title` 重复**:文章页已经把 `title` 渲染成页面大标题,
      正文再以 `# <同一标题>` 开头,前端把它降级成 `<h2>`,于是标题连出两遍。属**内容侧**问题
      (server 只校验不改写),判据是「正文第一个非空行是 `# X` 且 `X == title` → 删掉那行」。
      已把这条补进 `docs/notes-content-spec.md` §4 第 7 条与 §8 自检清单;修完重新 upsert 即可
      (幂等,未变的篇目回 `unchanged`) (2026-09-01)
- [ ] R9 **`deploy/.env.example` 的 `SITE_ORIGIN` 注释举的是 `:8080` 的例子**,而 R9 按所有者裁定
      用了 80(`http://192.168.100.130`,Caddyfile 与 compose 零改动)。注释本身没错(备案前两种都行),
      但和 130 上的真实配置不一致,照抄 8080 又不改 Caddyfile 就会得到一个连不上的站。
      下次动那个文件时顺手对齐 (2026-09-01)

- [ ] R10 **站点一个安全响应头都没有**:`deploy/Caddyfile` 与 `apps/web/next.config.ts` 均未设
      `X-Content-Type-Options` / `Referrer-Policy` / `X-Frame-Options`(或 CSP `frame-ancestors`)/
      `Permissions-Policy`;`docs/security.md` 也没有对应条款。全站唯一带 `nosniff` 的是 R6 为存储型
      XSS 单独加的供图端点。**所有者 2026-09-01 裁定本轮不做**(不在 R10 拆解内,属新增约束)。
      建议口径:先只上保守的一组(不含 CSP —— Next.js 的 inline script 需要 nonce 机制,属机制类改动);
      **HSTS 要等 R11 有 TLS 之后再开**,现在 130 是 http,提前发 HSTS 会把内网 IP 锁进 HTTPS。
      落地时按规则 9 先补 `docs/security.md` 一节 (2026-09-01)
- [ ] R10 **Postgres 备份始终没有落地**:`docs/deploy-cn-lightweight.md` §5 写着「每日 `pg_dump` 到
      本机 + 异地各一份,保留 14 天」,R10 拆解里也有「备份脚本与恢复演练」——**所有者 2026-09-01
      裁定本轮不做**。代价是显式的:`deploy-environments.md` 第 7 条与 §3 的「涉及不可逆迁移时先恢复
      备份」目前是**悬空引用**,真出事没有可恢复的东西;镜像回滚只能回代码,回不了数据。
      R11 上线前须再裁定一次(生产有真实内容之后,这条的性质就变了) (2026-09-01)
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

## 功能提案(需所有者裁定)

(空)
