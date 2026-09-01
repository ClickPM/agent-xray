# Round 08 — metrics 打点 + About 真实化 + 统计查询 MCP 工具

> 状态:已完成(codex 三轮共 3 条 findings 全采纳整改,第 3 轮零 findings,缺陷门禁 PASS)

## 目标

站点的最后两块假数据消失:**访问统计有了真实数据面**(`POST /t` 打点 → `visits` → MCP 统计 tools),
**About 页不再持有任何硬编码内容**(全部来自 `about_content`,经 MCP 维护)。
可证伪判据:库里搜不到任何原始 IP;MCP 统计结果与实际打点逐项对得上;
经 MCP 改一次 About 内容,刷新前端即生效。

## 前置

- R6 已完成:`about_content` 表与 `about_get` / `about_set` 工具已在库、MCP 管理面可用。
- 本轮**不依赖 R7**(沙箱与配额在另一分支并行):`visits` 与 `agent_ro` 无交集,
  `docs/security.md` §2 早已把 `visits` 列进「agent_ro 无任何权限」的清单,R7 建角色时照办即可。
- 本机需要 `apps/api/.secrets.local.cue` 里有 `MetricsIpSalt`(gitignored,值任意)。

## 所有者裁定(2026-09-01,开工前)

| # | 问题 | 裁定 |
|---|---|---|
| 1 | 画板 2e 的「公开仓库 / 语言构成」两块 R6 没进表,仍是 `demo-data.ts` 硬编码,怎么办 | **扩表两列 + 扩 `about_set`**。整页由 MCP 维护,前端零硬编码 |
| 2 | ROUNDS.md 写「github/origin 双链」,但画板 2e 只画了一个 GitHub 按钮 | **加同款 ghost 按钮「origin ↗」,`originUrl` 为空时不渲染**——空值时页面与画板一字不差 |

## 交付物

**后端 · metrics 服务(新)**

- `apps/api/agent/migrations/004_metrics.up.sql` —— `visits` 计数行表 + 按天索引
- `apps/api/metrics/beacon.ts` —— `POST /t`(`api.raw`,`sensitive: true`,`bodyLimit 1024`)
- `apps/api/metrics/visitor.ts` —— 加盐哈希 / 来源 IP 取值与网段收敛 / UA 摘要
  (**原始 IP、UA 的作用域到此为止**;哈希输入必须全部有界,见「代码审查」)
- `apps/api/metrics/path.ts` —— 路径归一(形状白名单 + 库内存在性校验)
- `apps/api/metrics/store.ts` · `db.ts` · `secrets.ts`(`MetricsIpSalt`)· `README.md`
- `apps/api/shared/site-time.ts` —— 站点时区(UTC+8)的自然日;写入方与读取方共用同一个「今天」

**后端 · about 服务(新)**

- `apps/api/agent/migrations/005_about_showcase.up.sql` —— `about_content` 增 `repos` / `lang_bar` 两列
- `apps/api/about/about.ts`(`GET /about`)· `store.ts` · `db.ts` · `README.md`

**后端 · MCP 管理面**

- `apps/api/mcp/tools.ts` —— 新增 `traffic_overview` / `traffic_paths` / `traffic_agents`(只读);
  `about_set` 扩两个字段并**改成部分更新**;`about_get` 描述同步
- `apps/api/mcp/store.ts` —— About 部分更新的 COALESCE 写法 + 三个统计聚合查询
- `apps/api/mcp/README.md` —— 工具数 21 → 24,新增段落

**前端**

- `apps/web/app/(site)/about/page.tsx` —— 数据源换成 `api.about.get()`,加 origin ghost 按钮,分块按有无数据渲染
- `apps/web/components/Beacon.tsx` —— pageview 打点(sendBeacon 优先,fetch keepalive 兜底),渲染 null
- `apps/web/components/SiteFooter.tsx` —— ICP 备案号占位(`ICP_BEIAN` 未配置则整块不渲染)
- `apps/web/app/(site)/layout.tsx` —— 挂上面两个组件
- `apps/web/lib/demo-data.ts` / `lib/types.ts` —— About 的五项硬编码与 `RepoCard` 类型删除
- `apps/web/lib/api-client.ts` —— `dev.ps1 gen` 重生成(多出 `about` / `metrics` 两个命名空间)

