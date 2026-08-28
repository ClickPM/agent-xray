# 架构

## 总览

```
访客浏览器
   │ HTTPS
   ▼
Caddy :443(自动 TLS,单机反代)
   ├── /            → apps/web  Next.js(Runtime 工作台 / Notes / About / /admin)
   └── /api/*       → apps/api  Encore.ts :4000
                        │
                        ├── agent 服务:createAgentSession(pi SDK in-process)
                        │     ├── noTools:'all' + defineTool 业务工具(见 security.md 四层沙箱)
                        │     ├── 观测者扩展:订阅 34 种内核事件 → 内存事件队列
                        │     └── 对话 SSE ← session.subscribe()
                        ├── trace 服务:GET /trace/stream(api.raw SSE ← 事件队列,推送前脱敏)
                        ├── notes 服务:教程库查询(前端用)+ pi 只读工具组(agent_ro 角色)
                        ├── admin 服务:登录 / 统计 / LLM 配置 / 限额 / 工具启停
                        ├── metrics 服务:POST /t 访问打点
                        └── Postgres(docker-compose 内)
```

## 关键决策(已定)

| 决策 | 结论 | 依据 |
|---|---|---|
| agent 运行时 | pi SDK **in-process** 嵌入 Encore 进程,无 sidecar | 三层验证通过(import / session / Encore 请求内执行);站点不提供代码执行,业务工具纯函数即可,无妥协 |
| 前后端协议 | **Encore 类型化 RPC**(`encore gen client`),不用 GraphQL | 强类型已免费拿到;核心是 SSE 流;最小攻击面 |
| 流式通道 | SSE ×2(对话流 + 轨迹流),`api.raw` + node:http | 同进程内通信,延迟毫秒级 |
| 会话持久化 | Postgres | 重启不丢会话;轨迹可回放 |
| 部署 | 单机 docker-compose(caddy/web/api/postgres),境内轻量服务器 | 成本最低;无 Encore Cloud 超时限制 |
| 教程内容 | vault `学习分享/` 静态编译入库,pi 经只读工具访问 | pi 可读不可改(SELECT-only 角色) |

## 事件模式与观测

pi 扩展系统 34 种事件按四模式分组,观测者扩展全量订阅、采集 `{eventType, mode, timestamp, data(sanitized)}` 推给前端(计数为 R1 对 `@earendil-works/pi-coding-agent@0.84.3` 类型面的实测,修正了旧记载 notify 18/合计 33 的笔误;逐事件清单见 `apps/api/spike/events.ts`):

- **notify**(19):agent/turn/message/tool_execution/session/provider-response/model 生命周期通知
- **veto**(6):tool_call、session_before_*、project_trust 等可否决点
- **chain**(7):context、before_provider_*、before_agent_start、message_end、tool_result、resources_discover 等链式修改点
- **takeover**(2):input、user_bash 接管点

R1 实测注意:bare `createAgentSession()` 不向扩展广播 `session_start`/`resources_discover`,需在创建后调用 `session.bindExtensions({ mode: "print" })`(run 模式层职责);R3 正式实现沿用此调用。

前端右栏三视图 = 同一事件流的三种投影:Timeline(时序瀑布)、Chain View(单事件的链式传递)、Lifecycle Map(生命周期节点图)。

## 仓库布局与 Encore 注意事项

- `apps/api` 是独立 Encore app(自带 `encore.app` 与 `package.json`),所有 encore 命令在该目录执行
- 不做 npm workspaces 提升(规避 encore#1723:仓内子包 node_modules 干扰 parser 的历史问题)
- `encore build docker` 产出 api 镜像;web 用 Next standalone 输出

## 设计稿

见 [design/](../design/README.md) —— 10 画板静态稿 + 可交互原型,token 与组件语汇以其为准。
