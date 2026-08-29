# PR #1 存档 — R-BUN

> [!warning] 这是从会话记录还原的 GitHub PR 存档，不是原始页面
> GitHub 账号 `cking000bigdemon` 于 2026-08-29 上午被封（申诉 Ticket `4709360`），
> `https://github.com/cking000bigdemon/agent-xray/pull/1` 已不可访问。
> 正文与两条评论的原文由 2026-08-29 从 Claude Code 会话记录逐字还原，**未经改写**。
> 代码本身无损失 —— PR 的 head 分支 `round-bun`（tip `2871ba2`）已完整推入 130 裸仓库。
>
> 审核改用分支方式：`remote-branch-review` 直接审 `origin/round-bun`，本文档提供 PR 的叙述性上下文。

| 项 | 值 |
|---|---|
| PR | #1（agent-xray 的第一个 PR） |
| base ← head | `main` ← `round-bun` |
| head tip | `2871ba2` |
| 创建时间 | 2026-08-29 07:37 |
| 原始标题 | R-BUN: 运行时统一 bun(开发/测试/预发/生产)+ 按架构评审整改部署方式 |
| **最终标题** | R-BUN: 生产 JS runtime 统一 bun(最终运行镜像不含 node)+ 按架构评审整改部署方式 |
| 原 URL | `https://github.com/cking000bigdemon/agent-xray/pull/1`（已失效） |

---

## PR 正文（2026-08-29 07:37 创建时提交）

> [!note] 阅读提示
> 下文「三个必须知道的实测结论」第 3 条把数据库迁移列为 **R9 阻塞项、待所有者裁定**。
> 该状态已被下方 2026-08-29 08:33 的评论一取代（方案一已落地，commit `0f026e0`）。
> 保留原文以维持时间线完整。

## 核心改动

把四个环境的 JS 运行时统一为 **bun 1.4.0**(任何镜像里不再有 node),同时把 `deploy/` 从「框架版」推进到可用状态——原样 `docker compose up` 此前根本起不来(`apps/web` 连 Dockerfile 都没有)。

**与 2026-08-29 架构评审结论的偏离**:评审给的是 **B(实验轨、生产保持 Node)**,理由是「Encore 把 bun-runtime 标为 experimental,生产路径不可用」。130 实测把这条理由证伪:开发与生产两条路径都跑通,生产只差一个 `--base` 参数。所有者裁定直接统一切换。残留风险不是「能不能跑」,而是「上游标 experimental,升级可能回归」,由钉版本 + 回归门禁兜住。

### 运行时

- `apps/api/encore.app` 开 `"experiments": ["bun-runtime"]`;实测**不需要** `ENCORE_EXPERIMENT` 环境变量
- 构建必须配 `--base oven/bun:1.4.0-slim`,已固化进 `dev.ps1 build`
- `apps/web/Dockerfile`(新增):runner 阶段纯 bun 无 node,uid 10001 + read_only 下首页 200
- 测试:`bun --bun vitest run --passWithNoTests`

### 部署(评审 P1-1/2/3/5/6)

- compose `build:` → `image:<git-sha>`,`${IMAGE_TAG:?}` 强制非空、禁 `latest`
- 新增 `deploy/infra-config.json`;库名随 infra-config 的 `databases` key 改为 `agent`
- `mem_limit` 2g → **1g**(依 bun 口径基线 162.5MB + 事件缓冲结构性上限推导;原值在 3.6GiB 主机上形同虚设,爆炸半径控制失效)
- 补 `cap_drop ALL` / `pids_limit` / tmpfs `noexec,nosuid,size=` / postgres healthcheck + `depends_on: service_healthy` / `stop_grace_period 40s` / `front`-`back` 网络分段
- `--services agent,system` 在构建期把 spike 挡在镜像外(实测 `/spike/*` 404),P1-6 从「计划保证」变成硬门禁
- 文档:容量段废弃「每会话 300–500MB」改为公式;升级流程从服务器 `git pull + build` 改为不可变镜像拉取

## ⚠️ 三个必须知道的实测结论

**1. 只开实验位会产出必然启动失败的镜像(Encore 上游缺陷)**

`encore build docker` 在 `bun-runtime` 下把 ENTRYPOINT 改成 `bun run …`,基座却仍是默认 `node:slim`,镜像里没有 bun:

```
docker: ... exec: "bun": executable file not found in $PATH
```

补 `--base oven/bun:1.4.0-slim` 即修复。另外 `encore.app` 的 `build.docker.base_image` 对本地构建**无效**(schema 注释:仅作用于 Encore 自家 CI/CD),`bundle_source: true` 会把镜像从 592MB 撑到 1.4GB——两条都别加。

**2. `packageManager: bun` 是不够的,会给出「已切换」的假象**

加上后 `encore test` 输出确实从 `npm notice run` 变成 bun 的 `$ vitest run`,但断言露馅:

```
expect(process.versions.bun).toBeDefined()
→ AssertionError: expected undefined to be defined
```

`bun run` 默认尊重 `node_modules/.bin/vitest` 的 `#!/usr/bin/env node` shebang 静默回落到 node,三种 vitest pool 都一样。必须 `bun --bun`。**判据只能是 `process.versions.bun`,不能看输出格式。**

**3. 自托管镜像不执行数据库迁移 —— R9 阻塞项,本 PR 未自行发明机制**

Encore 运行时全树没有迁移逻辑,`encore db` 也没有 `migrate` 子命令。空库直起的表现很阴险:

```
/health          → 200        ← 看起来一切正常
/agent/sessions  → 500  relation "sessions" does not exist
```

与 `docs/deploy-environments.md` 原文「Encore 镜像启动时自跑 migrations」直接矛盾,该表述已更正。已验证**迁移带外应用后全链路正常**。三个候选方案列在任务卡,按 CLAUDE.md「审查边界」交所有者裁定;**定稿前 R9 不得宣告部署成功**。

## 验证方式

R1/R2 全部门禁在 bun 下复刻通过(130 服务器,encore v1.57.13 / bun 1.4.0 / pi 0.84.3):

| 门禁 | 结果 |
|---|---|
| 实验位从 encore.app 生效 | `Enabled experiment(s): bun-runtime`,app 进程实证为 `bun run …` |
| 真实 LLM 对话 | handler 内 `createAgentSession` → `prompt()` 全程,流式返回 |
| 34 事件订阅 | `34/34`,0 错误;触发 16 种,与 R1 在 Windows/Node 记录**逐一对应、顺序一致** |
| 四模式计数 | notify 19 / veto 6 / chain 7 / takeover 2 = 34 |
| SSE ×2 | 直连跨 4.3s 逐 delta;轨迹流回放 74 条后 live tail;经 Next proxy 每秒 6/42/21 行 |
| 落库 | 239 条轨迹 seq 0–238 连续,`jsonb_typeof='object'` 全 true |
| 重启不丢 | 进程 kill 后重启,标题与 4 条消息完整恢复 |
| 凭据泄漏 | SSE 采样 + `trace_events` 全表 **0 命中**;脱敏自测 6/6 |
| `encore test` | 16/16,且 `process.versions.bun` 断言通过 |
| 镜像 | api 592MB / web 352MB,容器内均只有 bun 无 node |
| spike 隔离 | `/spike/*` 全 404,`/health` 200 |
| 生产形态端到端 | 纯 bun 镜像 + 标准 `postgres:16-alpine`,会话创建/列表/落库全通 |

**内存基线(bun 口径单独建档,勿与 node 混表)**

| 指标 | Bun 1.4.0 | (对照)Node v26.5.1 同机同代码 |
|---|---|---|
| 基线 RSS | 60.9 MB | 111.1 MB |
| import 后总量 `B` | **162.5 MB** | 228.0 MB |
| 单空闲会话增量 | 0.04 MB | 0.38 MB |
| 10 轮 churn 残留 | 1.75 MB | 0.38 MB |

顺带纠正 R1 任务卡一个数字:「import 约 16s」是 Windows 平台开销,同代码在 Linux/Node 上仅 512ms,不应作为运行时结论引用。

## 影响范围

15 个文件,+583/−65。`apps/web` 仅新增 `Dockerfile` / `.dockerignore`,**未动任何页面、className、design token**(CLAUDE.md 规则 7)。

新增 **CLAUDE.md 规则 11**(运行时统一 bun;实验位与基座必须成对;`--bun` 强制;运行时≠包管理器);「钉版本」表补 bun 1.4.0 与 encore 1.57.13;规则 10 补「镜像本机构建、禁 latest」。