**配置与文档**

- `dev.ps1` —— `$hostedServices` 补 `metrics,about`
- `deploy/infra-config.json` —— secrets 增 `MetricsIpSalt`
- `deploy/.env.example` · `deploy/docker-compose.yml` —— `METRICS_IP_SALT`(`:?` 硬要求)、`ICP_BEIAN`(可空)
- `docs/security.md` §6 —— R8 落地补记(哈希口径 / UA 摘要 / 路径归一 / `sensitive`)
- `docs/deploy-environments.md` —— 部署步骤的 `.env` 清单补两项
- `.gitattributes` —— `*.ts` / `*.tsx` 强制按文本 diff(见下方「本轮实测」第 5 条)

**测试**

- `apps/api/metrics/metrics.test.ts`(23 项)· `apps/api/mcp/mcp.test.ts` 增外链校验 / About / 统计聚合三段(15 项)

## 验收

| # | 检查 | 命令 / 期望 | 结果 |
|---|---|---|---|
| 1 | 编译与测试 | `dev.ps1 check` / `dev.ps1 test` 全过 | ✅ 9 files / 147 tests passed(第 2 轮整改后) |
| 2 | 前端类型与生产构建 | `npx tsc --noEmit`、`npx next build` 无错 | ✅ 构建通过 |
| 3 | 打点端到端 | 浏览 `/`、`/notes`、`/about` 后 `visits` 有对应计数行 | ✅ 8 PV / 2 visitor / 3 路径 |
| 4 | **库中无原始 IP** | `SELECT * FROM visits` 只有 32 位 hex 的 `visitor` | ✅ 无任何 IP 形状的值 |
| 5 | 原始 IP 不进 trace | metrics trace 的 `request_payload` 为 `<redacted>` | ✅ `sensitive: true` 生效 |
| 6 | 路径归一挡灌库 | 直发 `/wp-admin.php`、`/notes/<不存在>`、`//evil.com/x` 一律落 `/*` | ✅ 四次合并成一行 `/*` |
| 7 | query/hash 被丢掉 | 直发 `/about?utm=spam` 记成 `/about` | ✅ |
| 8 | **统计结果与打点一致** | 三个 tool 的 PV/UV/路径/UA 与库内逐项核对 | ✅ 见下方实测 |
| 9 | **About 经 MCP 改后前端生效** | `about_set` 写入 → `GET /about` → 页面渲染 | ✅ 双链 + 5 条 buildPoints + 3 张仓库卡 + 4 段语言条 |
| 10 | About 部分更新不丢数据 | 只传 `intro` 时 repos / langBar / buildPoints 原样保留 | ✅ 单测覆盖 |
| 11 | 备案号占位 | `ICP_BEIAN` 未配置无底栏;配置后底部出现并链到工信部 | ✅ 两种情况都实测 |
| 12 | 前端零 About 硬编码 | `demo-data.ts` 里搜不到 buildPoints / repos / langBar / githubUser | ✅ |
| 13 | **visitor 取值有界**(审查整改后新增) | 伪造 XFF 首段 ×3 + 换 UA 串 ×4 + 同 /24 换主机位 ×5 = 12 次请求 | ✅ 合并成 1 行 hits=12 |
| 14 | **只配 originUrl 时链接可见**(同上) | 清空其余字段后页面仍渲染 origin 按钮 | ✅ |
| 15 | **畸形外链入不了库**(第 2 轮整改后新增) | 经 MCP 直发 `https://` / `http://?x` / `javascript:…` | ✅ 三个全拒且未入库 |

## 禁止

- 不改前端页面样式(规则 7)。About 页只换数据源;新增的 origin 按钮复用同一份 `ghostLink`
  样式对象;`SiteFooter` 在未配置备案号时不渲染,因此开发与预发的版式与画板完全一致。
- 不加设计稿没有的功能(规则 8)。统计**没有**任何公开展示面(画板 3c 已随 `/admin` 废弃),
  读面只有 MCP 的三个只读 tool。
- 不碰 R7 的沙箱与配额:顶栏统计条的 tokens / cost / ctx 不在本轮拆解里,已记 BACKLOG。
- 不在本轮碰 `agent_ro` 授权语句(建角色在 R7、授权顺序在 R9)。

