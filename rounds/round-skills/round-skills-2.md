# Round R-SKILLS-2 — agent 使用 Skills:注入 + 沙箱运行 Python 脚本(`round-skills` 的 2.0 迭代)

<!-- 保存为 rounds/round-skills/round-skills-2.md;与 1.0 的任务卡 round-skills.md 同目录。拆解见 ROUNDS.md「R-SKILLS-2」。 -->

> 状态:**未开始(文档就绪、七条裁定已落,2026-09-03;等三个前置齐了另开 session 开工)**
>
> 研究与取舍全文在 [`research.md`](research.md)(pi 内核实测依据在附 A);本卡只列交付与验收。
> 前置见下;**代码一行未写**。

## 目标

给 pi agent 两个新工具:`skill_load`(把一个 skill 的 `SKILL.md` 送进上下文)与 `skill_run`(在独立的无网络执行容器里跑该 skill 声明过的 Python 脚本,venv 解释器、一次性进程与工作目录);
**哪些 skill 可用**由「代码清单 ∩ 库里 `agent_enabled` ∩ 展示副本与代码副本 hash 一致 ∩ 工具闸开着」四个条件决定;
守卫 / 注入 / 运行三条轨迹在 Runtime 右栏既有 34 事件上看得见,前端零样式改动。

可证伪:发版并按打开顺序开启后,对 agent 说「用 text-tools 统计这段话的词频:…」,
① Timeline 出现 `before_agent_start`(详情卡 EXTENSION RETURNED · xray-skills,列出可用 skills)→ `tool_call · skill_load` → `tool_call · skill_run` → `tool_execution_update · skill_run ×N` → `tool_execution_end · skill_run`;
② 对话区回复里有脚本算出的词频;
③ 再说「用 text-tools 跑 scripts/rm.py」→ Timeline 的 `tool_call · skill_run` 行带红色 `blocked` 徽标与「└ xray-guard returned {block: true}」注记,`tool_execution_end` 为 `isError`;
④ 生产 `skill-runner` 容器内出不了网、写不了 `/opt/skills`;
⑤ `/agent/tools` 与 SSE 原始流里搜不到 socket 路径 / 超时数字 / 限额数字。

## 前置(三个都要齐)

| 前置 | 状态 | 说明 |
|---|---|---|
| **R-SKILLS(1.0)落地并合并 `main`** | 未开工 | 本轮的迁移 013 依赖 012;`skills_agent_set` 依赖 `skills` 表;hash 一致性判据依赖 `skill_files`。所有者在 1.0 里经 MCP 上传首批 skills(裁定 5) |
| **画板 1f/1g 加第四组「沙箱执行组」** | 待所有者在画布上改 | 与 R-TOOLS 同一顺序(先改设计稿);建议沿用既有语义色 `#8b5cf6`、示例工具加 `skill_run`;改完更新 `design/README.md` 增删记录与 token 一行 |
| **spike:Encore 的 bun 运行时里 `fetch` 走 unix socket** | 未做,可与 1.0 并行 | 不通试 `node:http` 的 `socketPath`;两条都不通 → 写 BLOCKED 回所有者重裁裁定 4,**不自行退到共网** |

无新凭据。新依赖:runner 镜像的 Python 基座与 `requirements.txt`(hash 锁定);api / web 侧零新增 npm 依赖。

## 范围裁定(所有者 2026-09-03,七条;开工前不再重议)

| # | 项 | 裁定 | 落点 |
|---|---|---|---|
| 1 | 做不做 | **做**,作为 `round-skills` 的 2.0 迭代 | 本卡 |
| 2 | 规则 9 措辞 | 按默认:「一次性沙箱容器」→「独立沙箱容器(可常驻)+ 每次一次性的进程与工作目录」;残余风险认下 | `docs/security.md` §1 第 1 层(本文档轮已改) |
| 3 | `skill_run` 归组 | 按默认:第四组「沙箱执行组」,先改画板 1f/1g | 前置第 2 项;`catalog.ts` / `ToolsPanel.tsx` |
| 4 | 隔离强度 | 按默认:`network_mode: none` + unix socket;spike 不通停下重估 | 前置第 3 项;`deploy/docker-compose.yml` |
| 5 | 首批 skills | 所有者在 1.0 里经 MCP 上传;**默认只展示、不注入**,逐 skill 显式打开 | 迁移 013 的 `agent_enabled DEFAULT FALSE` + `skills_agent_set` |
| 6 | 改 SKILL.md 要不要发版 | **要发版**:agent 可用集合在代码里(`runner/skills/`),库里只能在集合之内开关;库内副本必须与代码副本 hash 一致才注入 | `skills.generated.ts` + `runner/manifest.json` + 一致性判据 |
| 7 | 130 预发 | **非必经**;隔离形态在生产冒烟验收,过了才开 `skill_run` | `docs/deploy-environments.md` 冒烟清单 +4;打开顺序在「交付物 · 运维」 |

