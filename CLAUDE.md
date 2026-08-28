# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

> **本文只留五块**:项目定位、仓库结构、开发模式与轮次流程、硬性规则、本地开发与部署。
> 架构/安全/部署细节都在 `docs/`,轮次拆解在仓库根 [`ROUNDS.md`](ROUNDS.md),按需读。
> **书写约定:硬性规则编号只增不改、不重排**(代码注释会引用「CLAUDE.md 规则 N」);删掉的规则留「已废弃」占位。
> `AGENTS.md` 是给 codex 审查者的指针文件,指向本文,无需双份维护。

## 项目定位

**Agent X-Ray**:「Agent 运行时」网站——访客与 AI agent 对话的同时,右侧面板像 DevTools 一样实时展示 agent loop 内核轨迹(34 种扩展事件)。三个 Tab:Runtime 工作台 / Notes 研习库 / About;另有单管理员后台 `/admin`。

- **功能范围的唯一边界是设计稿**:[`design/`](design/README.md) 15 块画板 + 可交互原型(规则 8)。
- 架构与既定决策:[`docs/architecture.md`](docs/architecture.md)(pi SDK in-process、Encore 类型化 RPC、SSE ×2、Postgres、单机 compose)。
- 安全强约束:[`docs/security.md`](docs/security.md)——威胁模型、四层沙箱、脱敏、凭据管理;**是约束不是建议**(规则 9)。

**用户回复默认中文**;代码、命令、路径、技术术语保持英文。

## 仓库结构

```
apps/web      Next.js 15 前端(App Router)。三 Tab + /admin 已按 15 块画板全部实现,
              当前跑在 lib/demo-data.ts 演示数据上;轮次实现 = 逐块换成真实 API(样式零改动,规则 7)
apps/api      Encore.ts 后端 **app root 在这里,不是仓库根**。当前仅 system/health.ts 实端点;
              agent/ trace/ notes/ admin/ metrics/ 五个服务只有 README(职责与安全约束已写明,实现按 ROUNDS.md)
design/       设计稿终稿存档(.dc.html 画板 + 可交互原型 + token 速查)——实现时逐画板对照
deploy/       docker compose + Caddyfile(预发/生产共用;框架版,R9 定稿)
docs/         架构 / 安全 / 部署环境矩阵 / 境内轻量服务器部署
rounds/       轮次任务卡与管理产出(约定见 rounds/README.md);roadmap 在根 ROUNDS.md
.claude/      encore 官方 skills(skills-lock.json 锁版本,升级 `npx -y skills update`)+ MCP 启动脚本
dev.ps1       Windows 本地 encore 唯一入口(规则 1)
```

## 开发模式与轮次流程

**Claude Code solo 开发,codex 独立审查**;不做视觉 review(规则 7 管住样式即可)。

```
开工:cp rounds/TEMPLATE.md rounds/round-NN/round-NN.md,按 ROUNDS.md 该轮拆解填任务卡
  → 实现(遵守规则 7/8/9)
  → 验证:dev.ps1 test / check + 任务卡验收项全过
  → codex 独立审查:默认 /codex:review;质疑设计取舍用 /codex:adversarial-review;
     改动超过 1–2 个文件带 --background,用 /codex:status、/codex:result 跟进
  → findings 逐条处理(采纳整改 / 不采纳写明理由),回填任务卡「代码审查」段
  → 只要有采纳整改的 findings → 对整改本身再发一轮 /codex:adversarial-review 复审
  → commit + 更新 ROUNDS.md 进度表
```

- **复审收口标准(所有者裁定 2026-08-28)**:审查/复审循环不得带**阻塞性问题或明显 bug/漏洞类 findings**(high 级,或任何会丢数据、漏凭据、泄资源、逻辑错误的问题)收口——继续「整改 → 复审」直到此类 findings 清零才允许合并 `main`;低危改进项可写明理由记 `rounds/BACKLOG.md` 后放行。禁止以「spike 会被替换」「概率低」为由跳过整改(可作为**方案取舍**的理由写进任务卡,但对应风险必须有显式兜底)。
- 降级到 Claude Code 自带 `/code-review` 只认硬失败(codex CLI 未安装/未登录/启动失败),降级原因写进任务卡;「等得久」「改动小」不是理由。
- 同一验收项针对性整改后连续 2 次仍不过 → 写 `rounds/round-NN/BLOCKED.md` 停下呼人,禁止放宽验收(rounds/README.md)。
- 分支:每轮在 `round-NN` 分支开发,审查通过后合并 `main`;纯文档与微修可直接 `main`。
- 跨轮次发现的问题写 `rounds/BACKLOG.md`,不当场顺手改。

## 硬性规则

**编号只增不改**。1–4 继承自 ticketBookingB2B 项目同机踩过的坑,原样适用。

