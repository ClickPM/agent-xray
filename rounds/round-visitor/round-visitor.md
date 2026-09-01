# Round VISITOR — 访客会话隔离 + 保留期 + 会话删除

> 状态:进行中
>
> 命名沿用 R-BUN 的「命名轮」先例:这不是 R0–R11 线性序列里的一环,是插在 R11(生产上线)
> 之前的一轮加固。ICP 备案未下来、生产尚未开站,是做这件事代价最小的时间点。

## 目标

一句话:**站点上线后,访客只能看见自己的会话**——会话/消息/轨迹三张表全部按访客归属过滤,
访客身份由服务端发放的 24h 滑动 cookie 承载;会话在最后活跃 3 天后被硬删;访客可主动删除自己的会话。

可证伪:两个不同浏览器(或一个正常窗口 + 一个无痕窗口)各建一个会话,任一方的会话列表、
`GET /agent/sessions/:id`、`GET /trace/stream?sessionId=<对方 id>` 都拿不到对方的任何内容。

## 前置

- R2 数据层(sessions / messages / trace_events)、R3 `/agent/ask`、R4 `/trace/stream` 已落地
- R11 尚未开始:生产库为空,130 预发库里只有冒烟数据,本轮的保留期规则可以直接生效

## 所有者裁定(2026-09-01)

本轮有三处**必须留档**的裁定,因为它们各自触到一条硬性规则:

1. **新增「会话删除」功能**(规则 8:严禁实现设计稿没有的功能)。设计稿画板 1a–1e 的会话列表
   没有删除入口。所有者裁定新增,理由:站点公开可访问后,访客需要一条自己清掉对话的通路,
   这是隐私功能而非产品功能。交互取**最小偏离**形态:会话行 hover 露一个 ×,点击弹浏览器
   原生 `confirm`——不引入任何新样式变量与新组件(规则 7)。
2. **引入访客 cookie**(规则 9:`docs/security.md` 是强约束)。原文 §4「无 cookie 会话」与
   §6「无 cookie、无 localStorage」在本轮之前是全站成立的;现在只对**管理面**与**打点组件**
   成立。文档已先于代码修改并写明理由(见 `docs/security.md` §6 的 R-VISITOR 补记)。
3. **24h 取滑动而非固定**:每次带 cookie 的请求把 `expires_at` 推到 `now()+24h`。
   代价是「连续 24h 不来」才失效,常来的访客身份长期不断;收益是不会在访客对话到一半时
   (跨过发放时刻 +24h)当场把会话从他眼前拿走。
4. **保留期按 `sessions.last_active_at` 起算 3 天**,不按 cookie 过期时刻起算。口径更简单、
   与「会话」这个被清理的对象直接对应;代价是一个 24h 内一直活跃的会话实际能活 3 天以上
   (从最后一次活跃算起)。

## 交付物

| 路径 | 内容 |
|---|---|
| `docs/security.md` | 新增 §6 R-VISITOR 补记(cookie 口径 / 归属鉴权 / 保留期 / CSRF);修订 §4、§6 里「无 cookie」的措辞范围 |
| `apps/api/agent/migrations/007_visitor_sessions.up.sql` | `visitors` 表 + `sessions.visitor_id` + 索引 |
| `apps/api/shared/visitor-cookie.ts` | cookie 名/解析/Set-Cookie 构造/token 哈希(agent 与 trace 两个服务共用的纯函数) |
| `apps/api/agent/visitor.ts` | 访客解析(只读)/ 发放 / 滑动续期 |
| `apps/api/agent/purge.ts` | 保留期清理(进程内定时器,自托管镜像不跑 Encore CronJob) |
| `apps/api/agent/store.ts` | 会话读写全部带 visitor 归属;新增 `deleteSession` / `sessionOwnedBy` / `purgeExpired` |
| `apps/api/agent/sessions.ts` | 列表/单查按归属过滤;新增 `DELETE /agent/sessions/:id` |
| `apps/api/agent/ask.ts` | 发放/续期 cookie;续接会话前校验归属 |
| `apps/api/trace/store.ts` · `stream.ts` | 轨迹流按归属放行(trace 仍只读、不写 visitors) |
| `apps/web/lib/agent-api.ts` · `components/workbench/Workbench.tsx` | 删除入口(hover × + 原生 confirm)与 404 兜底 |
| `apps/web/lib/api-client.ts` | `dev.ps1 gen` 重新生成(生成物,不手改) |
| `apps/api/agent/visitor.test.ts` · `store.test.ts` | 隔离、删除、保留期、滑动续期的自动化验收 |
| `apps/api/agent/README.md` · `apps/api/trace/README.md` | 端点与鉴权口径同步 |
| `ROUNDS.md` | 进度表加本轮;功能边界段补删除功能的裁定 |

