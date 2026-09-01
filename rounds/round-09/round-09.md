# Round 09 — 容器化与 130 预发部署(docker compose 全链路)

> 状态:已完成(18 项验收全过;所有者裁定本轮不走 codex 审查,理由见「代码审查」段)

## 目标

在 130 上从**干净环境**按 `docs/deploy-environments.md` 一次部署成功,并把此前只在
`encore run` 形态下验过的能力(SSE ×2、配额、沙箱、MCP 管理面、配图路由)在
**真实容器 + Caddy 拓扑**下逐项验一遍;回滚演练真跑一次。
可证伪判据:冒烟清单逐项留证,`IMAGE_TAG` 换回上一 SHA 后站点回到上一版形态。

## 前置

- R-BUN 已完成:镜像构建(bun 基座)、compose 定稿、安全参数、`deploy/migrate.sh`、四件部署资产。
- R3/R4 已完成:正式 `/agent/ask`、`/trace/stream` 两条 SSE 已进 `--services` 白名单(R-BUN 时无法演练的那项现在可以做)。
- R6/R7/R8 已完成:MCP 管理面、`agent_ro` 与配额、metrics/about 服务。
- 环境:130 = `192.168.100.130`(ssh 别名 `130`,Arch Linux,Docker 29.7.1 / Compose 5.4.0);实测 80/443 空闲。
- 凭据:LLM provider 由所有者裁定取本机 pi 的 `cliproxy-dmit` 网关(见下「所有者裁定」)。

## 所有者裁定(2026-09-01,开工前)

| # | 问题 | 裁定 |
|---|---|---|
| 1 | 预发要跑 `/agent/ask` 的 SSE 冒烟,但 R6 之后运行期 LLM 凭据只能经 MCP 写入,key 从哪来 | **取本机 `~/.pi/agent/models.json` 里 `cliproxy-dmit` 网关的 key**,经 MCP `llm_provider_upsert` 写进 130;模型取该网关的 GPT-5.6 Terra(`gpt-5.6-terra`)。key 只在传输与写入路径上出现,不入库明文、不进任务卡 | ✅ `local/xray-api` / `local/xray-web` 两版都出:`c6231b4`(v1)与 `dbf61ce`(v2) |
| 2 | BACKLOG 那条「上线前必做(架构评审 P1-4):Google Fonts 渲染阻塞」标的是「R9 或 R10」 | **R9 做**。顺带解决回滚演练缺真实代码差异的问题:v1 = 改字体前的镜像、v2 = 改后的,升级与回滚都有肉眼可验的差别,而不是两个内容相同只差 tag 的镜像 | ✅ 线上零外部请求,woff2 由本站供(40404B,`immutable`) |
| 3 | 预发对外端口 | **80**(`SITE_ORIGIN=http://192.168.100.130`)。Caddyfile 与 compose 零改动,与生产形态最接近 | ✅ `dev.ps1 ship 130 <sha>`,tar 154.9 MB,远端 `docker load` 成功 |

## 交付物

**前端 · 字体自托管(BACKLOG R-BUN P1-4;规则 7 允许的接线性结构改动,理由见「本轮实测」)**

- `apps/web/app/fonts/JetBrainsMono-latin.woff2` —— Google Fonts v24 的**变量**子集(latin,weight 100–800)
- `apps/web/app/fonts/OFL.txt` —— JetBrains Mono 的 SIL OFL 1.1 许可原文(随字体分发的义务)
- `apps/web/app/layout.tsx` —— 删掉 `fonts.googleapis.com` 的 `preconnect` + 渲染阻塞 `<link rel=stylesheet>`,改 `next/font/local`
- `apps/web/app/globals.css` —— `--font-mono` 首位换成 next/font 注入的 CSS 变量(字面同一款字体,渲染结果不变)

**构建**

- `apps/web/Dockerfile` —— 删掉 `COPY --from=builder /app/public ./public`:R6 把 notes 配图搬进 Postgres 后
  `apps/web/public/` 整个目录已不存在,这行会让 **web 镜像构建直接失败**(R9 开工时实测)

**部署脚本与资产**

- `dev.ps1` —— 新增 `ship <host>` 子命令:`docker save -o` → `scp`(镜像 + 四件部署资产)→ `docker load -i`,
  把文档里那段容易漏步骤的手工流程固化成一条命令(ROUNDS.md R9「部署流程文档 + 脚本」)

**部署脚本(补)**

- `deploy/migrate.sh` —— advisory lock 那句从 `SELECT pg_advisory_xact_lock(...)` 改成
  `DO $lock$ … PERFORM … $lock$`:psql 会把 `SELECT` 的返回值当结果集打印,首次跑 6 个迁移时
  会打出 6 张空表格把「应用 vN」的进度行冲散。**行为不变,只去噪音**;改后在 130 上用一个
  隔离的 compose 工程从空库重跑了完整 6 个迁移验证

