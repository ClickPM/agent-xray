# 部署环境矩阵

> 所有者裁定(2026-08-28):本机开发用 encore cli;**预发(130)与生产都用 docker 方式部署**。方式不混用(CLAUDE.md 规则 10)。
> 注意与同机的 ticketBookingB2B 项目区分:那边 130 走 encore run + systemd,本项目 130 走 docker。
>
> 所有者裁定(2026-08-29,R-BUN):**开发 / 测试 / 预发 / 生产的 JS 运行时统一为 bun**;**Node 已从生产 runtime 与最终运行镜像中移除**。
>
> ⚠️ 这不等于「项目不再依赖 Node/npm」。准确的边界是:
>
> | 层面 | 用什么 |
> |---|---|
> | 生产运行时(api / web runner) | **bun**,最终运行镜像内无 node |
> | 构建工具链 | 仍用 **node + npm**(`apps/web/Dockerfile` 的 builder 阶段装 `nodejs`/`npm`,跑 `npx next build`);这些不进 runner 阶段 |
> | 依赖安装与锁定 | 仍用 **`npm ci` + `package-lock.json`**(理由见下) |

| 环境 | 位置 | 方式 | 运行时 | 状态 |
|---|---|---|---|---|
| 开发 | 本机 Windows | `dev.ps1` → `encore run :4000`;本地 Postgres 由 encore 经 Docker Desktop 管理 | bun(`encore.app` 的 `bun-runtime` 实验位) | 可用(R0 起) |
| 测试 | 同上 | `dev.ps1 test` → `encore test` → `bun --bun vitest run` | bun | 可用(R-BUN 起) |
| 预发 | 130 服务器 | docker compose(`deploy/`)。**可选环境**:有需要时先在 130 发版验证,不是发生产的前置(所有者裁定 2026-09-03);SHA 允许落后于生产 | bun(`oven/bun:1.4.0-slim` 基座) | **可用**(R9,2026-09-01 全链路实测通过;`http://192.168.100.130`,当前 `7cc17fe` / 迁移 7) |
| 生产 | 境内轻量服务器 | docker compose;若经过 130 验证则原样提升**同一个镜像**(SHA 相同,不重新构建) | bun | **已投产**(R11,2026-09-02,`https://www.kzgai.cloud/`);逐次发版见 [`releases.md`](releases.md) |

**运行时与包管理器是两件事:** bun 只做 JS 运行时与脚本执行器;依赖安装仍走 `npm ci` + `package-lock.json`,不切 `bun install`。理由见 [`rounds/round-bun/round-bun.md`](../rounds/round-bun/round-bun.md)「包管理器为何不切」——pi SDK 自带 `npm-shrinkwrap.json` 锁定传递依赖,bun 不读它,切过去等于丢掉这层供应链锁定,而收益为零。

## docker 部署流(预发/生产共用)

镜像是**不可变制品**:同一个 git SHA 构建一次;**经 130 预发验证是可选的**(所有者裁定 2026-09-03),验过就原样提升同一个镜像、不重新构建,没验就直接发生产。**每次生产发版记入 [`releases.md`](releases.md)**。服务器上不装 encore CLI、不装 node/bun 工具链、不留 git 工作区,只有 docker + compose 加**四个部署资产**:`docker-compose.yml`、`Caddyfile`、`migrate.sh`、`.env`(由 `.env.example` 复制)。这四个文件首次部署时随镜像一起 scp 上去,之后仅在其有变更的发布中重传——`migrate.sh` 是部署序列的必经步骤,漏传就无法完成迁移。