## 代码审查

- 审查方式:codex `/codex:review`(`--background`,范围 = branch diff against main)

### 第 1 轮 — 2 条 findings,**全部采纳整改**

**[P1] `visitor` 的哈希输入含原始 UA,`/api/t` 可被用来无界撑库 — `metrics/visitor.ts`**

**采纳,判定属实且比 finding 描述的更宽**。`visitor` 是 `visits` 主键的一部分,而 `/t` 无认证:
哈希输入里任何一个分量只要请求方能自由左右,他就能自由制造新行。审查者指出了原始 UA 串
这一条;复核时发现 **IP 那条同样成立**——`clientIp` 取的是 `X-Forwarded-For` 的**第一段**,
而 Caddy 的 `reverse_proxy` 是**追加**不是覆盖,所以第一段恰恰是请求方自己写的那个。
两条合起来:一个 curl 循环就能把 `visits` 撑到磁盘满。路径归一挡不住这个,它只管 path 那一维。

整改口径是**让哈希的每个输入分量都有界**,而不是加限流或行数上限(后者是新机制):

| 分量 | 整改前 | 整改后 | 上界 |
|---|---|---|---|
| `day` | 一天一值 | 不变 | 1 |
| `ua` | **原始 UA 串** | `uaDigest` 闭集 | ≤42 |
| `ip` | XFF **第一段**的完整地址 | XFF **最后一段** → 收敛到网段(IPv4 `/24` / IPv6 `/48`) | 真实网段数 |
| `path` | 已有界 | 不变 | 站内路径数 |

取最后一段是因为那一段由我们自己的反代写入;**这条依赖「Caddy 前面没有别的代理」**,
将来加 CDN / 云 LB 必须改成「从右往左跳过 N 层可信代理」,已写进代码注释与 `docs/security.md` §6。
IP 收敛到网段同时是隐私改进:一台机器手上常有一整个 IPv6 `/64`,逐个换地址几乎零成本,
收到 `/48` 之后再怎么换都是同一行。代价是同网段 + 同浏览器族的两位访客会被算成一个人
——个人站量级下可接受的低估。

**实测复现与验证**(12 次请求,整改前会产生 12 行):

```
伪造 XFF 首段 ×3(1.1.1.1 / 2.2.2.2 / 3.3.3.3,真实对端同一个)
换 Chrome 版本号 ×4(同族不同串)
同 /24 内换主机位 ×5(203.0.113.1 … .5)
→ 整改后:1 行,hits = 12
```

**[P2] 只配了 `originUrl` 时头部整块不渲染,那条链接永远不出现 — `about/page.tsx`**

**采纳**。`about_set` 的每个字段都可省略,「只有 originUrl 的库行」是合法状态,而外层守卫
写的是 `(gh || about.intro)`。改成 `(gh || origin || about.intro)`。
实测:清空 githubUser / intro / 三个数组、只留 originUrl 后,页面正确渲染 origin 按钮,
且不出现 GitHub 按钮与 404 头像。

### 顺带记入 BACKLOG(不当场改)

`apps/api/mcp/audit.ts` 的 `remoteOf` 与 `mcp/server.ts` 的 `remoteOfRequest` 也取 XFF 第一段,
同样可被写入方伪造。影响有界(管理面只有一个使用者、认证不依赖这个头,它只是审计线索),
属跨轮次问题,按 CLAUDE.md 记 `rounds/BACKLOG.md` 不顺手改。

### 自测抓到的第三个缺陷(不在 findings 里)

写 P1 整改的用例时抓到 `ipNetwork` 的第一版对 IPv6 直接 `split(":")` 取前三组是**错的**:
`fe80::1` 会切成 `["fe80","","1"]`,把**主机位**当成了网段的一部分,于是 `fe80::1` 与 `fe80::2`
落进两个不同的桶——那正好复活了 P1 要消除的「一个 `/64` 里换地址就能造新行」。
已改成先展开 `::` 再取前三组并做前导零归一,补了 4 条用例(压缩/未压缩必须同桶)。

### 第 2 轮 — 1 条 finding,**采纳整改**(范围仍为 branch diff against main:CLAUDE.md「前两轮全量」)