## 验收

| # | 检查 | 命令 / 期望 | 结果 |
|---|---|---|---|
| 1 | 跨访客列表隔离 | `dev.ps1 test`:访客 A 的 `listSessions` 不含访客 B 的会话;无 cookie 时返回空列表 | ✅ 单测 +『curl 两个 cookie jar』双证:A 列表 1 条、B(无 cookie)`{"sessions":[]}` |
| 2 | 跨访客单查隔离 | `getSession(B 的 id)` 以 A 身份 → `not_found`(不是 403,不泄漏「这个 id 存在」) | ✅ 单测 + curl `404` |
| 3 | 跨访客轨迹隔离 | `GET /trace/stream?sessionId=<B 的 id>` 带 A 的 cookie → 404;不带 cookie → 404 | ✅ curl 两种情形均 `404`;本人取同一条流 `200` + `event: ready` |
| 4 | 跨访客续接隔离 | `POST /agent/ask` 带 B 的 sessionId + A 的 cookie → 404 | ✅ curl:他人 cookie `404`、无 cookie `404`、本人 `503`(本机未配 LLM,已过归属闸) |
| 5 | cookie 属性 | 响应头 `Set-Cookie` 含 `HttpOnly`、`SameSite=Lax`、`Path=/`、`Max-Age=86400`;`X-Forwarded-Proto: https` 时带 `Secure`,http 时不带 | ✅ `curl -i` 实测响应头齐全且**响应体里没有 token**;`Secure` 分支由单测覆盖;浏览器里 `document.cookie === ""`(HttpOnly 生效) |
| 6 | 滑动续期 | 连续两次请求间隔后 `visitors.expires_at` 被推到 `now()+24h`;过期行不再被认领,访客拿到新身份 | ✅ 单测(压到剩 1h → 认领后回到 ~24h;过期行认领得 null,`ensureVisitor` 发新身份且看不到旧会话) |
| 7 | 删除本人会话 | `DELETE /agent/sessions/:id` → 会话及其 messages / trace_events 级联清空 | ✅ 单测 + curl `200`,重复删 `404` |
| 8 | 删除他人会话失败 | 以 A 身份删 B 的会话 → `not_found`,B 的数据完好 | ✅ 单测 + curl `404` |
| 9 | 保留期清理 | `purgeExpired()`:`last_active_at` 早于 3 天的会话(含存量无归属会话)被删,新会话不受影响 | ✅ 单测 5 例(含边界「差一天不删」、存量无归属会话、幂等、访客行) |
| 10 | 前端隔离与删除交互 | 会话列表只出本浏览器的会话;删除按钮 hover 才出现,confirm 取消则不删 | ✅ 浏览器实跑:列表只出本 cookie 的 2 条;hover 才出 ×,取消不删,确认后 2→1 且左栏即时更新 |
| 11 | 样式零回归 | `git diff` 里 Workbench 除删除按钮外无样式/布局改动(规则 7) | ✅ diff 仅新增 hover 态与绝对定位的 × 及其 `position:relative` 容器;不 hover 时与画板 1a 一致(截图留证) |
| 12 | 编译与生成物 | `dev.ps1 check` 通过;`dev.ps1 gen` 后 `api-client.ts` 含 `deleteSession` 且前端类型对得上 | ✅ `dev.ps1 check` 通过;`dev.ps1 test` 11 文件 / 195 用例全过;`apps/web` `tsc --noEmit` 干净 |

## 禁止

- 不改前端页面样式(规则 7);本轮唯一允许的结构性改动是会话行的删除按钮,理由见「所有者裁定」1
- 不加设计稿没有的其他功能(规则 8):不做登录/注册、不做「导出会话」、不做 cookie 同意横幅
  (合规告知属所有者裁定事项,记 BACKLOG)
- 不动 metrics 的 `visits` 表与打点口径(那是另一套匿名身份,见 `docs/security.md` §6)
- 不引入 Encore `CronJob`(自托管镜像不执行它,加了等于留一个永不触发的假清理)
- 不给 `agent_ro` 任何 `visitors` 表权限

## 代码审查

<!-- 完成后回填 -->

- 审查方式:codex `/codex:review --background`(所有者裁定本轮走审查:改的是鉴权边界)。
  按 CLAUDE.md「审查范围」,前两轮用固定全量范围 `branch diff against main`。

