# 轮次进度与 Roadmap

> 拆解方法参照 GPUI-Pi:小轮次、可证伪验收、风险前置、止损明确。目录规则见 [`rounds/README.md`](rounds/README.md),每轮任务卡在开工时从 [`rounds/TEMPLATE.md`](rounds/TEMPLATE.md) 建立为 `rounds/round-NN/round-NN.md`。
> 每轮收口时更新本表(状态 / 完成日期 / 审查记录指针)。范围与验收要点以下方「各轮拆解」为准;与 `docs/architecture.md`、`docs/security.md` 冲突时以后者为准。
>
> **功能边界(所有者裁定,2026-08-28;2026-08-31、2026-09-01、2026-09-02 三次修订)**:本 roadmap 与各轮任务卡**严禁新增设计稿没有的功能**——站点访客功能以 [`design/`](design/README.md) 画板 1a–1g + 2a–2e(共 12 块)+ 可交互原型为唯一边界,加上 `docs/` 已定稿的安全与部署要求(它们是约束,不是功能)。**画板 3a–3e(/admin 后台)已废弃**:管理功能改由无状态 MCP 管理服务承担(无前端界面),其范围以 R6 拆解的裁定清单为准;画板已于 2026-09-02 从画布删除,`3x` 号段作废不复用。实现中想到的新功能一律进 [`rounds/BACKLOG.md`](rounds/BACKLOG.md) 等所有者裁定,不进任何轮次。
>
> **2026-09-01 修订(R-VISITOR)**:所有者裁定在会话列表新增**删除入口**——设计稿画板 1a–1e 没有这个东西,
> 属规则 8 的例外,理由是「站点公开可访问之后,访客需要一条自己清掉对话的通路」,是隐私功能而非产品功能。
> 交互取对画板偏离最小的形态(行 hover 露一个复用 `GhostButton` 的 ×,绝对定位不占布局宽度,
> 二次确认用浏览器原生 `confirm`),不 hover 时该行与画板一字不差。同轮引入的**访客 cookie**
> 不是功能而是安全约束,口径写在 `docs/security.md` §6(规则 9:先改文档再改代码)。
>
> **2026-09-01 第二次修订(R-TITLE)**:所有者裁定给 agent 配一个**会话命名工具** `session_rename`,
> 默认开启。设计稿画板 1a–1e 里会话列表本来就有标题(现在的标题是「首条用户消息的首行截 40 字」),
> 所以**前端零改动、无新界面**;新增的是「标题由谁写」这条通路,属规则 8 的例外,理由是
> 「首行截断在真实对话里几乎总是 `hi` / `你好` 这类无信息量的开场白,会话列表因此不可用」。
> 形态由所有者裁定为 **agent 工具**而不是服务端旁路生成:本站的卖点是右侧内核轨迹,
> 命名过程必须**在 Timeline 里看得见**(`tool_call · session_rename`)。
> 工具会写库,与 `docs/security.md` §1 第 1/2 层的「纯函数 / 数据面只读」相抵,
> 已按规则 9 先改文档(两处 R-TITLE 补记)再改代码。
>
> **2026-09-02 第三次修订(R-TOOLS)**:所有者裁定新增 **Tools 工具面板**——agent 现在真的会调工具
> (`notes_*` 三个 + `web_search` + `session_rename`),访客在 Timeline 里看得到 `tool_call · web_search`,
> **却无处得知这个 agent 有哪些工具、吃什么参数、吐什么结果**。与前两次修订不同,本次**不是**规则 8 的例外:
> 设计稿先扩到 12 块(新增 `1f` Tools 列表态 / `1g` 展开态,原型同步加第 4 个面板 tab 与逐工具展开),
> **然后**才有这一轮——「先改设计稿、再进轮次」是扩边界的唯一正确顺序。同日删除已废弃的 `3a–3e`。
> 形态裁定:落点是 Runtime 右栏第 4 个 tab(与 Timeline / Chain View / Lifecycle Map 并列),
> 理由是访客从「看到一次调用」到「想知道这是什么工具」的路径必须最短;内容**只读且静态**,
> 显示工具名 / 中文标签 / 描述 / 入参 JSON Schema / 输出形态 / 工具分组,
> **不显示**启停状态、日限额与剩余次数、provider 与 model 名(公开即泄服务端配置面)。

## 进度表

