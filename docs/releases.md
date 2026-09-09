# 生产发布记录

> 站点 https://www.kzgai.cloud/ 于 2026-09-02 投产(R11)。**每次生产发版在这里加一行**(所有者裁定 2026-09-03),
> 不成轮次的小修补也不例外——`dev.ps1 ship` 收尾会提醒。发版流程见 [`deploy-environments.md`](deploy-environments.md)
> (先停 api/web → `up -d --wait postgres` → `migrate.sh` → `up -d`);130 预发验证是**可选**步骤,不是前置。
>
> 列说明:**SHA** = `.env` 的 `IMAGE_TAG`(git 短 SHA,禁止 latest);**迁移** = 发版后 `migrate.sh --status` 的版本;
> **.env / 部署资产变更** = 这次发版除镜像之外还动了什么(没动写「无」);**回滚点** = 服务器上仍保留的上一个镜像 tag。
> 查当前生产状态:`ssh agent-xray-prod-deploy 'grep IMAGE_TAG ~/deploy/.env; cd ~/deploy && ./migrate.sh --status'`。
> 两条硬约束每次发版都成立:运行时 bun(`node -p "process.versions.bun"` 有值)、MCP 协议 2026-07-28(`server/discover`),见 CLAUDE.md 规则 12。

## 生产(106.54.238.52,https://www.kzgai.cloud/)

