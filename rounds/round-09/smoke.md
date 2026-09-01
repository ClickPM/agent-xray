# R9 · 130 预发冒烟留证(2026-09-01)

环境:130 = `192.168.100.130`(Arch Linux · Docker 29.7.1 · Compose 5.4.0)· Caddy 2.11.4 ·
Postgres 16-alpine · bun 1.4.0 · 对外 `http://192.168.100.130`(80,`SITE_ORIGIN` 同值)。
镜像:`local/xray-api` / `local/xray-web`,tag = git 短 SHA。

- **v1 = `c6231b4`**(修完构建、字体仍走 Google Fonts)—— 首次部署与回滚目标
- **v2 = `dbf61ce`**(字体自托管)—— 升级目标与本轮收口形态

## 0. 首次部署(干净环境,按 docs/deploy-environments.md 的顺序)

| 步骤 | 命令 | 实测 |
|---|---|---|
| 传输 | `.\dev.ps1 ship 130 c6231b4` | tar 154.9 MB;远端 `Loaded image: local/xray-api:c6231b4` / `…-web:c6231b4` |
| 配置 | `cp .env.example .env` + 在 **130 上**用 `openssl` 生成四个密钥 | 密钥全程未离开 130;MCP token 落 `~/deploy/.mcp-token`(0600) |
| 1 | `docker compose up -d --wait postgres` | postgres healthy **5.9s**;此刻 `curl http://127.0.0.1/` → **000(80 端口无人监听,对外零暴露)** |
| 2 | `./migrate.sh --status` | 报「当前版本: 0」+ 6 个待执行;执行前后库中表数均为 **0**(真只读) |
| 2 | `./migrate.sh` | 应用 v1–v6,**5.2s**;`schema_migrations` = `6|f`(与 `encore run` 本地库同构) |
| 2 | 复跑 `./migrate.sh` | `无待执行迁移(已是最新)`,空操作 |
| 3 | `docker compose up -d` | 四容器起;**第一次探测 `/api/agent/sessions` 就是 200 —— 不存在 500 窗口** |

建出的表(14):`about_content` `daily_quota` `llm_config` `mcp_audit` `messages` `notes_assets`
`notes_categories` `notes_chapters` `notes_series` `schema_migrations` `sessions` `tool_config`
`trace_events` `visits`。

## 1. 服务白名单逐项可达

| 服务 | 端点 | 实测 |
|---|---|---|
| system | `GET /api/health` | 200 |
| agent | `GET /api/agent/sessions` | 200 |
| trace | `GET /api/trace/stream`(无参) | **400**(非 404 = 服务在) |
| notes | `GET /api/notes/series` | 200 |
| notes | `GET /rss.xml`(站根路由) | 200 |
| about | `GET /api/about` | 200 |
| metrics | `POST /api/t` | 204 |
| mcp | `POST /api/mcp`(无 token) | 401 |
| ~~spike~~ | `GET /api/spike/mem` | **404** |
| ~~admin~~ | `GET /admin` | **404** |

三 Tab:`/` 200 · `/notes` 200 · `/about` 200,全部渲染真实数据。

## 2. MCP 管理面(2026-07-28 无状态协议,经 Caddy)

- `server/discover` → `supportedVersions: ["2026-07-28"]`,`serverInfo: agent-xray-admin/1.0.0`
- `tools/list` → **24 个工具**,与 `apps/api/mcp/README.md` 的清单一致
- **踩到的坑**:2026-07-28 的 per-request envelope 键是**带命名空间的**,少了直接 `-32602`
  (`the request is missing the required per-request envelope key(s)`):

  ```jsonc
  "_meta": {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientCapabilities": {},
    "io.modelcontextprotocol/clientInfo": { "name": "…", "version": "…" }
  }
  ```

- 认证:无 token / 错 token / GET 一律 **401**,且 `mcp_audit` 里各有一条 `denied`
  (`认证失败:缺少 Bearer 凭据` / `认证失败:凭据不匹配`)
- 写操作审计:`ok` 13 条 / `denied` 4 条,逐条带 `tool` 与 `summary`,**没有任何一条 summary 里出现 key**
- LLM key 读回:`llm_providers_list` 只给 `"apiKeyHint": "sk-…443a"`

## 3. 内容全链路(写入 → 前端 → RSS → 配图)

经 MCP 建四分类 → 系列 `r9-smoke` → 上传 1 张 WebP → 发 2 篇文章:

| 检查 | 实测 |
|---|---|
| `notes_asset_put` | `{"created":true,"byteSize":1778,"url":"/notes/r9-smoke/e284aa9ec6d9ee49.webp"}` |
| `notes_chapter_upsert` 幂等 | 第二次同内容 → `"status":"unchanged"`(RSS 不会假装有更新) |
| 配图路由 | `200` + `Content-Type: image/webp` + `Cache-Control: public, max-age=86400` + `ETag` |
| 条件请求 | 带 `If-None-Match` → **304** |
| 同形地址不被劫走 | `/notes/r9-smoke/readme` 200(文章页)· `/notes/r9-smoke` 200(系列页) |
| RSS | `/rss.xml` 200 · `/rss/deep-dive.xml` 200 · `/rss/nope.xml` 404 |
| RSS 绝对链接 | `http://192.168.100.130/notes/r9-smoke/readme` —— 取自 `SITE_ORIGIN`,scheme 正确 |
| About | 经 `about_set` 写入后 `/about` 立即出真实内容(intro / 构建要点 / 仓库卡 / 语言条) |

## 4. SSE ×2(真实 Caddy + 自托管镜像拓扑)

**`POST /agent/ask`**:经 Caddy 流式出字,`session` → 31 × `delta` → `done`。

**`GET /trace/stream`**:一轮真实对话采到 **40 条事件 / 16 种事件类型**
(`message_update` 23 · `message_start` 2 · `message_end` 2 · `session_start` / `resources_discover` /
`input` / `before_agent_start` / `agent_start` / `turn_start` / `context` /
`before_provider_headers` / `before_provider_request` 各 1 …),`seq` 0–39 连续。

| 检查 | 实测 |
|---|---|
| 心跳 | 空闲期每 15s 一条 `: hb`,45s 内收到 3 条 |
| `afterSeq` 回放 | `afterSeq=20` → 精确回放 seq **21–39**(19 条)后 `ready{lastSeq:39}` |
| `docker compose stop api` | 优雅停机 **31s**(`stop_grace_period 40s` + `graceful_shutdown.total 30s`);客户端在容器停止的**同一刻**结束,`curl` 退出码 **18**(transfer closed)—— **明确断流,不是静默挂起**。api `up -d` 后 **2s** 恢复 |
| 脱敏 | `/agent/ask` × 2 与 `/trace/stream` 的原始字节里:明文 key **0** 命中、key 后 8 位 **0** 命中、`authorization`/`api-key`/`apikey`/`bearer`/`x-api-key` **0** 命中 |
| 最该泄的那一帧 | `before_provider_headers` 的 `data` 只剩 `{"type":"before_provider_headers"}` |

> 一处值得记下的行为:优雅停机期间流仍在心跳,直到容器真正停止才在 TCP 层被切断,
> 客户端**收不到 `bye` 帧**。对浏览器 `EventSource` 无影响(它按连接关闭自动重连),
> 但「停机时给在线的流补一帧 `bye`」是个可以考虑的改进 —— 属机制类改动,记 BACKLOG。

### 断连信号复测(BACKLOG 的 R3 一条 + R4 两条)

R9 的任务之一是「在 Caddy + 自托管镜像的真实拓扑下复测能否拿到 SSE 客户端断开信号」——
**结论:仍然拿不到,那三条限制一条都不能放宽。**

| 步骤 | 实测 |
|---|---|
| 对同一会话开 8 条 `trace/stream`(各自独立 clientId) | 占满 `MAX_STREAMS_PER_SESSION=8` |
| 第 9 条 | **429**(名额确实被占住) |
| `kill -9` 掉全部 8 个客户端,等 6s | api 日志无任何释放迹象 |
| 再开第 9 条 | **仍然 429** |

即:**客户端进程消失后,服务端观测不到,名额只能等 `MAX_STREAM_MS`(5min)超时回收**。
与 R3/R4 在 `encore run` 下的结论一致,加一层 Caddy 也没有改变。
所以「同 clientId 让位」机制与 `MAX_STREAM_MS` 硬上界**都要保留**。

## 5. 配额(R7)

| 场景 | 实测 |
|---|---|
| `dailyTokenLimit=1`(今日已用 4061 tokens / 3 turns) | 新会话 `POST /agent/ask` → **429** `{"error":"quota exceeded","code":"daily_tokens"}` |
| `maxTurnsPerSession=1` | 同会话第 1 轮 200 并正常出字;第 2 轮 → **429** `{"code":"turn_limit"}` |
| 恢复 `0`(不限) | 下一次调用立即 200 并出字 —— 配置改动当轮生效 |

