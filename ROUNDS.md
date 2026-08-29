# 轮次进度与 Roadmap

> 拆解方法参照 GPUI-Pi:小轮次、可证伪验收、风险前置、止损明确。目录规则见 [`rounds/README.md`](rounds/README.md),每轮任务卡在开工时从 [`rounds/TEMPLATE.md`](rounds/TEMPLATE.md) 建立为 `rounds/round-NN/round-NN.md`。
> 每轮收口时更新本表(状态 / 完成日期 / 审查记录指针)。范围与验收要点以下方「各轮拆解」为准;与 `docs/architecture.md`、`docs/security.md` 冲突时以后者为准。
>
> **功能边界(所有者裁定,2026-08-28)**:本 roadmap 与各轮任务卡**严禁新增设计稿没有的功能**——功能范围以 [`design/`](design/README.md) 15 块画板 + 可交互原型为唯一边界,加上 `docs/` 已定稿的安全与部署要求(它们是约束,不是功能)。实现中想到的新功能一律进 [`rounds/BACKLOG.md`](rounds/BACKLOG.md) 等所有者裁定,不进任何轮次。

## 进度表

| 轮 | 内容 | 状态 | 完成 |
|---|---|---|---|
| **R0** | 工程初始化:CLAUDE.md · rounds 框架 · dev.ps1 · skills · MCP · 依赖安装冒烟 | ✅ 已完成 | 2026-08-28 |
| **R1** | ⚠️ pi 内核风险门禁 spike(in-process · 34 事件 · SSE ×2 · 内存基线) | ✅ 全门禁通过([任务卡](rounds/round-01/round-01.md),codex 审查整改后 PASS) | 2026-08-28 |
| **R2** | 数据层:迁移 · 会话/消息/轨迹落库 · encore test 基建 · gen client | ✅ 已完成([任务卡](rounds/round-02/round-02.md),codex 审查整改后 PASS) | 2026-08-28 |
| **R-BUN** | 运行时统一 bun(开发/测试/预发/生产)+ 部署方式按架构评审整改 | 🔄 进行中([任务卡](rounds/round-bun/round-bun.md),13 项门禁全过,待 codex 审查) | — |
| **R3** | Runtime 对话流真实化(/agent/ask SSE + 前端切真实数据源) | ⬜ | — |
| **R4** | 轨迹流 + 三视图真实化(/trace/stream + sanitize + 回放) | ⬜ | — |
| **R5** | notes 服务:摄入管线 · 查询端点 · RSS · Notes 页对接 | ⬜ | — |
| **R6** | 沙箱与配额落地(只读工具组 · agent_ro · tool_config · daily_quota) | ⬜ | — |
| **R7** | admin 服务 + /admin 五页对接(登录/统计/配置/工具) | ⬜ | — |
| **R8** | metrics 打点 + About 真实化 | ⬜ | — |
| **R9** | 容器化 + 130 预发部署(docker compose 全链路) | ⬜ | — |
| **R10** | 安全加固 + 上线前检查单逐项 | ⬜ | — |
| **R11** | 生产部署上线(服务器初始化 · 域名/备案/TLS) | ⬜ | — |

## 里程碑

| | 覆盖 | 含义 | 止损 |
|---|---|---|---|
| **M0** | R0–R1 | 环境 + 风险门禁 | R1 任一门禁不过 → **停**,重新评估 sidecar 形态并改写本表 |
| **M1** | R2–R4 | Runtime 核心真实化(站点核心卖点跑通) | — |
| **M2** | R5–R6 | 内容库 + 安全沙箱(公开可访问的安全底线) | R6 沙箱验收不过 → 不得进入任何公网部署轮 |
| **M3** | R7–R8 | 管理后台 + 统计(功能完备) | — |
| **M4** | R9–R11 | 预发 → 生产上线 | `docs/security.md` 上线检查单不全绿不上生产 |

## 各轮拆解

### R1 — pi 内核风险门禁 spike(⚠️ 全项目最大风险,先做)

架构决策「pi SDK in-process 嵌入 Encore 进程」此前只做过三层冒烟(import / session / Encore 请求内执行),本轮把它验证到可承诺的程度:

- 钉定 pi SDK 的 npm 包名与版本,写入 CLAUDE.md「钉版本」段;lockfile 固定
- Encore 请求内 `createAgentSession({ noTools: 'all' })` 跑通一轮**真实 LLM 对话**(经海外中转端点,key 走本地 secret)
- 观测者扩展订阅全部 **34 种事件**并采集 `{eventType, mode, timestamp, data}`,逐一核对四模式计数(notify 18 / veto 6 / chain 7 / takeover 2)与 `docs/architecture.md` 一致;有出入以实测为准回改文档
- `api.raw` SSE ×2 原型(对话流 + 轨迹流),Next dev proxy 与直连 :4000 两条路径都不缓冲、不断流
- 内存基线实测:import 增量、单活跃会话增量、`dispose()` 后回收,数字回填任务卡(部署规格依据)
- **止损**:任一门禁不过且无法当轮解决 → 写 BLOCKED.md 停下,与所有者重新评估 sidecar 方案