**第 1 轮**(3 条:1×P1 · 2×P2),**全部采纳整改**:

| # | 级别 | findings | 处置 |
|---|---|---|---|
| 1 | P1 | 访客 cookie 会进 Encore trace(`Path=/` 让它跟着每一个同源请求走,而收它的端点没设 `sensitive`) | **采纳**。实测证实**比 findings 说的多一处**:trace 里 `request_headers.cookie`、`response_headers.set-cookie`、`response_payload`(Encore 记的是处理函数**返回值**,`visitorCookie` 字段在那里还没被抽成响应头)**三处**都有明文 token。给 5 个 agent 端点 + `/trace/stream` 加 `sensitive: true`;另外给三个**浏览器直达**的 notes 端点(`/rss.xml`、`/rss/:file`、`/assets/notes/…`)也加上 —— 它们根本不看这个 cookie,但 `Path=/` 会把它一并送过去。整改后重抓 trace:请求头/响应头整段消失,两个 payload 都是 `<redacted>` |
| 2 | P2 | 前端删除失败仍在 `finally` 里 `startNew()`,把**没被删掉**的会话从界面上抹掉 | **采纳**。清空当前会话挪进 `.then()`;并在 `lib/agent-api.ts` 里把 404 当成成功(「它已经不在了」= 删除的目的达成),其余错误(409 / 5xx / 断网)照常抛出、保留选中。原实现与它自己注释里那句「失败只刷新列表」自相矛盾 |
| 3 | P2 | 删除端点的 `rec.busy` 读检查与异步 `disposeSession` 不原子,并发 ask 能挤进来 | **采纳**。改用 `runtime.claim()` —— 与 `/agent/ask` 同一把**同步**检查+置位的闸,认领失败回 409;认领后若 `disposeSession` 抛错则把 `busy` 还回去。同时改 `ask.ts`:用户消息落库失败时**无论是否新建会话**都释放运行时会话 —— 落库失败的一个真实原因就是「会话刚被自己在另一个标签页删了」,原来只在 `isNew` 时释放会让一个指向已删除数据的 pi 会话占着并发名额直到 15 分钟空闲回收 |

**第 2 轮**(全量 `--scope branch`;首次自动判据误选了 working-tree,重发时显式指定范围)。
3 条:2×P1 · 1×P2 —— **1 条采纳整改、1 条所有者裁定不修、1 条写明理由不采纳**:

| # | 级别 | findings | 处置 |
|---|---|---|---|
| 4 | P1 | `.mcp.json` 的 `xray-admin-130` 让管理面 bearer token 走明文 HTTP | **所有者裁定不修**(2026-09-01):「130 内网不用管安全问题」。已记 `rounds/BACKLOG.md` 并关闭,**边界写明仅限 130 内网** —— R11 的生产管理面在公网上,同样形态不成立。注:这条不属于本轮改动(是工作区里所有者自己的 `.mcp.json` 修改),第 1 次复审因自动判据选中 working-tree 才被扫到 |
| 5 | P1 | 第 1 轮只标了「我能枚举出的浏览器直达端点」,`/api/notes/series`、`/api/about`、`/health` 仍用默认 tracing,cookie 照样进 trace | **采纳**。这是第 1 轮整改**不彻底**:`Path=/` 下任何同源路径都会收到 cookie,逐个枚举「谁会被浏览器直接访问」本身就是错的方法。改为一条**不变量**:**每个 `expose: true` 端点都必须带 `sensitive: true`**,当前 16 个已全部覆盖(判据:两个 grep 的条数相等)。写进 `shared/visitor-cookie.ts` 与 `docs/security.md` §6。**未改 Path**:codex 点到的路径本来就在 `/api` 下,收窄 Path 一条都挡不住,却会让直连 `:4000` 的本地调试悄悄失效并把 cookie 与反代前缀绑死 |
| 6 | P2 | 认证成功但业务失败的响应(404/409)没重发 cookie,滑动窗口在这些路径上断了 | **写明理由不采纳**。Encore 的 `APIError` 没有响应头这一层(实测 `api/error.ts`),要修就得把 404 改成「200 + 错误字段」或为它单开 `api.raw`,前者是更糟的接口、后者是机制类改动(CLAUDE.md 审查边界:非阻塞 findings 不新增机制)。**兜底**:滑动靠成功响应维持,工作台每次挂载与每轮对话结束都调用会成功的 `listSessions`。残留风险只在「连续 24h 只收到错误响应」的 curl/爬虫形态上。已记 BACKLOG,并把 `sessions.ts` 文件头那句被证伪的「每条响应都重发」改成准确口径 |

