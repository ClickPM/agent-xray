# Round IMAGEGEN — agent 生图工具(第二个外呼组工具)

<!-- 命名轮,先例见 rounds/round-websearch / rounds/round-title;拆解以 ROUNDS.md 的「R-IMAGEGEN」段为准。 -->

> 状态:已完成,已合并 `main`(2026-09-02 开工、当日收口并合并;分支 `claude/agent-xray-image-generation-3c1bb5`,提交 `f0cf072` → `2b57656` → `0612bf2` → `98d4da6`)。**所有者裁定:与后续更新一起发生产**;届时配 provider 后跑验收 #17 的外呼半边
>
> 参考实现是 pi 的 `image-generation` 扩展(`~/.pi/agent/extensions/image-generation.ts`:
> 两个工具各打一条生图链路,图片落盘到 workspace,凭据读 `models.json`)。
> **三处都不能照搬**,原因写在「范围裁定」表里。

## 目标

给 pi agent 加一个 `generate_image` 工具:根据一段文字描述,经服务端持凭据的生图网关生成**一张**图片,
图片存进 Postgres、由受访客归属保护的端点供图;**访客在对话框里直接看到这张图**;
端点 / 凭据 / 协议形态 / 限额经 **MCP 管理面**配置(与 LLM、搜索 provider 同一套形态);
生成的**过程**在右栏三视图里看得见。

可证伪:配好 provider 并开启工具后,对 agent 说「画一张…」,
① 对话区助手回复里出现一张真实渲染出来的图片(不是一行地址);
② 右栏 Timeline 出现 `tool_execution_start · generate_image` → `tool_execution_update · generate_image ×N` → `tool_execution_end · generate_image`;
③ 换一个浏览器(没有该访客 cookie)直接打开那张图的地址是 404;
④ SSE 原始流与 `/agent/tools` 响应里搜不到 key / baseUrl / model。

## 前置

- R6(MCP 管理面 + `ConfigEncryptionKey`)、R7(`tool_config` / `daily_quota`)、R-WEBSEARCH(外呼组六条约束 + 域白名单 + 双计时器)、
  R-TITLE(会话绑定工具 + NOLOGIN 角色 + 列级/表级授权)、R-TOOLS(META 常量 + 目录派生)均已合并 `main`
- 需要一个**目标域白名单内**的生图网关凭据(所有者的 CLIProxyAPI 网关;R11 已把它的域加进搜索白名单的 env 追加项,本轮同款再加一次),经 MCP 写入,不入 Git
- 本机 Docker Desktop 已启动(`dev.ps1 test` 要本地 Postgres);worktree 里 `npm ci` ×2 + 复制 `.secrets.local.cue`

## 范围裁定(开工前确认,写在这里免得后面反复)