1. **本机构建**(Windows,CLAUDE.md 规则 1/10):

   ```powershell
   .\dev.ps1 build
   ```

   该命令做四件事:拒绝在脏工作区构建、并核对 skills 清单生成物与 `runner/skills` 一致(`node tools/skills-manifest/generate.mjs --check`)→ `encore build docker --config deploy/infra-config.json --base oven/bun:1.4.0-slim --services agent,trace,notes,mcp,metrics,about,system,site,skills` 出 api 镜像 → `docker build apps/web` 出 web 镜像 → `docker build runner` 出 **runner 镜像**(R-SKILLS-2 的执行容器 `xray-runner:<sha>`;Python 基座按 digest 钉在 `runner/Dockerfile`,不是 JS 运行时;R-WEBFETCH 起它要从 PyPI 装 `requirements.txt` 里全部带 hash 的依赖,本机直连慢就设 `$env:PIP_INDEX_URL` 指向镜像站,hash 照核)。三个 tag 都是 git 短 SHA,`ship` 三镜像一起 save;**egress 实例复用 runner 镜像,不是第四个镜像**。服务白名单以 `dev.ps1` 的 `$hostedServices` 为准,**新增服务必须补进去**,漏补的表现是镜像与健康检查都正常、该服务端点静默 404(冒烟清单第 1 条就是为它设的)。

   > ⚠️ 构建前先 `docker pull python:3.12-slim@<digest>`(digest 在 `runner/Dockerfile` 里)—— 与下面 bun 基座同一个理由,境内网络下让 daemon 侧的 mirror 去拉。

   > ⚠️ `--base` 不能省。Encore 开启 `bun-runtime` 后会把镜像 ENTRYPOINT 改成 `bun run …`,却仍按默认基座 `node:slim` 打包,产出的镜像里没有 bun,`docker run` 直接报 `exec: "bun": executable file not found in $PATH`。`encore.app` 里的 `build.docker.base_image` 对本地构建**无效**(只对 Encore 自家 CI/CD 生效)。已固化进 `dev.ps1 build`,不要手敲 `encore build docker`。
   >
   > ⚠️ 构建前先 `docker pull oven/bun:1.4.0-slim`。encore 发现本地没有基座时会**自己直连 Docker Hub 拉取,不走 docker daemon 的 registry mirror**——境内网络下会卡住几十分钟(实测 2026-08-31);daemon 侧 `docker pull` 正常,拉好后 encore 直接用本地镜像。

2. **镜像传输**:走文件,不走管道——**Windows PowerShell 5.1 的管道按文本重编码,`docker save … | ssh … docker load` 会把二进制 tar 破坏掉**(远端 load 报 unexpected EOF 之类):

   ```powershell
   docker save -o xray-<sha>.tar local/xray-api:<sha> local/xray-web:<sha>
   scp xray-<sha>.tar <host>:~
   ssh <host> docker load -i xray-<sha>.tar
   ```

   > 上面三步(外加建 `~/deploy`、传五件部署资产(R-WEBFETCH 起含 `egress-filter.sh`)、给 `migrate.sh` / `egress-filter.sh` 补执行位、load 完删远端 tar)
   > 已固化成一条命令,**平时用它**:
   >
   > ```powershell
   > .\dev.ps1 ship <host> [sha]      # 例:.\dev.ps1 ship 130
   > ```
   >
   > 它刻意**不传 `.env`** —— `.env` 按环境独立、含密钥,永不出本机。

   传输量比想象的小:`docker save` 对两个镜像**共享的 bun 基座层去重**,api 600 MB + web 355 MB 打成的 tar 只有 **155 MB**(R11 实测,传到境内云 99 秒)——别按镜像大小之和去估带宽,也不必为此改走压缩或 registry。

   生产按网络情况用同法或私有 registry(registry 流程在 `./migrate.sh` 前先 `docker pull` 对应 api 镜像,迁移要从镜像里取 SQL)。**任何环境都不用 `latest` tag**:compose 里 `${IMAGE_TAG:?}` 挡空值,`migrate.sh` 进一步硬校验 tag 必须是 git SHA。部署资产(`docker-compose.yml` / `Caddyfile` / `migrate.sh` / `.env.example`)首次与变更时随包一起 scp。

3. **服务器部署 —— 先迁移,后起服务**:

   ```bash
   cd deploy && cp .env.example .env && chmod 600 .env   # 首次
   # 填 IMAGE_TAG=<git-sha> / POSTGRES_PASSWORD / MCP_AUTH_TOKEN_HASH / CONFIG_ENCRYPTION_KEY
   #   / METRICS_IP_SALT / SITE_ORIGIN=<含 scheme 的对外地址>  ← 生成方式见 .env.example 里的注释
   # 生产另填:ICP_BEIAN=<备案号>(预发留空则底栏不渲染)/ SITE_ADDRESS=<域名>(预发留空 = :80)
   #   / SITE_REDIRECT_FROM=<裸域>(预发留空)/ XRAY_WEBSEARCH_EXTRA_HOSTS=<网关域名>(不补则搜索 provider 写不进去)
   #   / XRAY_IMAGEGEN_EXTRA_HOSTS=<生图网关域名>(与上一条是两份清单,网关域名两处都写;不补则生图 provider 写不进去)

   docker compose up -d --wait postgres   # 1) 只起库,--wait 会阻塞到 healthy
   ./migrate.sh                           # 2) schema 就位(详见下一节)
   docker compose up -d                   # 3) 再起 api / web / caddy
   ```

   > **顺序不能颠倒。** `/health` 不触库,所以「先 `up -d` 起全部、再迁移」会留下一段中间状态:Caddy 已经对外放流量、容器 healthy、健康检查全绿,而真实业务接口全部 500。这段窗口靠监控发现不了,只能靠部署顺序消除。升级时同理:新镜像若带了新迁移,也要先停在这个顺序上。