**文档**

- `docs/deploy-environments.md` —— 预发状态改「可用」;传输段补 `dev.ps1 ship`;
  冒烟清单换成 R9 实际执行的那份 15 条(spike 撤下、SSE ×2 补上、服务白名单逐项、
  `agent_ro` 与容器约束核验),并新增「『镜像里没有 node』怎么查才是对的」
- `CLAUDE.md` 规则 11 —— 补一条:别用 `command -v node` 验「最终镜像无 node」
- **`docs/notes-content-spec.md`(新)** —— 所有者中途给了 `D:	mpgent-xray-notes`(211 篇 md + 56 图)
  并裁定「先给一份修改要求,内容我让 AI 处理后再发」。这份文件就是那个要求:三层结构与 slug 规则、
  `series.json` manifest、正文与配图的硬约束、收录范围、逐条自检清单。**R9 不入库任何真实内容**
- `ROUNDS.md` —— 进度表 R9 收口
- `rounds/BACKLOG.md` —— 关闭 2 条(字体、服务白名单断言),回填 4 条的复测结论(3 条断连 + 1 条 XFF),新增 4 条

**轮次产出**

- `rounds/round-09/round-09.md`(本卡)
- `rounds/round-09/smoke.md` —— 130 冒烟逐项留证(11 段 + 4 条实测更正/新发现)

## 验收

| # | 检查 | 命令 / 期望 | 结果 |
|---|---|---|---|
| 1 | 两个镜像可构建 | `.\dev.ps1 build` 出 `local/xray-api:<sha>` 与 `local/xray-web:<sha>`,tag 均为 git 短 SHA | ✅ `local/xray-api` / `local/xray-web` 两版都出:`c6231b4`(v1)与 `dbf61ce`(v2) |
| 2 | 字体自托管 | 线上页面 HTML 与 CSS 中**不出现** `fonts.googleapis.com` / `fonts.gstatic.com`;woff2 由本站 `/_next/static/media/*` 供,断外网仍是 JetBrains Mono | ✅ 线上零外部请求,woff2 由本站供(40404B,`immutable`) |
| 3 | 传输走文件 | `docker save -o` → `scp` → `docker load -i`;130 上 `docker images` 见两个 tag = 同一 git SHA | ✅ `dev.ps1 ship 130 <sha>`,tar 154.9 MB,远端 `docker load` 成功 |
| 4 | 先迁移后起服务 | `up -d --wait postgres` 阶段 130 的 80 端口**无人监听**;`./migrate.sh` 后再 `up -d`,业务接口首次响应即 200(不存在 500 窗口) | ✅ 起库阶段 80 端口 `000`;起服务后**首次探测就是 200** |
| 5 | migrate.sh 幂等 | 复跑输出「无待执行迁移(已是最新)」;`schema_migrations` 与本机 `encore run` 库同构 | ✅ 复跑空操作;`schema_migrations` = `6|f` |
| 6 | 服务白名单逐项可达 | `agent/trace/notes/mcp/metrics/about/system` 七个服务各取一个**正式端点**,全部非 404 | ✅ 七个服务全部非 404;`/api/spike/*` 与 `/admin` 均 404 |
| 7 | 三 Tab | `/`(Runtime)、`/notes`、`/about` 均 200 且渲染真实数据(非 demo) | ✅ 三 Tab 200,内容来自库(经 MCP 发布的样本) |
| 8 | MCP 管理端点 | 无 token → 401 且有审计记录;带 token → `server/discover` 返回工具清单;一次写操作在审计表可见 | ✅ 无/错 token 与 GET 全 401 且有 `denied` 审计;`server/discover` 出 24 工具 |
| 9 | notes 配图路由 | `/notes/<系列>/<哈希>.webp` → 200 + `ETag`;带 `If-None-Match` 复请求 → 304(Caddy 扩展名分流生效) | ✅ 200 + `ETag` + `max-age=86400`;`If-None-Match` → 304;文章页未被劫走 |
| 10 | SSE ×2 冒烟 | `/agent/ask` 经 Caddy 流式出字;`/trace/stream` 有 15s 心跳、`afterSeq` 断线重连能回放;`docker compose stop api` 时客户端**明确断流**而非静默挂起 | ✅ 出字正常;15s 心跳;`afterSeq=20` 精确回放 21–39;`stop api` 时 curl 退出码 18(明确断流) |
| 11 | SSE 脱敏抽查 | 两条流的原始字节里搜不到 `Authorization` / `api-key` / `apiKey` / 明文 key 片段 | ✅ 明文 key / key 后 8 位 / 五种凭据头名 全部 0 命中 |
| 12 | 配额 | 经 MCP 把 `dailyTokenLimit` 调到极小 → 新会话被明确拒绝(非 500);恢复配置后可用 | ✅ `daily_tokens` 与 `turn_limit` 各回 429 + code;恢复后当轮生效 |
| 13 | `agent_ro` 写库失败 | 容器内 psql:`SET ROLE agent_ro; INSERT INTO notes_series …` → 权限错误(R7 落地补记 1 要求 R9 顺带核一句) | ✅ 写 notes 三表全 `permission denied`;读三表成功;其余十张表读也被拒 |
| 14 | 容器安全约束 | `docker inspect` 逐项为真:api/web 非 root(10001)、`ReadonlyRootfs`、`CapDrop ALL`、`PidsLimit`、`Memory`、`no-new-privileges`、tmpfs `noexec` | ✅ 逐项为真(明细见 smoke.md §7) |
| 15 | 最终运行镜像无 node | `docker run --rm --entrypoint sh local/xray-api:<sha> -c 'command -v node || echo NONE'` → `NONE`(web 同) |
| 16 | 网络分段 | 从 `caddy` / `web` 容器连 `postgres:5432` **不通**;从 `api` 容器通 | ✅ web/caddy 连 `postgres` 解析都不通(NXDOMAIN);api 通 |
| 17 | 断连信号复测 | 真实拓扑(Caddy + 自托管镜像)下切断 SSE 客户端,服务端能否观测到 close —— 结论回填 BACKLOG 那三条(R3 一条 / R4 两条) | ✅ 已复测 —— **仍拿不到断开信号**,三条 BACKLOG 均保持,让位机制不退役 |
| 18 | 回滚演练 | `.env` 的 `IMAGE_TAG` 换回上一 SHA + `up -d` 真跑;页面回到上一版形态(Google Fonts),再换回新 SHA 恢复 | ✅ v2→v1 用时 3s,页面回到 Google Fonts 形态且数据零丢失;再回 v2 恢复 |