产出物是 spike 代码 + 实测数据,允许粗糙,但事件清单与内存数字必须真实。

### R2 — 数据层与会话持久化

- `SQLDatabase` + 迁移 001:`sessions` / `messages` / `trace_events`(含回放所需索引);JSONB 写入遵守 CLAUDE.md 规则 4
- agent 服务:会话创建/续接/列表端点;对话消息与轨迹事件落库(重启不丢,`docs/architecture.md` 既定决策)
- `encore test` 基建(vitest,`dev.ps1 test` 可跑),对库读写路径出首批测试
- `encore gen client` 产出接入 `apps/web/lib/`(仅类型与数据层,不动 UI)

### R-BUN — 运行时统一 bun + 部署方式整改(跨轮基础设施轮)

不属于 R0–R11 的线性序列,是一轮横切基础设施改造:把开发/测试/预发/生产四个环境的 JS 运行时统一为 bun 1.4.0,同时把 `deploy/` 从「框架版」推进到可用状态(依据 2026-08-29 的架构评审 P1 清单)。

- 运行时:`apps/api/encore.app` 开 `bun-runtime` 实验位;构建配 `--base oven/bun:1.4.0-slim`;`apps/web/Dockerfile` 同基座;测试经 `bun --bun vitest run`
- 部署:compose 从 `build:` 改 `image:<git-sha>`(不可变镜像)、补 `deploy/infra-config.json`、安全参数补齐(`cap_drop ALL`/`pids_limit`/tmpfs 限容/网络分段/healthcheck/`stop_grace_period`)、`mem_limit` 2g → 1g
- 文档:容量段从「每会话固定 X MB」改为公式;升级流程从服务器 `git pull + build` 改为不可变镜像拉取(消化 BACKLOG 里那条与规则 10 的冲突)
- 验收:R1/R2 的全部门禁在 bun 下复刻通过(34 事件 / SSE ×2 / 落库与重启 / 脱敏 / 内存基线重新建档)
- **止损**:任一门禁在 bun 下不过且当轮无法解决 → 回退成本为零(实验位 + 基座参数各一行,npm lockfile 全程未动),弃分支即可

> 本轮暴露并解决了一个原本会卡死 R9 的问题:Encore 自托管镜像**不执行数据库迁移**(实测,空库直起则 `/health` 200 但触库端点 500)。所有者 2026-08-29 裁定采用「部署脚本用 psql 施加镜像内 SQL」,已落地为 `deploy/migrate.sh`(版本记录与 Encore 的 `schema_migrations` 同构、单事务、幂等),并在 130 上按完整 compose 形态实测通过。

### R3 — Runtime 对话流真实化

- `POST /agent/ask` 正式实现:`api.raw` SSE ← `session.subscribe()`;并发 session 上限、空闲回收、`dispose()` 及时
- 前端对话区 + 会话列表从 `demo-data.ts` 切到真实 API/SSE;**样式零改动**(CLAUDE.md 规则 7)
- 验收:新访客建会话 → 对话流式渲染 → 刷新后会话与历史可恢复

### R4 — 轨迹流与三视图真实化

- `GET /trace/stream?sessionId=…` SSE:观测者扩展内存队列 → 推送;推送前按**白名单字段** sanitize(`docs/security.md` §2:provider 凭据字段永不出服务端;入参/出参截断)
- 前端 Timeline / Chain View / Lifecycle Map 三视图消费真实事件流;历史会话轨迹从库回放
- 验收:对话进行中右栏实时出事件;抽查 SSE 原始流无 Authorization/api-key 字段

### R5 — notes 服务与内容摄入

- 迁移:`notes_series` / `notes_chapters`;vault `学习分享/` → 编译摄入脚本(本地执行,幂等可重跑)
- 查询端点(系列/章节/正文)+ RSS 生成(全站 + 四分类)
- Notes 三级页面 + RSS 弹层对接真实数据
- 验收:RSS 通过校验器;摄入脚本重跑不产生重复数据

### R6 — 沙箱与配额落地(`docs/security.md` §1 第 1/2/4 层)

