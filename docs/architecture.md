# 架构

## 总览

```
访客浏览器
   │ HTTPS
   ▼
Caddy :443(自动 TLS,单机反代)
   ├── /            → apps/web  Next.js(Runtime 工作台 / Notes / Skills / About;/admin 已于 R6 整目录删除)
   ├── /notes/**.webp → 按扩展名分流到 api 的 /assets/notes/…(正文配图存 Postgres,R6)
   ├── /skills/*.zip  → 按扩展名分流到 api 的 /assets/skills/…(skill 目录打包下载,R-SKILLS)
   └── /api/*       → apps/api  Encore.ts :4000
                        │
                        ├── agent 服务:createAgentSession(pi SDK in-process)
                        │     ├── noTools:'all' + 三组业务工具:纯函数组 notes_*(agent_ro 只读角色)
                        │     │   / 外呼组 web_search · generate_image(域白名单 + 双计时器 + 日限额)
                        │     │   / 会话绑定组 session_rename(列级授权;见 security.md 四层沙箱)
                        │     ├── 观测者扩展:订阅 34 种内核事件 → 内存事件队列
                        │     ├── 对话 SSE ← session.subscribe();GET /agent/tools 工具目录;GET /agent/images 按访客供图
                        │     └── 访客 cookie 归属过滤 + 3 天保留期(R-VISITOR)
                        ├── trace 服务:GET /trace/stream(api.raw SSE ← 事件队列,推送前脱敏)
                        ├── notes 服务:教程库查询(前端用)+ RSS + /assets/notes 正文配图供图
                        ├── about 服务:GET /about(about_content 只读)
                        ├── mcp 服务:无状态 MCP 管理面 /api/mcp(内容发布 / 附件 / About / LLM·搜索·生图 provider / 工具启停 / 统计查询;静态 token)
                        ├── site 服务:GET /site/tabs(顶部 tab 呈现开关的只读面,R-TABS)
                        ├── skills 服务:GET /skills · GET /skills/:name · GET /assets/skills/:name.zip(技能库只读面;写面在 mcp 的 skills_* 八个工具;R-SKILLS)
                        ├── metrics 服务:POST /t 访问打点(不存原始 IP)
                        ├── system 服务:GET /health
                        ├── skill-runner 容器(R-SKILLS-2,已落地):agent 的 `skill_run` 经命名卷里的 unix socket 调它;
                        │     `network_mode: none` / 只读 / 非 root / rlimit;每次运行一次性进程 + tmpfs 工作目录;
                        │     可运行的 skill 与 venv 烧在镜像里(`runner/`),库只管开关与一致性判据
                        ├── skill-runner-egress 容器(R-WEBFETCH,2026-09-04 落地):同一镜像的第二个实例,只在专用 egress 网络(不在 front / back),
                        │     只跑 xray.json 声明 network: egress 的 skill(首个 `web-fetch`:访客给公网 https 网址 → 抓取抽正文);api 经第二条
                        │     unix socket(/run/runner-egress)按清单里的 network 档次路由;SSRF 防线在脚本(逐地址校验 + 钉 IP)与宿主
                        │     DOCKER-USER 规则(deploy/egress-filter.sh),api 进程不碰 URL / HTML;不维护域名黑白名单
                        └── Postgres(docker-compose 内;单库 agent,迁移由 deploy/migrate.sh 施加)
```

## 关键决策(已定)