**包管理器明确不切**:pi SDK 自带 `npm-shrinkwrap.json` 锁定传递依赖而 bun 不读它,切 `bun install` 等于丢掉这层供应链锁定且收益为零。依赖解析仍归 `npm ci` + `package-lock.json`。

## 审查请重点看

1. `dev.ps1 build` 的 `--services` 白名单是维护热点——R4/R5/R7/R8 新增服务时漏改会静默 404
2. `stop_grace_period 40s` 与 `graceful_shutdown.total 30s` 的配比在 SSE 长连接下是否够
3. compose 里 `${IMAGE_TAG:?}` 的强制是否会卡住某些正常运维路径
4. web Dockerfile 的 builder 阶段仍装 node/npm(仅构建期),与「任何镜像里不得有 node」的表述边界

> `dev.ps1` 只做了 PowerShell 解析校验(0 语法错误),**未在 Windows 上实跑**——130 无 Windows 环境,`dev.ps1 build` 需在本机冒烟一次。


---

## 评论一 — 数据库迁移方案已落地（2026-08-29 08:33，commit `0f026e0`）

## 追加:数据库迁移方案已落地(所有者裁定方案一)

commit `0f026e0`。新增 `deploy/migrate.sh`,原先标为「R9 阻塞项」的迁移问题**已解决**,PR 描述里那段「未自行发明机制、待裁定」现已过期。

### 为什么选方案一

SQL 直接取自**正在部署的那个镜像**(按 `.env` 的 `IMAGE_TAG` 定位),服务器上没有仓库,因此不可能出现「镜像 A 版、SQL B 版」的漂移;也不必多维护一个 migrate 镜像。

### 设计要点

- **版本记录与 Encore 同构**:沿用 golang-migrate 的 `schema_migrations(version, dirty)` 单行语义。实测本脚本产出的记录与 `encore run` 本地库**逐字段一致**(都是 `1|f`)——将来若用 encore CLI 连这个库,它读到的版本是对的,不会重跑
- **单事务**:SQL 与版本推进同生共死。Postgres DDL 是事务性的,失败整体回滚、版本号不动、可直接重跑,因此 `dirty` 恒为 false
- **幂等**:只应用 `version >` 当前版本的文件
- **含 `CONCURRENTLY` 主动拒绝**:这类语句不能在事务内跑,宁可停下提示人工处理,也不绕过事务保护
- **多库不猜**:目前只认 `agent` 库,遇到别的库名报错停下

### 130 完整 compose 形态实测

四容器 `docker compose up -d`(含 caddy 占 80/443),postgres healthy 且 `depends_on: service_healthy` 确实生效:

| 检查 | 结果 |
|---|---|
| 迁移前故障形态复现 | `/api/health` 200 + 前端 200 + `/api/agent/sessions` **500** |
| `--status` 在空库上 | 真只读,执行前后库中表数**均为 0** |
| 首次执行 | 应用 v1,端点 500 → **200** |
| 幂等复跑 | 空操作 |
| **事务回滚**(故意 `SELECT 1/0`) | 版本停在原值;半途 `CREATE TABLE` 的表**不残留** |
| spike 隔离 | `/api/spike/mem` **404** |
| 前端经 Caddy | 200 / 22757 字节 |

> 首版脚本有两处瑕疵已修:`--status` 会建出跟踪表(与「未改库」的声明自相矛盾)、`CREATE TABLE IF NOT EXISTS` 的 NOTICE 噪音。修后从干净库重跑,上表全部通过。

### ⚠️ 一个 R9 验收项需要顺延

**生产镜像里现在没有任何 SSE 端点。** 两条 SSE 只存在于 spike,而 spike 已被 `--services` 排除出镜像;正式的 `/agent/ask`、`/trace/stream` 分别在 R3、R4 落地。

本轮的 SSE 门禁是在 `encore run` **开发形态**下验的 —— 生产镜像形态下的 SSE 行为(心跳、断线重连、`docker compose stop api` 时是否明确断流)**要等 R3/R4 才能验**。`ROUNDS.md` 的 R9 拆解与 BACKLOG 已相应更新,请审查时确认这个顺延是否可接受。

---

## 评论二 — 收口完成（2026-08-29 09:46，commit `2871ba2`）

