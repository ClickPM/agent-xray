# agent 服务(待实现)

pi SDK in-process 会话管理与对话流。

- `POST /agent/ask` — 创建/续接会话,对话流 SSE(`api.raw` ← `session.subscribe()`)
- `createAgentSession({ noTools: 'all', customTools: <按 tool_config 启停注册> })`
- 观测者扩展在此挂载:订阅 34 种事件 → 内存队列 → trace 服务
- 并发 session 上限、空闲回收、`dispose()`;每日限额检查(超限拒新会话)

安全约束(强):见 `docs/security.md` §1 —— 工具白名单 / 纯函数 / 执行类永久禁止 in-process。