| 问题 | 裁定 | 理由 |
|---|---|---|
| 规则 8 是否被触发 | **两半**:工具本身**否**,对话框预览**是所有者裁定的例外** | 工具:`docs/security.md` §1 开篇与第 4 层从第一天起就写着「后续生图、联网搜索等插件」「外呼型工具(LLM / 生图 / 搜索)」,与 R-WEBSEARCH 同为**补齐既定边界**;Tools 面板(1f/1g)按后端目录渲染,新工具自动出现。预览:画板 1a–1e 的聊天区没有画过图片,但助手回复渲染器(`Markdown.tsx`)本来就有 `img` 一项(画板 2c 的正文配图样式,聊天区复用),**前端一行不改**就能显示 —— 所有者裁定「支持在对话框里直接预览图片」,落点是「助手回复里的 markdown 图片」这条已有通路,不新造气泡与组件 |
| 一个工具还是两个(参考插件是两个) | **一个 `generate_image`**,协议形态 `api_style` 是 provider 的**配置字段** | 插件的两个工具差异只在**线上协议**(`/images/generations` 的 `data[].b64_json` vs `/chat/completions` 的 `message.images[].image_url.url`),那是 provider 的属性不是能力的属性;本站 provider 表是「唯一默认」语义,两个工具等于要同时激活两个 provider。代价:`runImageGen` 内部按 `api_style` 分两条解析路径(与 R-WEBSEARCH 的「零分支」不同,但白名单 / 计时器 / 字节上界 / 脱敏 / 重定向拒绝这些**安全性质是一份实现**) |
| 访客能控哪些入参 | **只有 `prompt`**;`size` 是 provider 配置(`image_size`,可空 = 上游默认),`n` 恒为 1 | 外呼组约束 1 的最严读法:模型给的东西只落进请求体的**一个**字段。`size` 若做成入参要给 `ToolParametersSchema` 加 `enum` 关键字,面板才画得出来(R-TOOLS:「面板永远不是第二个要改的地方」)—— 属机制扩面,记 BACKLOG 待所有者裁定 |
| 图片存哪 | **Postgres `generated_images`**,不落盘 | 容器根文件系统只读(第 3 层)、工具禁止碰文件系统(第 1 层)、镜像内不烧内容(R6 裁定)—— 与 notes 配图同一个理由。行随 `sessions` 级联删除:访客删会话 / 3 天保留期到期,图一起没了 |
| 谁能看图 | **只有生成它的那个访客**(`sessions.visitor_id` 归属过滤,不匹配一律 404) | R-VISITOR 把会话内容按访客隔离,生成图是会话内容的一部分;地址是 UUID 不可枚举,但「不可枚举」不是授权。`<img>` 是同源 GET,`SameSite=Lax` 的 cookie 会带上,前端不需要做任何事 |
| 写库走哪条通道 | **NOLOGIN 角色 `agent_image`,只有 `generated_images` 的 INSERT** | 与 R-TITLE 同构:agent 侧第二次拿到写库能力,授权面由 Postgres 限死,不靠工具实现自觉。会话 id 闭包绑定(不是入参),模型表达不出「往别人的会话里塞图」 |
| 域白名单 | 独立一份 `shared/imagegen-hosts.ts`(内置只有 `api.openai.com`,env `XRAY_IMAGEGEN_EXTRA_HOSTS` 只能追加),**判据实现与搜索共用**(`shared/outbound-hosts.ts` 工厂)。**合并后所有者追加裁定(2026-09-02)**:这是个人项目,公司网关域名从两份内置清单里都删掉,搜索侧内置只剩 `api.deepseek.com`;任何自建 / 公司网关一律走 env 追加,不进代码 | 两个白名单不合一:搜索网关不该因为被列进搜索白名单就自动可以当生图端点,所有者要显式选;判据(https / 精确 host / 无凭据 / 无 query)只能有一份实现 |
| 超时默认值 | **总 180s / 空闲 30s**(库级 CHECK 上界 300s / 120s) | 生图上游在出图前**一个字节都不发**(非流式),所以空闲计时器**只在响应头到达后才起**;等头那段只受总时长约束,期间每 10s 上报一次「生成中」让 Timeline 不空转 |
| `tool_config` 初始状态 | **默认关** | 与 `web_search` 同一理由:没配 provider 本来就不会注册,默认关把它变成显式的一件事 |
| 前端是否改动 | **零改动**(规则 7) | 预览走 `Markdown.tsx` 既有的 `img`;三视图泛型渲染 `tool_execution_*`;Tools 面板按后端目录渲染。唯一变化是 `dev.ps1 gen` 重生成的 `api-client.ts`(新 raw 端点的包装,生成物) |
| 画板示例数据 | **不手改 `design/*.dc.html`** | 它们是 Claude Design 的导出存档,画板 1f/1g 的工具清单是示例数据、面板由后端目录驱动。要同步,由所有者在画布上加;这里只在「本轮实测」提一句 |

## 交付物

**文档(规则 9:先改文档)**
- `docs/security.md` —— §1 第 1 层「工具分两组」表加 `generate_image` 列 + R-IMAGEGEN 补记(外呼组第二个成员;六条约束逐条落点);第 2 层补记(`agent_image` 角色:一张表的定向 INSERT);第 4 层补记(`daily_quota.images`);§3 加 imagegen key 口径;§6 补一句「生成图按会话归属」
- `ROUNDS.md` —— 头部功能边界修订(对话框预览)+ 进度表加行 + 本轮拆解
- `CLAUDE.md` —— 规则 9 的外呼组括号里补 `generate_image` 与 `imagegen-hosts.ts`
- `rounds/round-imagegen/round-imagegen.md` —— 本卡;`rounds/BACKLOG.md` 两条(见「本轮实测」)

