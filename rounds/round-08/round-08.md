# Round 08 — metrics 打点 + About 真实化 + 统计查询 MCP 工具

> 状态:进行中(实现与自测完成,待 codex 审查)

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
- `apps/api/metrics/visitor.ts` —— 加盐哈希 / 来源 IP 取值 / UA 摘要(**原始 IP、UA 的作用域到此为止**)
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

- `apps/api/metrics/metrics.test.ts`(18 项)· `apps/api/mcp/mcp.test.ts` 增 About 与统计聚合两段(11 项)

## 验收

| # | 检查 | 命令 / 期望 | 结果 |
|---|---|---|---|
| 1 | 编译与测试 | `dev.ps1 check` / `dev.ps1 test` 全过 | ✅ 9 files / 138 tests passed |
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

## 禁止

- 不改前端页面样式(规则 7)。About 页只换数据源;新增的 origin 按钮复用同一份 `ghostLink`
  样式对象;`SiteFooter` 在未配置备案号时不渲染,因此开发与预发的版式与画板完全一致。
- 不加设计稿没有的功能(规则 8)。统计**没有**任何公开展示面(画板 3c 已随 `/admin` 废弃),
  读面只有 MCP 的三个只读 tool。
- 不碰 R7 的沙箱与配额:顶栏统计条的 tokens / cost / ctx 不在本轮拆解里,已记 BACKLOG。
- 不在本轮碰 `agent_ro` 授权语句(建角色在 R7、授权顺序在 R9)。

## 代码审查

<!-- 完成后回填 -->

- 审查方式:
- findings 处理:
- 结论:

## 失败处理

同一验收项针对性整改后连续 2 次验证仍不过 → 写 `rounds/round-08/BLOCKED.md`,停下呼人。

## 本轮实测

**1. 统计口径的核心取舍:visitor 按天轮换,所以「区间 UV」这个数不存在**

访客标识是 `sha256(salt ‖ day ‖ ip ‖ ua)` 的前 128 bit。把 `day` 放进哈希输入,是为了
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

**9. 与计划的偏离**

- **新增了两个服务目录**(`metrics` 与 `about`),不是一个。ROUNDS.md 只提到 metrics;
  About 的访客读路径没有合适的落点——放 `notes` 与那个服务的职责不符,放 `system`(健康检查)
  更勉强。`about` 是单端点只读服务,与 notes(读)/ mcp(写)的分工同构。
  两个名字都已补进 `dev.ps1` 的 `--services` 白名单。
- **UA 摘要分布(`traffic_agents`)不在 ROUNDS.md 的聚合清单里**(那里写的是 PV/UV/路径分布/
  近 30 天趋势)。但打点规格明确要求存「UA 摘要」,存了却没有任何读路径等于存了个只能靠
  手写 SQL 才看得到的列。多这一个只读 tool 不引入新机制,聚合 SQL 与另外两个同构。
