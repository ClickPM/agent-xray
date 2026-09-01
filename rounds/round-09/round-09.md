# Round 09 — 容器化与 130 预发部署(docker compose 全链路)

> 状态:进行中

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
| 1 | 预发要跑 `/agent/ask` 的 SSE 冒烟,但 R6 之后运行期 LLM 凭据只能经 MCP 写入,key 从哪来 | **取本机 `~/.pi/agent/models.json` 里 `cliproxy-dmit` 网关的 key**,经 MCP `llm_provider_upsert` 写进 130;模型取该网关的 GPT-5.6 Terra(`gpt-5.6-terra`)。key 只在传输与写入路径上出现,不入库明文、不进任务卡 |
| 2 | BACKLOG 那条「上线前必做(架构评审 P1-4):Google Fonts 渲染阻塞」标的是「R9 或 R10」 | **R9 做**。顺带解决回滚演练缺真实代码差异的问题:v1 = 改字体前的镜像、v2 = 改后的,升级与回滚都有肉眼可验的差别,而不是两个内容相同只差 tag 的镜像 |
| 3 | 预发对外端口 | **80**(`SITE_ORIGIN=http://192.168.100.130`)。Caddyfile 与 compose 零改动,与生产形态最接近 |

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

**文档**

- `docs/deploy-environments.md` —— 冒烟清单换成 R9 实际执行的那份(spike 撤下、SSE ×2 补上、服务白名单逐项、`agent_ro` 与容器约束核验)
- `ROUNDS.md` —— 进度表 R9 收口
- `rounds/BACKLOG.md` —— 关闭本轮解决的条目(字体、SSE 冒烟、服务白名单断言),回填断连信号复测结论

**轮次产出**

- `rounds/round-09/round-09.md`(本卡)
- `rounds/round-09/smoke.md` —— 130 冒烟逐项留证(命令 + 实际输出)

## 验收

| # | 检查 | 命令 / 期望 |
|---|---|---|
| 1 | 两个镜像可构建 | `.\dev.ps1 build` 出 `local/xray-api:<sha>` 与 `local/xray-web:<sha>`,tag 均为 git 短 SHA |
| 2 | 字体自托管 | 线上页面 HTML 与 CSS 中**不出现** `fonts.googleapis.com` / `fonts.gstatic.com`;woff2 由本站 `/_next/static/media/*` 供,断外网仍是 JetBrains Mono |
| 3 | 传输走文件 | `docker save -o` → `scp` → `docker load -i`;130 上 `docker images` 见两个 tag = 同一 git SHA |
| 4 | 先迁移后起服务 | `up -d --wait postgres` 阶段 130 的 80 端口**无人监听**;`./migrate.sh` 后再 `up -d`,业务接口首次响应即 200(不存在 500 窗口) |
| 5 | migrate.sh 幂等 | 复跑输出「无待执行迁移(已是最新)」;`schema_migrations` 与本机 `encore run` 库同构 |
| 6 | 服务白名单逐项可达 | `agent/trace/notes/mcp/metrics/about/system` 七个服务各取一个**正式端点**,全部非 404 |
| 7 | 三 Tab | `/`(Runtime)、`/notes`、`/about` 均 200 且渲染真实数据(非 demo) |
| 8 | MCP 管理端点 | 无 token → 401 且有审计记录;带 token → `server/discover` 返回工具清单;一次写操作在审计表可见 |
| 9 | notes 配图路由 | `/notes/<系列>/<哈希>.webp` → 200 + `ETag`;带 `If-None-Match` 复请求 → 304(Caddy 扩展名分流生效) |
| 10 | SSE ×2 冒烟 | `/agent/ask` 经 Caddy 流式出字;`/trace/stream` 有 15s 心跳、`afterSeq` 断线重连能回放;`docker compose stop api` 时客户端**明确断流**而非静默挂起 |
| 11 | SSE 脱敏抽查 | 两条流的原始字节里搜不到 `Authorization` / `api-key` / `apiKey` / 明文 key 片段 |
| 12 | 配额 | 经 MCP 把 `dailyTokenLimit` 调到极小 → 新会话被明确拒绝(非 500);恢复配置后可用 |
| 13 | `agent_ro` 写库失败 | 容器内 psql:`SET ROLE agent_ro; INSERT INTO notes_series …` → 权限错误(R7 落地补记 1 要求 R9 顺带核一句) |
| 14 | 容器安全约束 | `docker inspect` 逐项为真:api/web 非 root(10001)、`ReadonlyRootfs`、`CapDrop ALL`、`PidsLimit`、`Memory`、`no-new-privileges`、tmpfs `noexec` |
| 15 | 最终运行镜像无 node | `docker run --rm --entrypoint sh local/xray-api:<sha> -c 'command -v node || echo NONE'` → `NONE`(web 同) |
| 16 | 网络分段 | 从 `caddy` / `web` 容器连 `postgres:5432` **不通**;从 `api` 容器通 |
| 17 | 断连信号复测 | 真实拓扑(Caddy + 自托管镜像)下切断 SSE 客户端,服务端能否观测到 close —— 结论回填 BACKLOG 那三条(R3 一条 / R4 两条) |
| 18 | 回滚演练 | `.env` 的 `IMAGE_TAG` 换回上一 SHA + `up -d` 真跑;页面回到上一版形态(Google Fonts),再换回新 SHA 恢复 |

## 禁止

- 不改前端页面样式(CLAUDE.md 规则 7)。**唯一例外**是字体自托管的接线改动(所有者裁定 2,已在「交付物」写明理由与影响范围);渲染出的字体、字重、字号、布局一律不变。
- 不加设计稿没有的功能(规则 8)。
- 不碰生产服务器(`106.54.238.52` 属 R11);不在 130 上构建镜像、不在 130 上留仓库或工具链(规则 10)。
- 不为了让冒烟好过而放宽 compose 的安全参数(`docs/security.md` §1 第 3 层)。

## 代码审查

<!-- 完成后回填 -->

- 审查方式:
- findings 处理:
- 结论:

## 失败处理

同一验收项针对性整改后连续 2 次验证仍不过 → 写 `rounds/round-09/BLOCKED.md`,停下呼人。禁止放宽验收标准自我通过。

## 本轮实测

<!-- 完成后回填 -->