**后端**
- `apps/api/agent/migrations/010_imagegen.up.sql` —— `imagegen_config` 表 · `daily_quota.images` 列 · `generated_images` 表 · NOLOGIN 角色 `agent_image`(仅 INSERT)· `generate_image` 启停种子(默认关)
- `apps/api/shared/outbound-hosts.ts`(新)—— 域白名单工厂;`websearch-hosts.ts` 改为它的一个实例(导出不变);`imagegen-hosts.ts`(新)第二个实例
- `apps/api/shared/image-magic.ts`(新)—— 图片魔数判定,mcp 的附件校验与本轮的上游响应判定共用同一份
- `apps/api/shared/http-body.ts`(新)—— 带字节上界的响应体读取;`websearch.ts` 改为调用它(行为不变)
- `apps/api/shared/redact.ts` —— `redactSecret(text, secret)`;`websearch.ts` 的私有 `redactUpstream` 改为调用它
- `apps/api/agent/imagegen-config.ts` —— 运行期 imagegen 配置的只读来源(读不到回 `null`)
- `apps/api/agent/imagegen.ts` —— 外呼实现:两种 `api_style` 的请求与解析 / 域白名单 / 重定向拒绝 / 总时长 + 空闲双计时器(空闲计时器在响应头之后才起)/ 字节上界 / base64 与魔数校验 / 阶段上报
- `apps/api/agent/image-db.ts` —— 写通道(`SET LOCAL ROLE agent_image`)与按归属读取
- `apps/api/agent/images.ts` —— `GET /agent/images/:file`(`api.raw`,`sensitive`,归属过滤,ETag / 304 / `private` 缓存 / nosniff)
- `apps/api/agent/quota.ts` —— `reserveImage`(与 `reserveSearch` 同一条原子 UPSERT)
- `apps/api/agent/tools.ts` —— `GENERATE_IMAGE_META` + `makeGenerateImageTool(cfg, ctx)`;`EnabledTools.imageGen`;`loadEnabledTools` / `buildSessionTools` 各加一条路径
- `apps/api/agent/catalog.ts` —— 目录派生加 `GENERATE_IMAGE_META → outbound`
- `apps/api/agent/runtime.ts` —— `systemPromptFor` 加生图段(**必须把 markdown 图片行原样写进回复**)
- `apps/api/mcp/store.ts` + `apps/api/mcp/tools.ts` —— 四个 `imagegen_*` 管理 tool;`server.ts` 的 INSTRUCTIONS 提一句
- `deploy/.env.example` / `deploy/docker-compose.yml` —— `XRAY_IMAGEGEN_EXTRA_HOSTS`;`docs/deploy-environments.md` / `docs/deploy-cn-lightweight.md` 对应两处
- `apps/api/mcp/README.md` / `apps/api/agent/README.md` —— 工具数与端点清单
- `apps/web/lib/api-client.ts` —— `dev.ps1 gen` 重生成(生成物,不手改)

**测试**
- `apps/api/agent/imagegen.test.ts`(新;注入 fetch,不打真实网络)
- `apps/api/agent/sandbox.test.ts` / `catalog.test.ts` / `apps/api/mcp/mcp.test.ts` 增量用例

## 验收

