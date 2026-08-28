# Round BUN — Node → Bun 运行时统一

> 状态:进行中

## 目标

在一套代码、零 `isBun` 分支的前提下,把**开发 / 测试 / 预发 / 生产**四个环境的 JS 运行时统一为 bun 1.4.0,任何镜像里不再存在 node;R1/R2 的全部门禁在 bun 下复刻通过。

**与原评审建议的偏离(所有者裁定 2026-08-29)**:2026-08-29 的架构评审给的结论是 **B —— Bun 作为实验轨、生产保持 Node**,理由是「Encore 把 bun-runtime 标为 experimental,生产路径不可用」。当日在 130 上的实测把这条理由证伪了:开发与生产两条路径都能跑通,生产路径只差一个 `--base` 参数(详见「本轮实测」)。所有者据此裁定直接统一切换,不走实验轨。**残留风险不是「能不能跑」,而是「上游把它标为 experimental,升级可能回归」** —— 由本卡的钉版本 + 回归门禁兜住。

## 前置

- R1(pi 内核门禁)、R2(数据层)已完成——本轮的验收就是拿 bun 复刻这两轮的门禁。
- bun **1.4.0**(2026-08-20 发布);encore CLI **1.57.13**(该版本二进制内已含 `bun-runtime` 实验位,无需升级 CLI)。
- LLM 凭据:真实对话门禁需要一把可用 key(R1 用 DeepSeek 官方;130 上用 openai-completions 兼容网关代替,对运行时结论无影响)。

## 交付物

| 路径 | 内容 |
|---|---|
| `apps/api/encore.app` | `"experiments": ["bun-runtime"]`;并注明 `build.docker.base_image` 对本地构建无效、不要往这里加 |
| `apps/api/package.json` | `"packageManager": "bun@1.4.0"`;test 脚本改 `bun --bun vitest run --passWithNoTests` |
| `apps/web/Dockerfile` | 新增。多阶段:`oven/bun:1.4.0-slim` builder(装依赖仍用 npm ci)+ 同基座 runner,`CMD ["bun","--bun","server.js"]`,uid 10001 |
| `apps/web/.dockerignore` | 新增。宿主机 `node_modules` / `.next` 不进构建上下文 |
| `deploy/infra-config.json` | 新增。`sql_servers`(`postgres:5432` 的 `agent` 库,密码 `$env`)+ `secrets`(`DeepSeekApiKey` ← `$env`)+ 显式 `graceful_shutdown` |
| `deploy/docker-compose.yml` | 重写:`build:` → `image:<sha>`;api `mem_limit 1g`、`cap_drop ALL`、`pids_limit`、tmpfs 限容;postgres healthcheck + `depends_on: service_healthy`;`stop_grace_period 40s`;`front`/`back` 网络分段;库名改 `agent` |
| `deploy/Caddyfile` | 端口契约注释(`PORT=4000` ↔ `api:4000`)+ 未来前置 CDN/LB 时 SSE 必须 bypass |
| `deploy/.env.example` | `IMAGE_TAG`(强制 git SHA)/ `IMAGE_REGISTRY` / `DEEPSEEK_API_KEY`;未落地的 R6/R7 变量降级为注释 |
| `dev.ps1` | 新增 `build` 子命令:脏工作区拒绝构建 → api(`--config` + `--base` + `--services`)→ web;tag = git 短 SHA |
| `CLAUDE.md` | 新增**规则 11**(运行时统一 bun;实验位与基座必须成对;`--bun` 强制;运行时≠包管理器);「钉版本」表补 bun 1.4.0 与 encore 1.57.13;规则 10 补「镜像本机构建、禁 latest」 |
| `docs/deploy-environments.md` | 四环境矩阵加运行时列;不可变镜像部署流;**「迁移必须带外执行」**新增段 |
| `docs/deploy-cn-lightweight.md` | §0 改为容量公式(废弃「每会话 300–500MB」);§3 改为不可变镜像流程;§6 检查单补 7 项 |
| `rounds/BACKLOG.md` | 记 Encore 上游缺陷、迁移方案待定、Next 代理 400、字体自托管 |

## 验收