| 决策 | 结论 | 依据 |
|---|---|---|
| agent 运行时 | pi SDK **in-process** 嵌入 Encore 进程,无 sidecar | 三层验证通过(import / session / Encore 请求内执行);站点不提供代码执行,业务工具纯函数即可,无妥协 |
| 前后端协议 | **Encore 类型化 RPC**(`encore gen client`),不用 GraphQL | 强类型已免费拿到;核心是 SSE 流;最小攻击面 |
| 流式通道 | SSE ×2(对话流 + 轨迹流),`api.raw` + node:http | 同进程内通信,延迟毫秒级 |
| 会话持久化 | Postgres | 重启不丢会话;轨迹可回放 |
| 部署 | 单机 docker-compose(caddy/web/api/postgres),境内轻量服务器 | 成本最低;无 Encore Cloud 超时限制 |
| 教程内容 | 所有者经 MCP 管理服务发布(标准 markdown 入库,server 只校验不改写),pi 经只读工具访问 | 2026-08-31 裁定,替代 R5 的 vault 静态编译管道;pi 可读不可改(SELECT-only 角色) |
| 管理面 | **无状态 MCP server**(2026-07-28,官方 TS SDK **v2** 保留向下协商;静态 bearer token) | 2026-08-31 裁定,替代 /admin 后台(画板 3a–3e 废弃);solo 维护无需 OAuth;无 cookie 即无 CSRF 面;详见 security.md §4 |
| MCP SDK 选型 | `@modelcontextprotocol/server` + `@modelcontextprotocol/node` **2.0.0**(不是 `@modelcontextprotocol/sdk`) | R6 实测:旧包最新版(1.30.0)的 `LATEST_PROTOCOL_VERSION` 仍是 `2025-11-25`、没有 `server/discover`;2026-07-28 由 SDK v2 以新包名提供。`createMcpHandler` 默认 `legacy:'stateless'`,同一份工具定义同时服务两个时代 |
| LLM 凭据与模型 | 全部来自 `llm_config` 表(多 provider,key 经 AES-256-GCM 加密入库),**无引导 secret** | 2026-08-31 裁定。`agent/runtime.ts` 在冷启动与**每一轮热路径**上都读一次配置并比对指纹:**配置变了,会话在下一轮被重建到新配置上**(走空闲回收同一条重建路径,库内历史照常注入)。这条统一规则是四轮 codex review 收敛出来的——只让新会话跟上配置,会留下「已在内存的会话拿着新 key 打旧端点」这类撤销漏洞 |
| notes 附件 | 存 Postgres,运行期由 api 供图;**镜像内不烧任何 notes 内容** | 2026-08-31 裁定。对外 URL 保持 `/notes/<系列>/<哈希>.webp` 不变(免改写存量正文);API 侧走 `/assets/notes/…`,因为 Encore 路由里 `/notes/:series/:file` 会与 `/notes/series/:slug` 撞车 |
| Skills 内容 | 与 notes 同形:所有者经 MCP **整包**发布(`SKILL.md` + `scripts/` + `references/` 的文本文件入库 `skill_files`),读面只读、文件一律当文本渲染、zip 写入时打好存库由读面吐;**agent 侧本轮不可读**(新表不授权任何 agent 角色) | 2026-09-03 裁定,R-SKILLS 落地(迁移 `012`,`apps/api/skills/` + mcp 八个 `skills_*` 工具,判据在 `shared/skill-pack.ts`,zip 用 `fflate`);约束见 security.md §1 第 2 层 / §4 的 R-SKILLS 补记;对外 zip URL `/skills/<name>.zip`,API 侧 `/assets/skills/…`(与 notes 配图同一前缀策略) |
| agent 使用 skills(R-SKILLS-2) | **执行不进 api 进程**:第五个容器 `skill-runner`(Python venv,`network_mode: none`),api 经 unix socket 调它,每次运行一次性进程 + tmpfs 目录;**可执行集合在代码里**(`runner/skills/` → 构建期生成 api 与容器两份同源清单),库里 `skills.agent_enabled` 只开关、且展示副本须与代码副本 sha256 一致才注入;pi 侧 `xray-guard`(`tool_call` 否决)/ `xray-skills`(`before_agent_start` 注入)两个扩展把裁决写进既有 34 事件(派生字段 `handlers`),不新增事件类型 | 2026-09-03 所有者七条裁定,同日落地(spike 留证:两个 `network_mode: none` 容器经命名卷 unix socket,bun 1.4.0 `fetch({unix})` 通;任务卡「本轮实测」);规则 9「一次性沙箱容器」措辞同日改为「独立容器可常驻 + 一次性进程」,理由与残余风险在 security.md §1 第 1 层;研究全文 `rounds/round-skills/research.md`。**生成物落在 `apps/api/shared/`**(不是任务卡写的 `agent/`):mcp 的 `skills_agent_status` 也要同一份清单,两个服务不互相 import |
| 读访客指定网页(R-WEBFETCH) | **不是新工具,是一个 egress 档 skill**:`runner/skills/web-fetch` 经 `skill_run` 跑在 `skill-runner-egress`(同一 runner 镜像、第二个实例,只出公网)里;`xray.json` 的 `network` 字段决定路由,两个实例各自拒绝不属于自己档次的 skill;**不维护域名黑白名单**,拒的是固定内网地址段;限额与超时复用 R-SKILLS-2 的;零新工具 / 画板 / 迁移 / MCP 工具 / 前端改动 | 2026-09-03 所有者十条裁定(预研 in-process 形态同日退役),**2026-09-04 落地**(`runner/skills/web-fetch` + compose `skill-runner-egress` / `egress` 网络 / `deploy/egress-filter.sh` + `agent/skill-runner.ts` 两档路由;抽取库 `trafilatura` 及传递依赖全部 hash 钉进 `runner/requirements.txt`);任务卡 `rounds/round-webfetch/round-webfetch.md`;约束 security.md §0 威胁 7–9、§1 R-WEBFETCH 补记 |