| # | 检查 | 命令 / 期望 | 结果 |
|---|---|---|---|
| 1 | 编译与测试全绿 | `dev.ps1 check` + `dev.ps1 test` 全过,且 `npx tsc --noEmit`(api 与 web)干净 | ✅ check 通过;test **15 文件 / 372 用例全过**;api / web tsc 各 0 错误 |
| 2 | 迁移 010 可施加且幂等 | 本机 `dev.ps1` 起库自动跑;只有 CREATE / ADD COLUMN / GRANT,无不可逆语句(R11「上线期间不做不可逆迁移」) | ✅ `dev.ps1 check` 与 `dev.ps1`(encore run)两次施加均成功;语句清单肉眼核对:CREATE TABLE ×2 / ADD COLUMN ×1 / CREATE ROLE / GRANT / INSERT 种子,无 DROP / ALTER TYPE / DELETE |
| 3 | **域白名单挡得住** | 单测:非白名单 host / 后缀伪装 / 明文 http / 内嵌凭据 / 带 query 全拒;MCP 写入侧同样拒且给出能行动的理由;搜索白名单里的 `api.deepseek.com` **不在**生图白名单里 | ✅ `imagegen.test.ts`「生图的目标域白名单」段 + `mcp.test.ts`「imagegen 管理 tool 的入参 schema」段(`api.deepseek.com` 在生图侧被拒且理由含「白名单」) |
| 4 | **访客控不到网络原语** | 单测:请求 URL / headers / model / size 只来自配置;`prompt` 只进请求体的一个字段(`images` 形态是 `prompt`,`chat` 形态是 `messages[0].content`);schema 只有 `prompt` 且 `additionalProperties:false` | ✅ 「访客控不到网络原语」段(注入 fetch 逐字段断言请求)+ 工具段「入参只有 prompt」 |
| 5 | 两种协议都解析正确 | 单测:`images` 形态取 `data[0].b64_json`;`chat` 形态取 `message.images[0].image_url.url`(data URL)或 `content[]` 里的 `image_url`;只回 `url` 不回内联数据 → 失败(不抓链接);不是 JSON → 失败 | ✅ 「响应解析:两种协议」段(含「只回链接 → 失败且不发第二个请求」) |
| 6 | 双计时器与体积上界 | 单测:等响应头期间**不受空闲超时约束**、只受总时长约束;响应头之后空闲超时生效;响应体超 16 MiB 中断;解码后超 8 MiB 拒绝(与库 CHECK 同值,测试钉住) | ✅ 「超时与体积上界」段(idle 100ms < 出图 400ms 仍成功 / 等头只受 total 约束 / 头后 idle 生效 / 分块慢送不误杀 / 17 MiB 中断)+ 「代码常量与迁移 010 的 byte_size CHECK 同值」 |
| 7 | **不是图片就不存** | 单测:base64 非法 / 魔数不是 png·jpeg·webp·gif(比如一段 HTML)一律拒;声明的 data URL mime 不作数,以魔数为准 | ✅ 「解码与魔数」段(HTML 冒充 / 坏 base64 / 声明 jpeg 实为 gif 以魔数为准)+ 库级 CHECK 用例(`image/svg+xml` 与超上界都被库拒) |
| 8 | **凭据不外泄** | 单测:上游把 Authorization 头回显进错误体,错误对象里没有明文 key;进度文案里没有 key / host / model;`imagegen_providers_list` 只回掩码;`/agent/tools` 响应 grep 不到假配置的任何值 | ✅ 「凭据不外泄」段(含纯十六进制 key 与 error 字段两条)+ `catalog.test.ts` 对 `FAKE_IMG_CFG` 每个值 grep + `mcp.test.ts` 掩码用例;本机 `curl /agent/tools` 实跑 `leak? false` |
| 9 | **限额生效且原子** | 单测:`dailyImageLimit=N` 时第 N+1 次 `reserveImage` 回 false;并发不超发;被拒的次数不累加 | ✅ 「第 4 层 · 每日生图张数」段(12 并发只放 4;与 `searches` 列互不影响) |
| 10 | 未配 provider 时不注册 | 单测:`tool_config` 开着但 `imagegen_config` 空 → 丢弃并记日志;配好后 `sessionScoped` 含它、`buildSessionTools` 产出定义 | ✅ `sandbox.test.ts`「generate_image 的注册闸」段(5 项:未配丢弃 / 配好注册且明文 key 不在定义对象上 / 开关关着不注册 / 密文坏了只丢它自己) |
| 11 | 配置变更下一轮生效 | 单测:改 imagegen 配置 → `EnabledTools.fingerprint` 变化 | ✅ 同上段「改 imagegen 配置会改变指纹」(改 `api_style` 名字不变、指纹变) |
| 12 | **写面被 Postgres 限死** | 单测:以 `agent_image` 能 INSERT `generated_images`;SELECT / UPDATE / DELETE 它、读 `llm_config` / `imagegen_config` / `sessions`、写 `sessions` / `messages` 全部 `permission denied` | ✅ 「agent_image 角色」段(1 正例 + 9 条 `permission denied`;**外键检查不需要它读 sessions** 实测成立) |
| 13 | **只有生成者看得到图** | 单测:按归属读取 —— 同一访客拿到字节;另一访客 / 无访客回 null;删会话后行级联消失 | ✅ 「按归属供图」段;**本机浏览器实跑**:同一浏览器 200 / 304,无 cookie 与伪造 cookie 一律 404(见「本轮实测」) |
| 14 | 目录与实现对齐 | `catalog.test.ts`:目录 name 集合 = 两个注册表 + `web_search` + `generate_image`;`generate_image` 分组 `outbound`,带 `phases`;条目与按真实路径(假配置 + 假会话)构造出的定义逐字段相等 | ✅ 集合相等 / 分组派生 / `tool_config` 每个名字都有目录项 / 六阶段 phases / 与 `makeGenerateImageTool(FAKE_IMG_CFG, 假会话)` 逐字段相等 |
| 15 | MCP 四个 tool 可用 | 单测(store + schema):upsert 首个自动默认 / 部分更新 / `apiStyle` 只收 `images` `chat` / `imageSize` 形状 / 超时上下界与 CHECK 一致 / `idle > total` 写入前拒 / set_default / delete | ✅ `mcp.test.ts` 两个新 describe 共 11 项;`registerTools` 计数 **32** |
| 16 | 前端零改动 | `git diff --stat apps/web/` 只有 `lib/api-client.ts`(生成物) | ✅ 只有生成物(新 raw 端点包装 + 注释;slug 噪音已还原) |
| 17 | **对话框里看得到图**(本机实跑) | 配好 provider(所有者的网关)+ `tool_config_set generate_image true`,说「画一张…」:助手回复里渲染出图片;Timeline 有 `tool_execution_update · generate_image ×N`;Lifecycle 三节点点亮;换浏览器打开图片地址 404 | ◐ **前端半边 ✅**(本机用种子数据实跑:助手回复里 320×180 的图渲染出来、样式是画板 2c 的;Tools 面板新卡片自动出现)。**外呼半边 ⏳**:本机无凭据,由所有者在 130 / 生产配好 provider 后跑(步骤见「待所有者做的事」) |

