# Round BUN — Node → Bun 运行时统一

> 状态:已完成——缺陷门禁 PASS(2026-08-31),已合并 `main`

## 目标

在一套代码、零 `isBun` 分支的前提下,把**开发 / 测试 / 预发 / 生产**四个环境的 JS **运行时**统一为 bun 1.4.0,**最终运行镜像(final runtime image)中不含 node**;R1/R2 的全部门禁在 bun 下复刻通过。

**范围边界(勿扩大解读)**:本轮改的是**运行时**,不是「项目不再依赖 Node/npm」。node/npm 仍保留在构建工具链(`apps/web/Dockerfile` builder 阶段)与依赖解析(`npm ci` + `package-lock.json`)中,只是都不进 runner 阶段。

**与原评审建议的偏离(所有者裁定 2026-08-29)**:2026-08-29 的架构评审给的结论是 **B —— Bun 作为实验轨、生产保持 Node**,理由是「Encore 把 bun-runtime 标为 experimental,生产路径不可用」。当日在 130 上的实测把这条理由证伪了:开发与生产两条路径都能跑通,生产路径只差一个 `--base` 参数(详见「本轮实测」)。所有者据此裁定直接统一切换,不走实验轨。**残留风险不是「能不能跑」,而是「上游把它标为 experimental,升级可能回归」** —— 由本卡的钉版本 + 回归门禁兜住。

## 收口状态(所有者 2026-08-29 确认)

| 维度 | 结论 |
|---|---|
| 生产 runtime | api → **bun**;web runner → **bun**;最终运行镜像不含 node |
| 构建工具链 | **仍允许 node/npm**(`apps/web/Dockerfile` builder 阶段),不进 runner |
| 依赖安装 | **`npm ci` + `package-lock.json`**,不切 bun install / bun.lock |
| pi | **继续 in-process**,不拆 sidecar/worker |
| 部署 | Docker Compose + **不可变镜像**(git SHA,禁 latest);本机构建后传输 |
| 数据库 | Postgres 单机容器;**部署时先完成迁移,再起 api/web/caddy** |
| 安全 | 保持当前 compose 加固(`cap_drop ALL`/`pids_limit`/`read_only`/tmpfs 限容/`front`-`back` 网络分段/healthcheck/`stop_grace_period`) |
| SSE | 生产镜像形态的验证**顺延到 R3/R4 后在 R9 补**;不为此保留 spike 或加临时端点 |
| 内存 | api 初始 `mem_limit = 1g`;结论保持中性,不做单向外推 |

本轮**不再扩大范围**:不讨论 K8s / worker / sidecar,不追求包管理器全面 bun 化,不新增 CI/CD 或安全组件。

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
| 6 | SSE ×2 不缓冲(**仅开发形态**) | `encore run` 下,直连与经 Next dev proxy 两条路径,对话流与轨迹流均逐事件到达;轨迹流回放 + live tail 正常。**生产镜像形态未验、也无法验**——两条 SSE 只在 spike 里而 spike 已被 `--services` 排除,正式端点在 R3/R4;顺延到那时在 R9 补 |
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

- 审查方式:`/codex:review`(branch diff vs `main`),2026-08-31。`--background` 模式两次因宿主进程中断/companion 提前退出而失败,改前台 `--wait` 完成(job `review-mtglxzwh-d1o97v`);非 codex 硬失败,未降级。
- 本机 Windows 复核(PR 存档注明 dev.ps1 未在 Windows 实跑):`dev.ps1 check` ✅;`dev.ps1 test` 16/16 ✅(实证经 `bun --bun vitest` 执行)。`dev.ps1 build` 跑到「api 编译完成、镜像写入 daemon 中」被所有者叫停(2026-08-31:等真部署时再构建)——脚本侧已验证的部分:脏工作区拒绝、git SHA tag、`encore build docker --config/--base/--services` 正确发起、linux/amd64 交叉编译成功、基座从本地 daemon 解析;**镜像落地与 web 构建顺延到首次真实部署(R9 前置步骤)**。另:encore 拉基座**不走 docker daemon 的 registry mirror**,国内网络下要先 `docker pull oven/bun:1.4.0-slim` 再 `dev.ps1 build`,已实测。本机 bun 1.3.14 与钉版本 1.4.0 不一致——不影响镜像(基座由 `--base` 钉死),仅本机脚本执行器,`dev.ps1 test` 已加漂移告警,对齐:`npm i -g bun@1.4.0`。

### findings 处理(4 P1 + 4 P2,全部采纳,均为最小改动,无新增机制)