| 日期 | SHA | 迁移 | 内容 | .env / 部署资产变更 | 回滚点 | 留证 |
|---|---|---|---|---|---|---|
| 2026-09-02 | `5bd6ace` | 9 | **首发**(R11):`main` 含 R-WEBSEARCH / R-TITLE / R-TOOLS;Caddyfile 域名化 + 六个安全头 + HSTS + 仅 HTTPS + 裸域 301;内容从 130 库级拷入(4 分类 / 13 系列 / 205 章节 / 103 配图)+ Encore 系列经 MCP 发布;LLM / 搜索 provider 经 MCP 写入,不设限额 | `.env` 首次建立(密钥三项服务器就地生成);首发漏了 `XRAY_WEBSEARCH_EXTRA_HOSTS`,补后重建 api;compose 补 `443:443/udp`(`97fcdec`) | — | [round-11 任务卡](../rounds/round-11/round-11.md)「生产部署与上线冒烟」「全链路验收」:13 项冒烟 + 对话 / SSE ×2 / web_search / session_rename 全通。**上线检查单未在生产重跑**(所有者裁定,6 项无留证,见「收工」段) |
| 2026-09-02 | `b291eb1` | 9 → **10** | R-IMAGEGEN(`generate_image` + 对话框 markdown 出图 + MCP `imagegen_*` ×4,迁移 010)+ 修补 `b291eb1`(Notes 数学公式 KaTeX + 货币美元防误伤) | `.env` 补 `XRAY_IMAGEGEN_EXTRA_HOSTS`(生图白名单是独立一份)并重建 api;备份 `~/deploy/.env.bak-pre-b291eb1` | `5bd6ace` | 同日经 MCP 配好 imagegen provider 并 `tool_config_set generate_image true`,生产实跑出图通过(约 72s,PNG 落库,对话框渲染);此后 6 个工具全开 |
| 2026-09-02 | `d2a87d0` | 10 | 纯前端修补两条:`9dd0c89` Timeline 进行中行波浪扫光 + 发送按钮生成期间转圈禁用;`d2a87d0` 文章页阅读进度线接真实滚动 | 无(`apps/api` 与 `deploy/` 零改动;`migrate.sh --status` 无待执行);备份 `~/deploy/.env.bak-pre-d2a87d0` | `b291eb1` | 三个 Tab 冒烟 |
| 2026-09-03 | `da10f6e` | 10 → **11** | R-TABS(顶部 tab 呈现开关:迁移 011 + `site` 只读服务 + MCP `site_tabs_list` / `site_tab_set`)+ 构建修复:`site` 补进 `dev.ps1` 的 `--services` 白名单(R-TABS 漏补,按 `459b168` 构建会整站 500,见下) | 无(`deploy/` 四件资产零改动,未重传;`.env` 只改 `IMAGE_TAG`);备份 `~/deploy/.env.bak-pre-da10f6e` | `d2a87d0` | 三页 200 + `/api/site/tabs` 可读;bun 1.4.0 双容器、真 node 不存在;`server/discover` 回 2026-07-28、`tools/list` **34**。**发版后经 `site_tab_set` 隐藏 `runtime`**(所有者要求):`/` → **307** `/notes`、导航条只剩 Notes / About、`/rss.xml` 仍 200 |
| 2026-09-03 | `789007e` | 11 → **12** | R-SKILLS 1.0(Skills 技能库 tab:迁移 012 三张表 + `apps/api/skills/` 只读面(首页 / 详情 / zip)+ MCP 八个 `skills_*`(工具 34 → **42**)+ 前端画板 2f/2g/2h + 四格 tab 三处登记)。发版时库里**还没有任何 skill**,`/skills` 是空态(所有者裁定「直接可见」,首批内容随后经 MCP 上传) | `deploy/Caddyfile` **有变更**(新增 `^/skills/[a-z0-9-]+\.zip$` → `/assets/skills/…` 扩展名分流),随 `dev.ps1 ship` 重传后 `caddy validate` + `caddy reload`(不重启容器);`.env` 只改 `IMAGE_TAG`;备份 `~/deploy/.env.bak-pre-789007e` | `da10f6e` | 冒烟:九个服务各取正式端点全部非 404(`/api/skills` 200、`/api/site/tabs` 200、`/api/t` 204、`/api/trace/stream` 400=非 404、`/api/mcp` 无 token 401);`/notes` `/skills` `/about` 200、`/` 仍 **307**(`runtime` 保持隐藏)、`/skills` 渲染「共 0 个 skill」空态;`/api/spike/*` 与 `/admin` 404;`/skills/<不存在>.zip` 回 **api 的 JSON 404**(证明新 Caddy 规则生效)、`/skills/<不存在>` 详情页 404;Notes 配图 200 + ETag、复请求 304(Caddy reload 无回归);`server/discover` 回 `2026-07-28`、`tools/list` **42** 含八个 `skills_*`;两容器 `process.versions.bun` = 1.4.0。发版当日随即上传首批 **18 个 skill**(见下),补验:`/skills/<name>.zip` 回 **`application/zip`**、zip 解开后逐文件 sha256 与源目录一致(diagram 11/11);`/api/skills` 回 total 18 / 四分类 7·6·2·3。**未验**:SSE 全链路(本次 diff 未触 `apps/api/agent` 运行代码,只加了迁移与测试) |
| 2026-09-03 | `c1ee245` | 12 → **13** | 一次发三轮:**R-SKILLS-2**(agent 使用 skills —— `skill_load` 注入 + `skill_run` 在独立无网络执行容器里跑脚本;迁移 013 + **第三个镜像 `xray-runner`** + MCP 42 → **46**)、**R-PERF**(软导航加载态 / 详情页载荷瘦身 / 错误边界,画板 2i–2k)、**R-TOOLCARDS**(会话区工具调用卡:实时内联 + 跑完折叠 2l / 展开 2m,`messages.payload` 加工具调用偏移表可回放)。发版时双闸关闭(迁移种下的 `skill_load` / `skill_run` 都是 `enabled=false`),**当日随即按 `round-skills-2.md`「运维」段的顺序全部打开**(见下) | `deploy/docker-compose.yml` **有变更**(新增 `skill-runner` service:`network_mode: none` / `init: true` / 只读 / noexec tmpfs / cap_drop ALL / pids 64 / mem 384m、命名卷 `runner_sock` 与 api 的 unix socket 挂载、透传 `XRAY_UNLOCK_DANGEROUS_TOOLS`),随 `dev.ps1 ship` 重传后由 `up -d` 建卷建容器;`Caddyfile` 无变更(重传同内容,未 reload);`.env` 发版时只改 `IMAGE_TAG`(备份 `~/deploy/.env.bak-pre-c1ee245`),**当日打开双闸时第二次改**:第 89 行 `#XRAY_UNLOCK_DANGEROUS_TOOLS=` → `XRAY_UNLOCK_DANGEROUS_TOOLS=1` 并 `up -d api` 重建(备份 `~/deploy/.env.bak-pre-unlock-dangerous`) | `789007e` | 冒烟:九服务正式端点全部非 404(`/api/notes/series` 200、`/api/site/tabs` 200、`/api/skills` 200 total 19、`/api/t` 405=非 404、`/api/trace/stream` 400、`/api/mcp` 无 token 401、带 token GET 405);`/notes` `/skills` `/about` 200、`/` 仍 **307 → /notes**;`/api/spike/*` 与 `/admin` 404;`/skills/diagram.zip` 回 `application/zip`;Notes 配图 200 + ETag、复请求 **304**;`http://` 无响应、裸域 **301** 带路径到 www;两容器 `process.versions.bun` = 1.4.0 且真实 node 不存在、`dpkg` 无 nodejs;`server/discover` 回 `supportedVersions:["2026-07-28"]`、`tools/list` **46**(含 `skills_agent_set` / `skills_agent_status`)。**第 19 条 skill-runner 隔离四项全过**(双闸关闭状态下):healthy、容器内 `create_connection(1.1.1.1:53)` 抛 `Network is unreachable` 且 `/proc/net/route` 只有表头、`touch /opt/skills/x` 回 Read-only、经 unix socket 发清单外脚本名回 `404 unknown_script`;`docker inspect` 核到 `NetworkMode=none` / `ReadonlyRootfs=true` / `CapDrop=[ALL]` / `PidsLimit=64` / `Memory=384m` / tmpfs `noexec`。**SSE ×2 用一轮真实对话验**(验后删会话):`/agent/ask` 流式出字 + `tool_start`/`tool_end` 各 2、`done` 回 `modelRoundTrips:3 turnMs:7053`;回放 `GET /agent/sessions/:id` 拿到 R-TOOLCARDS 的 `turn.toolCalls`(`at` 偏移 / `durationMs` / 入参与结果摘要 / `isError`),`/trace/stream?afterSeq=0` 回放 18 种事件类型;两条流的原始字节里 `Authorization`/`api-key`/`sk-`/`baseUrl`/`/run/runner`/`unix:` 均 **0** 次 |
| 2026-09-04 | `2c503d3` | 13 | **R-WEBFETCH**(agent 读访客指定的公网网页):`runner/skills/web-fetch`(egress 档 skill,单文件 `scripts/fetch.py` + trafilatura)+ 同一 runner 镜像的第二个实例 `skill-runner-egress`(只出公网)+ api 两档 `RunnerTargets` 路由 + 宿主出网过滤 `deploy/egress-filter.sh`。**零迁移(13→13)、零 MCP 工具(46 不变)、零前端改动、零画板**;`apps/api/package.json` 未动(不需要 `npm ci`)。runner 镜像 189 → **269 MB**(trafilatura 及 16 个传递依赖),api 602 → 603 MB,web 359 MB 不变(全缓存命中,`apps/web` 相对 `c1ee245` 零改动);`docker save` tar **218.8 MB**,`ship` 一次成功无重传 | `deploy/docker-compose.yml` **有变更**(新增 `skill-runner-egress` service + `egress` 网络 `172.30.0.0/24` + 命名卷 `runner_egress_sock`);**新增第五件部署资产 `deploy/egress-filter.sh`**(`ship` 补执行位),由 sudo 用户 `--install-unit` 装成 `xray-egress-filter.service`(`enabled` + `active`,六条 DROP 全 `ok`);`Caddyfile` 无变更(重传同内容,未 reload);`.env` **只改 `IMAGE_TAG`**,备份 `~/deploy/.env.bak-pre-2c503d3`;宿主 VPC 是 `10.0.0.5/22`、现有网桥 172.17/18/19,与 `172.30.0.0/24` 不冲突 | `c1ee245` | 冒烟:九服务正式端点全部非 404(`/api/agent/tools` 200、`/api/notes/series` 200、`/api/site/tabs` 200、`/api/skills` 200、`/api/about` 200、`/api/health` 200、`/api/t` 405、`/api/trace/stream` 400、`/api/mcp` 无 token 401);`/api/spike/*` 与 `/admin` 404;`/notes` `/skills` `/about` 200、`/` 仍 **307 → /notes**(`runtime` 保持隐藏);`/skills/diagram.zip` 回 `application/zip`;两容器 `process.versions.bun` = **1.4.0**、真实 node 不存在、`dpkg` 无 nodejs;MCP 三种坏 token POST 全 401、认证 GET 405、`server/discover` 回 `["2026-07-28"]`、`tools/list` **46**;第 19 条 skill-runner 四项全过(`NetworkMode=none` / 只读 / `CapDrop=[ALL]` / `Pids=64` / `Memory=384m` / tmpfs `noexec`,清单外脚本名 `404 unknown_script`)。**第 21 条**:① `skill-runner-egress` healthy、只在 `deploy_egress`、`Memory=268435456`、除 `runner_egress_sock` 与 noexec tmpfs 无其它挂载;② `getaddrinfo('postgres')`/`('api')` 均 `gaierror`,公网可达(`223.5.5.5:443`、`8.8.8.8:53`、`106.54.238.52:443` 均连通;**`1.1.1.1` 与 `39.156.66.10` 在境内不可达,不能拿来当存活探针**),`169.254.169.254:80` 失败且 `DOCKER-USER` 该条计数增长;③ none 档 socket 发 web-fetch → `403 network_mismatch`、egress 档发 text-tools → 同样 403、`https://169.254.169.254/` → `exitCode:2 stdout:"E_BAD_URL\n"`、`http://example.com/` → `E_BAD_URL`、`https://www.kzgai.cloud/about` → `exitCode:0` + `#` 开头 markdown;④ 端到端见下。SSE ×2 用两轮真实对话验(验后删会话):`/agent/ask` 出字正常、`/trace/stream` 回放 **28 种事件类型**,两条流原始字节里 `/run/runner-egress` / `unix:` / IPv4 / IPv6 / `Authorization` / `sk-` / `baseUrl` 均 **0** 次 |
| 2026-09-04 | `09e7fd2` | 13 → **14** | **R-USAGE**(顶栏统计条的 tokens 与 ctx 接真实数据):迁移 014 给 `sessions` 加 `total_tokens BIGINT`(会话累计,与全站按天的 `daily_quota` 是两个维度)、`/agent/ask` 的 `done` / `error` 收尾帧带 `totalTokens` + `ctxPercent`、`GET /agent/sessions/:id` 回库内累计与实时 ctx(会话不在运行时注册表里就字段缺席、前端显示 `-`);cost 按所有者裁定**固定占位**不接数据。**零 MCP 工具变动(46 不变)、零部署资产变动、零画板**;`apps/api/package.json` 未动(不需要 `npm ci`);前端只换数据源(`demo-data` 的三项硬编码 → `lib/stats-bar.ts` 纯函数投影),样式零改动 | 无(`deploy/` 四件资产零改动,随 `ship` 重传同内容、未 reload caddy;`.env` **只改 `IMAGE_TAG`**,备份 `~/deploy/.env.bak-pre-09e7fd2`) | `2c503d3` | 冒烟:九服务正式端点全部非 404(`/api/agent/tools` 200、`/api/trace/stream` 400、`/api/notes/series` 200、`/api/mcp` 无 token 401、`/api/t` 405、`/api/about` 200、`/api/health` 200、`/api/site/tabs` 200、`/api/skills` 200);`/api/spike/*` 与 `/admin` 404;`/` `/notes` `/skills` `/about` 全 200(**本次 `runtime` 可见,`/` 落在根路径、不再 307**),`/skills/diagram.zip` 回 `application/zip`,`/rss.xml` 200;配图 200 + `ETag` + 复请求 **304**、同形文章页不被图片路由劫走;裸域 **301** 带路径到 www、`http://` 连不上;两容器 `process.versions.bun` = **1.4.0**、真实 node 不存在、`dpkg` 无 nodejs;MCP 三种坏 token 401、认证 GET **405**、`server/discover` 回 `["2026-07-28"]`、`tools/list` **46**;第 19 / 21 条隔离复核(容器随发版重建):none 档出网 `OSError`、路由表只有表头、`/opt/skills` 只读、清单外脚本 `404 unknown_script`、egress 档 `getaddrinfo('postgres')` `gaierror` 且公网可达、`169.254.169.254:80` 被挡;`docker inspect` 六项(`NetworkMode=none` / 只读 / `CapDrop=[ALL]` / `Pids=64` / api 1g·runner 384m·egress 256m)。**R-USAGE 端到端**(两条验收会话验后即删,库内 remaining 0):第 1 轮 `done` 回 `totalTokens:5315 ctxPercent:0.988`、`GET /agent/sessions/:id` 读回 **同一个 5315**(先落库再发帧,F5 不回退);第 2 轮累加到 **8059**、ctx 涨到 1.008,库与帧一致;`/trace/stream` 回放 **25 种事件类型**;两条流原始字节里 `Authorization` / `api-key` / `sk-` / `baseUrl` / `/run/runner` / `unix:` 均 **0** 次。**前端实测**(浏览器真实一轮):顶栏统计条显示 「**5.4k tokens · - · ● ctx 1% · 76 events**」,F5 后重开会话数字不回退 |
| 2026-09-07 | `d59407a` | 14 → **15** | **R-GSEARCH**(`web_search` 的第二条线协议:provider 的 `toolType=google_search` 时打 `/v1/chat/completions` + `tools:[{google_search:{}}]`,检索与综述由 Google 后端在服务端完成,来源从正文的 markdown 链接抽;迁移 015 只做两件事 —— `tool_type` 的 CHECK 闭集扩一项、改 `tool_config.web_search` 的 note,旧值仍合法故后向兼容)+ **agent 系统提示词加固**(`40c246d`:身份保密 / 指令只来自系统提示 / 内容边界三条通用条款,**工具全关的会话也送达** —— 原先零工具时提示词只有「没有任何可用工具」一句,没有任何注入防御)+ `.gitignore` 补 `.codex/` 与 `.venv/`(`d59407a` 本身;不补则 `dev.ps1 build` 判工作区脏、拒绝构建)。**零 MCP 工具变动(46 不变)、零部署资产变动、零前端改动、零画板**;`apps/api/package.json` 未动(不需要 `npm ci`)。api 镜像 603 MB(与上一版同),**web 359 MB 与 runner 269 MB 全缓存命中**(`apps/web` 与 `runner/` 相对 `09e7fd2` 零改动);`docker save` tar **218.8 MB**,`ship` 一次成功无重传 | 无(`deploy/` 五件资产零改动,随 `ship` 重传同内容、未 reload caddy;`.env` **只改 `IMAGE_TAG`**,备份 `~/deploy/.env.bak-pre-d59407a`) | `09e7fd2` | 冒烟:九服务正式端点全部非 404(`/api/agent/tools` 200、`/api/trace/stream` 400、`/api/notes/series` 200、`/api/mcp` 无 token 401、`/api/t` 405、`/api/about` 200、`/api/health` 200、`/api/site/tabs` 200、`/api/skills` 200);`/api/spike/*` 与 `/admin` 404;`/` `/notes` `/skills` `/about` 全 200(`runtime` 保持可见)、`/skills/diagram.zip` 回 `application/zip`、`/rss.xml` 200;配图 200 + `ETag` + 复请求 **304**、同形文章页不被图片路由劫走;裸域 **301** 带路径到 www、`http://` 连不上;MCP 三种坏 token 401、认证 GET **405**、`server/discover` 回 `["2026-07-28"]`、`tools/list` **46**;两容器 `process.versions.bun` = **1.4.0**、`/usr/bin/node` 与 `/usr/local/bin/node` 均不存在、`dpkg` 无 nodejs;第 19 / 21 条隔离复核(容器随发版重建):none 档 `create_connection` 抛 `OSError` 且 `/proc/net/route` 只有表头(1 行)、`/opt/skills` 只读、egress 档 `getaddrinfo('postgres')`/`('api')` 均 `gaierror` 且公网可达(`223.5.5.5:443`)、`169.254.169.254:80` 被挡(`TimeoutError`);`docker inspect` 六项(`Net=none` / `deploy_egress` / `deploy_back`、`RO=true`、`CapDrop=[ALL]`、`Pids=64/64/256`、`Mem=384m/256m/1g`)。**HTTP 冒烟脚本 26 项 0 失败**(发版前同脚本跑过一次基线,两次同样 26/26)。**R-GSEARCH 端到端见下**。**未验**:HTTP/3(第 17 条,本机 curl 不支持 h3)、配额(第 9 条)、`agent_ro` 沙箱(第 10 条)—— 三项本次 diff 未触及 |
| 2026-09-07 | `d9fefb4` | 15 | **agent 提示词修补 `b6b31c8`**(主模型换 Gemini 系当天复现的「不搜 / 把 grounding 回来的事实判成虚构」,harness 侧 4 处确定缺口):A1 系统提示底座加【时间基准】段(会话开始的站点本地时间,精确到分)· A2 `web_search` 描述与系统提示搜索段改**两条硬规则**(访客要求搜就必须搜;随时间变化 / 不确定已否发生的事实先搜再答,不以「尚未发生」拒答 —— 本站教程内容除外,走 `notes_search`)· A3 工具结果头加「[实时检索 · 时间]」一行(带来源 / 零来源两种口径,都不说「已核实」)· A4 网关请求前缀带日期 · B1 命名段改「不要为了命名而推迟或省掉其它工具」;`shared/site-time.ts` 加 `siteNowLabel`。**零机制、零迁移(15→15)、零 MCP 工具变动(46 不变)、零部署资产变动、零前端改动、零画板**;`apps/api/package.json` 未动(不需要 `npm ci`)。codex 审查 **4 轮 / 7 条 / 全部采纳**,整改后 PASS。api 镜像 603 MB,**web 359 MB 与 runner 269 MB 全缓存命中**(`apps/web` 与 `runner/` 相对 `d59407a` 零改动);`docker save` tar **218.8 MB**,`ship` 一次成功无重传 | 无(`deploy/` 五件资产零改动,随 `ship` 重传同内容、未 reload caddy;`.env` **只改 `IMAGE_TAG`**,备份 `~/deploy/.env.bak-pre-d9fefb4`) | `d59407a` | **HTTP 冒烟 26 项 0 失败**(发版前同脚本跑过基线,两次同样 26/26):九服务正式端点全部非 404、`/api/spike/*` 与 `/admin` 404、四 Tab 全 200、`/skills/diagram.zip` 回 `application/zip`、`/rss.xml` 200、配图 200 + `ETag` + 复请求 **304**、裸域 **301** 带路径到 www、`http://` 连不上、MCP 三种坏 token 401 + 认证 GET 405。**容器复核 21 项 0 失败**:第 12 条两容器 `process.versions.bun` = **1.4.0** 且 `/usr/bin/node` 与 `/usr/local/bin/node` 均不存在、`dpkg` 无 nodejs;第 19 条 none 档四项(出网 `OSError`、`/proc/net/route` 只有表头、`/opt/skills` 只读、清单外脚本 `404 unknown_script`);第 21 条 ①②③(内部主机名 `gaierror`、公网可达 `223.5.5.5:443`、`169.254.169.254:80` 被挡 `TimeoutError`、**双向** `403 network_mismatch`、`E_BAD_URL` ×2、正常抓取 `exit=0`);`docker inspect` 六项(`none` / `deploy_egress` / `deploy_back`、`RO=true`、`CapDrop=[ALL]`、`Pids=64/64/256`、`Mem=384m/256m/1g`)、`xray-egress-filter` `enabled` + `active`。**本次修补端到端三例**(验后即删):**A 时间基准** 问「今天是几号?星期几?现在几点?」→ 答「**2026 年 9 月 7 日，星期一**，13:36(北京时间 UTC+08:00)」,2.7 s;**B 先搜再答**(不明说搜索)问「2026 赛季 F1 车手积分榜前三」→ **模型自己调了 `web_search`**,结果头 `[实时检索 · 2026-09-07 13:37(北京时间 UTC+08:00,星期一)]` 完整出现,给出赛果 + 2 条来源、**全程没有「尚未发生」**,整轮 **12.3 s** / 搜索 4.3 s / `modelRoundTrips:2`;**B1 实测生效** —— `session_rename` 与 `web_search` 两个 `at:0` 落在**同一轮**,命名不再抢占唯一的一次 tool call;**C 硬规则不误伤本站** 说「搜一下这个站点的教程里怎么讲 agent loop」→ 走 `notes_search`、`web_search` **0 次**。**SSE ×2**:`/trace/stream` 回放 **19 种事件类型**,不带搜索的一轮两条流脱敏 **9 项全 0**。**未验**:HTTP/3(第 17 条)、配额(第 9 条)、`agent_ro` 沙箱(第 10 条)、零来源时的结果头口径(网关偶发,不好构造)—— 四项本次 diff 未触及或不可控。**本次冒烟新查出一处既存泄露,见下** |
| 2026-09-08 | `be6c074` | 15 | **R-MOBILE**(移动端呈现层,画板 `4a`–`4u` 共 21 块):视口 ≤768px 走独立的移动壳(底部 Tab Bar / 玻璃功能条 / 两档 Sheet / 左侧会话抽屉 / 左滑删除 / 下拉刷新 / 大标题收起 / 键盘避让),外壳按 iOS 26 重画、**内核(Timeline 耗时色条 / Chain / Lifecycle / 工具卡 / 代码视图 / markdown)照搬桌面 token**;载体只取 PWA 轻量部分(`app/manifest.ts` + `display:standalone` + `orientation:portrait` + 三枚图标 + 两档 `theme-color`),**不做 Service Worker、不做安装引导**;viewport 禁缩放 + JS 拦 `gesturestart`(`user-scalable=no` 在 iOS 被忽略)。**桌面 20 块画板与已实现页面零改动**(规则 7)。**零迁移(15→15)、零 MCP 工具变动(46 不变)、零部署资产变动、零新增产品功能**(规则 8:两套画板同一功能范围);`apps/api` / `runner/` / `deploy/` / `tools/` 相对 `d9fefb4` **四处零改动**,diff 只有 `apps/web` 38 个文件 + 文档。codex 审查 **5 轮 / 17 条 findings:16 条采纳整改、1 条实证不采纳、零 high、末两轮零 findings**。`apps/web/Dockerfile` 恢复 `COPY /app/public ./public`(R6 删 `/admin` 时连带删掉;缺它是**静默失败** —— 图标 404、站点照常起,只有冒烟能照出来)。api 603 MB / runner 269 MB **全缓存命中**,web 359 MB 与上一版同;`docker save` tar **218.8 MB**,`ship` 一次成功无重传 | 无(`deploy/` 五件资产零改动,随 `ship` 重传同内容、未 reload caddy;`.env` **只改 `IMAGE_TAG`**,`diff` 核到全文件仅此一行不同,备份 `~/deploy/.env.bak-pre-be6c074`) | `d9fefb4` | **HTTP 冒烟 33 项 0 失败**,其中 **7 项是本轮新增判据且发版前刻意跑过基线**(`manifest.webmanifest` 404、三枚图标 404、viewport 还是 `initial-scale=1`、无 `theme-color`、无 `rel=manifest` —— 发版后 7 项全部翻成 PASS,构成正向对照,也正是 Dockerfile 那处静默失败的唯一探针)。既有 26 项照旧:九服务正式端点全部非 404、`/api/spike/*` 与 `/admin` 404、四 Tab 全 200(`runtime` 可见,`/` 不 307)、`/skills/diagram.zip` 回 `application/zip`、`/rss.xml` 200、配图 200 + `ETag` + 复请求 **304**、同形文章页不被图片路由劫走、裸域 **301** 带路径到 www、`http://` 连不上、MCP 三种坏 token 401 + 认证 GET **405** + `server/discover` 回 `["2026-07-28"]` + `tools/list` **46**;新增判据实测值:`manifest` 回 `application/manifest+json` / `display=standalone` / `orientation=portrait` / `icons=3`,三枚图标 `image/png` 1769 · 10843 · 10685 字节。**容器复核 22 项 0 失败**:第 12 条两容器 `process.versions.bun` = **1.4.0**、`/usr/bin/node` 与 `/usr/local/bin/node` 均不存在、`dpkg` 无 nodejs;第 19 条 none 档四项(出网 `OSError`、`/proc/net/route` 只有表头 1 行、`/opt/skills` `Read-only file system`、清单外脚本 **404 `unknown_script`**);第 21 条 egress(`getaddrinfo('postgres')`/`('api')` 均 `gaierror`、公网 `223.5.5.5:443` 可达、`169.254.169.254:80` `TimeoutError`、**双向 403 `network_mismatch`**);`docker inspect` 六项(`Net=none` / `deploy_egress`、`RO=true`、`CapDrop=[ALL]`、`Pids=64/64/256`、`Mem=384m/256m/1g`)、`xray-egress-filter` `enabled`+`active`。**移动端真实浏览器实测**(390×845):四个 Tab 全部 `body.scrollWidth === innerWidth = 390`(**零横向溢出**)、移动 Tab Bar 挂载、About 的主题开关在位;**桌面 1280×800 回归**:导航条可见 h**44**、左栏 **260**、右面板 **428**、移动壳**未挂载**、Tab Bar `display:none` —— 与本轮之前逐项一致。**未验**:真机(iOS Safari / 各家 webview)上的流式与手势 —— 需要硬件,所有者裁定「上线后自行验收」;HTTP/3(第 17 条)、配额(第 9 条)、`agent_ro` 沙箱(第 10 条)本次 diff 未触及。**未修的既存项照旧**:`/trace/stream` 带出搜索网关 host 与模型名(见下节)、ghost 按钮字号 14 vs 画板 12(`rounds/BACKLOG.md`) |
| 2026-09-08 | `0db08dd` | 15 | **R-MOBILE 修补**(所有者当日在微信 webview 上验收时报障,见下节):会话抽屉**选中行**的背景 `rgba(37,99,235,0.06)` 有 94% 透光,而删除按钮是常驻的绝对定位元素、靠本行盖住它再用 `translateX` 露出来 —— 于是选中的那一行**没划开就露着红色「删除」**,行内的相对时间与 chevron 正好压在「删除」二字上。改为 `linear-gradient(rgba(37,99,235,0.06), rgba(37,99,235,0.06)), var(--bg)`(叠一层实色而不是硬写混合后的色值,渲染结果与原来一字不差,明暗两套主题各自跟着 `--bg` 走)。**一个文件、一处样式;零迁移(15→15)、零 MCP 工具变动(46 不变)、零部署资产变动、零画板**;`apps/api` / `runner/` / `deploy/` 相对 `be6c074` 零改动,api 603 MB 与 runner 269 MB 全缓存命中。codex 审查**一轮零 findings** | 无(`.env` **只改 `IMAGE_TAG`**,`diff` 核到全文件仅此一行不同,备份 `~/deploy/.env.bak-pre-0db08dd`) | `be6c074` | **HTTP 冒烟 33 项 0 失败**(与 `be6c074` 同一脚本、同一结果)。**修复本身单验**:抓生产实际下发的 14 个 JS chunk 全文扫描 —— 含新写法(叠实色)的 **1** 个(`app/(site)/page-*.js`)、仍把裸 `rgba` 当 `background` 的 **0** 个。**改前先用合成 DOM 复刻过**(与所有者截图逐像素一致):未划开时 `elementFromPoint` 打在按钮中心命中的是时间 `span` 而不是按钮 —— 那块红色**按不动**;改后未划开按钮完全不可见,划开后 chevron 右缘 212 < 按钮左缘 228 不重叠、按钮中心命中 `BUTTON`。**容器复核未重跑**(相对 `be6c074` 只换了 web 镜像里的一个 chunk,api / runner 镜像逐层缓存命中即同一制品) |
| 2026-09-08 | `54f7356` | 15 → **16** | **R-SOURCE**(第五个顶部 tab「Source」+ agent 读站点源码):站点自身源码的只读浏览(左目录树 / 右文件预览,页面标 git SHA)+ agent 三个纯函数组只读工具 `source_list` / `source_read` / `source_search`(迁移 016 种子**默认开**)+ MCP **46 → 51**(五个 `source_*` 写面)+ 发布脚本 `tools/source-publish/`(只从 `git ls-tree <sha>` 取文件,永不读工作树;`begin` 带 manifest 增量 → `put` 分批 → `commit` 单事务)+ `dev.ps1` 的 `ship` 自动挂发布、新子命令 `source-publish`、`build` 跑 `--check`;`$hostedServices` 补 `source`。画板 `2n`–`2p`(新文件 `Agent X-Ray Source.dc.html`)、20 块导航改五格。**先桌面**:移动 Tab Bar 仍四格、不做 Source 页(所有者裁定)。codex 审查 **5 轮 / 9 条(1 P1 / 7 P2 / 1 P3)全部采纳、high 级为零、末轮零 findings**。`apps/api/package.json` 未动(**不需要 `npm ci`**);`deploy/` 五件资产零改动。api 603 MB(与上一版同)、runner 269 MB **全缓存命中**、web 359 MB 重建;`docker save` tar **218.9 MB**,`ship` 一次成功无重传。快照 **323 个文件 / 3,400,582 字节**(最大 `ROUNDS.md` 115 KB / 最深 8 层)| 无(`.env` **只改 `IMAGE_TAG`**,`diff` 核到全文件仅此一行不同,备份 `~/deploy/.env.bak-pre-54f7356`) | `0db08dd` | **HTTP / MCP 冒烟 29 项 1 失败**,那 1 条是**脚本自身取字段的路径写错**(`/api/skills` 的形状是 `categories[].skills[]`),单验补过:`/skills/encore-api.zip` 回 **200 `application/zip`** 6949 字节。逐项:**十个服务的正式端点全部非 404**(新增 `source` 在内:`/api/agent/tools` 200、`/api/notes/series` 200、`/api/site/tabs` 200、`/api/skills` 200、**`/api/source` 200**、`/api/about` 200、`/api/health` 200、`/api/rss.xml` 200、`/api/t` **204**、`/api/trace/stream` 400=缺 `sessionId`,非 404 即可达);`/api/spike/*` 与 `/admin` 404;**五个 Tab 全 200**;MCP 无 token **401**、`server/discover` 回 `["2026-07-28"]`、`tools/list` **51**、五个 `source_*` 齐(`begin` / `files_put` / `commit` / `snapshots_list` / `snapshot_delete`)。**冒烟第 22 条五项全过**:① `/api/source` 的 `snapshot.shortSha` == `.env` 的 `IMAGE_TAG` == `54f7356`(323 文件 / 3,400,582 字节);② `/source` 渲染 README、`/source/apps/api/agent/tools.ts` 带行号、`/source/apps/web/app/(site)/notes/[series]/page.tsx`(括号 + 方括号路径)200,`/source/apps/api`(目录地址)与 `/source/nope.ts` 都触发 `notFound()`;③ `source_snapshots_list` **只有一行 `current`、`pending: 0`**;④ **agent 端到端**:问「这个站的 MCP 工具注册表在哪个文件?给出路径和大致行号」→ Timeline 出现 `tool_call · source_search` → `source_list` → `source_read ×2`,**7 次模型往返 / 7 次工具调用 / 22.4s**,答「`apps/api/mcp/tools.ts`,`registerTools` 在第 **208** 行(实现分布 208–1467)、`server.ts` 约第 61 行调用」—— 与本机 `grep -n` 逐字对上(该文件正好 1467 行);⑤ `site_tab_set source false` → `/api/site/tabs` 的 `source=false`、`/source` **404 `notFound()`**、**`/api/source` 仍 200**,再 `true` 当场恢复。**规则 12 两条硬约束**:api 容器 `node -p process.versions.bun` = **1.4.0**、MCP 协议 `["2026-07-28"]`。**浏览器实看**(1440×900):桌面导航**五格**、Source 高亮、文件树 + 行号代码渲染正常;`/source/nope.ts` 渲染的是 2k-B(「HTTP 404 / 这个地址没有对应的内容 / 回 Source 目录」)—— **流式 404 的正文只在客户端渲染,HTTP 层抓不到文案**,脚本判据改用 flight 载荷里的 `NEXT_HTTP_ERROR_FALLBACK;404`。**未验**:HTTP/3(第 17 条,本机 curl 是 Schannel 构建)、配额(第 9 条)、`agent_ro` 沙箱(第 10 条)、容器隔离第 19 / 21 条(`deploy/` 零改动、runner 镜像逐层缓存命中即同一制品)—— 四项本次 diff 未触及。**冒烟会话未删**(本机 auto 模式拦下对生产的 `DELETE`,与 `5bd6ace` 那次同;只对当时那个访客 cookie 可见) |
| 2026-09-08 | `e8ac83e` | 16 | **R-LEAK**(公开轨迹流的配置面泄露修补):`/trace/stream` 与落库的 `trace_events.data` 里不再出现 provider 名 / model id / model name / 搜索网关 host。**三条通道** —— A `events.ts` 删掉 `EVENT_DERIVED.model_select` 与 `summarizeModel`(`data` 只剩白名单的 `{type, source}`,事件行仍在、详情显示 `{ source: "set" }`);B `websearch.ts` 的 `request` 阶段文案改固定串「已向搜索网关发起请求」(两条线共用同一个 `progress()`,只此一处);**C `tools.ts` 的 `web_search` 结果 `details` 只留 `citations`** —— C 不在任务卡列的两条里,是新增的集成探针 `agent/leak-e2e.test.ts` **第一次跑就抓到**的(`tool_execution_end.resultPreview` 带着 `{provider, model}`,与阶段文案是两条路;静态排查漏它是因为任务卡把范围写成「字符串模板」而它是个结构化对象)。判据同时从**字面词改成值级**:`events.test.ts` / `websearch.test.ts` 各钉值级断言,探针用 faux provider + faux 搜索网关驱动真实 pi loop 一轮,全量轨迹事件与库里 `data` 都 grep 不到五个配置值;`docs/deploy-environments.md` 冒烟第 8 条同步改成值级。**零迁移(16→16)、零 MCP 工具变动(51 不变)、零部署资产变动、零前端改动、零画板**;`apps/api/package.json` 未动(不需要 `npm ci`)。codex 审查**一轮零 findings**。`dev.ps1 test` **608 passed** + web 侧 `bun test lib` 28 passed(新增 6 条用例),`apps/web` 的 `tsc --noEmit` 通过。api 603 MB / web 359 MB **全缓存命中**、runner 269 MB 全缓存命中;`docker save` tar **219 MB**,`ship` 一次成功无重传。快照 **329 个文件 / 3,511,708 字节** | 无(`deploy/` 五件资产零改动;`.env` **只改 `IMAGE_TAG`**,备份 `~/deploy/.env.bak-pre-e8ac83e`) | `54f7356` | **冒烟第 8 条(值级)首次实跑,这是本轮的核心留证**:抓一轮**真实**含 `web_search` 的对话(`/agent/ask` 5,221 B + `/trace/stream` 23,486 B 原始字节),拿当前生效配置的值去 grep —— `api.64-186-228-154.sslip.io` / `64-186-228-154` / `gemini-3.8-flash-high` / `cliproxy-dmit` / `cliproxy-gemini` / `gpt-5.6-terra` **六个值 × 两条流全部 0 命中**;既有字面词检查(`baseUrl` / `Authorization` / `api-key` / `sk-`)同样 0。**该轮确实走了搜索**(trace 里 `web_search` 出现 9 次、`[request]` 行是新文案「已向搜索网关发起请求」),所以「搜不到」不是因为没搜 —— 对照 `d9fefb4` 那次同一位置抓到的是 `[request] 向 api.<网关>.sslip.io 发起搜索请求(model=gemini-3.8-flash-high)`。**其余冒烟**:五个 Tab(`/` `/notes` `/skills` `/source` `/about`)+ `/rss.xml` + `/api/agent/tools` + `/source/apps/api/agent/events.ts` 全 **200**;源码快照 `current` 的 `shortSha` == `.env` 的 `IMAGE_TAG` == `e8ac83e`(329 文件 / 3,511,708 字节 / `pending: 0`,唯一一行、无 staging 残留);规则 11 / 12 两条硬约束:api 容器 `node -p process.versions.bun` = **1.4.0**、`/usr/bin/node` 与 `/usr/local/bin/node` 均不存在,MCP 客户端按 **2026-07-28** 连通(`llm_providers_list` / `websearch_providers_list` / `source_snapshots_list` 三次调用均成功)。**未验**:HTTP/3(第 17 条)、配额(第 9 条)、`agent_ro` 沙箱(第 10 条)、容器隔离第 19 / 21 条 —— `deploy/` 零改动且 runner 镜像逐层缓存命中即同一制品,本次 diff 未触及。**冒烟会话未删**(与既往同,只对当时那个访客 cookie 可见) |
| 2026-09-09 | `995dc49` | 16 | **R-CROSSLINK**(跨栏 / 跨页联动,画板 `2q` / `2r` 新文件 `Agent X-Ray Crosslink.dc.html` + 移动 `4v`–`4x`):三件事共用**一个原语**「把一句预设文本放进输入框、**永不自动发送**」—— **C1** 画板 `1b` / `4f` 上一直是死按钮的 `Ask why ↗` 做实(前端从 `TraceRow` 拼追问,`apps/web/lib/ask-why.ts` 纯函数);**C2** 会话区工具卡 ↔ Timeline 行**双向定位**(靠 `toolCallId` 对上,已定位态不新造 = 既有展开态 + `scrollIntoView`,对不上不渲染);**C3** Notes 章节页「在 Runtime 里聊这一章」经 `/?ask=` 进 Runtime(通用模板,不给章节加字段)。URL 预填**读一次即清**(`history.replaceState`)、1000 字上限超出整段丢弃、去控制字符,不写任何存储。**零后端机制**:`apps/api` 只有 `runtime.ts` 的一句系统提示条款与它的测试;**零迁移(16→16)、零 MCP 工具变动(51 不变)、零部署资产变动、零新增依赖**(不需要 `npm ci`)。codex 审查 **3 轮 / 6 条(1 P1 + 5 P2)全部采纳、零 high、末轮零 findings**。`dev.ps1 test` api **609 passed** + web `bun test lib` **56 passed**,`apps/web` 的 `tsc --noEmit` 通过。api 603 MB / web 359 MB / runner 269 MB;`docker save` tar **219 MB**,`ship` 一次成功无重传。快照 **333 个文件 / 3,584,762 字节**。**发版前拦下一处**(见下节):`ask-why.test.ts` 里两个字面控制字节让 `source-publish --check` 拒绝构建,改回源码转义后才出的这个 SHA | 无(`deploy/` 五件资产零改动;`.env` **只改 `IMAGE_TAG`**,`diff` 核到全文件仅此一行不同,备份 `~/deploy/.env.bak-pre-995dc49`) | `e8ac83e` | **冒烟 33 项 0 失败**,其中 **1 项是本轮新增判据且发版前刻意跑过基线**:`/source/apps/web/lib/ask-why.ts`(本轮新文件)在旧快照下判为「不存在」、发版后翻成「存在」—— 正向对照。**判据本身修过一次**:该文件在基线下 HTTP 也是 200(流式 404 的状态码就是 200),按状态码判会得到假 PASS,改成看 flight 载荷里的 `NEXT_HTTP_ERROR_FALLBACK;404` 才成立。既有项:十个服务的正式端点全部非 404、`/api/spike/*` 与 `/admin` 404、五 Tab 全 200、`/skills/encore-api.zip` 回 `application/zip`、`/rss.xml` 200、MCP 三种坏 token + 未认证 GET 全 **401**、`server/discover` 回 `["2026-07-28"]`、`tools/list` **51**、裸域 **301** 带路径到 www;快照 `current` 的 `shortSha` == `.env` 的 `IMAGE_TAG` == `995dc49`(333 文件 / 3,584,762 字节 / `pending: 0`,唯一一行)。规则 11 / 12:api 容器 `node -p process.versions.bun` = **1.4.0**、`/usr/bin/node` 与 `/usr/local/bin/node` 均不存在、`dpkg` 无 nodejs 包。**三条联动在生产逐条端到端实跑**(1440×900 桌面壳):C3 章节页入口 → 跳 `/` 后输入框带模板文案、`location.search` **已清空**、未自动发送;发这一轮后 Timeline 出现 `tool_call · notes_search`,展开的详情卡里 **`Ask why ↗` 与 `查看卡片 ↗` 两条都在**;点 Ask why 预填出 `在 Turn 1 里你调用了 notes_search,入参是 {"query":"agent loop"}。为什么要这么做?` —— 与所有者列在任务卡里的第一个例子**一字不差**;点「查看卡片 ↗」会话区对应卡展开(展开体里出现「在 Timeline 里查看 ↗」),把 Timeline 行折叠后再点它,行**重新展开**——双向都成立。**未验**:HTTP/3(第 17 条)、配额(第 9 条)、`agent_ro` 沙箱(第 10 条)、容器隔离第 19 / 21 条 —— `deploy/` 零改动且 runner 镜像逐层缓存命中即同一制品,本次 diff 未触及;真机移动端(需硬件,所有者裁定上线后自行验收)。**冒烟会话未删**(与既往同,只对当时那个访客 cookie 可见) |
| 2026-09-09 | `d342b18` | 16 | **R-CARDS**(会话区信息卡片,画板 `2s` / `2t` 新文件 `Agent X-Ray Cards.dc.html` + 移动 `4y` / `4z`):模型在回复正文里写 ` ```xray-card ` 围栏 + 一个严格 JSON 对象,`Markdown.tsx` 认 `language-xray-card` 画成卡片 —— **不是 pi 工具**(工具级要给 `tool_end` 帧与 `payload` 加结构字段、还得给 `2l` 折叠规则开例外)。六种 `kind` 闭集(kv / table / list / stat / compare / tabs);交互**只允许声明式**(tabs / 折叠 / 排序 / 单选),动作按钮唯一动作 = R-CROSSLINK 的预填(只放进输入框、永不发送);所有值当纯文本、上限逐条闭合、任一不符**整卡回落成代码块**;流式期间围栏未闭合先画骨架;**只在会话区开**(Notes 不开)、每次回复最多两张。**零迁移(16→16)、零 MCP 工具变动(51 不变)、零部署资产变动、零新增依赖**(`apps/api/package.json` 未动,不需要 `npm ci`);`apps/api` 侧只有 `runtime.ts` 一段提示词 + 两个测试文件,`deploy/` / `runner/` / `tools/` 相对 `995dc49` 零改动。codex 审查 **4 轮 / 10 条(全部 P2、零 high):9 条采纳、1 条不采纳记 BACKLOG,末轮零 findings**。`dev.ps1 test` api **613 passed**(35 文件)+ web `bun test lib` **93 passed**,`apps/web` 的 `tsc --noEmit` 通过(**全量第一次跑有 1 条红**,是 BACKLOG 里 R-SOURCE 已记过的既存竞态 —— `sandbox` / `leak-e2e` 清空 `tool_config` 与 `source-tools` 并发,单跑该文件 9/9、重跑全量 613/613,与本轮 diff 无关)。api 603 MB / web 359 MB / runner 269 MB;`docker save` tar **219 MB**,`ship` 一次成功无重传。快照 **337 个文件 / 3,694,550 字节** | 无(`deploy/` 五件资产零改动,随 `ship` 重传同内容;`.env` **只改 `IMAGE_TAG`**,`diff` 核到全文件仅此一行不同,备份 `~/deploy/.env.bak-pre-d342b18`) | `995dc49` | **冒烟 33 项 0 失败**,其中 **2 项是本轮新增判据且发版前刻意跑过基线**:`/source/apps/web/lib/xray-card.ts` 与 `/source/apps/web/components/XrayCard.tsx`(本轮新文件)在旧快照下判 404、发版后翻成已渲染 —— 正向对照(判据看 flight 载荷里的 `NEXT_HTTP_ERROR_FALLBACK;404`,不看状态码,流式 404 的状态码就是 200)。既有项:五 Tab(`/` `/notes` `/skills` `/source` `/about`)全 200、十个服务的正式端点全部非 404(`/api/t` 是 **POST 204**、GET 405)、`/api/spike/*` 与 `/admin` 404、`/skills/encore-api.zip` 回 `application/zip`、`/rss.xml` 200、裸域 **301** 带路径到 www、MCP 三种坏 token 全 **401**、`server/discover` 回 `["2026-07-28"]`、`tools/list` **51**、快照 `current` 的 `shortSha` == `.env` 的 `IMAGE_TAG` == `d342b18`(337 文件 / 3,694,550 字节 / `pending: 0`,唯一一行)。**规则 11 / 12**:api 与 web 两容器 `node -p process.versions.bun` 均 **1.4.0**、`/usr/bin/node` 与 `/usr/local/bin/node` 均不存在、api 的 `dpkg` 无 nodejs 包;`xray-egress-filter` `enabled` + `active`。**验收 #13 的真实 provider 留证(本轮核心,本机 faux provider 补不出的那一项)**:生产 1440×900 桌面壳实跑两轮 —— ① 「用表格对比 REST / GraphQL / gRPC 三个维度」→ 模型**自己**写了 ` ```xray-card `,DOM 链是 `TABLE.xcard-table < DIV.xcard-scroll < DIV.xcard < DIV.md-chat`(是卡片,不是 markdown 表格),页面上 `pre code` **为 0**(没有回落);② 「可排序的表格 + 一个按钮」→ 第二张卡带 `action`,点「追问 Source Tab」后输入框出现「能详细介绍一下 Source 这个 tab 的功能与实现原理吗?」而 `agent_settled` 计数**不变**(预填、未发送 = R-CROSSLINK 原语),点表头行序在 `Runtime,Notes,Skills,Source,About` → `Source,Skills,Runtime,Notes,About` → `About,Notes,Runtime,Skills,Source` 间切换、`aria-sort=ascending`。同一张卡在**移动壳**(457 宽,底部 Tab Bar 四格)下 action 按钮与预填同样成立(`4y` / `4z`)。**未验**:HTTP/3(第 17 条)、配额(第 9 条)、`agent_ro` 沙箱(第 10 条)、容器隔离第 19 / 21 条 —— `deploy/` 零改动且 runner 镜像逐层缓存命中即同一制品,本次 diff 未触及;真机移动端(需硬件,所有者裁定上线后自行验收)。**冒烟会话未删**(与既往同,只对当时那个访客 cookie 可见) |
| 2026-09-09 | `2c7f174` | 16 | **R-CARDS-2**(会话区 UI 组件 2.0,画板 `2u` / `2v` 新文件 `Agent X-Ray Cards 2.dc.html` + 移动 `5a` / `5b` 新文件 `Agent X-Ray Mobile - Runtime 2.dc.html`):**A** = `xray-card` 新增 `choice`(单选 / 多选)与 `form` 两种**可回传** kind,**回传 = 发送**(单选点选项直接发、多选与表单点 submit 发),发出的文本**只由卡上可见文本与访客自己填的值拼成**、只由访客一次点击触发、走既有 composer 发送路径,发完卡进锁定态;**B** = 新围栏 ` ```xray-html `,模型写 HTML + CSS 渲染进 `sandbox=""` 的 iframe(静态档:无脚本、opaque origin、帧内 `meta` CSP 不出网、窄清洗不出链;宽 = 正文宽,高由模型声明夹到 [160, 480],≤ 16 KB)。每轮**最多两个组件**(硬限在解析器的树上数前两个围栏)、位置只在最终回答首或尾。**仍是内容级、不是 pi 工具**;**零迁移(16→16)、零 MCP 工具变动(51 不变)、零部署资产变动、零新增依赖**(`apps/api/package.json` 未动,**不需要 `npm ci`**);`apps/api` 侧只有 `runtime.ts` 一段提示词 + 两个测试文件,`deploy/` / `runner/` / `tools/` 相对 `d342b18` 零改动。codex 审查 **4 轮 / 末轮零 findings**(第 3 轮 P2 → 所有者裁定 A:「前两个围栏」改在解析器的树上数)。`dev.ps1 test` api **614 passed**(35 文件)+ web `bun test lib` **149 passed**,`apps/web` 的 `tsc --noEmit` 通过。api 603 MB / web 359 MB / runner 269 MB;`docker save` tar **219 MB**,`ship` 一次成功无重传。快照 **347 个文件 / 3,889,960 字节** | 无(`deploy/` 五件资产零改动,随 `ship` 重传同内容;`.env` **只改 `IMAGE_TAG`**,`diff` 核到全文件仅此一行不同,备份 `~/deploy/.env.bak-pre-2c7f174`) | `d342b18` | **冒烟 27 项 0 失败 + 4 项正向对照**(发版前跑过同一脚本基线,基线同样 27/27):本轮四个新文件 `apps/web/components/XrayHtml.tsx` / `ChatFence.tsx` / `lib/xray-html.ts` / `lib/remark-component-budget.ts` 在旧快照下判 404、发版后全部翻成已渲染(判据看 flight 载荷里的 `NEXT_HTTP_ERROR_FALLBACK;404`,不看状态码)。既有项:十个服务的正式端点全部非 404(`/api/t` POST **204**、`/api/trace/stream` 400=缺 `sessionId`)、`/api/spike/*` 与 `/admin` 404、五 Tab 全 200、`/skills/encore-api.zip` 回 `application/zip`、`/rss.xml` 200、裸域 **301** 带路径到 www、MCP 三种坏 token 全 **401** + 认证 GET **405**、`server/discover` 回 `["2026-07-28"]`、`tools/list` **51**、快照 `current` 的 `shortSha` == `.env` 的 `IMAGE_TAG` == `2c7f174`(347 文件 / 3,889,960 字节 / `pending: 0`,唯一一行、无 staging 残留)。**规则 11 / 12**:api 与 web 两容器 `node -p process.versions.bun` 均 **1.4.0**、`/usr/bin/node` 与 `/usr/local/bin/node` 均不存在、api 的 `dpkg` 无 nodejs 包;MCP 协议 2026-07-28。**容器隔离在重建后复核 5 项 0 失败**(本次 `skill-runner` / `skill-runner-egress` 两容器随发版重建):egress 档 `getaddrinfo('postgres')` `gaierror`、公网 `223.5.5.5:443` 可达、`169.254.169.254:80` 被挡、none 档出网 `OSError`、`/opt/skills` 只读;`xray-egress-filter` `enabled` + `active`,`DOCKER-USER` 六条内网段 DROP **按网段 `172.30.0.0/24` 匹配、不按容器 IP**(所以容器重建不失效)。**验收 #18 的真实 provider 留证(本轮核心,本机 faux provider 补不出的那一项)**:生产桌面壳实跑三条消息 —— ① 「用一张单选卡问我:想先深入了解 Runtime、Notes、Skills、Source 这四个 tab 中的哪一个?」→ 模型**自己**写了 ` ```xray-card ` 的 `choice`,DOM 是 `div.xcard[data-xray-card=choice]` + `role=radiogroup` + 4 × `role=radio`,页面 `pre code` **为 0**(没有回落);② **点第二项 Notes** → 会话区当场出现访客气泡,文本**精确等于** `你想先深入了解哪一个 Tab?: Notes`(= 题干 + ASCII `: ` + label,不含 `title` / `note` 等非可见字段),四个选项 `aria-disabled=true` / `tabindex=-1`、第二项 `aria-checked=true`(锁定态),Timeline 的 `input` 事件恰好 2 次、`POST /api/agent/ask` 网络面板恰好 **3 次**(= 我发的 3 条,**点一次只发一条、无连发**),下一轮正常作答并调了 `notes_list_series`;③ 「用一个 HTML 组件画一张 agent loop 示意图…高度 320」→ 帧渲染成功,`sandbox` 属性为**空串(0 个 token,无任何 `allow-*`)**、`referrerpolicy="no-referrer"`、无 `src`、`srcdoc` 4,946 B 里 `<meta http-equiv="Content-Security-Policy">` **在任何模型内容之前**(`metaCount=2` = charset + CSP)、帧内无 `script` / `img` / `link` / `form` / `input` / `button` / `on*` 属性 / 任何 `http(s)://` URL,`<style>` 与内联 `<svg>` 保留,高度 **320**(模型声明值,落在 [160,480] 内),`pre code` 仍为 0。**出网为零**:整轮 `read_network_requests` 46 条请求**全部指向 `www.kzgai.cloud` 自身,零第三方**。**未验**:HTTP/3(第 17 条)、配额(第 9 条)、`agent_ro` 沙箱(第 10 条)—— 本次 diff 未触及;真机移动端(需硬件,所有者裁定上线后自行验收)。**冒烟会话未删**(与既往同,只对当时那个访客 cookie 可见) |

### 发版前拦下:合并进 `main` 的测试文件里有两个**字面**控制字节(2026-09-09,`995dc49`)

`dev.ps1 build` 在 `source-publish --check` 处停下,只报一行:

```text
source-publish: 1 个文件不合规:
  apps/web/lib/ask-why.test.ts:含 NUL,不是文本文件 —— 加进 rules.mjs 的排除项
```

R-CROSSLINK 写那条用例时,源码里本该是转义序列的 `\u0000` 与 `\u007f` 被工具入参**解码成了真实字节**
写进文件(用户级 `~/.claude/CLAUDE.md`「本机 Windows 环境」记过这个坑)。**它躲过了本轮全部既有关卡**:
`bun test lib` 56 passed、`tsc --noEmit` 通过、codex 三轮审查零相关 findings —— 因为字面 NUL 与 `\u0000`
在 TS 里就是同一个字符,跑起来一字不差。**唯一照出它的是 R-SOURCE 的「只收文本」判据**,而那道判据
在构建期就跑(`dev.ps1 build` 的第二道 `--check`),所以拦在了镜像之前而不是发布之后。

处理:改回源码转义形式(运行时语义不变,`bun test lib` 仍 56 passed),**不加进 `rules.mjs` 的 `EXCLUDE_PATHS`**——
那张表是给「内容故意带 NUL 的夹具」用的(`apps/api/notes/notes.test.ts` 是唯一一条),
而这里只是字符串字面量的写法问题,列进去等于把一个笔误固化成豁免。发版 SHA 因此从 `1d872f8` 变成 `995dc49`。

**顺带扫了一遍全仓**(`git ls-files` 逐字节):除两个二进制资产目录与那条有意的 NUL 夹具外,
只剩 `apps/api/agent/imagegen.test.ts` 里一个 `0x07`(BEL)——它不触发「含 NUL」判据、不拦构建,
按「跨轮次发现的问题不当场顺手改」未动。

### MCP 2026-07-28 的逐请求契约:`_meta` 键名是 camelCase,而且要带 `Mcp-Method` / `Mcp-Name` 头(2026-09-09 冒烟时实测)

本次冒烟脚本在 MCP 三项上连红三次,三次都是**脚本自己没按契约发请求**,不是端点坏了。按踩到的顺序:

1. `_meta` 用了 `io.modelcontextprotocol/protocol-version` 与 `supported-protocol-versions`(kebab-case)→ handler **静默**落到 2025-11-25 的
   legacy 路径:`tools/list` 照常回 51 个工具、`server/discover` 却回 `-32601 Method not found`。正确键名是 camelCase 的
   `protocolVersion` / `clientCapabilities` / `clientInfo`(`rounds/round-10/checklist.md` §9 记着,CLAUDE.md 也指向那里)。
2. 键名改对之后**两个方法一起变 400**,`-32020`:`the body names method tools/list but the required Mcp-Method header is absent`。
   2026-07-28 要求请求头与请求体一致,每个请求都要带 `Mcp-Method: <method>`。
3. 补了 `Mcp-Method` 后 `tools/call` 仍 400:`the body carries params.name="…" but the required Mcp-Name header is absent` ——
   `tools/call` 还要再带一个 `Mcp-Name: <工具名>`。

**为什么以前没撞见**:`.mcp.json` 注册的客户端自己按契约发;历次冒烟脚本要么只测 `tools/list`(legacy 路径下照样通),
要么直接用 MCP 客户端。这三个头的记载在 `apps/api/mcp/README.md`(正本)里没有,补进正本记 BACKLOG。

### R-SOURCE 首次发版:快照发布这一步为什么必须手动补一次(2026-09-08)

`dev.ps1 ship` 末尾会自动把源码快照经 MCP 发进库,但**发的是当时还在跑的那一版 api**。本次是 `source_*` 五个工具
第一次进生产,旧 api(`0db08dd`)上没有它们,于是脚本按设计报 `Tool source_snapshot_begin not found`、只警告不中止
(镜像已送达,不因快照拦发版)。两个附带现象值得记:

1. **`ship` 因此以非零码退出**,看着像整条命令失败,其实前面的 `docker save` / `scp` / 远端 `docker load` 三步都成功了
   —— PowerShell 脚本的退出码取最后一个原生命令。判据是远端 `docker images | grep <sha>` 有三行(api / web / runner),
   以及 `~/xray-<sha>.tar` 已被脚本自己清掉。
2. 发布脚本的 node 进程在 Windows 上退出时会打一条 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`(libuv)
   的噪音,**与发布结果无关**,别当成发布失败的证据。

`compose up` 起新版之后补跑 `dev.ps1 source-publish agent-xray-prod-deploy <sha>` 即可(本次一次成功,`/api/source` 随即 200);
**此后每次 `ship` 自动发**,这条只对「新增了 MCP 工具的那一次发版」成立。

### 上一版 `be6c074` 漏掉的一处:选中行背景透光,删除按钮未划开就露着(2026-09-08 所有者验收时报障)

**是 R-MOBILE 本轮引入的缺陷,不是既存问题**,当日以 `0db08dd` 修复。记在这里是因为**它暴露的是验收方法的缺口,不只是一行样式**。

- **为什么本机与生产的自动化验收都没照出来**:我这一轮的移动端判据是「每屏 `body.scrollWidth === innerWidth`、
  Tab Bar 挂载、关键控件在位」——**全是与状态无关的整屏几何量**。而这个缺陷只在**选中态**的那一行上出现
  (未选中行的 `var(--bg)` 不透明,一切正常),自动化跑过的那几屏里选中行恰好没进视野。
  **整屏几何判据查不出「某一种状态下某一行画错了」。**
- **codex 五轮也没报**:diff 里那一行写的是 `background: s.id === selected ? "rgba(37,99,235,0.06)" : "var(--bg)"`,
  单看语法与色值都对;要发现它得同时把「删除按钮是常驻绝对定位元素、靠这一行盖住」这个上下文接上。
- **同类位置已一并核过**:`SkillDetail.tsx:269` 用同一个色值做文件树选中态,但它底下没有被遮的元素,不受影响;
  `TimelineView` / `LifecycleMap` 的同色值同理。移动端组件里另外两处 `rgba(0,0,0,0.22)` 是遮罩,本就该半透明。

### 冒烟新增判据查出一处**既存**泄露:轨迹流带出搜索网关 host 与模型名(2026-09-07,`d9fefb4` 发版当日)

**不是本轮引入**,也不是回归 —— 本次把「7 项扩展脱敏」第一次也对 `/trace/stream` 跑了一遍,才把它照出来。发版照常收口,记 `rounds/BACKLOG.md` 等所有者裁定。

- **现象**:凡是触发了 `web_search` 的一轮,访客自己的 `/api/trace/stream` 回放里有一帧
  `tool_execution_update`,`partialResultPreview` 原样带着
  `[request] 向 api.<网关地址>.sslip.io 发起搜索请求(model=gemini-3.8-flash-high)` ——
  **搜索网关 hostname(含其 IP)与模型名都在里面**。
- **位置**:`apps/api/agent/websearch.ts:314` 的 `progress("request", …)`,
  把 `new URL(cfg.baseUrl).hostname` 与 `cfg.modelId` 直接拼进阶段文案。
- **引入时间**:R-WEBSEARCH 的 `4c353fb`,即该文件建立的那一版;自生产首发 `5bd6ace`(2026-09-02)起一直在线。
- **`/agent/ask` 那条流是干净的**(本次实测 0 次):泄的只有轨迹流这一条。
- **历次冒烟没查到的原因是判据缺口,不是漏跑**:7 项扩展检查(含 `sslip.io`、任何 `gemini` 模型名、
  `cliproxy` provider 名)此前**只对 `/agent/ask` 做过**;`/trace/stream` 那侧只查字面词 `baseUrl`
  ——而泄出去的是 baseUrl 的**值**,字面词自然 0 次。**判据查的是词还是值,差别就在这里**。
- **违反的约束**:规则 8 的 R-TOOLS 修订(Tools 面板**不显示** provider 与 model 名,「公开即泄配置面」)与
  规则 9(SSE 推送前白名单 sanitize)。不含凭据 —— key 没有泄。
- **暂不动手的理由**:属跨轮次发现,按 CLAUDE.md「跨轮次发现的问题写 `rounds/BACKLOG.md`,不当场顺手改」;
  且改哪一档(删 host 与 model / 只留「已向搜索网关发起请求」/ 给 sanitize 加值级白名单)是所有者的方案裁定,
  不在发版收尾里自行决定。
- **已于 2026-09-08 `e8ac83e` 修掉(R-LEAK)**:所有者当日裁定「修」,取 BACKLOG 三档的 ①(固定文案),
  与 `model_select` 派生字段那条同轮。落地时发现**同族还有第三条**(`web_search` 结果的 `details` 带 `{provider, model}`)——
  是新写的集成探针抓的,静态排查没照出来。发版当日的值级冒烟:六个配置值 × 两条流 **0 命中**(见上表 `e8ac83e` 行)。
  **判据本身也一并改了**:冒烟第 8 条从「查字面词」改成「拿当前配置的值去 grep」,这条通道以后再回归会被当场照出来。

### `google_search` 线打开(2026-09-07,`d59407a` 发版当日;当天定在 `gemini-3.8-flash-high`)

发版并过完冒烟之后按 `rounds/round-gsearch/round-gsearch.md`「本轮实测 · 发版后要用它」那条做。
`web_search` 的 `tool_config` 自 `5bd6ace` 起就是开的,所以只有配 provider 一步。

1. `websearch_provider_upsert`**新建**(不是改现行那条):`provider: "cliproxy-gemini"` · `modelId: "gemini-pro-agent"` ·
   `toolType: "google_search"` · `baseUrl` 与现行同(`https://api.64-186-228-154.sslip.io/v1`,`XRAY_WEBSEARCH_EXTRA_HOSTS` 里那个)·
   `apiKey` 同一把(掩码 `sk-…443a`)· `makeDefault: true`。回 `{"status":"created","isDefault":true}`。
   **新建而不是改现行**,`cliproxy-dmit`(`gpt-5.6-terra` + `web_search`,Responses 线)原样留着当回滚点 ——
   回滚 = `websearch_set_default{provider:"cliproxy-dmit"}` 一条命令,不用发版、不用重配 key。
2. **迁移 015 生效的直接证据**:`tools/list` 里 `websearch_provider_upsert.toolType.pattern` 从
   `^web_search(_[0-9]{4}_[0-9]{2}_[0-9]{2})?$` 变成 `^(web_search(_[0-9]{4}_[0-9]{2}_[0-9]{2})?|google_search)$`
   (发版前后各取一次对比),工具总数仍 **46**。
3. **端到端(冒烟第 16 条 ②③⑥ + 第 8 条)**,两条验收会话验后即删:
   - 「联网搜索一下 Anthropic 最新发布的 Claude 模型有哪些?列 2-3 条并给出来源链接。」→ `web_search` 被调 **2 次**
     (`durationMs` 27673 与 15769),`resultPreview` 是**综述文本**而非搜索结果列表 —— 这正是 google 线的形态
     (检索与综述都在 Google 后端完成);回答里带出 **3 条 markdown 链接来源**(`anthropic.com/news/…`),
     `done` 回 `modelRoundTrips:3 turnMs:51189 totalTokens:11753`。
   - 脱敏:两次的原始 SSE 字节里 `Authorization` / `api-key` / `sk-` 前缀 / 明文 key / `sslip.io` / `gemini-pro-agent`
     均 **0** 次。
4. **当天随即换成 `gemini-3.8-flash-high`**(所有者要求)。先配 `gemini-pro-agent` 跑通,量到它**慢一档**:
   单次搜索 15–28 s、一轮两次搜索 **51 s**(任务卡 E2E 直连网关时是 28.3 / 37.6 s,与此吻合)—— 仍在双计时器内
   (空闲 45 s / 总时长 180 s),但访客侧观感是一轮等近一分钟。换模型只发**部分更新**
   (`websearch_provider_upsert{provider:"cliproxy-gemini", modelId:"gemini-3.8-flash-high"}`),回 `"status":"updated"`,
   `toolType` / `baseUrl` / key / 两个超时 / `isDefault` **逐项保留** —— 部分更新语义当场核过。两个模型的实测对比:

   | | `gemini-pro-agent` | `gemini-3.8-flash-high` |
   |---|---|---|
   | 单次搜索 `durationMs` | 27673 / 15769 | **7971**(第二轮 10862) |
   | 整轮 `turnMs` | 51189 | **12935**(第二轮 14055) |
   | 本轮搜索次数 | 2 | 1 |
   | `modelRoundTrips` | 3 | 2 |
   | `totalTokens` | 11753 | 7452 |
   | 回答里的 markdown 来源 | 3 条 | 3 条(两轮都是) |

   **来源质量没有因为换快模型而下降**,耗时降到约 1/4。切回只需再发一次部分更新改 `modelId`。
   flash-high 那两轮的脱敏检查扩到 **7 项**(明文 key / `Authorization` / `api-key` / `sk-` 前缀 / `sslip.io` /
   **任何 `gemini` 模型名** / **`cliproxy` provider 名**)全部 0 次 —— 前一轮只查了写死的 `gemini-pro-agent`,
   换模型后那条判据会失效,已改成通用匹配。
   **grounding 真实生效的硬证据**:第二轮问「Encore.ts 最新稳定版本号」,搜回 **v1.58.4** 并给出 GitHub Releases 与
   npm 两条来源 —— 训练截止不可能知道这个版本号(本仓库钉的还是 1.57.13)。
5. **一次自己的失误值得记**:首轮端到端的 prompt 写成「2026 年 9 月第一周有哪些 AI 新闻」,模型按自己的训练截止
   判定「该日期尚未发生」,把 grounding 回来的内容当成「推演/虚构预测类综述」而拒绝给来源 —— 链路其实是通的
   (`tool_start`/`tool_end` 各一、37.3 s),**是 prompt 把验收判据带偏了**。验实时检索能力时别把「未来日期」写进问题,
   换中性问法即可。
### `web-fetch` 打开(2026-09-04,`2c503d3` 发版当日)

发版并过完冒烟第 21 条 ①②③ 之后按任务卡「运维」段打开。`skill_load` / `skill_run` 双闸自 `c1ee245` 起就是开的,所以这一步做完即生效。

1. **先推 skills-hub**(所有者当日授权):`runner/skills/web-fetch/` 三个文件作为 `web-fetch/` 目录推到 `ClickPM/skills-hub` main(`cfc317d..b85ec5e`),README 目录表加一行、`xray.json` 说明句从只提 `text-tools` 改成覆盖两个。入库 blob 逐个核过是 LF 且 sha256 与仓库源一致 —— **站内安装命令由 `repo` 派生,不推就是假的**;`skills_upsert` 的 `repo` 是必填项,「先不填 repo」这条退路在 schema 上不存在。
2. `skills_upsert` 整包上传三个文件(`created`,3 文件 31601 字节,zip 14250),`categorySlug: workflow`(分类闭集里没有「自研 · 工具」,同为沙箱可执行的 `text-tools` 也在 workflow)、`sourceType: own`、`sortOrder: 8`、`repoUrl` 指向 skills-hub 的 `web-fetch` 目录。**26 KB 的 `fetch.py` 走脚本读文件发 MCP,不经上下文转手**。
3. `skills_agent_status` → `web-fetch` `inLibrary: true` / `consistency: ok` / `network: egress`;`skills_agent_set web-fetch true`。
4. **端到端(第 21 条 ④)**,四个用例都在生产实跑、验后删会话:
   - `https://www.kzgai.cloud/about` → `skill_load` → `tool_call · skill_run`(web-fetch / fetch.py)→ `tool_execution_update ×3`(validated / submitted / finished)→ `tool_result`,`exit=0 · 2087ms`,回复三句来自正文;`before_agent_start` 的 `skills` 数组里已含 `web-fetch`。
   - `https://en.wikipedia.org/wiki/Server-side_request_forgery`(任务卡原用例)→ **`E_UNFETCHABLE`、`isError: true`、5434ms**,慢路径多一帧 `[running] 运行中 5s`。**原因是这台服务器在境内、维基百科不可达**(容器里 `en.wikipedia.org` 解析到 `199.59.148.20`,不是维基的真实地址);模型按 SKILL.md 降级:说明读不到,再用自身知识回答并声明了这一点。短码经 `failureShortCode` 附在固定失败文案后,接缝生效。**这条用例不适合当生产验收判据**,换境内可达的页面。
   - `https://169.254.169.254/latest/meta-data/` → 模型读过 SKILL.md 后**在调用前就自己拒了**,不进 `skill_run`(工具侧的 `E_BAD_URL` 由第 21 条 ③ 的直连 socket 用例证实)。
   - `http://example.com` → 模型**没触发 `E_BAD_URL`,直接改用 `https://example.com` 调用**并成功(`exit=0 · 2421ms`)—— 比预期的「先失败再重试」更好一档。
5. **止损实测**:`docker compose stop skill-runner-egress` 之后,web-fetch 以「执行容器当前不可用,本轮无法运行脚本;请基于已有知识回答,并说明这一点。」失败(`isError: true`,3ms 快速失败),同一状态下 `text-tools` 经 none 档照常执行;`up -d` 恢复后 web-fetch 立即恢复(`exit=0 · 1818ms`)。`skills_agent_set web-fetch false` 单个下线未实测(与 `text-tools` 同一代码路径,`c1ee245` 当日已验)。

> **冒烟时发现的一处防线缺口(所有者当日裁定:照原计划打开,缺口记 BACKLOG)**:`deploy/egress-filter.sh` 的六条 DROP 写在 `DOCKER-USER`,
> 而那是 **FORWARD** 链的第一跳 —— 容器发往**宿主自身地址**(`10.0.0.5` 是 eth0,`172.30.0.1` / `172.17.0.1` 是网桥网关)的包在本机交付、走 **INPUT**,
> 那六条看不见。实测 `skill-runner-egress` 可连 `10.0.0.5:22`(sshd),而 `-> 10.0.0.0/8` 那条规则计数为 **0**;转发出去的流量(`169.254.169.254`、
> 内部网络上的 api / postgres)确实被挡住,规则本身没写错,是覆盖面少了「宿主本机」这一类目的地。宿主 `0.0.0.0` 上的监听只有 22 与 80/443,
> 所以能够到的是 sshd 与站点自身。另两层防线完好(`fetch.py` 在名字/地址层拒私网段并钉 IP 连、只走 https/443;容器不在 `front`/`back`),
> 要踩到得先有一个 `fetch.py` 地址校验的绕过。详见 `rounds/BACKLOG.md`。

> 另:本次验收留下一条测试会话 `dc201b10-765a-4608-a632-04635cdf15d4`(标题「概览网页内容」)—— 那一轮的输出被 `sed` 截断,脚本在 DELETE 前收到 SIGPIPE;
> 生产库的 `DELETE` 被本机 auto 模式拦下,未清。它只对当时那个访客 cookie 可见(R-VISITOR 隔离)。

### R-SKILLS-2 双闸打开(2026-09-03,`c1ee245` 发版当日)

按 `rounds/round-skills/round-skills-2.md`「运维」段的顺序做完五步,四个 skill 对 agent 可用:

1. **对齐展示副本**(不对齐 `consistency` 就不是 ok,不会被注入):`text-tools` 生产没有 —— 先推到
   [`ClickPM/skills-hub`](https://github.com/ClickPM/skills-hub/tree/main/text-tools)(`cfc317d`,自研 skill 的既定出处,
   站内安装命令由 `repo` 派生,不推那条命令就是假的)再 `skills_upsert` 上传 4 个文件;`encore-api` /
   `encore-database` / `encore-testing` 各只有 1 个 SKILL.md 且是 **CRLF**(上传源 `.claude/skills/` 被 `core.autocrlf`
   写成了 CRLF,而哈希按字节算),整包重传 LF 的 SKILL.md + 上游 Apache-2.0 `LICENSE`,两处漂移一起修掉
2. `tool_config_set skill_load true`
3. `skills_agent_set` 四个全 true → `skills_agent_status` 四个 `consistency: ok` / `available: true`
4. 服务器 `.env` 加 `XRAY_UNLOCK_DANGEROUS_TOOLS=1` → `docker compose up -d api` 重建(env 变了 `restart` 不生效)
5. `tool_config_set skill_run true`

**冒烟清单第 20 条(端到端)逐项留证**,四个测试会话验后即删:

- ② 「用 text-tools 统计词频」→ `skill_load` → `skill_run(wordfreq.py)` **exit=0 · 117ms**,回复给出正确词频,一轮 12s
- ③ 拦截:直接问「跑 `scripts/rm.py`」**触发不了 guard** —— `skill_load` 已把 SKILL.md 送进上下文,
  模型自己就回「只开放了两个脚本」。要让 guard 真的裁决得走**入参不过 schema** 那条(`top=999`,上限 50)。
  轨迹里是验收要的形状,且**全程没有 `tool_result`**(同一条流里另两个成功工具各有一条):

  ```text
  seq=101 tool_execution_start  skill_run
  seq=102 tool_call             skill_run  handlers=[{"extension":"xray-guard","returned":{"block":true,"reason":"字段 top 不能大于 50"}}]
  seq=103 tool_execution_end    skill_run  isError=True
  ```

  `durationMs: 0` 说明请求根本没到执行容器
- ④ `/agent/ask` 与 `/trace/stream` 原始字节里 `/run/runner` / `unix:` / `runner.sock` / `MAX_RUNS` /
  `Authorization` / `api-key` 均 **0** 次;`/api/agent/tools` 里唯一的 `limit` 命中是 `notes_search` 的公开
  入参 schema(`maximum: 20`),不是限额
- ⑤ 止损:`tool_config_set skill_run false` 之后**新会话**里 agent 只剩 `session_rename` + `skill_load`,
  明确回「当前会话未提供 `skill_run`」;开回来即恢复

> **别拿 `/api/agent/tools` 判「工具关掉了没有」。** 它是**静态**目录,`catalog.ts` 开头就写明刻意不读
> `tool_config`(「回答的是这个 agent 具备什么能力,与有没有正在运行的会话无关」),
> 所以关掉的工具照样列在面板上。第 20 条 ⑤ 的唯一判据是**会话里实际拿到的工具集**,
> 本次先按 catalog 判过一次,是错的。

### `da10f6e` 那条「构建修复」是什么(2026-09-03,发版前拦下)

R-TABS 新增了 `apps/api/site/` 服务,但没同步 `dev.ps1` 的 `$hostedServices`。按 `459b168` 直接构建,
后果**比通常的「漏补服务 = 该服务端点 404」重一个量级**:`apps/web/app/(site)/layout.tsx` 每次渲染都调
`visibleTabKeys()`,而 `apps/web/lib/tabs-server.ts` 明确**不为取数失败兜底**(兜成「全部可见」会让一次
后端抖动把所有者刚藏起来的 tab 重新露出来)——所以表现是**整站每一页 500**,而镜像构建成功、容器
healthy、`/health` 200,没有任何一处会报错。

`deploy-environments.md` 的冒烟清单第 1 条(「服务白名单逐项可达」)本就是为这类漏补设的,但它跑在部署**之后**;
这次是在构建前读 diff 发现的。**新增 Encore 服务时,`dev.ps1` 的 `$hostedServices` 与轮次任务卡的改动清单要一起过。**

### 首批 skill 内容(2026-09-03,`789007e` 发版当日)

19 个,分三类出处;**发布前逐个看 LICENSE**:

| 出处 | skill | 判据 |
|---|---|---|
| `encoredev/skills`(curated) | encore-api / auth / database / frontend / secret / service / testing / code-review | `.claude/skills-lock.json` 记的 source |
| `anthropics/skills`(curated) | skill-creator | 该 skill 目录内是 **Apache 2.0** |
| `kepano/obsidian-skills`(curated) | obsidian-bases | 与上游**逐字节一致**,不重复托管 |
| `ClickPM/skills-hub`(own) | defuddle · obsidian-markdown · obsidian-cli(三个改自 `kepano/obsidian-skills`,MIT)· diagram · ppt-master(文档面精简包)· wiki-init / compile / lint / query | 所有者裁定:没有公开出处的自研 skill 新建 `skills-hub` 公开仓库承接,再挂它 |

**「来自官方仓库」要逐文件比对,别信记忆**(2026-09-03 实测):所有者说 `defuddle` / `obsidian-markdown` /
`obsidian-bases` 三个都来自 Obsidian 官方的 [`kepano/obsidian-skills`](https://github.com/kepano/obsidian-skills)(MIT)。
`git clone` 上游逐文件 diff 之后:**只有 `obsidian-bases` 逐字节一致**,另外两个本机已改过(加了项目路径约定、
本机实测结论、工作文档示例)。**照「上游原版」发会把本机改动当上游内容发出去,照「自研」发又抹掉上游署名** ——
两种错法都靠这次 diff 才拦住。改动版按所有者裁定发,包内带上游 `LICENSE` 与 `## Attribution` 段(MIT 要求)。

**公开前要洗的不止路径**:这批里洗掉了绝对路径(`D:/…/.claude/skills/diagram/scripts`)、vault 名、
私有 vault 统计(2710 files / 1669 orphans 这类)、拿内部文档章节标题当示例的行、「本机实测」措辞。
仓库那边还把首个提交的 author 邮箱从个人 gmail 改成 GitHub noreply 后 force-push(公开仓库的 commit 元信息也是个人信息)。

**没发的四个,理由要记住**:

- `xlsx` / `docx` / `pdf` —— 目录内 `LICENSE.txt` 是 Anthropic 专有条款,明文禁止
  *Distribute, sublicense, or transfer these materials to any third party* 与 *retain copies outside the Services*。
  站点托管副本 + 提供 zip 下载正是这两条禁止的行为,**不发**。(这三个在 `anthropics/skills` 公开仓库里也有,
  但「仓库公开」不等于「许可允许再分发」,判据是 skill 目录内的 LICENSE,不是仓库可见性。)
- `ppt-master` —— 整包发不进去(158 个可收文件 / 1.9 MB,超 64 文件与 512 KB 上限;更根本的是
  `templates/icons` 的 11,820 个 **SVG 在闭集之外,提上限也进不来**)。所有者裁定发**文档面精简包**
  (`SKILL.md` + `references` + `workflows` + `.env.example` + `requirements.txt`,23 文件 / 296 KB),
  完整版指向 GitHub。**推公开仓库前拦下一件事**:`templates/layouts/` 里 22 个版式有 12 个带具名机构的品牌资产
  (雇主的 logo 位图 + 写明「复刻自内部材料」的 design_spec、几家国内企业与高校、几家外企风格版式)——
  所有者裁定 **`templates/` 整个不推**。
  **这条差点漏掉的原因值得记**:此前那遍「个人信息扫描」的 pattern 是**大小写敏感**的雇主名两种写法,
  而目录名用的是全小写的同一个词,中文机构名更是从没进过 pattern。
  扫公开前的资产要 `grep -i` 并把**目录名**也纳入(`find`),只扫文件内容会漏。
- `okf-visualizer` —— 86% 体积是第三方 `vendor/force-graph.min.js`,而它的许可文件叫
  `force-graph.LICENSE`(不是 `LICENSE`)会被扩展名闭集剔掉;所有者裁定不发。

平台还会静默剔掉 **HTML**(闭集里没有):`skill-creator` 的 `assets/eval_review.html` 与
`eval-viewer/viewer.html` 因此不在站内包里,zip 解出来的 eval-viewer 是不完整的。

### 合并轮次分支后,发版第一步是 `npm ci`(2026-09-03 实测,`789007e`)

`round-skills` 在 worktree 里加了新依赖 `fflate`(`apps/api/package.json` + lockfile)。合并回 `main`
之后主工作区的 `node_modules` 里**没有**它,`dev.ps1 check` 直接崩在 parser 上:

```text
check: failed to start app: error: unable to resolve module fflate: failed to get the node_modules path
  --> apps/api/shared/skill-pack.ts:18:1
```

看着像编译错误,其实只是依赖没装。**轮次分支动过 `apps/api/package.json` 时,合并后发版前先在 `apps/api` 跑一次 `npm ci`**
(`encore build docker` 同样要打包 `node_modules`,漏装会一路带到镜像里)。判据:`git diff <上一个发版 SHA>..HEAD -- apps/api/package.json`
有输出就要装。

### SSH 传输:密集重连会把自己关在门外(2026-09-03 实测)

本次 `dev.ps1 ship` 的 scp 传到 67/156 MB 被 `Connection reset` 打断。**接下来的处理方式才是教训**:
用「每轮两条 SSH、失败立刻重来」的续传循环去补,几分钟内堆了十几条未完成认证的连接,于是
**sshd 停止回应 banner**(`kex_exchange_identification: read: Connection timed out`)——而 TCP 22 仍能三次握手、
443 与站点全程正常、`ping` 107 ms、load 0.02。**这个组合是「连接级限流」的指纹,不是宕机**,停手约 3 分钟自动放行。

两条口径:① 重传要**低频**(退避 ≥ 90s、总次数个位数),别用紧凑循环;
② **续传脚本必须防 `stat` 拿不到大小**——本次那个脚本在限流期把 `HAVE` 取成空串,
`tail -c +$((HAVE+1))` 退化成 `tail -c +1`,把整个文件又追加了一遍,远端 tar 涨到 204 MB。
**sha256 比对是唯一发现它的手段**,任何形式的续传都必须带。

## 130 预发(192.168.100.130,http,可选环境)

保留为预发环境,**有需要时先在这里发版验证,不是发生产的前置**(所有者裁定 2026-09-03);SHA 允许落后于生产。

| 日期 | SHA | 迁移 | 内容 | 留证 |
|---|---|---|---|---|
| 2026-09-01 | R9 v1 / v2 | 6 | 首次 compose 部署 + 升级 / 回滚演练(两个镜像刻意有可见差异:构建修复 → 字体自托管) | [round-09 冒烟留证](../rounds/round-09/smoke.md) |
| 2026-09-01 | `4b572c1` | 6 | 修补第一批:聊天区 markdown 渲染、站点图标 | ROUNDS.md 修补记录 |
| 2026-09-01 | `5c98b3e` | 6 | 修补第二批:导航条 logo、Timeline 贴底跟随;R10 上线前检查单 1–11 项在此形态留证 | [round-10 检查单](../rounds/round-10/checklist.md) |
| 2026-09-01 | `7cc17fe` | 6 → 7 | R-VISITOR 访客隔离(迁移 007),8 项冒烟全过 | [round-visitor 任务卡](../rounds/round-visitor/round-visitor.md#130-预发部署留证2026-09-01) |

此后 R-WEBSEARCH(008)/ R-TITLE(009)/ R-TOOLS / R-IMAGEGEN(010)**均未上 130**,直接随生产发版验证。