## 禁止

默认继承两条:不改前端页面样式(规则 7);不加设计稿没有的功能(规则 8,本轮例外只有「对话框预览」这一条,且落点是既有的 markdown 图片渲染)。本轮另加:

- **不给工具任何形式的 URL / host / header / model 入参**;`size` 也不做入参(记 BACKLOG 待裁定)
- **不抓任何链接**:上游只回 `url` 不回内联图片数据时报失败,不发第二次请求去取图
- **不把图片内容回给模型**(pi 支持 `ImageContent`,但那是 token 与费用,且轨迹里也放不下);模型拿到的是一行 markdown
- 不把生图次数折进 `daily_quota.tokens` / `searches`
- 不在工具体内读 `process.env` / 解密 / 读配置表;不碰文件系统
- 不新增前端组件、不改 `Markdown.tsx`、不改三视图与 Tools 面板
- 不手改 `design/` 存档

## 代码审查

<!-- 完成后回填。审查路由见 CLAUDE.md「开发模式」:codex 独立审查,硬失败才降级 /code-review。 -->

- 审查方式:`/codex:review --background --scope branch`(前两轮全量;第 3 轮起 `--base <上一轮已审提交>`)
- 审查边界按 CLAUDE.md 带给审查者:只判定缺陷与严重级别,不展开设计方案;非阻塞 findings 只允许最小改动
- findings 处理:见下表(逐条:核验 → 采纳整改 / 不采纳写明理由)
- 结论:**整改后 PASS**。三轮共 3 条 findings(0×P1 · 3×P2)**全部核验属实、全部采纳整改**,没有一条以「概率低」放行;
  **第 3 轮零 findings**,缺陷门禁关闭(第 3 轮按 CLAUDE.md 收到「上一轮整改 diff」:`--base 2b57656`)

### 第 1 轮(2026-09-02,基线 `f0cf072`,全量 branch 范围;2 条 findings,0×P1 · 2×P2)