4. **数据库迁移 —— 必须显式执行一次,不会自动跑**:

   ```bash
   ./migrate.sh --status   # 只读:看当前版本与待执行清单
   ./migrate.sh            # 应用待执行迁移
   ```

   > ⚠️ **经 ssh 远程跑时,一条命令一个 ssh,或给它 `< /dev/null`**。`migrate.sh` 内部用 `docker compose exec -T`,
   > 而 **`-T` 只是不分配 TTY,stdin 照样 attach** —— 把它放进 `ssh host bash -s <<'EOF'` 的多行脚本里,
   > 它会把 heredoc **剩下的行当成自己的输入吃掉**,后面的命令静默不执行。R11 生产首发就是这么
   > 「`--status` 通了、实际迁移一行没跑、表数 0」的,日志里看不出任何异常。

   **为什么需要这一步**(实测 2026-08-29):Encore 的自托管镜像**不含迁移执行逻辑**。本地 `encore run` 时是 encore CLI 把 SQL 灌进库的(日志里的 "Running database migrations"),而生产镜像里没有 CLI,Encore 运行时本身也没有迁移代码。镜像虽打包了 `agent/migrations/*.up.sql`,但容器启动不会应用。**空库直起的表现极具迷惑性**:

   ```
   /health          → 200        ← 健康检查全绿,容器 healthy
   /agent/sessions  → 500        relation "sessions" does not exist
   ```

   `deploy/migrate.sh`(所有者裁定 2026-08-29 方案一)的设计:

   - **SQL 来自正在部署的那个镜像**(按 `.env` 的 `IMAGE_TAG` 定位),不从 git 工作区读——服务器上没有仓库,因此不存在「镜像是 A 版、SQL 是 B 版」的漂移
   - **版本记录沿用 Encore/golang-migrate 的 `schema_migrations(version, dirty)` 单行语义**,与 `encore run` 的本地库完全同构;将来若用 encore CLI 连这个库,它读到的版本是对的,不会重跑
   - **单事务应用**:SQL 与版本推进同生共死,失败整体回滚、版本号不动、可直接重跑(已实测:中途报错后版本停在原值,半途建的表不残留)
   - **幂等**:只应用 `version >` 当前版本的文件,重复执行是空操作
   - 遇到含 `CONCURRENTLY` 的语句会**拒绝执行**并提示人工处理——这类语句不能在事务内跑,宁可停下也不绕过事务保护

   **升级顺序:先停旧服务,再迁移,再起新版**。「先迁移、后起服务」在升级场景有个陷阱:只对 postgres `up -d --wait` 时,**旧版 api 还在跑、还在对外服务**,迁移是在它脚下改 schema——旧二进制遇到不兼容的新 schema 会出错甚至写坏数据。V1 用短暂停机换确定性:

   ```bash
   # 改 .env 的 IMAGE_TAG 为新 SHA 后:
   docker compose stop api web            # 1) 停旧版(caddy 可留,回 502;库不动)
   docker compose up -d --wait postgres   # 2) 确认库 healthy
   ./migrate.sh                           # 3) 新 schema 就位
   docker compose up -d                   # 4) 拉起新版 api / web
   ```

   不停机升级(跳过第 1 步)**仅当确认本次迁移与在跑旧版完全后向兼容**时才允许;V1 默认不做这个保证。

