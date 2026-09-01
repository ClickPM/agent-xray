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
- [ ] R-BUN `dev.ps1 build` 的 `--services` 白名单是维护热点(R4 已补 `trace`、R5 已补 `notes`):R6/R8 新增 mcp/metrics 服务时必须同步补名字,漏补表现为该服务端点静默 404。考虑在 R9 冒烟里加一条「已声明服务全部可达」的断言 (2026-08-29)
- [ ] R-BUN Next dev proxy 对**未百分号编码**的中文 query 返回 400,直连 Encore 同样请求返回 200。浏览器会自动编码故对真实用户影响小,但手写 URL 的脚本/测试会踩 (2026-08-29)
- [ ] R-BUN **上线前必做(架构评审 P1-4)**:`apps/web/app/layout.tsx:17-21` 从 `fonts.googleapis.com` 加载 JetBrains Mono,是渲染阻塞样式表,境内首访会挂在字体请求超时上(数秒白屏)。改为自托管(`next/font/local` 或 woff2 放 `public/`),视觉零变化;属规则 7 允许的「接线需要的结构性改动」,任务卡写明理由即可。落地时记得在 `apps/web/Dockerfile` 补 `COPY … /app/public ./public`。R9 或 R10 完成 (2026-08-29)
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
      仍会跑完(数秒 token),会话随即释放。**R9 在 Caddy + 自托管镜像真实拓扑下复测**;
      若仍无信号,可考虑心跳写失败探测或上游提 issue (2026-08-31)
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
      **R9 在 Caddy + 自托管镜像的真实拓扑下与 R3 那条断连复测一起做**:若那时能拿到断开信号,
      这两条限制都可以放宽 (2026-08-31)
- [ ] R4 Timeline 的行时长是「本行首个事件 → 下一行首个事件」的间隔,不是事件自身的处理耗时——
      pi 的扩展事件只带一个时间戳,进程内拿不到真实耗时。当前口径对瀑布图是合理近似,
      若将来要显示真实耗时,需要在观测者里对成对事件(start/end)做配对计时 (2026-08-31)
- [ ] R4 **轨迹流的观众标识在「复制标签页」下会撞车**(codex 复审 P2):浏览器复制标签页会连
      `sessionStorage` 一起复制,两个标签页共用同一个 `clientId`,后开的那个会把先前那个让位掉,
      先前那个收到 `superseded` 后停更(刷新或切会话可恢复)。改成「每次页面加载换新 id」能避开
      复制标签页,但会把代价换成更常见的刷新——每刷一次漏一个名额到 5min 超时。两头都占住需要
      「连接代次」这类协议字段,属机制类改动,按缺陷门禁规则不在非阻塞 findings 的整改范围。
      **与那条「断开探测不到」一起在 R9 真实拓扑下重估**:若届时能拿到断开信号,让位机制整个可以退役 (2026-08-31)
- [ ] R4 **快速切会话仍有一个窄窗口能让位错人**(codex 复审 P2 的残留):占名额已提到第一个
      `await` 之前,占槽顺序 = 请求到达顺序,消除了"谁的库查询先返回谁先占槽"这个主因;
      但若网络把两个请求的到达顺序也调换了(B 后于 C 到达),仍会由已经没人读的 B 把 C 让位掉。
      彻底解决同样需要「连接代次」,与上一条一并在 R9 重估 (2026-08-31)
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

## 功能提案(需所有者裁定)

(空)