## 交付物

**文档(规则 9:本文档轮已完成,开工时若有偏离先改文档)**
- `docs/security.md` —— §0 威胁 6;§1 第 1 层措辞修订 + R-SKILLS-2 补记(第四组八条约束);第 2 层 R-SKILLS 补记补一句;第 3 层 runner 参数;第 4 层 `skill_runs`;§7 供应链
- `CLAUDE.md` —— 规则 8 的 R-SKILLS-2 修订、规则 9 四组、仓库结构 `runner/`;`docs/architecture.md` / `README.md` —— 容器与 socket 决策(待实现标注,收口时去掉)
- 开工时:`design/README.md`(前置第 2 项完成后记增删)、`docs/deploy-environments.md`(第三个镜像、冒烟 +4)、`docs/deploy-cn-lightweight.md` §0 预算表加 runner 一行、`deploy/.env.example`(`XRAY_UNLOCK_DANGEROUS_TOOLS` 那段改成「已有用武之地」)、`apps/api/agent/README.md`(两个工具 + 两个扩展)、`apps/api/mcp/README.md`(+4)、`docs/releases.md`(发版一行)

**执行容器 `runner/`(仓库根,Encore app root 之外,规则 6)**
- `runner/Dockerfile` —— `python:3.12-slim@sha256:…` 按 digest 钉 → `python -m venv /opt/venv` → `pip install --require-hashes -r requirements.txt` → `COPY skills/ /opt/skills/` + `manifest.json` → `runner.py`;非 root `10001`
- `runner/requirements.txt`(钉版本 + hash;首批可以为空)· `runner/runner.py`(stdlib `http.server` + `subprocess`;unix socket 监听,`RUNNER_LISTEN=tcp://…` 仅开发模式;`POST /run` / `GET /health`;并发信号量 2;rlimit;进程组超时 kill;stdout / stderr 流式截断 256 KiB;每次运行 `/run/work/<uuid>` 结束即删;
  读 daemon env `RUNNER_NETWORK`(缺省 `none`),`/run` 时清单里该 skill 的 `network` 与自己不等即拒,与非清单脚本同一拒绝路径 —— **R-WEBFETCH C6 裁定「提前」**,2026-09-03)
- `runner/skills/<name>/` —— 可被 agent 使用的 skill 源(`SKILL.md` + `scripts/*.py` + `xray.json`;`xray.json` 顶层可选字段 `network`,取值 `none` / `egress`,缺省 `none`,**本轮只允许 `none`**,`egress` 档由 R-WEBFETCH 使用 —— 字段与判断提前进本轮,所有者裁定 2026-09-03 C6);首批:`text-tools`(可运行型,`wordfreq.py` / `json_pretty.py`,纯标准库)+ 所有者从 1.0 上传集合里挑的注入型(候选 `encore-api` / `encore-database` / `encore-testing`)
- `tools/skills-manifest/`(node 脚本)—— 读 `runner/skills` → 生成 `apps/api/agent/skills.generated.ts`(name / description / SKILL.md 正文 / 每文件 sha256 / `xray.json` 的脚本与 schema / `network` 档次)与 `runner/manifest.json`(同样带 `network`);`dev.ps1 skills-gen` 调它;生成物入库