- 结论:<待第 3 轮复审>

## 失败处理

同一验收项针对性整改后连续 2 次验证仍不过 → 写 `rounds/round-visitor/BLOCKED.md`,停下呼人。

## 本轮实测

### 1. Encore 的响应 cookie / 响应头字段**不穿透类型别名**(本轮最大的坑)

把响应字段抽成类型别名复用,Encore 的静态解析器认不出来,会**静默**把它当成普通响应体字段:

| 写法 | 实测结果 |
|---|---|
| `type VisitorCookie = Cookie<string, "xr_visitor">` 再复用 | ❌ 无 `Set-Cookie` 头;响应体变成 `{"session":{…},"visitorCookie":{"httpOnly":true,"maxAge":86400,…,"value":"<明文 token>"}}` |
| `type VisitorCookie = Header<string, "Set-Cookie">` 再复用 | ❌ 无 `Set-Cookie` 头;响应体里 `"visitorCookie":"xr_visitor=<明文>; Path=/; …"` |
| 字段处**内联** `Cookie<string, "xr_visitor">` | ✅ 发头 |
| 字段处**内联** `Header<string, "Set-Cookie">` | ✅ 发头(最终采用) |

两个后果都是致命的:①浏览器根本收不到 cookie,访客身份永远建立不起来;②身份 token 明文
进响应体,页面里任何 JS 都读得到,`httpOnly:true` 成了一句写在 JSON 里的空话。
**而它编译通过、请求 200、字段也在** —— 只有 `curl -i` 抓响应头才看得出来。

最终选 `Header<string, "Set-Cookie">` 而不是内联的 `Cookie<>`:两条 `api.raw`
(`/agent/ask`、`/trace/stream`)只能自己拼字符串,用 `Cookie<>` 等于让同一个 cookie 的属性
在两处各写一遍,漂掉一个 `httpOnly` 在浏览器里是看不出来的(后一个 Set-Cookie 直接覆盖前一个)。
现在属性只有 `shared/visitor-cookie.ts` 的 `buildSetCookie` 一个来源。

### 2. Encore `CronJob` 在自托管镜像里不执行

官方文档明确:cron 由 Encore **平台**按注册时刻调用端点,本地开发与 Preview 环境都不执行。
本项目是 `encore build docker` + compose 自托管(规则 10),写 `new CronJob(...)` 只会得到一个
看起来很正规、实际永不触发的假清理。保留期清理因此落在 `apps/api/agent/purge.ts` 的进程内
定时器上(每小时一次,`unref()` —— 不 unref 的话 `encore test` 跑完要等一个钟头才退出)。

### 3. 没能在本机跑到的一条路径,以及为什么仍然判它成立

`/agent/ask` **新建会话**那条分支(`ensureVisitor` → `writeHead(200, {...SSE_HEADERS, "Set-Cookie"})`)
在本机跑不到:R6 之后 LLM 凭据的唯一来源是 `llm_config` 表,而本机没有配 provider,
`acquireSession` 在到达那行之前就抛 `LlmNotConfiguredError` 回 503。

**没有为此去改本机 secrets 或插一条假 provider** —— 那要动所有者的 `.secrets.local.cue`。
判它成立的依据是:同一个 `api.raw` 端点的 `fail()` 路径用的是**同一套机制**(node `writeHead` +
`Set-Cookie` 键),而它已被实测证明有效(带 cookie 的 503 响应确实带回了 `Set-Cookie`);
剩下的差异只是一次对象展开。**仍然把「新会话首帧带 Set-Cookie」列进 130 预发冒烟**,
那里配了真 provider(与 R4 把镜像实跑冒烟并入 R9 是同一种处理)。

### 4. 其他

- **`apps/web/lib/api-client.ts` 的 diff 里有两行与本轮无关**:`Environment()` 里的应用 id
  从 `qpquw` 变成 `936eu`。`encore.app` 的 `id` 是空的,本地 app id 由 daemon 分配,
  重新注册后会变;这两行是生成物,不手改(规则 6)。该函数指向 Encore Cloud 环境,本项目不用。
- 生成客户端对 `Set-Cookie` 发了 `mustBeSet`,浏览器侧被 `!BROWSER` 跳过、当前无影响,
  但从 SSR 调 `client.agent.*` 会抛 `DataLoss` —— 已记 BACKLOG。
- 开工时发现本机 `next dev` 在服务一个坏掉的构建(`.next/static/chunks` 目录不存在、
  `main-app.js` 404、页面完全不 hydrate),与本轮改动无关,重启后正常。