| 轮 | 内容 | 状态 | 完成 |
|---|---|---|---|
| **R0** | 工程初始化:CLAUDE.md · rounds 框架 · dev.ps1 · skills · MCP · 依赖安装冒烟 | ✅ 已完成 | 2026-08-28 |
| **R1** | ⚠️ pi 内核风险门禁 spike(in-process · 34 事件 · SSE ×2 · 内存基线) | ✅ 全门禁通过([任务卡](rounds/round-01/round-01.md),codex 审查整改后 PASS) | 2026-08-28 |
| **R2** | 数据层:迁移 · 会话/消息/轨迹落库 · encore test 基建 · gen client | ✅ 已完成([任务卡](rounds/round-02/round-02.md),codex 审查整改后 PASS) | 2026-08-28 |
| **R-BUN** | 运行时统一 bun(开发/测试/预发/生产)+ 部署方式按架构评审整改 | ✅ 已完成([任务卡](rounds/round-bun/round-bun.md),13 项门禁全过;codex 初审 4P1+4P2 与三轮复审共 14 条 findings 全采纳整改,第 3 轮零 findings,缺陷门禁 PASS) | 2026-08-31 |
| **R3** | Runtime 对话流真实化(/agent/ask SSE + 前端切真实数据源) | ✅ 已完成([任务卡](rounds/round-03/round-03.md),10 项验收全过;codex 初审 5 条(3×P1)+ 复审第 1 轮 3 条(2×P1)findings 全采纳整改,复审第 2 轮零 findings,缺陷门禁 PASS) | 2026-08-31 |
| **R4** | 轨迹流 + 三视图真实化(/trace/stream + sanitize + 回放) | ✅ 已完成([任务卡](rounds/round-04/round-04.md),12 项验收全过(#11 按所有者裁定改为静态核验,镜像实跑冒烟并入 R9);codex 初审 3 条(2×P1)+ 复审三轮 5 条(全 P2)共 8 条 findings,7 条采纳整改、1 条写明理由记 BACKLOG,复审第 4 轮零 findings,缺陷门禁 PASS) | 2026-08-31 |
| **R5** | notes 服务:摄入管线 · 查询端点 · RSS · Notes 页对接 | ✅ 已完成([任务卡](rounds/round-05/round-05.md),8 项验收全过;codex 7 轮共 17 条 findings,15 条采纳整改、2 条所有者裁定不采纳并留兜底,末轮零 findings,缺陷门禁 PASS) | 2026-08-31 |
| **R6** | MCP 管理服务(无状态 2026-07-28:notes 内容/About/LLM 多 provider/工具启停;/admin 与 R5 管道退役) | ✅ 已完成([任务卡](rounds/round-06/round-06.md),10 项验收全过;codex 五轮共 18 条 findings,16 条采纳整改、1 条实跑证伪不采纳、1 条写明理由记 BACKLOG,末轮零 P1,缺陷门禁 PASS) | 2026-08-31 |
| **R7** | 沙箱与配额落地(只读工具组 · agent_ro · daily_quota,消费 R6 配置表) | ✅ 已完成([任务卡](rounds/round-07/round-07.md),12 项验收全过;codex 三轮共 6 条 findings(1×P1 · 4×P2 · 1×P3)**全部采纳整改**,末轮零 findings,缺陷门禁 PASS) | 2026-09-01 |
| **R8** | metrics 打点 + About 真实化 + 统计查询 MCP 工具 | ✅ 已完成([任务卡](rounds/round-08/round-08.md),15 项验收全过;codex 三轮共 3 条 findings(P1/P2/P3 各一)全采纳整改,第 3 轮零 findings,缺陷门禁 PASS) | 2026-09-01 |
| **R9** | 容器化 + 130 预发部署(docker compose 全链路) | ✅ 已完成([任务卡](rounds/round-09/round-09.md) · [冒烟留证](rounds/round-09/smoke.md)),18 项验收全过,130 预发可用;**所有者裁定本轮不走 codex 审查**(过程与残留风险见任务卡「代码审查」段)。同日按 `docs/notes-content-spec.md` 经 MCP 入库 13 系列 / 205 章节 / 103 配图 | 2026-09-01 |
| **R10** | 安全加固 + 上线前检查单逐项 | ✅ 已完成([任务卡](rounds/round-10/round-10.md) · [检查单留证](rounds/round-10/checklist.md)),检查单 1–11 项在 130(SHA `5c98b3e`)全绿;**所有者裁定本轮不做限额演练(引 R9 留证)与 pg 备份**,不做安全响应头与 IP 白名单(均记 BACKLOG) | 2026-09-01 |
| **R-VISITOR** | 访客会话隔离(24h 滑动 cookie · 归属过滤 · 3 天保留期 · 会话删除) | ✅ 已完成([任务卡](rounds/round-visitor/round-visitor.md) · [130 部署留证](rounds/round-visitor/round-visitor.md#130-预发部署留证2026-09-01)),12 项验收全过;codex 三轮共 6 条 findings(3×P1 · 3×P2),4 条采纳整改、1 条所有者裁定不修(130 内网)、1 条写明理由不采纳记 BACKLOG,第 3 轮零 findings,缺陷门禁 PASS。同日 130 预发升级到 `7cc17fe`(迁移 6→7),8 项冒烟全过,**本机验不了的「新建会话首帧带 Set-Cookie」在 130 上验掉,不再交接给 R11** | 2026-09-01 |
| **R-WEBSEARCH** | agent 联网搜索工具(Responses API 网关 · 域白名单 · MCP 配 provider · DeepSeek 零分支兼容) | ✅ 已完成([任务卡](rounds/round-websearch/round-websearch.md)),本机验收 #1–#10、#14 全过;codex 四轮共 6 条 findings(3×P1 · 3×P2)**全部采纳整改**,第 4 轮零 findings,缺陷门禁 PASS;**所有者裁定本轮不构建镜像、不发 130**(#2/#11/#12/#13 四条 130 实跑验收并入下一次预发升级) | 2026-09-02 |
| **R-TITLE** | 会话命名工具(`session_rename`:agent 自己给会话起名,轨迹可见,默认开启) | 🔄 已合并 `main`,待 130 预发验收 #1/#7([任务卡](rounds/round-title/round-title.md),8 项验收 6 过、2 项交接 130;codex 五轮共 4 条 findings(2×P1 · 2×P2):2 条 P2 采纳整改,1 条 P1 **所有者裁定不采纳并回滚**(记 BACKLOG),1 条 P1 随回滚作废,末轮零 findings,缺陷门禁 PASS) | — |
| **R-TOOLS** | Tools 工具面板(右栏第 4 tab:工具名/描述/入参 schema/输出形态,只读) | ⬜ 未开始([任务卡](rounds/round-tools/round-tools.md);设计稿 1f–1g 与原型已就位,与 R11 的先后待所有者裁定) | — |
| **R11** | 生产部署上线(服务器初始化 · 域名/备案/TLS) | ⬜ | — |

## 里程碑

| | 覆盖 | 含义 | 止损 |
|---|---|---|---|
| **M0** | R0–R1 | 环境 + 风险门禁 | R1 任一门禁不过 → **停**,重新评估 sidecar 形态并改写本表 |
| **M1** | R2–R4 | Runtime 核心真实化(站点核心卖点跑通) | — |
| **M2** | R5–R7 | 内容库 + MCP 管理面 + 安全沙箱(公开可访问的安全底线) | R7 沙箱验收不过 → 不得进入任何公网部署轮 |
| **M3** | R8 | 统计 + About(功能完备) | — |
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

- 迁移:`notes_categories` / `notes_series` / `notes_chapters`(建在既有 agent 库,`deploy/migrate.sh` 只认这一个库)
- vault `学习分享/` → `tools/notes-sync` 同步管线(本地执行,幂等可重跑);入口 `dev.ps1 notes`,操作规程收敛成 skill `sync-notes`
- 查询端点(系列/章节/正文)+ RSS 生成(全站 + 四分类,地址在站根,Caddy 与 next dev 各一条路由)
- Notes 三级页面 + RSS 弹层对接真实数据
- 验收:RSS 通过校验器;摄入脚本重跑不产生重复数据

> **摄入方案由所有者逐条裁定(2026-08-31)**:库里存标准 markdown、Obsidian 语法在同步阶段改写、
> 前端渲染;frontmatter 不保留;图片压缩后进 web 静态资源;AI 资料只收中译并保留 source 原链;
> `原始资料/` 不摄入且不生成指向它的链接;内容分享不同步。完整裁定表与实测数字见任务卡。

### R6 — MCP 管理服务(替代 /admin 后台;所有者裁定 2026-08-31)

> 原 R7 的 admin 服务与 `/admin` 五页(画板 3a–3e)整体废弃,与原 R6 对调进位。管理面改为**无状态 MCP server**,所有者以 MCP 客户端(Claude Code 等)对站点内容与配置直接操作。R5 的 notes-sync 管道与 sync-notes skill 同时废除(**存量文章与数据不动**)。安全条款见 `docs/security.md` §4(已按本裁定重写)。

- 协议:**2026-07-28 规范为目标版本**(无状态核心:无 initialize 握手、无 `Mcp-Session-Id`,每请求 `_meta` 带版本与能力;`server/discover` 必须实现;POST 带 `Mcp-Method`/`Mcp-Name` 头)。用官方 TS SDK 并**保留向下协商**(客户端支持仍在铺开,所有者裁定);不实现 `subscriptions/listen`(管理面无订阅需求,纯 POST 单端点)
- 挂载:`api.raw` 端点 `/api/mcp`(走既有 `/api/*` 反代,无需新增 Caddy 路由);bun 下跑官方 TS SDK 属轮内验证项
- 认证与审计:静态 bearer token(高熵随机、服务端只存哈希、经 secret 注入;solo 维护不上 OAuth)+ 可选 Caddy 层 IP 白名单;认证失败与全部写操作入审计日志
- 迁移(原 R6/R7 的配置表在本轮一次建齐,R7 只消费):`llm_config`(多 provider:provider / key **加密** / baseURL / 默认模型 / 限额配置)· `tool_config` · `about_content`(github/origin 双链等)· `notes_assets`(附件二进制)· 审计表
- MCP tools 首批:notes 三张表 CRUD(**入参即标准 markdown,server 只校验不改写**——Obsidian 改写器随管道退役,与 BACKLOG「vault 源头写标准 markdown」裁定自洽)· 附件上传/删除 · About 内容 · LLM provider 管理(key 任何读回只给掩码)· 工具启停(双闸之一)。**统计查询 tools 不在本轮**(数据面在 R8,所有者裁定后挪)
- LLM 多 provider:**直接用 pi-ai 统一对接,不另起炉灶**(所有者裁定):`ModelRuntime.setRuntimeApiKey` 按 provider 注册、models.json 定义模型;`agent/runtime.ts` 硬编码的 `MODEL_PROVIDER`/`MODEL_ID`/单 secret 改从 `llm_config` 读。轮内验证:中转 baseURL 在 pi-ai 配置面的表达、key/模型变更热生效;`.env` 引导键 `DEEPSEEK_API_KEY` 去留在本轮裁定(BACKLOG 既有条目)
- 附件供图:**镜像内不烧任何 notes 内容(所有者裁定),全部从 Postgres 读**——存量 `apps/web/public/notes/` 图片回填 `notes_assets` 后从 web 删除;API raw 端点从库读、带长缓存头;**图片 URL 保持既有 `/notes/<系列>/<哈希>.webp` 不变**(免改写存量 markdown),Caddy 按扩展名把该路径分流到 api,next dev 加对应 rewrite(RSS 先例)
- 退役与删除:`apps/web/app/admin/` 六页整目录删除(所有者裁定;规则 7 结构性改动,理由=功能废弃)· `apps/api/admin/` 占位已换 `apps/api/mcp/` · `tools/notes-sync/` + `dev.ps1 notes` + `.claude/skills/sync-notes` 删除并 `dev.ps1 skills` 重同步镜像 · `dev.ps1 build --services` 补 `mcp`
- 验收:①本机 Claude Code 实连打通(**第一验收项**,客户端对 2026-07-28/向下协商的支持在此验证);②无 token/错 token 全拒且有审计记录;③经 MCP 发布一篇含附件新文章全链路(写入 → 前端渲染 → RSS 更新);④存量文章与图片零回归(URL 不变);⑤LLM key 读回只见掩码;⑥切换默认模型后新会话生效

> **落地补记(2026-08-31,与上面计划的四处偏离,详见任务卡)**
>
> 1. **SDK 换包名**:2026-07-28 由官方 TS SDK **v2** 提供,包名是 `@modelcontextprotocol/server` / `@modelcontextprotocol/node`(2.0.0)。原包 `@modelcontextprotocol/sdk` 最新版(1.30.0)的 `LATEST_PROTOCOL_VERSION` 仍是 `2025-11-25`、没有 `server/discover`。
> 2. **`subscriptions/listen` 要显式关**:它是 SDK 自带的,而 Claude Code 一连上来就调(抓包实测)。留着等于在管理端点上开一条断连探测不到的长连 SSE,已用 `maxSubscriptions: 0` 关掉。
> 3. **供图端点换前缀**:Encore 路由里 `/notes/:series/:file` 与既有的 `/notes/series/:slug` 冲突,API 侧改为 `/assets/notes/:series/:file`;**对外 URL 不变**,由 Caddy 与 next dev 按扩展名分流。
> 4. **`DEEPSEEK_API_KEY` 所有者裁定彻底移除**(不保留为部署引导):运行期 LLM 凭据只有 `llm_config` 一个来源;新环境首次部署后必须先经 MCP 写 provider,`/agent/ask` 在那之前回 503。已写进 `docs/deploy-environments.md` 部署步骤。
>
> 另:Claude Code **原生说 2026-07-28**(抓包见 `MCP-Protocol-Version: 2026-07-28` + `Mcp-Method` 头),向下协商这次没被用到,但按所有者裁定保留。

### R7 — 沙箱与配额落地(原 R6;`docs/security.md` §1 第 1/2/4 层)

- 只读工具组:`notes_list_series` / `notes_get_chapter` / `notes_search`——纯函数,取数走 `agent_ro` 只读角色
- 迁移:`agent_ro` 角色(仅 SELECT notes 三张表);注册集合按 **R6 已建的 `tool_config`** 启停配置决定
- `daily_quota`:每日 token/费用计数,超限拒新会话;单会话 turn 上限;限额值从 R6 的 `llm_config` 配置读
- prompt injection 自测清单过一遍(诱导执行/读配置/改数据),结果回填任务卡
- 验收:以 agent_ro 连接尝试写库必须失败;超限路径有明确拒绝行为

> **落地补记(2026-09-01,与上面计划的两处偏离,详见任务卡)**
>
> 1. **`agent_ro` 不用 `AGENT_RO_DATABASE_URL`**(所有者裁定):角色建成 **NOLOGIN**,由应用连接在事务里
>    `SET LOCAL ROLE agent_ro` 临时降权。权限仍由 Postgres 强制,但省掉一个 pg 驱动依赖、一份角色口令
>    (`.env`/initdb/secret 各一处)和一个 Encore 管不到的第二连接池。**决定性理由是验收能不能自动跑**:
>    本机 encore 的库由 CLI 托管,agent_ro 的登录口令进不去,「以 agent_ro 写库必须失败」只能推到部署轮
>    人工核验——而 M2 的止损正是「R7 沙箱验收不过不得进入任何公网部署轮」。改法之后这条进了 `dev.ps1 test`。
>    **连带**:下面 R9 的「`docker-entrypoint-initdb.d` 建角色」一项取消(角色由迁移 006 建)。
> 2. **不用 pi 的 `defineTool()` 运行时导出**,只用它的类型:那是个恒等函数,唯一作用是保住 TypeBox 的泛型推断,
>    而工具 schema 用的是普通 JSON Schema 对象(pi 校验器显式支持);静态 import 它会把整个 pi 包在 API 启动时
>    拉进来,破坏 `runtime.ts` 刻意做的惰性加载。

### R8 — metrics 与 About 真实化 + 统计查询 MCP 工具

- `POST /t` pageview beacon:date / path / **加盐 IP 哈希** / UA 摘要,不存原始 IP(`docs/security.md` §6);web 端打点接入
- 聚合查询(PV/UV/路径分布/近 30 天趋势)——**展示面是 MCP 统计查询 tools**(画板 3c Traffic 页已废弃;统计 tools 按所有者裁定挪到本轮,数据面就绪后落地)
- About 页从 `about_content` 读真实数据(github/origin 双链,表与管理 tools R6 已建);footer 备案号占位
- 验收:库中无原始 IP;MCP 统计查询结果与打点一致;About 内容经 MCP 修改后前端生效

> **落地补记(2026-09-01,与上面计划的四处偏离,详见任务卡)**
>
> 1. **所有者裁定扩 `about_content` 两列**(`repos` / `lang_bar`):画板 2e 的「公开仓库 / 语言构成」
>    两块 R6 没进表,仍是 `demo-data.ts` 的硬编码。不扩表就没法说 About「真实化」了。
>    同轮 `about_set` 从「整体覆盖」改成**部分更新**——字段涨到 6 个之后,整体覆盖会变成一个
>    「改一句 intro 静默清空七张仓库卡」的接口。
> 2. **origin 链接按所有者裁定加同款 ghost 按钮**(画板 2e 只画了一个 GitHub 按钮)。
>    `originUrl` 为空时整个按钮不渲染,此时页面与画板一字不差。
> 3. **新增了两个服务目录**,不是一个:`metrics`(打点)与 `about`(访客面的只读读取)。
>    About 的读路径没有合适的既有落点;`about` 与 notes(读)/ mcp(写)的分工同构。
>    两个名字都已补进 `dev.ps1` 的 `--services` 白名单。
> 4. **多一个 `traffic_agents`(UA 摘要分布)**:打点规格要求存 UA 摘要,存了却没有读路径
>    等于存了个只能靠手写 SQL 才看得到的列。聚合 SQL 与另外两个同构,不引入新机制。
>
> 另:**访客标识按天轮换**(哈希输入含日期),所以「区间 UV」这个数在本方案下不存在 ——
> 统计只给各日 UV 之和,tool 里叫 `visitorDays` 而不是 UV。这是隐私设计的直接后果。

### R9 — 容器化与 130 预发部署

> R-BUN 已把镜像构建、compose 定稿、安全参数、文档四块前移完成(bun 基座、不可变镜像、`infra-config.json`、`cap_drop`/`pids_limit`/网络分段/healthcheck)。R9 只剩「在 130 上真跑一遍 + 补齐尚未落地的部分」。

- 数据库迁移已由 R-BUN 的 `deploy/migrate.sh` 解决(所有者裁定方案一);R9 只需把它纳入部署流程文档与冒烟清单
- ~~`agent_ro` 初始化:`docker-entrypoint-initdb.d` 建角色~~ —— **本项取消**(R7 落地补记 1):角色是 NOLOGIN、
  没有口令,由迁移 `006` 连同授权一起建。R9 这边只剩一条既有约束:**`migrate.sh` 必须在起 api 之前跑完**
  (本来就是既定顺序);冒烟时顺带核一句「以 agent_ro 写库失败」
- 130 部署流程文档 + 脚本:`dev.ps1 build` → 文件方式传输(`docker save -o` → `scp` → `docker load -i`;**勿在 PowerShell 用管道直传,二进制会被文本重编码破坏**)→ 130 上按**先迁移后起服务**的顺序(`up -d --wait postgres` → `./migrate.sh` → `up -d`),避免「健康检查全绿但业务接口 500」的中间状态;升级另需先 `docker compose stop api web`(见 docs/deploy-environments.md「升级顺序」)
- 预发全链路验证:三 Tab + `/api/mcp` 管理端点(带 token 实连)+ notes 附件供图路由(Caddy 扩展名分流)+ 限额;安全约束逐项核验(非 root / read_only / `cap_drop ALL` / `pids_limit` / mem_limit / **最终运行镜像**内无 node / postgres 仅 `back` 网段可达)。spike 服务已于 R4 整目录删除,`/spike/*` 不再存在,该项从冒烟清单撤下
- **服务白名单核验**:`dev.ps1 build` 的 `--services` 是维护热点——冒烟时必须逐个确认**当前已落地的正式 service 端点都可达**(不只是 `/health`),漏改的表现是镜像构建正常、健康检查正常、而该服务端点静默 404
- **SSE 冒烟**(R3/R4 已就绪,可以做了):正式端点 `POST /agent/ask` 与 `GET /trace/stream` 均已落地并进白名单。冒烟内容:心跳 15s、断线重连 `afterSeq` 回放、`docker compose stop api` 时客户端收到明确断流而非静默挂起、SSE 脱敏抽查。**另需复测两条 R4 挂起的限制**(见 `rounds/BACKLOG.md`):Caddy + 自托管镜像的真实拓扑下能否拿到 SSE 客户端断开信号——若能,`/trace/stream` 的让位机制与 `MAX_STREAM_MS` 硬上界都可以放宽甚至退役
- 回滚演练:`IMAGE_TAG` 换回上一 SHA + `up -d` 真跑一次
- 验收:130 上从干净环境按文档一次部署成功,且回滚演练通过

> **落地补记(2026-09-01,与上面计划的四处偏离,详见任务卡)**
>
> 1. **开工第一个卡点是 web 镜像根本构建不出来**:`apps/web/Dockerfile` 的
>    `COPY --from=builder /app/public ./public` 在 R6 把配图搬进 Postgres、删掉整个 public/ 之后
>    就指向了一个不存在的路径。R6 之后没人再构建过 web 镜像,所以「R9 才第一次真构建」正好把它翻出来。
>    删掉那行即可(自托管字体走 `.next/static/media`,不经 public/)。
> 2. **字体自托管按所有者裁定并进 R9**(BACKLOG 的 R-BUN P1-4,原标「R9 或 R10」),
>    顺带解决回滚演练缺真实代码差异的问题 —— 本轮提交刻意拆成 v1(构建修复 + `dev.ps1 ship`)
>    与 v2(字体自托管),升级与回滚都有肉眼可验的差别,而不是两个内容相同只差 tag 的镜像。
> 3. **断连信号复测给出否定结论**:BACKLOG 里三条(R3 一条 / R4 两条)都挂着「等 R9 在真实拓扑下
>    复测,能拿到断开信号就放宽」。实测**拿不到** —— 开满 8 条 `trace/stream` 后 `kill -9` 掉全部
>    客户端,第 9 条仍 429。加一层 Caddy 不改变 Encore 网关不传导断开这件事。
>    **让位机制与 `MAX_STREAM_MS` 上界都要留着**,三条 BACKLOG 全部保持打开。
> 4. **多出一份 `docs/notes-content-spec.md`**:所有者中途给了 `D:	mpgent-xray-notes`
>    (211 篇 md + 56 图,是 vault 原导出而非标准化内容)并裁定「先给一份修改要求,
>    我让 AI 处理后再发」。全量内容入库不在本轮 —— 那会重新造一遍 R6 已退役的 notes-sync 改写管线。
>    R9 只发了验收所需的样本(四分类 + 系列 `r9-smoke` + 2 篇 + 1 图 + About),真实内容到位时清掉。
>
> 另:「最终运行镜像里不含 node」这句话要加限定 —— `oven/bun` 基座自带一个**指向 bun 的
> `node` 软链**,`command -v node` 会命中它。结论仍成立,判据已改(CLAUDE.md 规则 11 与
> `docs/deploy-environments.md` 冒烟清单第 12 条)。

### R10 — 安全加固与上线检查单

- ~~`docs/security.md` §~~ **`docs/deploy-cn-lightweight.md` §6**「上线前检查单」逐项过并留证:gitleaks / .env 权限 / 容器约束 / admin 强认证 / SSE 抽查 / 限额演练(检查单实际在 cn-lightweight 那篇,security.md 里没有这一节)
- 备份:Postgres 每日 pg_dump(本机 + 异地)脚本与恢复演练
- 可选:/admin IP 白名单(Caddy 层)
- 验收:检查单全绿,证据回填任务卡

> **落地补记(2026-09-01,与上面计划的三处偏离,详见[任务卡](rounds/round-10/round-10.md)与[检查单留证](rounds/round-10/checklist.md))**
>
> 1. **所有者裁定砍掉两项,本轮收敛成纯验证轮**:限额演练**不重跑**(R9 `smoke.md` §5 已在同一部署
>    形态下留证,`daily_tokens` / `turn_limit` 双路径 429 + 恢复后立即可用),**pg 备份整项不做**。
>    备份的代价是显式的:`deploy-environments.md` 与 §3 里「涉及不可逆迁移时先恢复备份」目前是
>    **悬空引用**,镜像回滚能回代码、回不了数据。已记 BACKLOG,R11 上线前须再裁定一次。
>    IP 白名单同样不启用(130 是内网预发,源 IP 同网段,白名单在这里没有验证价值),
>    留 R11 按真实出口 IP 开;Caddyfile 第 45–51 行的模板本轮核对过。
> 2. **本轮的实际产出是「把检查单的判据修准」,不是「打勾」**:5 条发现里有 3 条是判据本身会误判 ——
>    ①「镜像内无 node」写的 `node --version 应失败` 会给出相反结论(bun 的 node 兼容层不支持单独的
>    `--version`,报错却写着 `Node.js-compatible REPL`);②「GET 一律 401」漏了限定,带**正确** token
>    的 GET 是 **405**;③「SSE 优雅关闭」钉死 `curl exit 18`,而 R10 实测是 `0`(两者都对,差别只在
>    断开落在响应分块的哪个位置,要判的是「停机同刻终止」)。三条已就地改进 `docs/`。
>    另外新增 `.gitleaks.toml`:裸跑 gitleaks 会报 15 条(全是构建产物与**刻意写成假密钥的测试夹具**),
>    「每次要人眼过一遍 15 条」正是真泄漏藏得住的地方,把判据钉死后这项的期望值才是 0。
> 3. **两条加固被裁定出本轮,写进 BACKLOG**:①全站**一个安全响应头都没有**(Caddyfile 与
>    next.config.ts 均未设 nosniff / Referrer-Policy / X-Frame-Options);②130 上留着一份明文
>    LLM key(`~/deploy/.llm-key`,R9 残留,与 security.md §3「唯一来源是加密入库」不一致)——
>    扩散面已查清只有这一份,**没有当场删**(删了要回 provider 控制台重取,是所有者的东西)。

### R-VISITOR — 访客会话隔离(插在 R11 之前的加固轮;所有者裁定 2026-09-01)

> 沿用 R-BUN 的「命名轮」先例:不属于 R0–R11 的线性序列。ICP 备案未下来、生产尚未开站,
> 是做这件事代价最小的时间点 —— 生产库还是空的,保留期规则可以直接生效。

**开工时的实际状态比「缺个 cookie」严重**:`sessions` 表没有任何归属列,`GET /agent/sessions`
是**全站**列表 —— 任何访客打开 Runtime 就能看到所有人的会话标题,点进去能读全文;
`GET /trace/stream?sessionId=` 也只校验会话存在,轨迹面板里是完整的 prompt 与回复。
站点公开可访问,这在上线前必须堵掉,且必须同时覆盖 agent 与 trace 两个服务。

- 迁移 007:`visitors`(token 只存 sha256 / 24h 滑动 `expires_at`)+ `sessions.visitor_id`(可为 NULL,
  存量会话因此对所有人不可见)+ 归属索引
- cookie `xr_visitor`:HttpOnly / SameSite=Lax / Path=/ / Max-Age 86400,`Secure` 跟 `X-Forwarded-Proto`
  走(备案期是 HTTP,写死 Secure 会让浏览器静默丢弃整个 cookie)。**只在会话被创建时发放**,
  读路径只认领 —— 否则 `GET /agent/sessions` 就是个无认证的建行入口
- 归属过滤覆盖:会话列表 / 单查 / 续接提问 / 删除 / 轨迹流。不匹配一律 `not_found` 而非 403
- 保留期:会话最后活跃满 3 天硬删(级联 messages / trace_events),访客行过期满 3 天删。
  **不能用 Encore `CronJob`**(自托管镜像不执行 cron),落点是进程内 `unref` 定时器
- 会话删除(所有者裁定新增,见上面的功能边界修订):`DELETE /agent/sessions/:id` + 前端 hover ×
- 文档先行(规则 9):`docs/security.md` §6 加 R-VISITOR 补记,§4/§6 里「无 cookie」的措辞收窄到
  「管理面无 cookie」「打点侧无 cookie」

> **本轮最值得记住的实测**:Encore 的静态解析器**不穿透类型别名**。把响应 cookie 字段写成
> `type VisitorCookie = Cookie<string, "xr_visitor">` 再复用,Encore 会**静默**把它当成普通响应体字段 ——
> 不发 `Set-Cookie`,而是把整个 cookie 对象(含**明文 token**)序列化进 JSON:
> `{"session":{…},"visitorCookie":{"httpOnly":true,…,"value":"<明文>"}}`。编译过、请求 200、字段也在,
> 只有抓响应头才看得出来。内联写全就正常。最终选 `Header<string, "Set-Cookie">` 而不是内联的
> `Cookie<>`,是为了让 cookie 属性只有 `buildSetCookie` 一个来源 —— 两条 `api.raw` 只能拼字符串,
> 用 `Cookie<>` 等于让同一个 cookie 的属性在两处各写一遍。

### R-WEBSEARCH — agent 联网搜索工具(插在 R11 之前的能力轮;所有者裁定 2026-09-01)

> 沿用 R-BUN / R-VISITOR 的「命名轮」先例。**插在上线之前**的理由很直接:
> 这一轮动的是 agent 的工具集与出网面,上线之后再动等于让生产环境当第一个试验场。

**先说清楚它不违反规则 8**:`design/Agent Runtime Workbench.dc.html:1162` 就画着
`mkTool('web_search', 'MCP', '外呼', '联网搜索(服务端 key · 域白名单 · 计入日限额)', 'on')`,
`docs/security.md` §1 开篇与第 4 层也一直写着「后续生图、联网搜索等插件」「外呼型工具(LLM / 生图 / 搜索)」。
本轮是**补齐既定边界**,不是长新功能;实现口径连括号里那三条都照搬了。

- **协议**:OpenAI 系 Responses API 的服务端内置搜索(`POST {base}/v1/responses`,
  `tools:[{type:"web_search"}]` + `stream:true`)。**DeepSeek 与自建 AI 网关是同一套协议**,
  差异只有 baseUrl / modelId / toolType 三个配置字段 —— 一份实现,零分支
- **不做 Perplexity**(所有者裁定):参考插件里那三个是收费直连,与本站「服务端持凭据 + 域白名单」
  是另一套取舍;只取插件的第 1 个工具
- **文档先行**(规则 9):`docs/security.md` 威胁模型加第 5 条(外部内容注入);§1 第 1 层
  加「工具分两组」表 —— 原文只写了「每个工具必须是纯函数」,而第 4 层同时写着「外呼型工具」,
  两处此前是矛盾的。本轮把外呼组的**六条附加约束**写死(访客控不到网络原语 / 域白名单 /
  双计时器 / 计入日限额 / 结果有界且异常不外泄 / 返回内容视为不可信输入)
- 迁移 008:`websearch_config`(与 `llm_config` 同构但**不合表**)+ `daily_quota.searches` +
  `web_search` 启停种子(**默认关**)
- MCP 四个管理 tool:`websearch_providers_list` / `_provider_upsert` / `_set_default` / `_provider_delete`
- **右栏可见性**(所有者追加要求):一次搜索最长 180s,不上报的话 Timeline 上就是一行干等三分钟。
  阶段上报走 pi 的 `onUpdate` → `tool_execution_update`(34 事件之一,已在白名单里),
  Lifecycle 的 `tool_call` / `tool_execution` / `tool_result` 三个节点也随之从 pending 点亮 ——
  **前端零改动**(三视图本来就是泛型投影),规则 7 完好
- 验收:域白名单挡得住(含后缀伪装 / 明文 http / 内嵌凭据)· 访客控不到网络原语 ·
  双计时器与 4 MiB 上界 · 凭据不进错误对象 · 限额原子 · 未配 provider 不注册 ·
  配置变更下一轮生效 · 130 上 DeepSeek 与网关两条配置各跑通一次

> **本轮最值得记住的实测**:测试抓到过一个真 bug —— 上游 4xx 的响应体被原样放进了
> `WebSearchError.message`,而网关**会把请求头回显进错误体**,于是明文 key 进了错误对象。
> 只在日志那一行调 `safeErrorText` 是不够的:一个带着凭据的 `Error` 会被传递、被别处 catch、
> 被将来某个人直接 `console.error(err)`。**凭据要在构造错误的地方就抹掉**,而且通用模式
> (`sk-` 前缀 / `Bearer`)兜不住纯十六进制的自定义网关 key —— 必须再叠一道本次 key 的精确替换。

### R-TITLE — 会话命名工具(插在 R11 之前的小轮;所有者裁定 2026-09-01)

> 沿用 R-BUN / R-VISITOR 的「命名轮」先例:不属于 R0–R11 的线性序列。放在上线前做的理由是
> 它只改 agent 侧一条通路、不动部署形态,而生产库还是空的 —— 迁移 009 落在没有存量数据的库上。

**问题**:`sessions.title` 现在由 `store.deriveTitle` 派生(首条用户消息取首行、截 40 字)。
真实对话的第一句几乎总是 `hi` / `你好` / `在吗`,于是左栏会话列表全是同一个词,点进去才知道是哪一段。
参考实现是 pi 的 `auto-session-title` 扩展(首条输入后另起一个 `--no-tools` 子进程起标题)。

**形态裁定**:不照搬「服务端旁路生成」,改成**给 agent 一个工具**。理由是本站的卖点就是右侧内核轨迹——
命名过程要在 Timeline 里以 `tool_call · session_rename` 看得见;顺带还省掉一条独立的 LLM 出网路径
(标题由本轮对话顺产,token 落在既有 `daily_quota` 计数里)。代价已认:模型偶尔不调用,那时标题
退回现在的首行截断,不比现状差。

- 迁移 009:`sessions.title_source`(`derived` | `agent`,默认 `derived`)· NOLOGIN 角色 `agent_title`
  + **列级**授权(只有 `sessions` 的 `title` / `title_source` 两列可写)· `tool_config` 种下
  `session_rename` 且 **enabled = TRUE**(所有者可经 MCP `tool_config_set` 关掉)
- `apps/api/agent/tools.ts`:新增**会话绑定**工具注册表 —— 工具定义在建会话时按当前会话 id
  闭包绑死,入参只有一个 `title`;既有三个只读工具的注册路径与语义不变
- `apps/api/agent/title-db.ts`:写通道(`SET LOCAL ROLE agent_title` + `statement_timeout`),
  与 `ro-db.ts` 同构但**不是** `READ ONLY` 事务
- `runtime.ts`:冷启动查一次「本会话是否还需要命名」,已命名的会话**不注册**这个工具;
  系统提示按实际注册到的工具生成(现有那句「它们只能读教程内容,不能写任何数据」不能再一刀切)
- `docs/security.md` §1 第 1/2 层补记(规则 9 先行):纯函数与只读两条约束的**唯一例外**及其边界
- 前端**零改动**:标题在会话列表里本来就渲染,每轮对话结束的 `refreshSessions()` 会带回新标题

- 验收:①新会话首轮结束后左栏标题不再是首行截断,且右侧 Timeline 有 `tool_call · session_rename`
  一行、入参预览就是那个标题;②同一会话第二轮不再改标题(冷启动不注册 + SQL 双闸);
  ③以 `agent_title` 角色改 `sessions` 其他列 / 写 `messages` / 删会话 / 读 `llm_config` 全部失败;
  ④经 MCP `tool_config_set` 关掉后新会话不再有这个工具,标题回落首行截断;⑤`dev.ps1 test` 全绿
- **止损**:回退成本是一条迁移与一个工具;真出问题时 `tool_config_set session_rename enabled=false`
  即可当场停用,不需要发版

### R-TOOLS — Tools 工具面板(命名轮;所有者裁定 2026-09-02)

> 又一个不属于 R0–R11 线性序列的命名轮。**与 R11 的先后待所有者裁定**:它只加一个只读端点与一个前端 tab,
> 无迁移、无新依赖、不动部署形态,放在上线前后都成立。

**问题**:R7 落地只读工具组、R-WEBSEARCH 加了联网搜索、R-TITLE 加了会话命名,现在 agent 手上有 5 个工具。
访客在 Timeline 里看得到 `tool_call · web_search` 这一行,**却无处得知这个 agent 一共有哪些工具、
每个工具吃什么参数、吐什么结果**——「Agent 运行时 DevTools」这个定位缺了「能力清单」这一块。

**形态裁定**:Runtime 右栏**第 4 个 tab `Tools`**,与 Timeline / Chain View / Lifecycle Map 并列。
它与前三个的性质不同:前三个回答「本次运行发生了什么」,Tools 回答「这个 agent 具备什么能力」,
**与有没有正在运行的会话无关**,空会话时也有内容。设计稿 `1f`(列表态)/ `1g`(展开 `web_search`)
与原型已于 2026-09-02 就位,实现逐画板对照。

- 只读端点(`apps/api/agent/`):吐工具元信息 —— 名称 / 中文标签 / 描述 / 入参 JSON Schema / 输出形态说明 / 分组。
  **端点不得吐**:`execute` 函数、`ActiveWebSearchConfig` 的任何字段(baseUrl / key / model / provider)、
  `dailySearchLimit` 与当日用量、`tool_config` 的 enabled 状态(所有者裁定:公开即泄服务端配置面)。
- **派生式,不手工维护目录**(所有者裁定 2026-09-02,针对「每次发版还得顺便处理一下面板」)。
  数据来源要认一件事:`TOOL_REGISTRY` 只有纯函数组三个;`web_search` 由 `makeWebSearchTool(cfg)` 现构造、
  没配置就不存在,`session_rename` 是按会话闭包绑定的工厂 —— 但这三条路径里 `name` / `label` /
  `description` / `parameters` **都是常量**,只有 `execute` 闭包才用到 `cfg` / `ctx`。于是:
  每个工具一份 **META 常量**(定义由它构造 `{...META, execute}`),端点收集 META 并按白名单序列化。
  **面板永远不是第二个要改的地方**。
- 画板上有两样 pi 的 `ToolDefinition` 没有的东西,它们才是会反复要人手补的地方,各给一条出路:
  **工具分组按注册路径派生**(在哪个注册表里就是哪一组,手写只会写错);
  **输出形态是 META 的必填字段**,漏写是**编译不过**而不是「面板少一行」—— 拦在写工具那一刻,不是发版前。
- META 定义在闭包**外面**,`cfg` / `ctx` 在那个作用域里不存在,所以「description 里插进限额数字」
  这类泄配置面的写法**在结构上做不到**,不靠自觉也不靠 grep。
- 前端(`apps/web/components/workbench/`):新增 Tools 面板组件 + `Workbench.tsx` 的 tab 数组加第 4 项。
  这是规则 7 允许的结构性改动 —— 依据是设计稿已扩到 12 块(见上方 2026-09-02 修订),不是「顺手加的」。
- **一条待裁定**:目录是**静态**的(5 个工具全列)。若 `web_search` 未配置或被 `tool_config` 关掉,
  面板仍会列出它 —— 这与「不显示启停状态」的裁定是同一枚硬币的两面。所有者若认为「列了但用不了」
  比「泄配置面」更糟,再单独裁定改口径,不在本轮循环里自行决定。

- 验收:①右栏出现第 4 个 tab,样式/间距/选中态与前三个一致,空会话下也有内容;②5 个工具齐、分三组,
  每条的 name / label / description / 入参约束与 `apps/api/agent/tools.ts` **逐字一致**(用测试钉死,不靠眼看);
  ③端点响应里 grep 不到 key / baseUrl / model / provider / 限额数字 / enabled;④展开态按画板 `1g` 对照;
  ⑤`dev.ps1 test` 全绿、`dev.ps1 gen` 后前端类型对得上
- **止损**:回退成本是一个端点文件 + 一个前端组件 + tab 数组里的一行,无迁移、无数据变更

### R11 — 生产部署上线

- 前置:生产服务器采购完成,所有者提供 SSH 入口与密钥
- 服务器初始化(`docs/security.md` §5 基线:仅密钥登录 / 防火墙 / fail2ban / 自动安全更新)
- docker compose 部署;域名解析 + ICP 备案流程(`docs/deploy-cn-lightweight.md` §1)+ Caddy 自动 TLS;备案号挂 footer
- 上线冒烟 + 首日观察(限额、内存、日志)
- **R10 交接过来的四条**(逐条给结论,不要漏):①检查单在生产**重跑一遍**(R10 只证了 130,判据已修准,见 `rounds/round-10/checklist.md`);②`/api/mcp` 的 Caddy IP 白名单**按真实出口 IP 启用**(模板在 `deploy/Caddyfile` 第 45–51 行);③写生产 LLM provider 时 key **直接贴进 MCP 调用,不落盘**(130 上那份 `.llm-key` 就是这么留下的);④**安全响应头**与 **pg 备份**在上线前再裁定一次(两条都在 BACKLOG,备份那条决定了「不可逆迁移出错」有没有兜底)

## 轮次外事项

跨轮次发现的问题进 [`rounds/BACKLOG.md`](rounds/BACKLOG.md),不当场顺手改(CLAUDE.md 开发约定)。

### 修补记录(不成轮次)

| 日期 | 内容 | 处置 |
|---|---|---|
| 2026-09-01 | R9 部署后所有者在 130 上发现两处:① Runtime 聊天区把助手回复当纯文本渲染,模型给的 markdown 全糊成一段;② 站点没有图标文件,浏览器落兜底图标 | 合入 `main`(merge `4b572c1`,含提交 `1d42a91` / `bcc39d6`)。**所有者裁定不走 codex 审查**。130 预发已由 `dbf61ce` 升级到 `4b572c1`(无新迁移,`migrate.sh --status` 停在版本 6),两处修复与三 Tab / 七服务端点 / RSS 均实测正常,流式渲染在 130 上实跑确认 |
| 2026-09-01 | R-VISITOR 合并后 130 预发升级:`5c98b3e` → `7cc17fe`,迁移 `6 → 7`(007 访客隔离) | 按「先停 api/web、再 `migrate.sh`、后 `up -d`」顺序升级。8 项冒烟全过(留证在[任务卡](rounds/round-visitor/round-visitor.md#130-预发部署留证2026-09-01));**本机验不了的「新建会话首帧带 Set-Cookie」在这里验掉**。存量 12 条冒烟会话迁移后归属为 NULL、对所有访客不可见,由 3 天保留期清掉 |
| 2026-09-01 | 所有者继续提两处:① 导航条没有 logo;② 右侧 Timeline 不跟随滚动,新事件到了还要手动划 | 合入 `main`(merge `5c98b3e`,含提交 `0f0325b`)。**所有者裁定不走 codex 审查**。logo 按 Pulse X 定稿的导航条实测图实现(44px / mark 20px / gap 9px / accent 明暗两态),`components/XrayMark.tsx` 与 `app/icon.svg` 是同一图形的两份载体、改图形要一起改。Timeline 改为**贴底才跟随**:上翻查看历史时不被新事件拽回,滚回底部自动恢复。130 已升到 `5c98b3e`,三种行为(跟随 / 上翻不被拽 / 回底恢复)在真实事件流下逐项实测 |