## 6. 沙箱(R7 的 `agent_ro`,R9 顺带核验)

`\du agent_ro` → **Cannot login**(NOLOGIN,如 R7 落地补记所述)。事务内 `SET LOCAL ROLE agent_ro` 后:

| 操作 | 结果 |
|---|---|
| `DELETE FROM notes_series` | `ERROR: permission denied for table notes_series` |
| `INSERT INTO notes_series DEFAULT VALUES` | `ERROR: permission denied for table notes_series` |
| `UPDATE notes_chapters` | `ERROR: permission denied for table notes_chapters` |
| `CREATE TABLE ro_probe(i int)` | `ERROR: permission denied for schema public` |
| `SELECT` notes_series / notes_categories / notes_chapters | **成功**(0 行) |
| `SELECT` sessions · messages · visits · llm_config · mcp_audit · trace_events · notes_assets · tool_config · daily_quota · about_content | **十张全部 `permission denied`** |

> 第一次探测写的是 `INSERT INTO notes_series (slug, category_slug, title, …)`,回的是
> **列不存在**而不是权限错误 —— 列解析先于权限检查。用不带列名的写法(`DEFAULT VALUES` /
> `DELETE` / `UPDATE`)才验得到权限这一层。写进来免得下次重踩。

## 7. 容器安全约束

| 容器 | User | ReadonlyRootfs | CapDrop | CapAdd | PidsLimit | Memory | no-new-privileges | tmpfs | 网络 |
|---|---|---|---|---|---|---|---|---|---|
| api | `10001:10001` | **true** | `[ALL]` | `[]` | 256 | 1024 MB | ✅ | `/tmp rw,noexec,nosuid,64m` | front + back |
| web | `10001:10001` | **true** | `[ALL]` | `[]` | 128 | 384 MB | ✅ | `/tmp rw,noexec,nosuid,32m` | front |
| caddy | (root) | false | `[ALL]` | `[CAP_NET_BIND_SERVICE]` | 128 | 128 MB | ✅ | — | front |
| postgres | (root) | false | `[]` | `[]` | 256 | 768 MB | ✅ | — | **back** |

容器内 `id`:api `uid=10001 gid=10001` · web `uid=10001(app)` · caddy `uid=0`
(只为绑 80/443,能力已全丢、只留 `NET_BIND_SERVICE`)。

**网络分段**:`web` 与 `caddy` 容器里 `getent hosts postgres` → **NXDOMAIN**、`nc -z postgres 5432` → 不通;
只有 `api` 同时在 `front` 与 `back`。

## 8. 打点与统计(R8)

`POST /api/t` × 3 → 全 204。`visits` 表 9 行,`visitor` 列 **9/9 是 32 位十六进制哈希、0 行形如 IPv4**。
MCP 统计与打点逐项对得上:`traffic_overview` 的 `pageviews: 23` = `visits.hits` 之和
(6+1+2+7+1+3+1+1+1);`traffic_paths` / `traffic_agents` 的分布与表内容一致。

## 9. 升级与回滚演练

**升级 v1 → v2**(按 docs 的「升级顺序」):

| 步骤 | 实测 |
|---|---|
| `docker compose stop api web` | 停机期间 `/` → **502**(caddy 还在,库不动) |
| `up -d --wait postgres` | healthy |
| `./migrate.sh` | `无待执行迁移(已是最新)` —— 同 schema 的升级是空操作 |
| `up -d` | api **2s**、web **1s** 恢复 |

**回滚 v2 → v1**:改 `.env` 的 `IMAGE_TAG` + `docker compose up -d`,**3s** 完成。

| 检查 | v2(dbf61ce) | v1(c6231b4,回滚后) | 复原到 v2 |
|---|---|---|---|
| 页面里的 Google Fonts 引用 | **0** | **有**(`fonts.googleapis.com/css2?family=JetBrains+Mono…`) | **0** |
| `/notes/r9-smoke/readme` | 200 | 200 | 200 |
| 配图 | 200 | 200 | 200 |
| `/api/agent/sessions` | 200 | 200 | 200 |

数据在两次切换中零丢失(镜像是无状态制品,状态全在 `pg_data` 卷里)。

## 10. 字体自托管(线上验收)