5. **首次部署必做:经 MCP 配置 LLM provider**(R6 起没有引导密钥,`docs/security.md` §3)。

   在这一步之前,站点三个 Tab 都能开,但 `/agent/ask` 会回 `503 对话服务尚未配置模型` —— 这是**设计如此**,不是故障。运行期 LLM 凭据的唯一来源是 `llm_config` 表,只能经管理面写入:

   ```jsonc
   // MCP 客户端(Claude Code 等)指向 https://<对外地址>/api/mcp,
   // 带 Authorization: Bearer <你的 token>(服务端只存它的 sha256)
   llm_provider_upsert {
     "provider": "deepseek",              // pi-ai 的 provider id
     "apiKey": "<明文 key,加密入库,读回只给掩码>",
     "baseUrl": "https://<海外中转端点>/v1",  // 境内直连不稳,§5
     "modelId": "deepseek-v4-flash"
   }
   ```

   内容(文章与配图)同理:库是空的,由所有者经 MCP 发布,或从别的环境 `pg_dump`/`pg_restore` 搬过来。**镜像里不含任何 notes 内容**。

   **可选:开联网搜索**(R-WEBSEARCH)。`web_search` 是唯一的外呼工具,种子行**默认是关的**,要两步才生效——先配 provider,再开开关。少哪一步都是「工具不出现」而不是报错:

   ```jsonc
   websearch_provider_upsert {
     "provider": "deepseek",                  // 自取的标签,不是 pi-ai 的 provider id
     "apiKey":   "<明文 key,加密入库,读回只给掩码>",
     "baseUrl":  "https://api.deepseek.com",  // host 必须在目标域白名单内
     "modelId":  "deepseek-v4-flash",
     "dailySearchLimit": 200                  // 0 = 不限;这是唯一花钱的外呼面
   }
   tool_config_set { "name": "web_search", "enabled": true }
   ```

   - baseUrl 的 host 白名单**在代码里**(`apps/api/shared/websearch-hosts.ts`),内置只有 `api.deepseek.com`;自建 / 代理网关一律用 `.env` 的 `XRAY_WEBSEARCH_EXTRA_HOSTS` **追加**(不能替换),不进代码(所有者裁定 2026-09-02:个人项目)
   - 自建 AI 网关与 DeepSeek 是同一套 Responses API,换 `baseUrl` / `modelId` 即可;DeepSeek 若要用带日期的工具变体,另传 `"toolType": "web_search_2025_08_26"`
   - 改动**下一轮生效**(会话按配置指纹重建);删掉默认 provider 后工具自动下线,`tool_config` 的开关不用动

   **可选:开生图**(R-IMAGEGEN)。`generate_image` 是第二个外呼工具,同样两步、同样默认关。协议形态由 `apiStyle` 决定:

   ```jsonc
   imagegen_provider_upsert {
     "provider": "cliproxy-dmit",
     "apiKey":   "<明文 key,加密入库,读回只给掩码>",
     "baseUrl":  "https://<生图网关>/v1",       // host 必须在**生图**白名单内(与搜索白名单是两份)
     "modelId":  "gpt-image-2",
     "apiStyle": "images",                        // gpt-image-* 用 images;gemini-*-image 经兼容网关用 chat
     "imageSize": "1024x1024",                    // 只对 images 形态生效;省略 = 上游默认
     "dailyImageLimit": 50                        // 0 = 不限;每张都是真金白银
   }
   tool_config_set { "name": "generate_image", "enabled": true }
   ```

   - 生图白名单在 `apps/api/shared/imagegen-hosts.ts`(内置只有 `api.openai.com`);要加别的域,`.env` 的 `XRAY_IMAGEGEN_EXTRA_HOSTS` 可**追加**(不能替换)——网关域名要在这里**再写一次**,搜索那条的追加项不作数
   - 生成的图存 Postgres(`generated_images`,随会话级联删除),由 `GET /api/agent/images/<uuid>.<ext>` 按访客归属供图;对话框里的预览是助手回复里的 markdown 图片,前端不用改
   - 上游必须回**内联**图片数据(`b64_json` / data URL);只回 `url` 的 provider(如 dall-e-3 默认)用不了 —— 本站不抓链接