| # | 检查 | 命令 / 期望 |
|---|---|---|
| 1 | 实验位从 encore.app 生效 | 不带任何环境变量 `encore run`,日志出现 `Enabled experiment(s): bun-runtime`,且 app 进程是 `bun run …` 而非 node |
| 2 | 编译 | `dev.ps1 check` 通过 |
| 3 | 测试**真正跑在 bun 上** | `dev.ps1 test` 16/16 全绿;且临时加一条 `expect(process.versions.bun).toBeDefined()` 必须通过(判据不是「输出里有 bun 字样」) |
| 4 | 真实 LLM 对话 | Encore handler 内 `createAgentSession({noTools:'all'})` → `prompt()` 全程跑通,流式返回 |
| 5 | 34 事件订阅 | `subscribedCount 34/34`、`subscribeErrors []`;四模式计数 notify 19 / veto 6 / chain 7 / takeover 2 |
| 6 | SSE ×2 不缓冲 | 直连与经 Next dev proxy 两条路径,对话流与轨迹流均逐事件到达;轨迹流回放 + live tail 正常 |
| 7 | 落库与重启不丢 | 会话/消息/轨迹落库,seq 连续、JSONB 类型为 object;进程 kill 后重启数据完整恢复 |
| 8 | 凭据不泄漏 | SSE 原始采样 + `trace_events` 全表凭据扫描 0 命中;脱敏自测 6/6 |
| 9 | 内存基线(bun 口径**单独建档**) | 基座 RSS、import 增量、单会话增量、churn 残留全部回填本卡;**不与 node 数字混表** |
| 10 | api 镜像可启动 | `dev.ps1 build` 产物 `docker run` 能起;镜像内 `bun` 存在、`node` 不存在 |
| 11 | web 镜像可启动 | 同上;non-root(uid 10001)+ read_only 根 FS 下首页 200 |
| 12 | spike 端点不在镜像 | `/spike/*` 全部 404,`/health` 200 |
| 13 | 生产形态端到端 | 纯 bun 镜像 + 标准 `postgres:16-alpine`,会话创建/列表/落库/真实 LLM + SSE 全通 |

## 禁止

- 不改前端页面样式(CLAUDE.md 规则 7)。本轮 `apps/web` 的改动仅限新增 `Dockerfile` / `.dockerignore`,不动任何页面、className、design token。
- 不加设计稿没有的功能(规则 8)。
- **不写 `if (isBun)` 分支**——一套代码两个运行时是本轮的前提,不是可协商项。
- **不做压力测试 / soak test / 性能 benchmark**。本轮只回答「行为是否对等」,不回答「谁更快」。
- 不切包管理器(理由见下),不做 `bun build --compile` standalone 二进制。
- 不顺手修 Google Fonts、Next 代理 400 等跨轮问题——记 BACKLOG。

### 包管理器为何不切

pi SDK(`@earendil-works/pi-coding-agent`)自带 `npm-shrinkwrap.json` 锁定它自己的传递依赖,**bun 不读依赖包内的 shrinkwrap**。切 `bun install` 会丢掉这层供应链锁定,而换来的收益接近零(依赖已装好、无 CI 流水线、安装耗时不在关键路径上)。因此:bun 只做**运行时**与**脚本执行器**,依赖解析仍归 `npm ci` + `package-lock.json`。`packageManager: "bun@1.4.0"` 字段的唯一作用是让 `encore test` 以 bun 执行 test 脚本。

## 代码审查

<!-- 完成后回填。审查路由见 CLAUDE.md「开发模式」:codex 独立审查,硬失败才降级 /code-review。 -->

- 审查方式:待执行(改动跨 12 个文件,应带 `--background`)
- findings 处理:待回填
- 结论:待回填

**建议审查者重点看**:① `dev.ps1 build` 的 `--services` 白名单是维护热点——R4/R5/R7/R8 新增服务时漏改会静默 404;② `stop_grace_period 40s` 与 `graceful_shutdown.total 30s` 的配比在 SSE 长连接下是否够;③ compose 里 `${IMAGE_TAG:?}` 的强制是否会卡住某些正常运维路径;④ web Dockerfile 的 builder 阶段仍装 node/npm(仅构建期),是否与「任何镜像里不得有 node」的表述冲突——runner 阶段确实无 node,但表述边界要审。

## 失败处理

同一验收项针对性整改后连续 2 次验证仍不过 → 写 `rounds/round-bun/BLOCKED.md`,停下呼人。禁止放宽验收标准自我通过。

