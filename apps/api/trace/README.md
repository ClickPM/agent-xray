# trace 服务(待实现)

运行时轨迹 SSE。

- `GET /trace/stream?sessionId=…` — `api.raw` SSE,从观测者扩展的内存队列推送事件
- 推送前 sanitize:白名单字段;`before_provider_headers`/request 的凭据字段永不出服务端(`docs/security.md` §2)
- 事件落 Postgres(轨迹回放用,后续轮次)