6. **验证 —— 冒烟清单**(R9 在 130 上逐项跑过,留证在 [`rounds/round-09/smoke.md`](../rounds/round-09/smoke.md)):

   | # | 检查 | 期望 |
   |---|---|---|
   | 1 | **服务白名单逐项可达** | `agent` / `trace` / `notes` / `mcp` / `metrics` / `about` / `system` / `site` / `skills` 各取一个**正式端点**(`site` 是 `GET /api/site/tabs`,`skills` 是 `GET /api/skills`),全部非 404 |
   | 2 | 已删服务 | `/api/spike/*` 与 `/admin` 全部 404 |
   | 3 | 四 Tab | `/`、`/notes`、`/skills`、`/about` 均 200 且渲染真实数据;`/skills/<name>.zip` 经 Caddy 回 `application/zip`(R-SKILLS 的扩展名分流) |
   | 4 | MCP 管理面 | 无 token / 错 token / 格式不对的 token / **未认证的** GET 一律 401,且**审计表有 denied 记录**;带 token 且带齐 2026-07-28 逐请求契约的 `server/discover` 回 `supportedVersions: ["2026-07-28"]`,`tools/list` 回全部工具(以 `apps/api/mcp/tools.ts` 的 `registerTool` 计数为准,R-WEBSEARCH 后是 28、R-IMAGEGEN 后是 32、R-TABS 后 34、R-SKILLS 后 42、R-SKILLS-2 后 **46**;**不带 `params._meta` 会落到 legacy 路径,`server/discover` 回 `-32601`,别误判成端点坏了**)(R10 修准:带**正确** token 的 GET 是 **405** —— 认证闸在方法校验之前,别按 401 去核) |
   | 5 | 正文配图路由 | `/notes/<系列>/<哈希>.webp` → 200 + `ETag`;带 `If-None-Match` 复请求 → 304;同形的文章页地址不被图片路由劫走 |
   | 6 | RSS | `/rss.xml` 与 `/rss/<分类>.xml` 200,条目里的绝对链接用的是 `SITE_ORIGIN`;未知分类 404 |
   | 7 | **SSE ×2** | `POST /agent/ask` 经 Caddy 流式出字;`GET /trace/stream` 有 15s 心跳、`afterSeq` 断线重连能精确回放;`docker compose stop api` 时客户端**在停机同刻拿到确定的终止**而非挂到超时(R10 修准:**别钉死退出码**——R9 见 curl `18`、R10 见 `0`,差别只在断开落在响应分块的哪个位置;要判的是「+0s 就结束」) |
   | 8 | SSE 脱敏 | 两条流的原始字节里搜不到明文 key、`Authorization`、`api-key`;`before_provider_headers` 帧只剩 `type` |
   | 9 | 配额 | 把 `dailyTokenLimit` / `maxTurnsPerSession` 调小 → `429` + `code`(`daily_tokens` / `turn_limit`),恢复配置后立即可用 |
   | 10 | `agent_ro` 沙箱 | `SET LOCAL ROLE agent_ro` 后写 notes 三张表全部 `permission denied`;读这三张表成功;读其余任何表 `permission denied` |
   | 11 | 容器安全约束 | `docker inspect`:api/web 为 `10001:10001`、`ReadonlyRootfs=true`、`CapDrop=[ALL]`、`PidsLimit`、`Memory`、`no-new-privileges`、tmpfs `noexec` |
   | 12 | **最终运行镜像无 Node.js** | 见下面的「怎么查才是对的」 |
   | 13 | 网络分段 | 从 `web` / `caddy` 容器**连不上也解析不到** `postgres`;`api` 可以 |
   | 14 | 打点与统计 | `POST /t` → 204;`visits` 里只有哈希、无原始 IP;MCP 的 `traffic_*` 结果与打点逐项对得上 |
   | 15 | migrate.sh 守卫 | `IMAGE_TAG=latest` 被拒;未知参数(如 `--stats`)被拒 |
   | 17 | **HTTP/3**(R11) | `docker run --rm ymuski/curl-http3 curl --http3-only -sS -o /dev/null -w '%{http_version} %{http_code}' https://<域名>/` 回 `3 200`。**本机 curl 是 Schannel 构建、不支持 h3,验不了这条**。三处缺一不可:compose 的 `443:443/udp`(简写 `"443:443"` **只映射 tcp**)、ufw `443/udp`、云控制台 UDP 443。漏了的表现不是报错,是 Caddy 照样广告 `Alt-Svc: h3` 而访客首访白等一次超时 |
   | 18 | **80 无响应 + 规范跳转**(仅生产,R11) | `http://<域名>/` 连不上或空回复,**不得**出现 30x;非规范主机名(`SITE_REDIRECT_FROM`)→ **301** 到 `SITE_ORIGIN`,路径与 query 原样带过;规范主机名自身不被跳转 |
   | 16 | **联网搜索**(R-WEBSEARCH,配了才查) | ① 只配 provider 不开 `tool_config` → 工具不出现;两步都做 → 下一轮出现 ② 问一个知识截止后的问题,答案带来源链接 ③ 右栏 Timeline 出现 `tool_execution_update · web_search ×N`,Lifecycle 的 `tool_call`/`tool_execution`/`tool_result` 三节点点亮 ④ `websearch_provider_upsert` 传一个白名单外的 baseUrl **被拒** ⑤ `websearch_providers_list` 只回掩码 ⑥ `/trace/stream` 原始字节里搜不到搜索 key |
   | 17 | **生图**(R-IMAGEGEN,配了才查) | ① 两步都做后说「画一张…」,助手回复里**渲染出图片**(不是一行地址);② Timeline 出现 `tool_execution_update · generate_image ×N`(等图期间每 10s 一条「生成中」);③ 换一个没有该访客 cookie 的浏览器直接打开图片地址 → 404;④ `imagegen_provider_upsert` 传搜索白名单里、生图白名单外的 baseUrl **被拒**;⑤ `imagegen_providers_list` 只回掩码;⑥ `/agent/tools` 与 `/trace/stream` 里搜不到 key / baseUrl / model;⑦ 删掉那个会话后图片地址 404 |
   | 19 | **skill-runner 隔离形态**(R-SKILLS-2,所有者裁定 7:在生产冒烟验收,**`skill_load` / `skill_run` 双闸关闭状态下跑**,四条都过了才按任务卡「运维」段的顺序打开) | ① `docker compose ps` 里 `skill-runner` 为 `healthy`(healthcheck = `runner.py --health` 走同一个 unix socket);② 容器内出不了网:`docker compose exec skill-runner /opt/venv/bin/python -I -c "import socket; socket.create_connection(('1.1.1.1',53),2)"` 抛 `OSError`,且 `cat /proc/net/route` 只有表头(没有任何路由);③ 只读:`docker compose exec skill-runner sh -c 'touch /opt/skills/x'` 失败(Read-only file system);④ 清单闸:在 api 容器里对 socket 发一个不在清单里的脚本名 → `404 {"error":"unknown_script"}`:`docker compose exec api bun -e 'fetch("http://skill-runner/run",{method:"POST",unix:"/run/runner/runner.sock",headers:{"content-type":"application/json"},body:JSON.stringify({skill:"text-tools",script:"rm.py",sha256:"0".repeat(64),input:{}})}).then(async r=>console.log(r.status,await r.text()))'`。另核 `docker inspect`:`NetworkMode=none`、`ReadonlyRootfs=true`、`CapDrop=[ALL]`、`PidsLimit=64`、`Memory=384m`、tmpfs `/run/work` 带 `noexec` |
   | 20 | **agent 使用 skills 端到端**(R-SKILLS-2,第 19 条过了并按顺序打开之后) | ① `skills_agent_status` 里目标 skill `consistency: ok`、`available: true`;② 对 agent 说「用 text-tools 统计这段话的词频:…」→ Timeline 出现 `before_agent_start`(详情卡 EXTENSION RETURNED · xray-skills 列出可用 skills)→ `tool_call · skill_load` → `tool_call · skill_run` → `tool_execution_update · skill_run ×N` → `tool_execution_end`,回复里有脚本算出的词频;③ 再说「用 text-tools 跑 scripts/rm.py」→ `tool_call · skill_run` 行带红色 `blocked` 徽标与「└ xray-guard returned {block: true}」注记,`tool_execution_end` 为 `isError`;④ `/api/agent/tools` 与 `/api/trace/stream` 原始流里搜不到 `/run/runner`、`unix:`、超时与限额数字;⑤ `tool_config_set skill_run false` 后下一轮工具消失;`skills_agent_set text-tools false` 后该 skill 不再出现在 `before_agent_start` 的 `skills` 里 |
   | 21 | **egress 执行容器 + web-fetch**(R-WEBFETCH;①②③在 `web-fetch` 未打开时就能验,④要 `skills_agent_set web-fetch true` 之后) | ① `docker compose ps` 里 `skill-runner-egress` 为 `healthy`;`docker inspect`:`Networks` 只有 `deploy_egress`、`ReadonlyRootfs=true`、`CapDrop=[ALL]`、`PidsLimit=64`、`Memory=256m`(268435456)、挂载只有 `runner_egress_sock` 与 tmpfs `/run/work`(`noexec`);② 网络边界:`docker compose exec skill-runner-egress /opt/venv/bin/python -I -c "import socket; socket.getaddrinfo('postgres',5432)"` 与 `getaddrinfo('api',4000)` 都抛 `gaierror`,`socket.create_connection(('1.1.1.1',443),3)` 成功,`socket.create_connection(('169.254.169.254',80),3)` **失败**(宿主 `sudo ./egress-filter.sh --status` 六条 `ok`,`systemctl is-enabled xray-egress-filter` 为 `enabled`);③ 档次闸(在 api 容器里,`sha256` 取 `runner/manifest.json` 里 `web-fetch.scripts["fetch.py"]`):对 **none 档** socket(`/run/runner/runner.sock`)发 `{skill:"web-fetch",script:"fetch.py",…}` → `403 {"error":"network_mismatch"}`;对 **egress 档** socket(`unix:"/run/runner-egress/runner.sock"`)发 `text-tools` → 同样 `403`;对 egress socket 发 web-fetch + `{"url":"https://169.254.169.254/"}` → `200` 且 `exitCode:2, stdout:"E_BAD_URL\n"`(**纯数字 TLD 在 `narrow_url` 的 `TLD_RE` 就被拒**,到不了地址校验那层;2026-09-04 生产实测订正,原记 `E_UNFETCHABLE` 有误);发 `{"url":"http://example.com/"}` → `E_BAD_URL`;发 `{"url":"https://www.kzgai.cloud/about"}` → `exitCode:0`、stdout 是以 `#` 开头的 markdown;④ 端到端:`skills_upsert` 上传 `runner/skills/web-fetch/` 的 3 个文件(LF)→ `skills_agent_status` 里 `web-fetch` `consistency: ok` → `skills_agent_set web-fetch true` → 对 agent 说「读一下 https://en.wikipedia.org/wiki/Server-side_request_forgery 并用三句话总结」→ Timeline `tool_call · skill_run`(web-fetch / fetch.py)→ `tool_execution_update ×N` → `tool_result`,回复的三句来自正文;说「读 https://169.254.169.254/latest/meta-data/」→ **模型读过 SKILL.md 后通常在调用前就自己拒了**(2026-09-04 生产实测),不进 `skill_run`;要看工具侧的短码用上面 ③ 的直连 socket 用例。真进了工具则以「脚本运行失败…(E_BAD_URL)」失败(`isError`);`/api/trace/stream` 与 `/api/agent/tools` 原始流里 grep 不到 IPv4 / IPv6 字面量、`Location`、`/run/runner-egress`;`docker compose stop skill-runner-egress` 后 web-fetch 以「执行容器当前不可用」失败、`text-tools` 照常;`skills_agent_set web-fetch false` 后下一轮 `<available_skills>` 里没有它 |

   > **预检必须走 compose 起容器,别用 `docker run` 手工凑。** R11 上线前用 `docker run -p 443:443/udp …` 做过一次
   > 访问层预检,HTTP/3 是通的;正式 `docker compose up` 之后却不通 —— compose 里根本没写 udp 映射,
   > udp 是预检时手敲在命令行上的。「预检用的启动方式和生产不是同一条」这类差异只能靠跑真实部署路径消除。
   >
   > **`--services` 是维护热点,必须纳入冒烟。** 打进镜像的服务由 `dev.ps1 build` 里的 `$hostedServices`(当前 `agent,trace,notes,mcp,metrics,about,system,site,skills`)白名单决定。新增服务时**必须同步在那里补上服务名**,否则表现是:镜像构建成功、容器 healthy、`/health` 200,而该服务的所有端点静默 404 —— 没有任何一处会报错。
   >
   > 因此冒烟不能只看 `/health`,要**逐个确认当前已落地的正式 service 端点都可达**(表里第 1 条)。本项目不引入自动服务发现,这条靠清单与冒烟兜住。

   > **「镜像里没有 node」怎么查才是对的**(R9 实测):`command -v node` 在 api 与 web 镜像里**都能查到**一个
   > `/usr/local/bun-node-fallback-bin/node` —— 它是 `oven/bun` 基座自带的**软链,指向 `/usr/local/bin/bun`**,
   > 存在的意义是让带 `#!/usr/bin/env node` shebang 的脚本落到 bun 上。用它当判据会得出「镜像里有 node」的错误结论。
   > 正确的判据是问那个 `node` 自己是谁:
   >
   > ```bash
   > docker run --rm --entrypoint sh local/xray-api:<sha> -c 'node -p "process.versions.bun"'   # → 1.4.0
   > docker run --rm --entrypoint sh local/xray-api:<sha> -c 'ls -l $(command -v node); ls /usr/bin/node /usr/local/bin/node 2>&1'
   > docker run --rm --entrypoint sh local/xray-api:<sha> -c 'dpkg -l | grep -c "^ii  *nodejs"'  # → 0
   > ```
   >
   > R9 实测三项结论:`node` = 指向 bun 的软链、真实的 `node`/`nodejs` 二进制不存在、`nodejs` 包未安装。
   > 所以「最终运行镜像里没有 Node.js 运行时」这句成立,只是不能用 `command -v node` 去证。