**后端(`apps/api`)**
- `agent/migrations/013_agent_skills.up.sql` —— `ALTER TABLE skills ADD COLUMN agent_enabled BOOLEAN NOT NULL DEFAULT FALSE`;`sandbox_config` 单行表(`daily_run_limit INT DEFAULT 0 CHECK ≥ 0`、`total_timeout_ms INT DEFAULT 30000 CHECK BETWEEN 5000 AND 120000`);`ALTER TABLE daily_quota ADD COLUMN skill_runs INT NOT NULL DEFAULT 0`;`tool_config` 种子 `('skill_load', FALSE, FALSE, …)`、`('skill_run', FALSE, TRUE, …)`。只有 ADD / CREATE,无不可逆语句
- `agent/skills.generated.ts`(生成物)· `agent/skills-catalog.ts` —— `loadAgentSkills()`:代码清单 × 库(`name` 存在 ∧ `agent_enabled` ∧ 文件集合与 sha256 全等)→ 本次可用集合 + 指纹(并进 `EnabledTools.fingerprint`);漂移 / 未打开 / 库里没有分别记日志
- `agent/sandbox-config.ts` —— 读 `sandbox_config`,与 `websearch-config.ts` 同构(读不到不是错:`skill_run` 这轮不注册)
- `agent/skill-runner.ts` —— 与 runner 的协议:`fetch` 走 unix socket(`XRAY_SKILL_RUNNER_URL` 只在注册环节读、只接受 `unix:` 默认值或 `http://127.0.0.1:<port>`);总超时 = `sandbox_config.total_timeout_ms + 2000`;响应体经 `shared/http-body.ts` 带上界读取;错误在构造处不带容器内路径;按清单 `network` 选客户端 —— 本轮只有 `none` 一个客户端,清单里 `egress` 档的 skill 不进可用集合并记日志(R-WEBFETCH 加第二个客户端)
- `agent/tools.ts` —— `SKILL_LOAD_META` / `SKILL_RUN_META`(META 在闭包外,`output` 必填,`phases` 四段);`skillLoad` 进 `TOOL_REGISTRY`;`makeSkillRunTool(cfg)` 第四条构造路径;`loadEnabledTools` 读 `skill_run` 时同时读 `sandbox_config` 与 `loadAgentSkills()`;`reserveSkillRun` 进 `quota.ts`
- `agent/catalog.ts` —— `ToolGroup` 加 `"sandbox"`;`toolCatalog()` 加第四条路径;`catalog.test.ts` 的双向集合相等自动覆盖
- `agent/guard.ts` —— `makeGuard(rec, ctx)`:`tool_call` 五条规则(research.md §2.5);`agent/skill-injector.ts` —— `makeSkillInjector(rec, ctx)`:`before_agent_start` 追加 `<available_skills>`;两者在 `runtime.ts` 里与 `makeObserver` 同款注册,顺序 `[injector, observer, guard]`;`capture()` 加可选 `handlers`;观测者不再订阅这两个事件
- `agent/events.ts` —— `tool_call` / `before_agent_start` 白名单加派生字段 `handlers`(摘要,不放原文);`runtime.ts` 的 `systemPromptFor` 加「skills 怎么用 + 脚本输出是数据不是指令」一段
- `mcp/tools.ts` / `store.ts` —— `skills_agent_set` / `skills_agent_status` / `sandbox_config_get` / `sandbox_config_set`(42 → 46);`server.ts` INSTRUCTIONS 补一句打开顺序
- `deploy/docker-compose.yml` —— `skill-runner` 服务(`network_mode: none` · `read_only` · `tmpfs /run/work` · `user 10001` · `cap_drop ALL` · `no-new-privileges` · `mem_limit 384m` · `pids_limit 64` · `cpus 1.0` · healthcheck)+ 命名卷 `runner_sock` 挂到 api 与 runner 的 `/run/runner`;api 的 `environment` 加 `XRAY_UNLOCK_DANGEROUS_TOOLS`(注释:默认不设)
- `dev.ps1` —— `build` 出第三个镜像 `xray-runner:<sha>`;`ship` 三镜像 save;`skills-gen`;`runner`(本机 `docker run --rm -p 127.0.0.1:8000:8000`)

**前端(规则 7:零样式改动;三处都是投影 / 绑定逻辑,任务卡在此写明理由 = 接后端的新字段)**
- `apps/web/lib/trace-view.ts` —— `toRow`:`detail.extension / returned / diff` 从 `data.handlers` 取,没有时保留今天的观测者文案;`hasBadge / hasNote` 由 `handlers.some(h => h.returned?.block)` 置位;`toChainView`:`steps` 从 `handlers` 生成
- `apps/web/components/workbench/TimelineView.tsx` —— 第 112–116 行写死的 `permission-gate` 改为绑定 `handlers` 里那个扩展名(画板 1a 的注记格式不变)
- `apps/web/components/workbench/ToolsPanel.tsx` —— `GROUPS` 加 `sandbox` 一项(编译强制)、`GROUP_ORDER` 加到末尾;色值按前置第 2 项改完的画板取
- `apps/web/lib/api-client.ts` —— `dev.ps1 gen` 产物