## 禁止

- 不改前端页面样式(CLAUDE.md 规则 7)。**唯一例外**是字体自托管的接线改动(所有者裁定 2,已在「交付物」写明理由与影响范围);渲染出的字体、字重、字号、布局一律不变。
- 不加设计稿没有的功能(规则 8)。
- 不碰生产服务器(`106.54.238.52` 属 R11);不在 130 上构建镜像、不在 130 上留仓库或工具链(规则 10)。
- 不为了让冒烟好过而放宽 compose 的安全参数(`docs/security.md` §1 第 3 层)。

## 代码审查

- 审查方式:**未做**。已按 CLAUDE.md 流程发起 `/codex:review --background`(全量 branch diff,
  前两轮的固定范围),**所有者在运行中裁定停掉并直接合并**(2026-09-01)。
- 裁定过程:所有者提出「没改代码为什么要审查」;我给出分支 diff 实况反驳 ——
  914 行新增里约 620 行是文档/任务卡,**代码与脚本约 90 行**,分布在四处:
  `dev.ps1` 的 `ship` 子命令(+56 行,拼 ssh/scp、远端 `docker load && rm`、失败分支)、
  `apps/web/app/layout.tsx`(改 `next/font/local`)、`apps/web/Dockerfile`(删失效 COPY)、
  `deploy/migrate.sh`(advisory lock 一句),并指出 `dev.ps1 ship` 与 `migrate.sh`
  是最值得被人看一眼的两处(前者拼命令行且要处理含中文的路径,后者在部署必经路径上)。
  所有者据此仍裁定跳过。
- findings 处理:无 findings(未产生)。
- 结论:**本轮无审查记录**。这是与 CLAUDE.md「codex 独立审查 → 缺陷门禁」流程的一次
  显式偏离,记在此处以免将来被误读成「审查通过」。**残留风险**:
  `dev.ps1 ship` 与 `migrate.sh` 的改动只经过本轮实跑验证(ship 成功传了两版镜像;
  migrate.sh 在隔离 compose 工程里从空库重跑了完整 6 个迁移),没有第二双眼睛看过
  错误分支与边界情况。

## 失败处理

同一验收项针对性整改后连续 2 次验证仍不过 → 写 `rounds/round-09/BLOCKED.md`,停下呼人。禁止放宽验收标准自我通过。

## 本轮实测

完整留证在 [`smoke.md`](smoke.md)(11 段 + 4 条更正)。这里只记「与计划不同」和「值得记住」的部分。

### 开工第一个卡点:web 镜像根本构建不出来

`apps/web/Dockerfile` 有一行 `COPY --from=builder /app/public ./public`。R5 时 public/ 装着
notes 配图,R6 按所有者裁定把图片搬进 Postgres 并**删掉了整个目录** —— 那行从此指向一个不存在的
路径,`docker build` 直接失败。R6 之后没有人再构建过 web 镜像,所以这个洞一直没被发现,
正好由「R9 才第一次真构建」暴露出来。修法是删掉那行(自托管字体走 `.next/static/media`,不经 public/)。