7. **回滚**:镜像即回滚单元。把 `.env` 的 `IMAGE_TAG` 换回上一个 SHA,`docker compose up -d`。涉及不可逆迁移时先恢复备份(R10 衔接)。

8. **环境间内容迁移(预发 → 生产,R11 实做过一次)**:Notes 与 About 走**库级拷贝**,不走 MCP 逐篇重发——103 张配图的 base64 过一遍对话会把上下文炸掉,而库拷贝 20 MB、几秒钟、逐字节一致。

   ```bash
   # 源端:逐表 dump,顺序 = 外键依赖(categories → series → chapters → assets → about),序列单独带上
   for t in notes_categories notes_series notes_chapters notes_assets about_content notes_chapters_id_seq; do
     docker compose exec -T postgres pg_dump -U app -d agent --data-only --no-owner --no-privileges -t "public.$t" < /dev/null
   done > notes-content.sql
   # 目标端:单事务灌入,任何一条失败整体回滚
   docker compose exec -T postgres psql -U app -d agent -v ON_ERROR_STOP=1 --single-transaction -q < notes-content.sql
   ```

   四条硬约束,每条都有实测依据:

   - **别用一条 `pg_dump` 带多个 `-t`**:`--data-only` 按**字母序**出表,`notes_assets` 会排在 `notes_series` 前面,灌入时撞外键。逐表 dump 再拼接才能控制顺序
   - **`notes_chapters_id_seq` 要显式 dump**(`-t` 不会自动带上被表拥有的序列),漏了的表现是拷完之后**新插入撞主键**
   - **先核两边表结构**(`information_schema.columns` 逐列 diff):两个环境的迁移版本可能不同(R11 时 130 是 7、生产是 9),恰好 008/009 不碰这五张表才能直接灌
   - **`llm_config` / `websearch_config` 不可拷,连试都别试**:key 是用**各环境自己的** `CONFIG_ENCRYPTION_KEY` 加密的密文,拷到另一个环境解不开、agent 照样 503;MCP 读回也只有掩码。provider 必须由所有者给明文经 `llm_provider_upsert` / `websearch_provider_upsert` 重写。反过来「把源环境的 `CONFIG_ENCRYPTION_KEY` 也拷过去」是错误解法——那等于两个环境共用一把密钥

   拷完检查一遍 About:文案里可能带着源环境的话(R11 从 130 拷来的 intro 结尾是「这里是 130 预发环境」,上了公开生产站才发现)。