| # | 级别 | findings | 核验 | 处理 |
|---|---|---|---|---|
| 1 | P2 | 迁移 010 的 8 MiB 上界只 CHECK 了元数据列 `byte_size`,不查 BYTEA 本身:一次写错的 INSERT 填 `byte_size = 1` 就能塞进任意大的 `bytes`,而 `agent_image` 正是刻意放给 agent 侧的写面 | **属实**。「就算代码漏了也进不了库」这句在原 CHECK 下不成立 —— 代码那道(`decodeImagePayload` 与 `insertGeneratedImageAsAgent` 传 `bytes.length`)是对的,库那道是摆设 | **采纳**:CHECK 改成 `byte_size > 0 AND byte_size <= 8388608 AND octet_length(bytes) = byte_size`(命名约束 `generated_images_byte_size_check`)。迁移尚未离开本机(不在 main、130、生产),就地改 010 而不是再补一条 011;本机 run / test 两个库 `encore db reset` 后重跑。回归用例:`byte_size = 1` 配真 PNG 进不来、真实字节超上界配如实元数据也进不来、一致且在界内进得来;读 `pg_constraint` 的用例加断言 CHECK 文本含 `octet_length(bytes) = byte_size` |
| 2 | P2 | `runImageGen` 读非 2xx 错误体时 `readCapped(res).catch(() => "")` 把超时 / 超限吞成空串,再报成 `http_error`:模型拿到「生图失败」而不是「生图超时」的后路指引,日志 kind 也错;4xx 却回超过 16 MiB 的错误体报不出 `oversize` | **属实**。计时器 abort → `reader.read()` 以 AbortError 拒绝 → 被 catch 吞掉 → `abortReason` 永远用不上。**`websearch.ts` 的同款写法有同一个洞**(`readTextCapped(res, resetIdle).catch(() => "")`),跨轮次问题记 BACKLOG,不当场改 | **采纳**:只把「读体本身的普通失败」当空串 —— `ImageGenError`(oversize)与 `AbortError`(计时器 / 外部取消)原样往外抛,外层 catch 照旧把 AbortError 映射成 `abortReason`。回归用例三条:5xx 头 + 挂住的 body → `idle_timeout`;4xx + 17 MiB 错误体 → `oversize`;读错误体期间外部 signal 取消 → `AbortError` |

**codex 推理清单里提到、但未报成 findings 的两处,自查后一并处理**:①`images.ts` 对路径段裸调 `decodeURIComponent`,畸形百分号编码会抛 `URIError` 冒成 500 —— 包 try/catch 回 404(三行,不是新机制);`notes/assets.ts` / `rss.ts` 的同款写法跨轮次,记 BACKLOG。②白名单判 host 不判端口(`https://api.openai.com:8443` 会放行)—— 与搜索白名单的既有口径一致,端口仍是白名单内的那台主机,不改。

整改后:`npx tsc --noEmit` 干净;`dev.ps1 test` **15 文件 / 373 用例全过**(+1);`dev.ps1 check` 通过(本机库 `encore db reset` 后迁移 010 以新 CHECK 重新施加)。

### 第 2 轮(2026-09-02,基线 `2b57656`,仍为全量 branch 范围;1 条 findings,0×P1 · 1×P2)

| # | 级别 | findings | 核验 | 处理 |
|---|---|---|---|---|
| 3 | P2 | 图片响应 `Cache-Control: private, max-age=86400`:`private` 只挡共享缓存、**不按 cookie 分区**,同一浏览器里访客 cookie 过期 / 被清 / 换新身份之后,只要还知道地址就能直接复用缓存,归属查询根本不跑 —— 端点声明的「只有生成者看得到」在那一天里是漏的 | **属实**。我把 `private` 读成了「按用户隔离」,它的语义只是「不进共享缓存」。场景是同一台设备上的下一位使用者(共用电脑),不是跨设备,但「不可枚举不是授权」这条同样适用于「缓存不是授权」 | **采纳**,取审查者给的两条修法里更强的那条:`private, no-cache`(每次回服务端复验),而不是 `Vary: Cookie`(依赖浏览器对 Vary 的实现细节)。归属仍在 = 一次 304(强 ETag 早就有),不在 = 404。代价:每张图每次页面加载多一次轻量往返,一个会话里的图就那几张。`docs/security.md` §6 与 `agent/README.md` 同步改口径 |