**这条的普遍教训**:`--services` 白名单那种「漏改就静默 404」的维护热点已经进冒烟清单了,
但 Dockerfile 里的 COPY 是另一类 —— 它不静默,只是**没人跑就发现不了**。目前没有 CI
(BACKLOG R0 那条),构建是靠轮次里手动触发的。

### 回滚演练需要两个内容不同的镜像,于是把提交拆成两个

回滚演练如果两版镜像内容相同、只差 tag,验的只是 compose 的机制,验不了「回滚真的回到了上一版」。
所以本轮的提交刻意拆成 v1(构建修复 + ship)与 v2(字体自托管):v1 页面仍走 Google Fonts、
v2 是自托管,升级与回滚都有肉眼可验的差别。实测 v2→v1 用时 3s、页面确实回到 Google Fonts 形态、
库里的文章与配图零丢失。

### 断连信号:R9 的复测任务给出了否定结论

BACKLOG 里有三条(R3 一条 / R4 两条)都挂着「等 R9 在真实拓扑下复测,若能拿到断开信号就放宽」。
**结论是拿不到**:开满 8 条 `trace/stream` 后 `kill -9` 掉全部客户端,等 6s,第 9 条仍然 429,
api 日志没有任何释放迹象。加一层 Caddy 不改变 Encore 网关不传导断开的事实。
所以「同 clientId 让位」机制与 `MAX_STREAM_MS` 上界都要留着,三条 BACKLOG 全部保持打开。

顺带的正面结论:`docker compose stop api` 时客户端是**明确断流**(curl 退出码 18)而不是静默挂起,
优雅停机耗时 31s 与 `stop_grace_period 40s` 的配置吻合。

### 「最终运行镜像里不含 node」这句话需要限定

`command -v node` 在两个镜像里都命中 `/usr/local/bun-node-fallback-bin/node` —— 那是 `oven/bun`
基座自带的、**指向 bun 的软链**。结论本身没错(`node -p "process.versions.bun"` 回 `1.4.0`、
真实的 `/usr/bin/node` 不存在、`nodejs` 包未安装),但判据必须换。已回写 CLAUDE.md 规则 11
与冒烟清单第 12 条。

### BACKLOG 那条 XFF 伪造,在当前拓扑下打不进来

`mcp/audit.ts` 取 XFF 首段确实可被伪造(从 caddy 容器绕过反代直连 `api:4000` 时,
`203.0.113.77` 原样进了审计表),但**经 Caddy 2.11.4 时伪造被挡住** —— 未配 `trusted_proxies`
的 Caddy 用真实对端 IP **覆盖**不可信的 XFF。所以这条不紧急,但前提写进了 BACKLOG:
一旦前面再加一层代理或配了 `trusted_proxies`,保护就没了。

### 与计划的偏离

| # | 计划 | 实际 |
|---|---|---|
| 1 | 交付物里没有 `deploy/migrate.sh` | 加了一处**去噪**改动(advisory lock 从 `SELECT` 改 `DO/PERFORM`),行为不变;在隔离 compose 工程里从空库重跑 6 个迁移验证过 |
| 2 | 交付物里没有 `docs/notes-content-spec.md` | 所有者中途给了 `D:	mpgent-xray-notes` 并裁定「先给修改要求」,于是产出这份内容标准化契约。**R9 仍不入库任何真实内容** |
| 3 | 计划只说「样本内容」 | 实际发布了四个分类 + 系列 `r9-smoke` + 2 篇文章 + 1 张配图 + 一份 About 内容 —— 因为验收 #7「三 Tab 渲染真实数据」在空库下验不了 About。这批样本要在真实内容到位时清掉(已记 BACKLOG) |
| 4 | 计划里 MCP 冒烟只写「带 token 实连」 | 实际踩到 2026-07-28 的 per-request envelope 键必须**带 `io.modelcontextprotocol/` 命名空间**,少了直接 `-32602`。写进了 smoke.md,免得下次重踩 |

### 目前证据不足(不要外推)

- **长时间运行**:130 上连续运行约 1 小时,长期内存/句柄泄漏口径未验(与 R-BUN 同一处空白)。
- **并发**:全部冒烟都是单人串行,没有做并发访客或多路 SSE 的压力测试。
- **HTTPS / 域名**:预发只跑明文 80,Caddy 的自动 TLS 路径要等 R11 备案后才验得到。
- **含 `CONCURRENTLY` 的迁移**:`migrate.sh` 会主动拒绝,该路径仍未实测(六个迁移都不含该语句)。
- **真实内容量级**:样本只有 2 篇文章 + 1 张图。211 篇 + 56 图入库后的 RSS 体积、Notes 首页渲染、
  `notes_assets` 的库体积都没有数据。