1. **Windows 上所有 encore 命令必须走 `dev.ps1`**(或手动 `$env:LOCALAPPDATA="D:\encore-data"; $env:APPDATA="D:\encore-data\roaming"; $env:Path += ";$HOME\.encore\bin"`)。原因:encore daemon 的 unix socket 无法绑定在含中文字符的用户名路径(`bind: An invalid argument was supplied`),且 daemon 继承启动进程的 PATH。daemon 常驻且同机与 ticketBookingB2B 共用——用错误 env 启动过后要以正确 env 重跑 `encore daemon` 重启。
2. **测试只能 `encore test`**(`dev.ps1 test`),禁止裸跑 `vitest`(缺 `ENCORE_RUNTIME_LIB` 会炸)。引入 vitest 时 `apps/api/package.json` 的 test 脚本必须是 `vitest run --passWithNoTests`(不带 `run` 会进 watch 卡死)。
3. **含中文的 `.ps1` 必须存成 UTF-8 with BOM**。PowerShell 5.1 对无 BOM 的 UTF-8 按 ANSI(936) 解码,中文注释会吞掉行尾换行、把下一行并进注释——`param` 行曾因此被整行注释掉导致参数静默失效。`param` 放首行 + BOM 双保险;改完跑一次带参数命令确认行为正确。
4. **写 JSONB 一律 `${JSON.stringify(x)}::text::jsonb`,绝不写裸 `::jsonb`,也别改成直接传 JS 值**。`::jsonb` 会让驱动把 JS 字符串再编码一次,库里存成 JSON 字符串标量(`jsonb_typeof` 回 `string`),SQL 侧 `->`/`@>`/GIN 全部失效而 JS 侧读回来看似正常;直接传值则 `COALESCE(${null}, col)` 的裸 null 会被写成 `jsonb 'null'` 而非 SQL NULL。`::text::jsonb` 对 null 与非 null 是同一套语义。R2 建轨迹/消息表起就适用。
5. **`secret()` 只能在 service 目录内声明**(Encore 限制);共享库里不出现 `secret()`,需要密钥的共享代码收「已取好的值」作参数。
6. **`apps/api` 是 Encore app root,不做 npm workspaces 提升**(规避 encore#1723:app root 下无关 node_modules/.ts 干扰 parser)。web 与 api 不手工共享源码文件;类型经 `encore gen client` 产物(`apps/web/lib/api-client.ts`)流向前端,该文件是生成物,不许手改。
7. **非必要不得修改前端页面样式,不做视觉 review**。15 块画板已是终稿且前端已实现:接后端只许换数据源(demo-data → API/SSE),不许动样式、布局、className、design token、动画参数。确因接线需要改结构时,任务卡写明理由与影响范围,且不得偏离 `design/` 对应画板。
8. **严禁实现设计稿没有的功能**(所有者裁定 2026-08-28)。功能范围 = `design/` 15 画板 + 可交互原型;`docs/` 的安全与部署要求是约束不是功能。新功能想法进 `rounds/BACKLOG.md` 等所有者裁定,不进任何轮次任务卡。
9. **`docs/security.md` 是强约束**,改动先改文档并说明理由。红线速记:`noTools:'all'` 起步、业务工具必须纯函数、**bash/write/任意代码执行类工具永久禁止进 in-process 进程**;SSE 推送前白名单 sanitize,provider 凭据字段永不出服务端;LLM key 加密入库只回掩码;`.env`/密钥不入 Git、明文凭据不进日志。
10. **部署方式不混用**:本机开发 = `dev.ps1`(encore run);130 预发与生产 = docker compose(`deploy/`),镜像用 `encore build docker` + Next standalone。禁止在服务器上跑 encore run 当部署、也禁止本机用 compose 起开发环境。矩阵与流程见 [`docs/deploy-environments.md`](docs/deploy-environments.md)。

## 钉版本

| 依赖 | 版本 | 说明 |
|---|---|---|
| `@earendil-works/pi-coding-agent` | **0.84.3**(exact,lockfile 固定) | pi SDK 本体(`createAgentSession`/`defineTool`/扩展系统都在这个包);R1 实测通过。升级前先在本地过一遍 34 事件兼容性(`docs/security.md` §7) |

## 本地开发

```powershell
.\dev.ps1            # 后端 encore run :4000(需 Docker Desktop 已启动,本地 Postgres 走容器)
.\dev.ps1 test       # encore test
.\dev.ps1 check      # encore check(编译校验)
.\dev.ps1 gen        # encore gen client → apps/web/lib/api-client.ts
.\dev.ps1 db <名>    # encore db shell <数据库名>
cd apps\web; npm run dev   # 前端 next dev :3000
```

- Encore 本地控制台 http://localhost:9400(看 trace)。
- Encore MCP 已在 `.mcp.json` 注册(stdio,经 `.claude/mcp-encore.ps1` 带正确 env 启动),新会话生效。
- `.claude/skills/` 有 8 个 encore 官方 skills(api/auth/code-review/database/frontend/secret/service/testing),写对应领域代码时按需触发,框架细节以 skills 为准。

## 部署环境矩阵

| 环境 | 位置 | 方式 | 状态 |
|---|---|---|---|
| 开发 | 本机 Windows | `dev.ps1` → encore run | 可用 |
| 预发 | 130 服务器 | docker compose(镜像本机构建后传输) | R9 落地 |
| 生产 | 境内轻量服务器(待采购) | docker compose,同预发 | R11;所有者提供 SSH 后开工 |

细节:[`docs/deploy-environments.md`](docs/deploy-environments.md);生产服务器初始化与 ICP 备案:[`docs/deploy-cn-lightweight.md`](docs/deploy-cn-lightweight.md)。
