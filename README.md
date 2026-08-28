# Agent X-Ray

> See every heartbeat of an agent kernel. 把 agent 内核从黑盒变成 X 光机。

一个「Agent 运行时」网站:访客与 AI agent 对话的同时,右侧面板像浏览器 DevTools 一样**实时**展示 agent loop 的内核轨迹——每个扩展事件何时触发、耗时多少、修改了什么数据、拦截了什么操作。

## 三个 Tab

| Tab | 内容 |
|---|---|
| **Runtime** | 三栏工作台:会话列表 ‖ 对话区 ‖ 运行时面板(Timeline 瀑布 / Chain View 链式传递 / Lifecycle Map 生命周期图) |
| **Notes** | harness 工程研习库:产品经理 / 源码拆解 / 代码工程 / AI 前沿 四分类,全部内容提供 RSS 订阅 |
| **About** | 围绕 GitHub 公开仓库的作者页 |

## 架构

```
访客浏览器 ── HTTPS ──> Caddy :443
                        ├── /        → apps/web   (Next.js)
                        ├── /api/*   → apps/api   (Encore.ts)
                        └── /admin   → apps/web   (管理后台,单管理员强认证)

apps/api 进程内:
  createAgentSession(pi SDK, noTools:'all' + defineTool 业务工具)
  ├── 观测者扩展:订阅 34 种内核事件 → SSE /api/trace/stream
  ├── 对话流 SSE ← session.subscribe()
  └── Postgres:会话 / 轨迹 / 访问统计 / LLM 配置 / 限额 / 工具启停
```

技术要点:

- **pi in-process**:pi coding agent 以 SDK 方式嵌入 Encore.ts 进程,无 sidecar
- **零侵入观测**:一个观测者扩展订阅全部 34 种事件,不改 pi 一行源码
- **类型化 RPC**:前后端用 Encore 生成的类型化 client,不走 GraphQL;流式一律 SSE(`api.raw`)
- **沙箱化工具执行**:agent 无 bash/read/write 等任何内置工具;业务工具(如教程库只读查询)是纯函数,走 SELECT-only 数据库角色;详见 [docs/security.md](docs/security.md)

## 目录

```
apps/web      Next.js 前端(Runtime 工作台 + Notes + About + /admin)
apps/api      Encore.ts 后端(agent / trace / notes / admin / metrics)
design/       Claude Design 设计稿存档(.dc.html 画板 + 可交互原型)
deploy/       docker-compose + Caddyfile(轻量服务器单机部署)
docs/         架构 / 安全审计 / 部署文档
```

## 项目状态

**轮次实现阶段**。设计已终稿(15 画板 + 可交互原型,见 [design/](design/));前端已按设计稿全部实现(当前跑演示数据);后端按轮次推进,进度与 roadmap 见 [ROUNDS.md](ROUNDS.md),开发约定见 [CLAUDE.md](CLAUDE.md)。

## License

[MIT](LICENSE)