**[P3] `originUrl` 的前缀匹配放得过 `https://` 与 `http://?x` — `mcp/tools.ts`**

**采纳**。`/^https?:\/\//` 只看开头,`https://`(没有主机)与 `http://?x` 都能通过,
于是一个点不开的链接进得了库、也渲染得出来。前端 `safeExternal` 是同一份判据,
所以两道防线一起漏。

整改是**换判据、不是加机制**:交给 WHATWG 的 `URL` 解析,再要求
`protocol ∈ {http:, https:}` **且** `hostname` 非空。两个条件缺一不可 ——
`new URL("javascript:alert(1)")` 是**能解析成功**的(protocol=`javascript:`、hostname 为空),
只判解析成功等于把原来防的 XSS 又放回来。服务端与前端两处同步改(web 与 api 不共享源码,规则 6)。

实测经 MCP 直发:`https://` / `http://?x` / `javascript:alert(1)` 三个全部被拒且未入库,
`https://ok.example.com/x` 正常写入。补 4 条单测(共 147 项通过)。

### 第 3 轮 — 零 findings

范围按 CLAUDE.md「第 3 轮起只审整改 diff」收窄为 `--base 8112879`(第 2 轮已审提交)。
审查结论原文:URL 校验现在正确地要求「可解析的 http(s) 地址 + 主机名」,前端在渲染前
应用同一份校验,新增用例覆盖了畸形与不安全输入。

- 结论:**整改后 PASS**。三轮共 3 条 findings(1×P1、1×P2、1×P3)**全部采纳整改**,
  末轮零 findings,**缺陷门禁 PASS**。另有 1 条跨轮次问题(`mcp/audit.ts` 的 XFF 取首段
  同样可被伪造)按 CLAUDE.md 记 `rounds/BACKLOG.md`,不当场改。

## 失败处理

同一验收项针对性整改后连续 2 次验证仍不过 → 写 `rounds/round-08/BLOCKED.md`,停下呼人。

## 本轮实测

**1. 统计口径的核心取舍:visitor 按天轮换,所以「区间 UV」这个数不存在**

访客标识是 `sha256(salt ‖ day ‖ IP网段 ‖ UA摘要)` 的前 128 bit(输入分量的收敛见「代码审查」第 1 轮 P1)。把 `day` 放进哈希输入,是为了
让「库整个泄漏也串不出任何人的跨天访问史」成立。直接后果是**跨天的 visitor 不可比**:
近 30 天只能给「各日 UV 之和」。三个 tool 里它一律叫 `visitorDays` 而不是 UV,
description 里逐个重申过——一个叫 UV 的字段被读成「多少个人」是迟早的事。

**2. `POST /t` 是无认证的公开写入口,所以路径必须归一**

第一版只做形状白名单,随即发现挡不住灌库:`/notes/aaaa`、`/notes/aaab`… 全是合法形状,
任何人都能让 `visits` 长到任意大。最终口径是**形状白名单 + 库内存在性校验**,归不出来的
一律折进常量桶 `/*`。行数上界从此由站内内容量决定,而不是由请求方决定。
代价是每次打点多一次走唯一索引的 EXISTS 查询——本站量级下可忽略。

实测直发的四种脏输入(`/wp-admin.php`、`/notes/does-not-exist`、`//evil.com/x`、
指向已删系列的 `/notes/pi/01`)全部合并进同一行 `/*`。

**3. 两个「今天」必须是同一个**

第一版用 SQL 的 `CURRENT_DATE` 切区间,而落库的 `day` 是 JS 按站点时区算的。
Postgres 容器默认 UTC,两者在跨日附近会错开一天——不报错、也不好复现。
改成时间源只在 JS 侧(`shared/site-time.ts`),SQL 只收一个算好的日期参数。
时区固定 UTC+8 且不做成配置项:用 `Intl` 按 IANA 时区算要依赖容器里有完整 ICU 数据,
而中国自 1991 年起没有夏令时,固定偏移在这里是精确的而不是近似。

**4. 爬虫识别里 `\bbot` 是写错的(自测抓到)**

`\b(bot|crawler|…)\b` 匹配不上 `Googlebot`——几乎所有爬虫都是「厂商 + bot」连写,
前置词边界一个都命中不了。改成 `bot\b|…` 并补了 Googlebot / bingbot / YandexBot /
Twitterbot / curl / HeadlessChrome 六条用例。

