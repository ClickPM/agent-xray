# trace 服务

运行时轨迹 SSE(R4 落地)。

## 端点

`GET /trace/stream?sessionId=<uuid>[&afterSeq=<int>][&clientId=<token>]` — `api.raw` SSE。

先回放该会话已有轨迹(Postgres + `shared/trace-bus` 的内存缓冲,按 seq 去重合并),
再转 live tail。帧契约:

| 帧 | 载荷 | 含义 |
|---|---|---|
| `event: trace` | `{seq, eventType, mode, timestamp, data}` | 一条轨迹事件 |
| `event: ready` | `{lastSeq}` | 回放结束,此后是 live |
| `event: bye` | `{lastSeq, reason}` | 服务端主动收尾;客户端凭 `lastSeq` 重连 |
| `: hb` | — | 15s 心跳,穿透反代空闲超时 |

`afterSeq` 是断线续读游标(缺省 -1 = 从头);`clientId` 标识观众(见下)。
`sessionId` 不存在返回 404,参数不合法 400,名额耗尽 429。

## 边界

- **只读**:`trace_events` / `sessions` 的 schema 与迁移归 agent 服务;本服务经
  `SQLDatabase.named("agent")` 引用,不建表、不加迁移、不写库。
- **不 import agent 服务的内部实现**:live 事件走中立的 `shared/trace-bus`
  (agent 是生产者、trace 是消费者),日志脱敏走 `shared/redact`。

## 安全

- 事件在**采集时**(`agent/runtime.ts` → `agent/events.ts` 的白名单 sanitize)就已脱敏,
  库里存的即脱敏后的数据,本服务只搬运、不做二次处理。
  `before_provider_headers` / `before_provider_request` 的凭据字段永不出服务端
  (`docs/security.md` §2)。
- 日志一律走 `safeErrorText`,异常对象不整个打进日志(CLAUDE.md 规则 9)。

## 【重要】客户端断开探测不到

R3 对 POST、R4 对 GET 各实测一次:客户端断开后 `req` / `resp` / `socket` 都不触发
close/error,`resp.write()` 仍返回 `true`,`destroyed` 恒为 `false`——Encore 网关代理
不把外部连接断开传导进 JS 运行时。**不要按常规写法加 `req.on("close")` 收尾,它永远不会触发。**

由此,流的生命周期只能靠两条确定信息兜底:

1. `MAX_STREAM_MS`(5min)到期主动收尾 → `bye{max-duration}`,客户端立刻凭 `afterSeq` 续上;
2. **同 `clientId` 再次连上** → 同一个标签页不会同时读两条流,此前那条必然已死,精确让位
   → `bye{superseded}`。

外加 `MAX_STREAMS_PER_SESSION`(8,单会话公平上限)与 `MAX_TOTAL_STREAMS`(64,全站上限),
超出返回 429。

**别改回「逐出最旧的一条」**:那是 R4 最初的设计,实测被证伪——真正在看的连接恰恰是最旧的
(访客一进来就连上了),各种短命探测/重挂载连接都比它新,按"越老越可能被遗弃"逐出等于
每次精准掐死唯一活着的观众。启发式在这里是反的。