- `defineTool` 只读工具组:`notes_list_series` / `notes_get_chapter` / `notes_search`——纯函数,连接串用 `AGENT_RO_DATABASE_URL`
- 迁移:`agent_ro` 角色(仅 SELECT notes 表)+ `tool_config` 表;注册集合按启停配置决定
- `daily_quota`:每日 token/费用计数,超限拒新会话;单会话 turn 上限
- prompt injection 自测清单过一遍(诱导执行/读配置/改数据),结果回填任务卡
- 验收:以 agent_ro 连接尝试写库必须失败;超限路径有明确拒绝行为

### R7 — admin 服务与后台对接

- 迁移:`admin_*`(账户/会话/审计)+ `llm_config`
- `POST /admin/login`:argon2id + HttpOnly/Secure/SameSite=Strict cookie;登录限速 + 连续失败锁定;写操作 CSRF 校验
- stats / config(LLM key 加密存储,读返回掩码)/ tools 启停 + 审计日志;高危工具双闸(`XRAY_UNLOCK_DANGEROUS_TOOLS` + 后台开关)
- `/admin` 五页(login / Overview / Traffic / Settings / Tools)对接真实数据
- 验收:错误密码限速生效;key 任何读接口只见掩码;启停操作在审计日志可查

### R8 — metrics 与 About 真实化

- `POST /t` pageview beacon:date / path / **加盐 IP 哈希** / UA 摘要,不存原始 IP(`docs/security.md` §6);web 端打点接入
- 聚合查询供 /admin Traffic 页(PV/UV/路径分布/近 30 天趋势)
- About 页 GitHub 公开数据(构建时拉取或后端缓存代理,二选一在任务卡定);footer 备案号占位
- 验收:库中无原始 IP;Traffic 页数字与打点一致

### R9 — 容器化与 130 预发部署

> R-BUN 已把镜像构建、compose 定稿、安全参数、文档四块前移完成(bun 基座、不可变镜像、`infra-config.json`、`cap_drop`/`pids_limit`/网络分段/healthcheck)。R9 只剩「在 130 上真跑一遍 + 补齐尚未落地的部分」。

- 数据库迁移已由 R-BUN 的 `deploy/migrate.sh` 解决(所有者裁定方案一);R9 只需把它纳入部署流程文档与冒烟清单
- `agent_ro` 初始化:`docker-entrypoint-initdb.d` 建角色 + 仅 SELECT `notes_*` 授权(R6 建表后补授权的顺序写进文档)
- 130 部署流程文档 + 脚本:`dev.ps1 build` → `docker save | ssh | docker load` → 130 上按**先迁移后起服务**的顺序(`up -d --wait postgres` → `./migrate.sh` → `up -d`),避免「健康检查全绿但业务接口 500」的中间状态
- 预发全链路验证:三 Tab + /admin + 限额;安全约束逐项核验(非 root / read_only / `cap_drop ALL` / `pids_limit` / mem_limit / **最终运行镜像**内无 node / `/spike/*` 404 / postgres 仅 `back` 网段可达)
- **服务白名单核验**:`dev.ps1 build` 的 `--services` 是维护热点——冒烟时必须逐个确认**当前已落地的正式 service 端点都可达**(不只是 `/health`),漏改的表现是镜像构建正常、健康检查正常、而该服务端点静默 404
- **SSE 冒烟需等 R3/R4**:两条 SSE 目前只在 spike 里,而 spike 已被 `--services` 排除出镜像;正式端点落地后再补「心跳 15s、断线重连 `afterSeq` 回放、`docker compose stop api` 时客户端收到明确断流而非静默挂起、SSE 脱敏抽查」这组验证
- 回滚演练:`IMAGE_TAG` 换回上一 SHA + `up -d` 真跑一次
- 验收:130 上从干净环境按文档一次部署成功,且回滚演练通过

### R10 — 安全加固与上线检查单

- `docs/security.md` §「上线前检查单」逐项过并留证:gitleaks / .env 权限 / 容器约束 / admin 强认证 / SSE 抽查 / 限额演练
- 备份:Postgres 每日 pg_dump(本机 + 异地)脚本与恢复演练
- 可选:/admin IP 白名单(Caddy 层)
- 验收:检查单全绿,证据回填任务卡

### R11 — 生产部署上线

- 前置:生产服务器采购完成,所有者提供 SSH 入口与密钥
- 服务器初始化(`docs/security.md` §5 基线:仅密钥登录 / 防火墙 / fail2ban / 自动安全更新)
- docker compose 部署;域名解析 + ICP 备案流程(`docs/deploy-cn-lightweight.md` §1)+ Caddy 自动 TLS;备案号挂 footer
- 上线冒烟 + 首日观察(限额、内存、日志)

## 轮次外事项

跨轮次发现的问题进 [`rounds/BACKLOG.md`](rounds/BACKLOG.md),不当场顺手改(CLAUDE.md 开发约定)。