**5. `apps/api/mcp/mcp.test.ts` 里混着一个裸 NUL 字节(R6 遗留),git 把整个文件判成二进制**

表现是 `git diff` 显示 `Bin 14975 -> 20419 bytes`——**代码审查者读不到这个文件的任何改动**。
本轮往这个文件里加了 141 行测试,不修的话那 141 行等于没写。已把它换成 `\0` 转义写法
(字节语义不变),并在 `.gitattributes` 里给 `*.ts` / `*.tsx` 加上 `diff` 属性兜底:
再混进控制字符时,diff 仍然可读,而不是整份消失。

**6. `about_set` 从「整体覆盖」改成「部分更新」**

字段从 4 个涨到 6 个、其中两个是几十行的数组之后,整体覆盖就变成了一个只会静默丢数据的
接口:「只想改一句 intro」必须把 7 张仓库卡与整条语言构成原样重报一遍,少报一个字段不会
报错、只会把它清空。改成部分更新后,清空是显式动作(传 `""` / `[]`),与
`llm_provider_upsert` 的口径一致。

**7. 备案号底栏必须 `await connection()`**

Runtime Tab(`/`)原本是静态页,`SiteFooter` 会在 `next build` 期间被预渲染,
`process.env.ICP_BEIAN` 于是被烧进构建产物——而镜像是不可变制品、预发与生产共用同一个
SHA(规则 10),备案号只可能在部署期由 compose 注入。表现会是「配了也不显示,且只在 `/`
上不显示」。加 `connection()` 后 `next build` 的路由表里 `/` 从 `○ Static` 变成
`ƒ Dynamic`,实测配上 `ICP_BEIAN` 后底栏正常渲染并链到 `beian.miit.gov.cn`。

**8. 三个统计 tool 的实测输出**(浏览 `/` ×3、`/notes` ×2、`/about` ×3 之后)

```
traffic_overview → { timezone: "UTC+08:00", from: 2026-08-03, to: 2026-09-01,
                     pageviews: 8, visitorDays: 2, daily: [{2026-09-01, pv 8, uv 2}] }
traffic_paths    → [ {/, pv 3}, {/about, pv 3}, {/notes, pv 2} ]
traffic_agents   → [ {Chrome/Windows, pv 5}, {Edge/Windows, pv 3} ]
```

与 `SELECT day, path, visitor, ua, hits FROM visits` 逐行核对一致。

**9. 审查整改后的口径变化(codex 第 1 轮 P1)**

`visitor` 的哈希输入从 `salt ‖ day ‖ ip ‖ ua` 改成 `salt ‖ day ‖ IP网段 ‖ UA摘要`。
**这不是「更保守一点」的调整,而是一个安全前提的修复**:`visitor` 是主键的一部分,
而 `/t` 无认证——哈希输入里只要有一个分量是请求方能自由左右的,这个端点就是一条
撑爆数据库的通道。原先 UA(原始串)与 IP(XFF 第一段,而 Caddy 是追加不是覆盖)
两个分量都满足这个条件。

副作用要说清:UV 从此是**按网段 + 浏览器族**去重,不是按设备。同一个 `/24` 里用同款
浏览器的两位访客会被算成一个人。这是有意的取舍——换来的是「行数上界不由请求方决定」。

**10. 与计划的偏离**

- **新增了两个服务目录**(`metrics` 与 `about`),不是一个。ROUNDS.md 只提到 metrics;
  About 的访客读路径没有合适的落点——放 `notes` 与那个服务的职责不符,放 `system`(健康检查)
  更勉强。`about` 是单端点只读服务,与 notes(读)/ mcp(写)的分工同构。
  两个名字都已补进 `dev.ps1` 的 `--services` 白名单。
- **UA 摘要分布(`traffic_agents`)不在 ROUNDS.md 的聚合清单里**(那里写的是 PV/UV/路径分布/
  近 30 天趋势)。但打点规格明确要求存「UA 摘要」,存了却没有任何读路径等于存了个只能靠
  手写 SQL 才看得到的列。多这一个只读 tool 不引入新机制,聚合 SQL 与另外两个同构。