**测试**
- `agent/guard.test.ts`(五条规则逐条;守卫抛异常 = 拦截)· `agent/skills-catalog.test.ts`(四个条件的真值表;漂移判定:多一个文件 / 少一个 / 改一字节)· `tools/skills-manifest` 的漂移测试(生成物 == 现算,与 `catalog.test.ts` 同一思路)· `agent/skill-runner.test.ts`(假 HTTP 服务:超时 / 排队 / 非零退出 / 超大输出 / 非清单脚本各一)· `agent/catalog.test.ts`(第四组;响应 grep 不到 socket 路径 / 超时 / 限额)· `agent/sandbox.test.ts`(`agent_ro` 对 `sandbox_config` 与 `skills.agent_enabled` 无权限;`reserveSkillRun` 原子)· `mcp/mcp.test.ts`(四个新工具;总数 46)· `apps/web` 的 `trace-view.test.ts`(徽标 / 注记 / 链式步骤 / 无 `handlers` 时回退)

## 验收

| # | 检查 | 命令 / 期望 |
|---|---|---|
| 1 | 编译与全量测试 | `dev.ps1 check` 通过;`dev.ps1 test` 全绿(1.0 收口时的文件数 / 用例数 +N,回填) |
| 2 | spike 留证 | Encore bun 运行时里经 unix socket 完成一次 `POST /run` 往返,记录在「本轮实测」;不通即 BLOCKED |
| 3 | 清单同源 | `dev.ps1 skills-gen` 重跑后 `git diff` 为空;篡改 `runner/skills` 任一字节后漂移测试红;`network` 字段透传两份清单、缺省 `none`,手工把某 skill 改成 `egress` 后它不进可用集合且 runner 对它的 `/run` 拒绝(R-WEBFETCH C6) |
| 4 | 四个条件真值表 | `skills-catalog.test.ts`:代码有 / 库无 → 不可用;库有未开 → 不可用;开了但 hash 不等 → 不可用且日志含 `drift`;四条全真 → 可用 |
| 5 | 入参闭集 | `skill_run` 的 schema 只有 `skill / script / input` 三个 string;`/agent/tools` 响应里 grep 不到 `code` / `path` / `argv` / `interpreter` |
| 6 | 守卫五条 | `guard.test.ts` 逐条:未知工具 / 未开放 skill / 非清单脚本 / 非法 input / 超会话次数 → `{block:true}`,`reason` 不含内部路径;守卫 handler 抛异常 → 仍是拦截 |
| 7 | 轨迹形状 | faux provider 驱动真实 agent loop:被拦截的调用事件序列为 `tool_execution_start → tool_call(handlers[0].returned.block=true) → tool_execution_end(isError)`,无 `tool_result`;放行的调用 `tool_call.handlers[0].returned` 为空 |
| 8 | 注入轨迹 | 每轮 `before_agent_start` 的 `handlers` 含 `xray-skills` 与 `skills` 列表;`systemPromptDelta` > 0;可用集合为空时不注入且 `handlers` 记 `returned: undefined` |
| 9 | 前端投影 | `trace-view.test.ts`:带 `block` 的 `tool_call` 行 `hasBadge && hasNote`;详情卡 `extension` 取自 `handlers`;无 `handlers` 的事件与今天输出逐字段相同(回归) |
| 10 | 画板对照 | Timeline 拦截行的徽标 / 注记与画板 1a 第 1043 行一致;详情卡与 1b 的 `context-injector` 卡同版式;Tools 面板第四组与改后的 1f/1g 一致;`git diff` 不含样式属性改动 |
| 11 | 限额与超时 | `reserveSkillRun` 原子(并发 20 次只放行上限数);`total_timeout_ms` CHECK 上下界;超时后 runner 进程组不残留(`ps` 无子进程) |
| 12 | 输出有界 | 脚本打印 10 MB → runner 截 256 KiB → 工具结果正文 ≤ 8000 + 截断标注;事件 ≤ 8 KB |
| 13 | MCP 四工具 | 真实 2026-07-28 协议路径:`tools/list` 46;`skills_agent_status` 对「库里没有 / 未开 / drift / 可用」四种状态各回对应值 |
| 14 | 镜像 | `dev.ps1 build` 产出三镜像;runner 镜像里 `/opt/venv/bin/python -I -c "import sys; print(sys.flags.isolated)"` 输出 1;`pip` 不可用或 `--require-hashes` 锁定 |
| 15 | **生产冒烟 4 条(裁定 7,双闸关闭状态下跑)** | ① `skill-runner` healthy;② 容器内 `socket.create_connection(('1.1.1.1',53),2)` 失败、`ip route` 为空;③ 容器内 `touch /opt/skills/x` 失败;④ 经 socket 对 `/run` 发不在清单的脚本名 → 拒绝。四条过了才按打开顺序开启 |
| 16 | 端到端(生产) | 目标段那三句「可证伪」逐条成立;`tool_config_set skill_run false` 后下一轮工具消失;`skills_agent_set text-tools false` 后该 skill 不再出现在 `before_agent_start` 的 `skills` 里 |