## 环境差异要点

- 容器安全约束(非 root / read_only / cap_drop ALL / pids_limit / mem_limit / no-new-privileges / tmpfs noexec)在 `deploy/docker-compose.yml` 已定稿,预发与生产一致,不得为省事放宽(`docs/security.md` §1 第 3 层)。
- 网络分段:`front`(caddy/web/api)与 `back`(api/postgres,`internal: true`)。postgres 不在 front 网段,caddy 与 web 无法直连数据库。
- 端口契约:api 容器 `PORT=4000`,与 `deploy/Caddyfile` 的 `reverse_proxy api:4000` 成对;镜像默认是 8080,两处必须同改。
- 生产额外做服务器基线初始化(`docs/security.md` §5)与 ICP 备案/TLS(`docs/deploy-cn-lightweight.md`)。
- 预发(130)不备案,内网 IP + 端口直访即可;Caddy TLS 只在生产开。
- **站点地址与规范主机名**:生产 `SITE_ADDRESS=www.kzgai.cloud, kzgai.cloud` + `SITE_REDIRECT_FROM=kzgai.cloud`(裸域 301 到 `SITE_ORIGIN`);130 两者都不设(`:80`,跳转规则是死的)。compose 里 `SITE_REDIRECT_FROM` 的默认值是哨兵 `__unset__` 而非空串——Caddy 的 `{$VAR:default}` 对**存在但为空**的变量取空,matcher 变成 `host `(缺参数)、Caddyfile 解析失败(实测 `module value cannot be null`)。
- **生产 80 不给响应**(`auto_https disable_redirects`),ACME 只走 TLS-ALPN-01,443 是证书续期的唯一命脉(`docs/security.md` §5);130 是明文 `:80`,这条对它是空操作。
- **udp/443 三处齐**才有 HTTP/3:compose `443:443/udp` + ufw + 云控制台。
- **`XRAY_WEBSEARCH_EXTRA_HOSTS`**:两个环境都要放 LLM/搜索网关的域名。130 早就设了,生产首次部署漏了它 `websearch_provider_upsert` 会直接拒。
- **`XRAY_IMAGEGEN_EXTRA_HOSTS`**(R-IMAGEGEN):生图白名单是**另一份清单**(内置只有 `api.openai.com`),网关域名要在这里再写一次,否则 `imagegen_provider_upsert` 直接拒。env 变了要**重建 api**(`up -d api`),`restart` 不生效。
- `.env` 各环境独立,永不入 Git;LLM key 不进镜像,经 `infra-config.json` 的 `{"$env": …}` 在运行时注入。
