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

### `da10f6e` 那条「构建修复」是什么(2026-09-03,发版前拦下)

R-TABS 新增了 `apps/api/site/` 服务,但没同步 `dev.ps1` 的 `$hostedServices`。按 `459b168` 直接构建,
后果**比通常的「漏补服务 = 该服务端点 404」重一个量级**:`apps/web/app/(site)/layout.tsx` 每次渲染都调
`visibleTabKeys()`,而 `apps/web/lib/tabs-server.ts` 明确**不为取数失败兜底**(兜成「全部可见」会让一次
后端抖动把所有者刚藏起来的 tab 重新露出来)——所以表现是**整站每一页 500**,而镜像构建成功、容器
healthy、`/health` 200,没有任何一处会报错。

`deploy-environments.md` 的冒烟清单第 1 条(「服务白名单逐项可达」)本就是为这类漏补设的,但它跑在部署**之后**;
这次是在构建前读 diff 发现的。**新增 Encore 服务时,`dev.ps1` 的 `$hostedServices` 与轮次任务卡的改动清单要一起过。**

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