**本轮已触发一次「停下呼人」**:验收项之外发现自托管镜像不执行数据库迁移(见下),该问题指向部署方案设计而非缺陷,按 CLAUDE.md「审查边界」不在本轮自行发明机制,交所有者裁定。

## 本轮实测

环境:130 服务器(Arch Linux)· encore v1.57.13 · bun 1.4.0(`1.4.0+34cbb9a40`)· node v26.5.1(仅作对照)· pi 0.84.3 · Next 15.5.24 · vitest 4.1.11 · 2026-08-29

### 门禁结果

1–13 全部通过。要点:

- **实验位可从 `encore.app` 生效**,不需要 `ENCORE_EXPERIMENT` 环境变量;app 进程实证为 `/…/bun/bin/bun run …/main.mjs`。
- **34/34 订阅、0 错误**;纯对话场景实际触发 **16 种**事件,与 R1 在 Windows/Node 上记录的 16 种**逐一对应、顺序一致**。四模式计数 19/6/7/2 = 34,与 R1 一致。
- **SSE ×2 均逐事件到达**:对话流跨 4.3s 逐 delta;轨迹流先回放 74 条缓冲(seq 0–73)再 live tail,第二轮对话事件实时到达。经 Next dev proxy 同样不缓冲(每秒 6 / 42 / 21 行)。
- **落库**:239 条轨迹事件 seq 0–238 连续无缺口,`bool_and(jsonb_typeof(data)='object') = t`;进程 kill 后重启,会话标题与 4 条消息完整恢复。
- **凭据扫描**:SSE 原始采样 + `trace_events` 全表,`authorization|x-api-key|bearer|sk-|access_token|client_secret` **0 命中**;脱敏自测 6/6。
- **测试真跑在 bun 上**:`packageManager` 字段能让 `encore test` 从 npm 切到 bun,但**光有它不够**——`bun run` 会尊重 `node_modules/.bin/vitest` 的 `#!/usr/bin/env node` shebang 静默回落到 node,三种 vitest pool(threads/vmThreads/forks)都一样。加 `--bun` 强制后 `process.versions.bun` 断言才通过,16 个原有用例同时全绿。

### 内存基线(bun 口径,单独建档)

未开 `--expose-gc`,自然回收口径。**不要与 node 数字混用**(JSC 堆 vs V8,RSS 语义不同)。

| 指标 | Bun 1.4.0 | (对照)Node v26.5.1 同机同代码 |
|---|---|---|
| 进程基线 RSS(pi 未加载) | **60.9 MB** | 111.1 MB |
| pi 动态 import ΔRSS | **+101.4 MB** | +115.7 MB |
| **import 后 RSS 总量 `B`** | **162.5 MB** | 228.0 MB |
| import 耗时 | 335 ms | 512 ms |
| 单空闲会话增量 | 0.04 MB | 0.38 MB |
| 3 会话 dispose 后回落 | +0.12 MB | +1.12 MB |
| 10 轮 create/dispose 残留 | +1.75 MB | +0.38 MB |

- bun 侧常驻内存比 node 低约 **65MB(29%)**,`deploy/docker-compose.yml` 的 `mem_limit: 1g` 据此设定(替换原先的 2g)。
- churn 残留 bun(1.75MB)略高于 node(0.38MB),两者均**无单调增长**,量级在噪声范围,不构成泄漏证据。
- **顺带纠正 R1 任务卡一个数字**:R1 记的「import 约 16s」是 Windows 平台开销,不是运行时特性——同代码在 Linux/Node 上仅 512ms。该数字不应作为运行时结论引用。

### 镜像

| 镜像 | 大小 | 内容 |
|---|---|---|
| `xray-api`(bun 基座) | **592 MB** | bun 1.4.0,无 node |
| (对照)api node 基座 | 711 MB | node v26.8.1 |
| `xray-web` | **352 MB** | bun 1.4.0,无 node,uid 10001,read_only 下首页 200 / Ready 89ms |

### 踩坑与实测发现

1. **只开实验位会产出必然启动失败的镜像(上游缺陷)。** `encore build docker` 在 `bun-runtime` 下把 ENTRYPOINT 改成 `bun run …`,基座却仍是默认的 `node:slim`,镜像内没有 bun:
   ```
   docker: ... exec: "bun": executable file not found in $PATH
   ```
   node 对照组同样构建能进到 Encore runtime,证明是 bun 分支单独坏的。**补 `--base oven/bun:1.4.0-slim` 即修复**,修好后容器正常启动并加载 Encore 原生运行时(`encore-runtime.node`,N-API)。已记 BACKLOG,建议给 Encore 提 issue。