审查者原文对其余部分的结论:「其余主要实现未发现明确的阻塞性问题。」

整改后实跑(本机 `dev.ps1` + curl,新建会话拿 cookie、种子图入库):带 cookie **200** 且 `Cache-Control: private, no-cache`
+ 强 ETag + nosniff;带 cookie 与 `If-None-Match` → **304**;**不带 cookie 的条件请求 → 404(不是 304)**,即缓存复验也过归属;
畸形百分号路径 `%zz.png` 被 Encore 网关先拦成 **400**,到不了 handler(第 1 轮自查加的那层 try/catch 是纵深兜底)。
`dev.ps1 test` 15 文件 / 373 用例全过,tsc 干净。

### 第 3 轮(2026-09-02,`--base 2b57656` —— 只审上一轮的整改 diff)

**零 findings。** 审查者原文:「将缓存策略改为 `private, no-cache` 会强制浏览器复验,并且归属校验发生在返回 304 之前,
能够修复同一浏览器更换访客身份后复用旧缓存的问题。未发现此次变更引入新的功能性缺陷。」

**这三轮的共同点值得记一句**:三条 P2 都是「我写的那层防线其实没在防」—— 库级 CHECK 查的是元数据不是字节、
`.catch(() => "")` 把计时器的判定吞掉、`private` 被我读成了「按用户隔离」。它们全都编译过、测试过、浏览器里也看起来对;
审查者做的事是把每一条防线的**语义**与它声称要挡的东西对了一遍。

## 失败处理

同一验收项针对性整改后连续 2 次验证仍不过 → 写 `rounds/round-imagegen/BLOCKED.md`,停下呼人。禁止放宽验收标准自我通过。

## 本轮实测

### 本机门禁(2026-09-02)

- `dev.ps1 check`:通过(迁移 010 施加成功,app 起得来)
- `dev.ps1 test`:**15 文件 / 372 用例全过**(新增 `imagegen.test.ts` 41 项 + `sandbox` 5 项 + `catalog` 1 项 + `mcp` 11 项;基线 14 文件 / 314 项);codex 第 1 轮整改后 **373**(+1 条回归用例)
- `npx tsc --noEmit`:api 与 web 都干净(门禁不跑 tsc,见 BACKLOG)
- `expose: true` / `sensitive: true` 行数:**17 = 17**(security.md §6 的不变量,新端点两行都在)
- `git diff --stat apps/web/`:只有 `lib/api-client.ts`(`dev.ps1 gen` 重生成:新 raw 端点 `image` 的包装 + 一段跟着源码走的注释;
  app slug 噪音 `936eu` → `8f65i` 三行按 BACKLOG R3/R6 先例还原)→ 验收 #16 通过

### 本机浏览器实跑:对话框里看得到图(验收 #17 的前端半边)

本机库没有 LLM / imagegen provider(所有者凭据不在本机),所以**工具本身的真实外呼**要由所有者在 130 / 生产跑;
但「图片存进库 → 助手回复里的 markdown → 前端渲染 → 按归属供图」这条通路**不需要 provider**,本机用种子数据实跑了一遍:

1. 浏览器 `POST /api/agent/sessions` 建会话(拿到 HttpOnly 访客 cookie);
2. 用 `bun` + `Bun.sql` 往本机 encore 库塞一张 320×180 的真 PNG(纯 node 生成)进 `generated_images`、
   一条含 `![…](/api/agent/images/<id>.png)` 的助手消息进 `messages`;
3. 刷新工作台、点开会话 —— **`<img>` 渲染成功**:`complete=true`、`naturalWidth=320`、`naturalHeight=180`,
   边框 1px / 圆角 7px(画板 2c 的正文配图样式,`Markdown.tsx` 的 `img` 一项,**前端零改动**);