| # | 级别 | finding | 处理 |
|---|---|---|---|
| 1 | P1 | LLM key 进 `deploy/.env` 与 security.md §3「管理后台写入加密入库」冲突 | **采纳(文档收口)**:`DeepSeekApiKey` 是 R1 起的 Encore secret,自托管镜像在 R7 管理后台落地前只能经 infra-config `$env` 注入,且所有者 2026-08-29 收口交付物已含该绑定——机制不改;在 security.md §3 补记「引导凭据例外」划清与 R7 管理面 key 的边界,`.env.example` 注明,R7 收敛职责记 BACKLOG |
| 2 | P1 | 升级时旧版 api 仍在服务,迁移在旧二进制脚下改 schema(混版本窗口) | **采纳(改文案)**:升级顺序改为「先 `docker compose stop api web` → 迁移 → 起新版」,V1 用短暂停机换确定性;不停机升级仅当迁移确认后向兼容。compose 头注释 / deploy-environments / deploy-cn-lightweight 三处同步 |
| 3 | P1 | `docker save \| ssh docker load` 在 PowerShell 5.1 管道下二进制被文本重编码破坏 | **采纳(改文案)**:dev.ps1 构建完成提示与两个部署文档全部改为文件流(`docker save -o` → `scp` → `docker load -i`),并注明原因 |
| 4 | P1 | 服务器资产清单只列 compose/Caddyfile/.env,但部署序列必跑 `./migrate.sh`(且禁 clone 仓库) | **采纳(改文案)**:资产清单改为四件(compose/Caddyfile/migrate.sh/.env),传输步骤带上部署资产,两文档同步 |
| 5 | P2 | registry 部署路径:迁移在 api 启动前跑,镜像尚未 pull,`docker image inspect` 直接 die | **采纳(改文案)**:die 提示与文档补「registry 流程先 `docker pull`」;不加自动 pull 逻辑(网络动作不该藏在迁移脚本里) |
| 6 | P2 | `source .env` 把 dotenv 当 shell 执行:`$`/命令替换会被展开,与 compose 语义不一致 | **采纳(改判断)**:改为 `env_get` 只提取 `IMAGE_TAG`/`IMAGE_REGISTRY` 两键(脚本不需要 `POSTGRES_PASSWORD`,psql 走容器内 socket);注入用例实测不执行 |
| 7 | P2 | 未知参数(如 `--stats` 打错)静默落入写模式执行生产迁移 | **采纳(改判断)**:参数白名单 case,未知/多余参数一律 die;实测拒绝 |
| 8 | P2 | `${IMAGE_TAG:?}` 只挡空值,`latest` 能通过 | **采纳(改判断)**:migrate.sh(部署必经步骤)内加 SHA 格式硬校验(7–40 位十六进制);不新增独立 preflight 机制。`latest` 实测被拒 |

整改验证:`bash -n` ✅;migrate.sh 六条失败路径行为测试全过(未知参数/多余参数/无 .env/latest/命令注入不执行/引号值解析);dev.ps1 BOM 完好且带参实跑 ✅;`docker compose config -q` ✅;`dev.ps1 check` ✅、`dev.ps1 test` 16/16 ✅。

### 复审(缺陷门禁)

**复审第 1 轮**(2026-08-31,整改 commit `1047b70` 后,`/codex:review` 前台):**上一轮 4 P1 + 4 P2 全部未再出现,阻塞级 findings 清零**;新报 3 条 P2,全部采纳(仍为最小改动):

| # | 级别 | finding | 处理 |
|---|---|---|---|
| 1 | P2 | migrate.sh 并发执行竞态:两个执行者可同读旧版本、重复应用迁移(DML 类会重复/损坏数据) | **采纳(改判断)**:事务内加 `pg_advisory_xact_lock` 串行化 + 锁下版本复核(不符即 RAISE 中止);循环内 `current` 随应用推进。在真实 postgres 上实测:首次应用成功,携带过期预期的第二执行者被中止且完整回滚 |
| 2 | P2 | 本机 bun 版本(1.3.14)≠ 钉版本(1.4.0),`packageManager` 只选运行时不校验版本,测试门禁可能跑在非钉版运行时上 | **采纳(改判断+改文案)**:`dev.ps1 test` 检测漂移并告警(不阻断);CLAUDE.md 钉版本表补「本机解释器也要对齐」。环境侧待办:本机 `npm i -g bun@1.4.0` |
| 3 | P2 | ROUNDS.md R9 拆解残留一处 `docker save \| ssh \| docker load` 管道写法(与本轮已修正的 P1-3 同因) | **采纳(改文案)**:改为文件流并注明原因;全仓 grep 确认无其余残留 |