## 事件模式与观测

pi 扩展系统 34 种事件按四模式分组,观测者扩展全量订阅、采集 `{eventType, mode, timestamp, data(sanitized)}` 推给前端(计数为 R1 对 `@earendil-works/pi-coding-agent@0.84.3` 类型面的实测,修正了旧记载 notify 18/合计 33 的笔误;逐事件清单见 `apps/api/agent/events.ts`):

- **notify**(19):agent/turn/message/tool_execution/session/provider-response/model 生命周期通知
- **veto**(6):tool_call、session_before_*、project_trust 等可否决点
- **chain**(7):context、before_provider_*、before_agent_start、message_end、tool_result、resources_discover 等链式修改点
- **takeover**(2):input、user_bash 接管点

R1 实测注意:bare `createAgentSession()` 不向扩展广播 `session_start`/`resources_discover`,需在创建后调用 `session.bindExtensions({ mode: "print" })`(run 模式层职责);R3 正式实现沿用此调用。

R4 落地轨迹流后补记两条实现约束:

- **采集点即脱敏点**:事件在 `agent/runtime.ts` 的观测者里就过白名单 sanitize,库与 SSE 拿到的都已是脱敏数据。`docs/security.md` §2「SSE 推送前 sanitize」以此满足——入口脱敏比出口再洗一遍更强,否则库里会留着原文。
- **两个服务的耦合走中立模块**:trace 服务消费 agent 产生的进程内事件,二者都只依赖 `apps/api/shared/`(`trace-bus` 事件总线、`sse` 帧写出、`redact` 凭据脱敏),互不 import 对方目录;trace 读库经 `SQLDatabase.named("agent")`,只读、不拥有 schema。
- **SSE 连接的客户端断开在本架构下探测不到**(Encore 网关不传导,R3 POST / R4 GET 各实测一次),故长连接的生命周期由服务端硬上界 + 同 `clientId` 让位兜底,详见 `apps/api/trace/README.md`。

前端右栏三视图 = 同一事件流的三种投影:Timeline(时序瀑布)、Chain View(单事件的链式传递)、Lifecycle Map(生命周期节点图)。

## 仓库布局与 Encore 注意事项

- `apps/api` 是独立 Encore app(自带 `encore.app` 与 `package.json`),所有 encore 命令在该目录执行
- 不做 npm workspaces 提升(规避 encore#1723:仓内子包 node_modules 干扰 parser 的历史问题)
- `encore build docker` 产出 api 镜像;web 用 Next standalone 输出

## 设计稿

见 [design/](../design/README.md) —— 15 块画板静态稿(1a–1g + 2a–2h;2f–2h 为 Skills 技能库,2026-09-03 新增)+ 可交互原型,token 与组件语汇以其为准。