> 同一时刻 PR 标题改为：**R-BUN: 生产 JS runtime 统一 bun(最终运行镜像不含 node)+ 按架构评审整改部署方式**（去掉绝对化表述）

## 收口完成(commit `2871ba2`)

六项逐条处理完毕,**未扩大范围**:没有新增 migrate service / 新容器 / 编排系统 / 安全组件,也没有继续推包管理器 bun 化。

### 1. 部署顺序改为「先迁移、后起服务」✅

沿用现有 `migrate.sh`,不加任何编排设施:

```bash
docker compose up -d --wait postgres   # 1) 只起库,--wait 阻塞到 healthy
./migrate.sh                           # 2) schema 就位
docker compose up -d                   # 3) 再起 api / web / caddy
```

**130 实测新顺序**:

| 步骤 | 实测 |
|---|---|
| 1 | 只起 postgres,`--wait` 阻塞 5.97s 到 healthy;**此刻 80 端口无人监听**(curl → 000),对外零暴露 |
| 2 | api 尚未启动即完成迁移 v1(脚本只依赖 postgres) |
| 3 | 服务上线即 `/api/agent/sessions` **200**,不再出现 500 窗口 |

四处描述已统一:compose 头注释 / migrate.sh 用法 / deploy-environments.md / deploy-cn-lightweight.md,ROUNDS.md R9 同步;升级与回滚路径也按同一顺序改写。

### 2. 收紧「完全移除 Node」表述 ✅

原措辞("任何镜像里不得存在 node"、"不存在 node 路径")确实会误导。已统一改为:

> **Node 已从生产 runtime 与最终运行镜像中移除;构建阶段与依赖解析仍用 Node/npm。**

并在 `docs/deploy-environments.md` 开头补了一张三层边界表:

| 层面 | 用什么 |
|---|---|
| 生产运行时(api / web runner) | **bun**,最终运行镜像内无 node |
| 构建工具链 | 仍用 **node + npm**(builder 阶段 `npx next build`),不进 runner |
| 依赖安装与锁定 | 仍用 **`npm ci` + `package-lock.json`** |

PR 标题也一并去掉了绝对化表述。任务卡里我原本留给审查者的第 ④ 条(node 表述边界)据此闭环。

### 3. npm + package-lock 保持不变 ✅
未做任何改动。

### 4. `--services` 白名单保留 + 明确维护热点 ✅
`deploy-environments.md` 写明:R4/R5/R7/R8 落地 `trace`/`notes`/`admin`/`metrics` 时必须同步补 `dev.ps1` 的 `$hostedServices`,否则表现是**镜像构建成功、容器 healthy、`/health` 200,而该服务端点静默 404,没有任何一处报错**。ROUNDS.md R9 冒烟新增一条「逐个确认已落地正式 service 端点可达」。不引入自动服务发现。

### 5. SSE 顺延表述统一 ✅
任务卡验收项 6 与实测记录都标注了「**仅开发形态 `encore run`**」,并显式声明该结果**不能读作「生产镜像 SSE 已验证」**。ROUNDS.md / BACKLOG / deploy-environments 四处措辞一致。不保留 spike、不加临时端点。

### 6. 内存结论收紧为中性 ✅

- `mem_limit: 1g` → 明确表述为**初始生产上限**(依据:Bun 口径基座 + 事件缓冲结构性上限 + 主机总预算),并显式写明**不代表已证明 1GB 足够所有真实负载**,`S_active_p95` 仍是空值
- 明确禁止用空闲会话 0.04MB 推真实活跃会话容量
- Bun/Node 对比改成「支持什么 / 不支持什么」的中性记录,并主动点名 **10 轮 churn 残留是 bun(1.75MB)高于 node(0.38MB)**,不写「全面优于」

---

**本次改动**:7 文件 +110/−37,纯文档与配置注释 + 部署顺序,无功能代码变更。收口后回归:`migrate.sh` 语法 OK / `docker compose config` OK / `dev.ps1` PowerShell 解析 OK / 完整四容器按新顺序实测通过。

任务卡新增「收口状态」表,把最终结论(runtime / build toolchain / 依赖安装 / pi / 部署 / 数据库 / 安全 / SSE / 内存)固化下来,并注明本轮不再扩大范围。