2. **`encore.app` 的 `build.docker.base_image` 对本地构建无效。** 写进去后日志仍 `resolving base image node:slim`;schema 注释写明该字段 *"used for building the application in Encore's CI/CD system"*。基座只能靠 `--base`,故固化进 `dev.ps1 build`。另外 `bundle_source: true` 会把镜像从 592MB 撑到 1.4GB,不要开。

3. **`bun run` 默认尊重 shebang 会回落到 node。** 见上「测试真跑在 bun 上」。判据只能是 `process.versions.bun`,不能看输出格式。

4. **自托管镜像不执行数据库迁移 —— R9 阻塞项,需所有者裁定。** Encore 运行时里**没有迁移逻辑**(runtimes 全树无相关代码;`encore db` 也没有 `migrate` 子命令);迁移是本机 CLI(`encore run`/`check` 日志里的 "Running database migrations")或 Encore Cloud 控制面施加的。镜像里虽打包了 `agent/migrations/001_init.up.sql`,但容器启动不会应用。空库直起的表现:
   ```
   /health          → 200
   /agent/sessions  → 500  relation "sessions" does not exist
   ```
   **已验证:迁移一旦带外应用,全链路即正常**(纯 bun 镜像 + 标准 `postgres:16-alpine`,POST/GET 会话均 200)。
   候选方案(按 CLAUDE.md「审查边界」不在本轮自行选定):① 一次性 migrate 容器;② 部署脚本用 psql 施加镜像内 SQL(SQL 来自被部署的那个镜像,不会漂移,但需自行记录版本);③ 从构建机经隧道施加。**定稿前 R9 不得宣告部署成功。**

5. **`hosted_services` 不能用来裁剪端点。** infra-config 里去掉 `spike` 后 `/spike/mem` 仍 200;schema 也写明该字段 *"should not be set by the user, computed during build"*。真正生效的是构建期 `--services agent,system`,实测让 `/spike/*` 全部 404 而 `/health` 正常——评审的 P1-6 由此从「计划保证」变成构建期硬门禁。

6. **`PORT` 环境变量有效**,镜像默认 8080 可改 4000,与 Caddyfile 的 `api:4000` 对齐(二选一已写死在 compose + Caddyfile 注释)。

7. **infra-config 的 `databases` key 就是物理库名**,故 compose 的 `POSTGRES_DB` 从 `xray` 改为 `agent`。

8. **`encore build docker` 不消费 `DATABASE_URL` 等普通环境变量**,不给 `--config` 直接硬失败(`Your infra configuration is incomplete: Secrets DeepSeekApiKey / Databases agent`)——评审 P1-1 属实,且是硬失败不是软警告。

9. **Next standalone 可跑在 bun 上**:`bun --bun server.js` Ready 89ms、首页 200。但仅验证了 standalone **运行**;`next build` 本身仍以 node 执行(Dockerfile builder 阶段装了 node/npm),未验证用 bun 执行 Next 构建器。

### 与计划的偏离

- 原评审建议 R-BUN 作为「不阻塞 R9–R11 的实验轨」;所有者裁定改为直接统一切换(理由见「目标」段)。
- 原评审建议 `encore.app` 写 `base_image` + `bundle_source: true`;实测两条都不成立,改为 `--base` 固化进 `dev.ps1 build`、不开 `bundle_source`。
- 原评审建议 R-BUN 包含「package manager migration」;实测评估后**明确不切**,理由见「包管理器为何不切」。

### 目前证据不足(不要外推)

- **活跃会话真实内存增量**:只测了空闲会话。长上下文、大量 Tool Output、高频事件队列的增量未知,`S_active_p95` / `S_stream_p95` 仍是空值,须等 R3/R4 后用真实使用数据采。
- **长时间运行**:最长连续运行约 20 分钟,长期泄漏口径未验。
- **`next build` 在 bun 下执行**:未验证(当前构建期仍用 node)。
- **bun `smol` 模式**:未测。Encore 曾在 bun 实验发布说明里提示 bun 内存占用偏高并建议 `smol`,但本轮实测 bun 反而比 node 低 29%,该建议是否仍适用未知。
