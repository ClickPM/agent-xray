# Agent X-Ray

> See every heartbeat of an agent kernel. 把 agent 内核从黑盒变成 X 光机。

一个「Agent 运行时」网站:访客与 AI agent 对话的同时,右侧面板像浏览器 DevTools 一样**实时**展示 agent loop 的内核轨迹——每个扩展事件何时触发、耗时多少、修改了什么数据、拦截了什么操作。

**已投产**:https://www.kzgai.cloud/(2026-09-02 上线,仅 HTTPS)。

## 三个 Tab

| Tab | 内容 |
|---|---|
| **Runtime** | 三栏工作台:会话列表 ‖ 对话区 ‖ 运行时面板(Timeline 瀑布 / Chain View 链式传递 / Lifecycle Map 生命周期图 / Tools 工具面板) |
| **Notes** | harness 工程研习库:产品经理 / 源码拆解 / 代码工程 / AI 前沿 四分类,全部内容提供 RSS 订阅 |
| **About** | 围绕 GitHub 公开仓库的作者页 |

## 架构

```
访客浏览器 ── HTTPS ──> Caddy :443
                        ├── /              → apps/web   (Next.js:Runtime / Notes / About)
                        ├── /notes/**.webp → apps/api   (正文配图从 Postgres 供图)
                        └── /api/*         → apps/api   (Encore.ts;含 /api/mcp 无状态 MCP 管理面,
                                                         所有者用 Claude Code 等 MCP 客户端维护内容与配置)

apps/api 进程内:
  createAgentSession(pi SDK, noTools:'all' + 三组业务工具)
  ├── 观测者扩展:订阅 34 种内核事件 → SSE /api/trace/stream
  ├── 对话流 SSE ← session.subscribe()
  └── Postgres:会话 / 轨迹 / Notes 内容与配图 / About / 访问统计
               / LLM·搜索·生图 provider 配置 / 限额 / 工具启停 / 生成图片
```

技术要点:

- **pi in-process**:pi coding agent 以 SDK 方式嵌入 Encore.ts 进程,无 sidecar
- **零侵入观测**:一个观测者扩展订阅全部 34 种事件,不改 pi 一行源码
- **类型化 RPC**:前后端用 Encore 生成的类型化 client,不走 GraphQL;流式一律 SSE(`api.raw`)
- **沙箱化工具执行**:agent 无 bash/read/write 等任何内置工具;业务工具分三组——纯函数组(教程库只读查询,走 SELECT-only 角色)、外呼组(联网搜索 / 生图:服务端持凭据、目标域白名单、双计时器、计入日限额)、会话绑定组(给本会话起标题,列级授权)、沙箱执行组(agent 在独立的无网络容器 `skill-runner` 里跑 skill 自带的 Python 脚本:可执行集合在代码里、api 经 unix socket 调它、每次运行一次性进程与目录,R-SKILLS-2);详见 [docs/security.md](docs/security.md)
- **无界面管理面**:站点内容与配置经无状态 MCP 服务(协议 2026-07-28)维护,没有 `/admin` 后台
- **运行时统一 bun**:开发 / 测试 / 预发 / 生产四个环境的 JS 运行时都是 bun,最终运行镜像不含 node

## 目录

```
apps/web      Next.js 前端(Runtime 工作台 + Notes + About)
apps/api      Encore.ts 后端(about / agent / mcp / metrics / notes / system / trace,各目录 README 写明边界)
design/       Claude Design 设计稿存档(.dc.html 画板 12 块 + 可交互原型)
deploy/       docker compose + Caddyfile + migrate.sh(预发/生产共用的部署资产)
docs/         架构 / 安全 / 部署环境矩阵 / 境内轻量服务器部署 / 生产发布记录
rounds/       轮次任务卡与 backlog;roadmap 在根 ROUNDS.md
```

## 项目状态

**已投产,进入运维迭代**。R0–R11 与各命名轮(R-BUN / R-VISITOR / R-WEBSEARCH / R-TITLE / R-TOOLS / R-IMAGEGEN)全部完成,站点于 2026-09-02 上线。后续较大迭代延续轮次机制(所有者裁定 2026-09-03),小修补直接进 `main`;每次生产发版记入 [docs/releases.md](docs/releases.md)。roadmap 与进度见 [ROUNDS.md](ROUNDS.md),开发约定见 [CLAUDE.md](CLAUDE.md)。

## License

[MIT](LICENSE)