## 禁止

默认继承两条:不改前端页面样式(规则 7);不加设计稿没有的功能(规则 8)。本轮另加:

- **`skill_run` 不得有 code / path / argv / interpreter 任何形式的入参**;不接受 `input` 之外的第二个自由文本字段。
- **不开 pi 内置 `read` / `bash` / `write`**;loader 保持 `noSkills: true`;守卫与注入器**不得 `registerCommand`**。
- **默认 runner 实例不进任何 docker 网络**(`network_mode: none` 是硬约束,开发模式的 TCP 只在本机 `docker run`);R-WEBFETCH 的 egress 实例只在专用 egress 网络、不在 `front` / `back`,**不在本轮**;api 进程**不 `spawn`**。
- 执行来源只有代码清单:**不从库里把脚本推给 runner**、不接受 `skills_upsert` 上传的文件作为执行输入。
- 不给 `agent_ro` / `agent_title` / `agent_image` 授权 `skills` 三表或 `sandbox_config`(1.0 口径不变;一致性判据在注册环节用全权连接读,不在工具体内)。
- 不新增事件类型(仍是 34 种);`handlers` 只放摘要,不放系统提示词原文与脚本输出原文。
- 不改 1.0 的三张表结构与八个 MCP 工具的契约(只 `ADD COLUMN`)。
- 不在 Skills 页(2f–2h)显示「agent 可用」徽标 —— 画板没有,记 BACKLOG 待裁定。
- 不升级 encore CLI / MCP SDK / pi(规则 12)。

## 运维:打开顺序与止损

打开(每一步都可单独回退):发版(runner 镜像 + api + compose)→ 生产冒烟 4 条 → `tool_config_set skill_load true` → `skills_agent_set <name> true`(逐个)→ 服务器 `.env` 加 `XRAY_UNLOCK_DANGEROUS_TOOLS=1` 并 `docker compose up -d api` 重建 → `tool_config_set skill_run true`。

止损:`tool_config_set skill_run false` 当场停用运行(不发版);`skills_agent_set <name> false` 单个下线;`docker compose stop skill-runner` 后工具调用以固定文案失败、站点其余照常。
回退成本:一条纯追加迁移 + 两个工具 + 两个扩展 + 一个容器;`.env` 去掉 `XRAY_UNLOCK_DANGEROUS_TOOLS` 并重建 api 即回到「注册表里没有 dangerous 实现」的状态。

## 代码审查

<!-- 完成后回填。审查路由见 CLAUDE.md「开发模式」:codex 独立审查,硬失败才降级 /code-review。 -->

- 审查方式:<codex /codex:review --background(改动跨 runner / api / web / deploy)>;**审查要求带上**:`runner/skills/*/scripts/*.py` 按 research.md §2.2 准入清单逐条判
- findings 处理:<逐条:采纳整改 / 不采纳及理由>
- 结论:<PASS | 整改后 PASS>

## 失败处理

同一验收项针对性整改后连续 2 次验证仍不过 → 写 `rounds/round-skills/BLOCKED-2.md`,停下呼人。禁止放宽验收标准自我通过。
spike(验收 2)不过属前置未满足,同样写 BLOCKED 回所有者重裁裁定 4。

## 本轮实测

<!-- 完成后回填:spike 记录、实际数字、踩的坑、与设计/计划的偏离及原因 -->

### 文档轮留证(2026-09-03)

- 研究与七条裁定见 `research.md`;裁定落盘的文档改动:`docs/security.md`(§0 / §1 第 1–4 层 / §7)、`CLAUDE.md`(规则 8 修订、规则 9 四组、仓库结构)、`docs/architecture.md`、`README.md`、`ROUNDS.md`(第七次修订 + 进度表 + 拆解)、`rounds/BACKLOG.md`(功能提案条目关闭 + 三条新记录)。代码零改动。