**复审第 2 轮**(2026-08-31,整改 commit `6e6a450` 后):**第 1 轮 3 条 P2 全部未再出现,阻塞级持续清零**;新报 3 条 P2,全部采纳(最小改动):

| # | 级别 | finding | 处理 |
|---|---|---|---|
| 1 | P2 | 重复迁移版本号(两分支各加 002_a/002_b)第二份被「version > current」静默跳过,库永久缺一份变更 | **采纳(改判断)**:执行前按解析后的版本号做唯一性校验,重复即 die。实测拒绝 |
| 2 | P2 | 迁移文件按字典序 sort:版本宽度变化(999/1000)或未补零(2/10)会错序,导致部分迁移被静默跳过 | **采纳(改判断)**:改为解析版本号后数值排序(`sort -n`)。四组用例实测排序正确 |
| 3 | P2 | 首次部署 scp 到 `~/deploy/` 时远端目录不存在,多文件传输直接失败 | **采纳(改文案)**:首次流程补 `ssh <host> "mkdir -p ~/deploy"` |

**复审第 3 轮**(2026-08-31,整改 commit `6e90aab` + 文档 commit `cb2c523` 后):**零 findings**——审查者结论原文:「未发现明确、可操作且由本次改动引入的缺陷。配置与脚本通过了基础语法检查,部署流程、Bun 运行时、数据库迁移及容器约束之间保持一致。」

### 审查结论

**缺陷门禁 PASS,可合并 `main`。**

- 阻塞级(high / 丢数据 / 漏凭据 / 泄资源 / 逻辑错误)findings:初审后**连续三轮复审为零**;第 3 轮连低危都没有。
- 全程 14 条 findings(4 P1 + 10 P2)全部采纳整改,均为最小改动(改判断/改文案),未新增任何机制(无新队列/协议/抽象/配置面/导出面),符合「审查边界」。
- 唯一动 `docs/security.md` 的整改(P1-1 引导凭据例外)为补记所有者 2026-08-29 已裁定的部署形态,非放宽约束;R7 收敛项已记 BACKLOG,提请所有者留意。
- 环境侧遗留(不阻塞合并):本机 bun 1.3.14 待对齐 1.4.0(`npm i -g bun@1.4.0`);`dev.ps1 build` 的镜像落地与 web 构建按所有者指示顺延到首次真实部署。

**建议审查者重点看**:① `dev.ps1 build` 的 `--services` 白名单是维护热点——R4/R5/R7/R8 新增服务时漏改会静默 404;② `stop_grace_period 40s` 与 `graceful_shutdown.total 30s` 的配比在 SSE 长连接下是否够;③ compose 里 `${IMAGE_TAG:?}` 的强制是否会卡住某些正常运维路径;④ 「先迁移后起服务」的顺序在文档/compose/脚本三处是否已完全一致。

> ④ 原为「node 表述边界」问题(builder 阶段仍装 node/npm 与『任何镜像里不得有 node』冲突)。**所有者 2026-08-29 收口时已确认并统一改为「Node 已从生产 runtime 与最终运行镜像中移除;构建阶段与依赖解析仍用 Node/npm」**,该条已闭环,不必再审。

## 失败处理

同一验收项针对性整改后连续 2 次验证仍不过 → 写 `rounds/round-bun/BLOCKED.md`,停下呼人。禁止放宽验收标准自我通过。

**本轮触发过一次「停下呼人」并已收口**:验收项之外发现自托管镜像不执行数据库迁移(见「踩坑」第 4 条),该问题指向部署方案设计而非缺陷,按 CLAUDE.md「审查边界」未在本轮自行发明机制,而是列出三个候选交所有者裁定。**所有者 2026-08-29 裁定采用方案一**(部署脚本用 psql 施加镜像内 SQL),已实现为 `deploy/migrate.sh` 并实测通过。

## 本轮实测

环境:130 服务器(Arch Linux)· encore v1.57.13 · bun 1.4.0(`1.4.0+34cbb9a40`)· node v26.5.1(仅作对照)· pi 0.84.3 · Next 15.5.24 · vitest 4.1.11 · 2026-08-29

### 门禁结果

1–13 全部通过。要点:

- **实验位可从 `encore.app` 生效**,不需要 `ENCORE_EXPERIMENT` 环境变量;app 进程实证为 `/…/bun/bin/bun run …/main.mjs`。
- **34/34 订阅、0 错误**;纯对话场景实际触发 **16 种**事件,与 R1 在 Windows/Node 上记录的 16 种**逐一对应、顺序一致**。四模式计数 19/6/7/2 = 34,与 R1 一致。
- **SSE ×2 均逐事件到达(开发形态 `encore run`)**:对话流跨 4.3s 逐 delta;轨迹流先回放 74 条缓冲(seq 0–73)再 live tail,第二轮对话事件实时到达。经 Next dev proxy 同样不缓冲(每秒 6 / 42 / 21 行)。
  > ⚠️ 这组结果**不能读作「生产镜像的 SSE 已验证」**。生产镜像里当前没有任何 SSE 端点(spike 被 `--services` 排除,正式端点在 R3/R4),该项顺延。
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

**这些数字支持什么、不支持什么(刻意保持中性):**

- ✅ 支持:**在当前 Linux + 当前代码 + 当前 pi 版本下,bun 的基础 RSS 更低**(基座低约 65MB / 29%)。`deploy/docker-compose.yml` 的 `mem_limit: 1g` 据此设为初始上限(替换原先的 2g)。
- ❌ **不支持**写成「bun 的内存表现全面优于 node」。同一组数据里 **10 轮 churn 残留 bun(1.75MB)反而高于 node(0.38MB)**;两者都无单调增长、量级也都在噪声范围,不构成泄漏证据,但足以说明现阶段不该做单向结论。
- ❌ **不支持**用空闲会话增量(0.04MB)推真实活跃会话容量。空闲会话不持有上下文、消息历史、在途 provider 响应与流式写缓冲。
- ❌ **不支持**「1g 已证明够用」。1g 是基于基座 + 事件缓冲结构性上限 + 主机总预算选出的**初始上限**,`S_active_p95` 仍是空值。
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

4. **自托管镜像不执行数据库迁移 —— 已裁定并落地。** Encore 运行时里**没有迁移逻辑**(runtimes 全树无相关代码;`encore db` 也没有 `migrate` 子命令);迁移是本机 CLI(`encore run`/`check` 日志里的 "Running database migrations")或 Encore Cloud 控制面施加的。镜像里虽打包了 `agent/migrations/001_init.up.sql`,但容器启动不会应用。空库直起的表现极具迷惑性:
   ```
   /health          → 200        ← 健康检查全绿、容器 healthy
   /agent/sessions  → 500        relation "sessions" does not exist
   ```
   **所有者 2026-08-29 裁定:方案一(部署脚本用 psql 施加镜像内 SQL)**,实现为 `deploy/migrate.sh`。选它的理由是 SQL 直接取自正在部署的那个镜像,不存在「镜像 A 版、SQL B 版」的漂移,且服务器上不需要多维护一个镜像。

   关键设计与实测(见下「migrate.sh 验证」):版本记录沿用 Encore/golang-migrate 的 `schema_migrations(version, dirty)` 单行语义,与 `encore run` 本地库同构(实测两边都是 `1|f`),将来 encore CLI 连这个库读到的版本是对的;单事务应用,失败整体回滚;幂等;含 `CONCURRENTLY` 的迁移主动拒绝而非绕过事务保护。

5. **`hosted_services` 不能用来裁剪端点。** infra-config 里去掉 `spike` 后 `/spike/mem` 仍 200;schema 也写明该字段 *"should not be set by the user, computed during build"*。真正生效的是构建期 `--services agent,system`,实测让 `/spike/*` 全部 404 而 `/health` 正常——评审的 P1-6 由此从「计划保证」变成构建期硬门禁。

6. **`PORT` 环境变量有效**,镜像默认 8080 可改 4000,与 Caddyfile 的 `api:4000` 对齐(二选一已写死在 compose + Caddyfile 注释)。

7. **infra-config 的 `databases` key 就是物理库名**,故 compose 的 `POSTGRES_DB` 从 `xray` 改为 `agent`。

8. **`encore build docker` 不消费 `DATABASE_URL` 等普通环境变量**,不给 `--config` 直接硬失败(`Your infra configuration is incomplete: Secrets DeepSeekApiKey / Databases agent`)——评审 P1-1 属实,且是硬失败不是软警告。

9. **Next standalone 可跑在 bun 上**:`bun --bun server.js` Ready 89ms、首页 200。但仅验证了 standalone **运行**;`next build` 本身仍以 node 执行(Dockerfile builder 阶段装了 node/npm),未验证用 bun 执行 Next 构建器。

### 完整 compose 部署实测(130,提前跑通了 R9 的大部分链路)

按真实部署形态在 130 上跑了完整四容器(含 caddy 占 80/443)。**收口时按「先迁移、后起服务」的最终顺序重跑了一遍**:

| 步骤 | 命令 | 实测 |
|---|---|---|
| 1 | `docker compose up -d --wait postgres` | 只起 postgres,`--wait` 阻塞到 healthy(5.97s);**此刻 80 端口无人监听**(curl → 000),对外零暴露 |
| 2 | `./migrate.sh` | api 尚未启动即完成迁移 v1(脚本只依赖 postgres) |
| 3 | `docker compose up -d` | api/web/caddy 拉起;**服务一上线业务接口就是 200,不存在 500 窗口** |

上线后端点:`/api/health` 200 · `/api/agent/sessions` 200(GET/POST 均可) · 前端 `/` 200 · `/api/spike/mem` 404。

初次探索时用的是「一把 `up -d` 起全部再迁移」的顺序,结果如下(正是这个中间状态促成了顺序调整):

| 检查 | 结果 |
|---|---|
| 四容器启动 | api / caddy / web 全 Up;postgres **healthy**,`depends_on: service_healthy` 生效(api 确实等到 postgres healthy 才启动) |
| 前端经 Caddy | `http://127.0.0.1/` → 200,22757 字节 |
| API 经 Caddy | `/api/health` → 200 |
| spike 隔离 | `/api/spike/mem` → **404**(`--services` 构建期白名单生效) |
| **迁移前故障形态复现** | `/api/health` 200 + 前端 200 + `/api/agent/sessions` **500** —— 与文档描述完全一致 |
| 迁移后 | `/api/agent/sessions` GET 200、POST 建会话 200,数据落库 |

**migrate.sh 验证**:

| # | 场景 | 结果 |
|---|---|---|
| 1 | `--status` 在空库上(表都不存在) | 正确报告 `当前版本: 0` + 1 个待执行;**执行前后库中表数均为 0**(真只读,不建跟踪表) |
| 2 | 首次执行 | 应用 v1,`/api/agent/sessions` 从 500 变 200 |
| 3 | 幂等复跑 | `无待执行迁移(已是最新)`,空操作 |
| 4 | `schema_migrations` 内容 | `1|f` —— 与 `encore run` 本地库**逐字段同构** |
| 5 | **事务回滚**(故意在迁移中途 `SELECT 1/0`) | 版本停在原值不动;半途 `CREATE TABLE` 的表**不残留**(`to_regclass` 为 f) |

> 首版脚本有两处瑕疵已修:`--status` 会建出跟踪表(与「未改库」的声明矛盾)、`CREATE TABLE IF NOT EXISTS` 的 NOTICE 噪音。修后从干净库重跑,上表 1–5 全部通过。

### 与计划的偏离

- 原评审建议 R-BUN 作为「不阻塞 R9–R11 的实验轨」;所有者裁定改为直接统一切换(理由见「目标」段)。
- 原评审建议 `encore.app` 写 `base_image` + `bundle_source: true`;实测两条都不成立,改为 `--base` 固化进 `dev.ps1 build`、不开 `bundle_source`。
- 原评审建议 R-BUN 包含「package manager migration」;实测评估后**明确不切**,理由见「包管理器为何不切」。

### 目前证据不足(不要外推)

- **活跃会话真实内存增量**:只测了空闲会话。长上下文、大量 Tool Output、高频事件队列的增量未知,`S_active_p95` / `S_stream_p95` 仍是空值,须等 R3/R4 后用真实使用数据采。
- **长时间运行**:最长连续运行约 20 分钟,长期泄漏口径未验。
- **`next build` 在 bun 下执行**:未验证(当前构建期仍用 node)。
- **生产镜像的 SSE 冒烟**:**当前无法演练**。两条 SSE 只存在于 spike 里,而 spike 已被 `--services` 排除出镜像;正式的 `/agent/ask`、`/trace/stream` 分别在 R3、R4 落地。本轮的 SSE 门禁是在 `encore run`(开发形态)下验的,**生产镜像形态下的 SSE 行为要等 R3/R4 才能验**。
- **含 `CONCURRENTLY` 的迁移**:`migrate.sh` 会主动拒绝,但该路径未实测(当前只有一个迁移文件,不含该语句)。
- **多数据库**:`migrate.sh` 目前硬编码只认 `agent` 库,遇到别的库名会报错停下而不是猜。R5 建 notes 表若沿用同一个库则无影响;若新增数据库需要扩这个脚本。
- **bun `smol` 模式**:未测。Encore 曾在 bun 实验发布说明里提示 bun 内存占用偏高并建议 `smol`,但本轮实测 bun 反而比 node 低 29%,该建议是否仍适用未知。