| 检查 | 实测 |
|---|---|
| 页面 HTML 里的 `fonts.googleapis.com` / `fonts.gstatic.com` | **0 条** |
| 浏览器实际请求的外部主机 | **`[]`**(空,零外部请求) |
| 字体请求 | `http://192.168.100.130/_next/static/media/a865edea076e0166-s.p.woff2` |
| 响应头 | `200` · `Content-Type: font/woff2` · `Content-Length: 40404` · `Cache-Control: public, max-age=31536000, immutable` |
| `document.fonts` | `jetbrainsMono 100 800 loaded` · `jetbrainsMono Fallback normal loaded` |
| `pre code` 的 computed font-family | `jetbrainsMono, "jetbrainsMono Fallback", "Noto Sans Mono", Consolas, ui-monospace, monospace, "JetBrains Mono", monospace` |

## 11. 守卫类

| 检查 | 实测 |
|---|---|
| `migrate.sh` + `IMAGE_TAG=latest` | `错误: IMAGE_TAG 必须是 git SHA(当前值: 'latest');禁止 latest 等可变 tag` |
| `migrate.sh --stats`(打错的参数) | `错误: 未知参数 '--stats'(仅支持 --status)` |
| `dev.ps1 ship` 无参数 | `用法:.\dev.ps1 ship <host> [sha];host 是 ssh 目标(别名或 user@ip)` |
| `dev.ps1 ship` 指向本机没有的 tag | `本机没有镜像 …,先跑 .\dev.ps1 build` |

## 实测更正与新发现

### A. 「最终运行镜像里不含 node」这句话要加限定

`command -v node` 在 **api 与 web 两个镜像里都查得到**:

```text
/usr/local/bun-node-fallback-bin/node -> /usr/local/bin/bun
```

它是 `oven/bun` 基座自带的软链,让带 `#!/usr/bin/env node` shebang 的脚本落到 bun 上。
按它判会得出「镜像里有 node」的错误结论。实际查证:

| 判据 | 结果 |
|---|---|
| `node -p "process.versions.bun"` | `1.4.0` —— 这个 `node` 就是 bun |
| `/usr/bin/node` · `/usr/local/bin/node` · `/usr/bin/nodejs` | **都不存在** |
| `dpkg -l` 里的 `nodejs` 包 | **未安装** |
| `bun --version` | `1.4.0`(两个镜像一致) |
| 实际进程 | api:`bun run /workspace/apps/api/.encore/build/combined/combined/main.mjs`(uid 10001)<br>web:`bun --bun server.js`(uid 10001) |

结论仍成立(**没有 Node.js 运行时**),但判据换成上面三条。已回写 CLAUDE.md 规则 11 与
`docs/deploy-environments.md` 的冒烟清单第 12 条。

### B. BACKLOG 的「audit 来源地址可被伪造」在当前拓扑下打不进来

BACKLOG(R8)记着 `mcp/audit.ts` 的 `remoteOf` 取 `X-Forwarded-For` **首段**,而 Caddy 是追加,
所以调用方自塞一个 XFF 就能左右审计里的来源地址。R9 在真实拓扑下分两路验:

| 路径 | 送 `X-Forwarded-For: 203.0.113.77` | 审计里记下的 remote |
|---|---|---|
| 经 Caddy(`http://127.0.0.1/api/mcp`) | 是 | **`172.20.0.1`**(真实对端) |
| 绕过 Caddy 直连 api(从 caddy 容器里发到 `http://api:4000/mcp`) | 是 | **`203.0.113.77`**(伪造值进来了) |

即:**代码层的问题属实,但 Caddy 2.11.4 在未配 `trusted_proxies` 时会用真实对端 IP
覆盖(而非追加)不可信的 XFF,当前部署形态下伪造打不进来**。
这条不降级、也不在本轮改(跨轮次问题),但 BACKLOG 里补上了这个前提 ——
**一旦在 Caddy 前面再加一层代理、或给 Caddy 配了 `trusted_proxies`,这层保护就没了**。

### C. About 页的头像走 `github.com/<user>.png`,是第二个「境内首访外部依赖」

字体那条修完之后,页面上还剩一个跨境资源:About 头部的头像由前端拼
`https://github.com/<githubUser>.png`。130 上实测该图**加载不出**(浏览器显示 alt 文本)。
不影响其余版式,但和 Google Fonts 是同一类问题。跨轮次,记 BACKLOG。

### D. `migrate.sh` 的进度输出被 advisory lock 的结果集淹没

首次执行 6 个迁移时,每个迁移都打印一张空的 `pg_advisory_xact_lock` 表格,把「应用 vN」
的进度行冲散。原因是并发保护那句写成了 `SELECT pg_advisory_xact_lock(...)`,psql 会把
返回值当结果集打印。已改成 `DO $lock$ BEGIN PERFORM ... END $lock$;`,行为不变、只去噪音。