4. 同一浏览器 `fetch` 那个地址:**200**,`Content-Type: image/png`、`Cache-Control: private, max-age=86400`、
   强 ETag、`X-Content-Type-Options: nosniff`;带 `If-None-Match` 复请求 **304**;
   同 id 换扩展名 `.jpg` → **404**;非 UUID 文件名 → **404**;
5. **无 cookie 的 curl(直连 :4000 与经 next 代理两条路)→ 404;伪造 cookie → 404** —— 「只有生成者看得到图」成立;
6. `GET /agent/tools`:六条、`generate_image:outbound`、入参只有 `prompt`、六个阶段文案齐,响应里 grep 不到
   `apiKey` / `baseUrl` / `modelId` / `api_style` / `sk-`;Tools 面板里新卡片自动出现(截图见下)。

### 踩到的坑

1. **Write 工具会把正则里的 ` ` 类转义写成字面字节**:`imageAltText` 的控制字符正则落盘后 `tools.ts` 变成
   「binary file」,`grep` 直接拒读。`sanitizeTitle` 早就把理由写在注释里(「写成 \uXXXX 转义是为了不让编辑器把
   字面量吞掉」),这次是同一坑的另一种形态。用一个 node 脚本把那一行换回转义写法,并顺手扫了全部改动文件
   (ROUNDS.md 第 229 行那个控制字符是 R9 时期就有的,不是本轮引入)。
2. **`export { x } from "…"` 不在本模块里绑定名字**:把 `magicMatches` 挪到 `shared/image-magic.ts` 后,mcp/tools.ts
   只写了 re-export,自己的调用点就 `Cannot find name`。`dev.ps1 check` 与 `dev.ps1 test` 都没拦住(它们不跑全量 tsc,
   BACKLOG 已记),`npx tsc --noEmit` 抓到的。改成 import + 同名 export。
3. **Bash 工具会折反斜杠**(memory 早有记录):heredoc 写 node 脚本时 `\\uXXXX` 到了文件里变成 `\uXXXX`,
   node 直接语法错;脚本改用 Write 工具落盘再跑。

### 与计划的偏离

- **空闲计时器的起点与 websearch 不同**(响应头之后才起),这是设计而不是偏离,但值得再说一次:
  `imagegen.test.ts` 里「idle 100ms < 出图 400ms < total 5s 仍成功」那条用例就是它的可证伪形态 ——
  把 `resetIdle()` 挪回 fetch 之前,那条立刻红。
- **四样共享原语是本轮顺手抽出来的**(域白名单工厂 / 魔数判定 / 带上界的响应体读取 / 本次 key 的精确脱敏),
  `websearch.ts` 与 `mcp/tools.ts` 各改成薄调用,行为不变、既有用例原样通过。不抽的话就是两份判据慢慢漂移
  (R-WEBSEARCH 把 `redact.ts` 下沉到 shared/ 时讲过同一个理由)。
- **`generate_image` 在 `loadEnabledTools` 里走的是 `sessionScoped` 路径而不是 `definitions`**:它既要配置又要会话 id,
  `EnabledTools` 因此多一个 `imageGen` 字段把读好的配置带到 `buildSessionTools`。R-TITLE 的 `RENAME_ONLY` 夹具补了一个
  `imageGen: null`,其余既有测试零改动。
- **catalog 的分组判据**:`generate_image` 同时是会话绑定的,但分组按「凭据从哪来」判 → `outbound`
  (面板上的分组色与组注跟着外呼组走,「访客只控 query」那句组注对它读作「只控 prompt」,组注文案是画板原文,没动)。

### 待所有者做的事(本轮交付之外)

- 在 130 / 生产的 `.env` 补 `XRAY_IMAGEGEN_EXTRA_HOSTS=<网关域名>` 并**重建 api**;经 MCP `imagegen_provider_upsert`
  (`apiStyle` 按模型选:gpt-image-* 用 `images`,gemini-*-image 用 `chat`)+ `tool_config_set generate_image true`;
  然后跑验收 #17 的后半边(真实外呼 + Timeline 六阶段)
- 画板 1f/1g 的示例工具清单要不要加 `generate_image`(BACKLOG 已记,设计存档不手改)
- BACKLOG 两条新条目:`web_search` 把 provider / model / host 带进公开轨迹流(跨轮次,不当场改);`size` 是否做入参
