# metrics 服务(R8 已落地)

自托管访问统计。**无第三方脚本、无 cookie、不存原始 IP**(`docs/security.md` §6)。

## 端点

`POST /t`(对外 `/api/t`,走既有 `/api/*` 反代,无需新增 Caddy 路由)——
`api.raw` pageview beacon。请求体 `{"path":"/notes/pi/01"}`,响应恒 204。

前端打点在 `apps/web/components/Beacon.tsx`(挂在 `(site)/layout.tsx`,渲染 null)。

## 这个端点的三条性质

1. **无认证的公开写入口。** 所以进库的每一列都必须是**服务端派生的闭集值** ——
   客户端唯一能给的原始输入是一个 path 字符串,而它不会原样落库。
2. **原始 IP 与原始 UA 一个字节都不落库**,也不进日志。它们只在 `visitor.ts` 的
   函数栈里出现过。`api.raw` 的 `sensitive: true` 是必须的:不设的话 Encore 会把
   请求头(含 `X-Forwarded-For`)原样写进 trace。
3. **打点失败绝不能变成访客可见的错误。** 库挂了、盐没配、路径不认识,对访客一律
   是 204。唯一的例外是请求体读不出来 —— 那是接线错误,回 400 才能在开发期被发现。

## 文件

| 文件 | 职责 |
|---|---|
| `beacon.ts` | `POST /t` 入口。派生 → 落库 → 204,全程不抛 |
| `visitor.ts` | 加盐哈希与 UA 摘要。**原始 IP/UA 的作用域到此为止** |
| `path.ts` | 路径归一(形状白名单 + 库内存在性校验),归不出来的落常量桶 `/*` |
| `store.ts` | `visits` 的计数行 upsert |
| `secrets.ts` | `MetricsIpSalt`(规则 5:secret 只能在 service 目录内声明) |

「站点时区的今天」在 `apps/api/shared/site-time.ts` —— 写入方(本服务)与读取方
(mcp 的统计 tools)必须用同一个「今天」,否则近 N 天的区间会在跨日附近错开一天。

## 数据形状与三条口径

`visits` 是 **(day, path, visitor) 的计数行**(`agent/migrations/004_metrics.up.sql`),
不是一行一次 pageview。

1. **为什么是计数行**:一行一 pageview 的表在被人对着 `/t` 打循环时会无界增长;
   计数行让「同一访客当天在同一页刷一万次」只变成一行的 `hits`。
2. **为什么路径要校验存在性**:光有形状白名单挡不住灌库 —— `/notes/aaaa`、
   `/notes/aaab`… 全是合法形状。校验 slug 真实存在之后,行数上界由**站内内容量**
   决定,而不是由请求方决定。代价是每次打点多一次走唯一索引的 EXISTS 查询。
3. **为什么 UV 只能按天**:`visitor` 的哈希输入里含日期,跨天不可关联(这是隐私
   设计的直接后果)。所以区间总量只能给「各日 UV 之和」,统计 tool 里它叫
   `visitorDays` 而不是 UV —— 免得被读成「多少个人」。

## 展示面

统计的读面是 **MCP 管理面的三个只读 tool**(`apps/api/mcp/tools.ts`):
`traffic_overview` / `traffic_paths` / `traffic_agents`。
画板 3c 的 Traffic 页已随 `/admin` 废弃,**没有任何公开的统计查询端点**。

聚合 SQL 写在 `apps/api/mcp/store.ts` 而不是这里:与 trace 服务只读 agent 的
`trace_events` 是同一个先例 —— 表的归属在一处(本服务),读它的服务各自写自己的
store,不跨服务 import 内部实现。
