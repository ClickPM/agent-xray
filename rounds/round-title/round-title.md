# Round TITLE — 会话命名工具(`session_rename`)

<!-- 命名轮,先例见 rounds/round-bun / rounds/round-visitor;拆解以 ROUNDS.md 的「R-TITLE」段为准。 -->

> 状态:**已完成**。代码与审查 2026-09-02 收口并合并 `main`(与 R-WEBSEARCH 合流,迁移改号 009);验收 #1 / #7 原交接 130,R11 跳过了 130,**两条均由所有者在生产验过**(#1 见 round-11 任务卡「全链路验收」;#7 所有者 2026-09-03 确认无问题)

## 目标

一句话:**agent 在会话首轮自己调用 `session_rename` 给本次会话起一个有信息量的标题,整个过程在右侧 Timeline 里看得见,且它的写库能力被 Postgres 限死在「本会话标题这一列」上。**

可证伪:新会话首轮结束后,左栏标题不再是首条消息的首行截断;右侧 Timeline 出现 `tool_call · session_rename` 且入参预览就是那个标题;以 `agent_title` 角色改任何别的东西都失败。

### 为什么做(所有者裁定 2026-09-01)

`sessions.title` 现在由 `store.deriveTitle` 派生 —— 首条用户消息取首行、截 40 字。真实对话的第一句几乎总是 `hi` / `你好`,于是会话列表里每一条都叫「hi」,点进去才知道是哪一段。参考实现是 pi 的 `auto-session-title` 扩展(`~/.pi/agent/extensions/auto-session-title.ts`:首条输入后另起一个 `--no-tools --no-session` 的 pi 子进程起标题)。

**形态没有照搬**:所有者裁定改成 **agent 工具**而不是服务端旁路生成。两条理由:

1. 本站的卖点是右侧内核轨迹,命名过程**必须看得见** —— 旁路生成什么都不会出现在 Timeline 里;要让它出现,就得把第二个 agent loop 的 34 个事件混进同一条轨迹流,而三视图是按 Turn 分组的,两个 loop 交织会把 Timeline 弄乱。
2. 工具形态**不新增 LLM 出网路径**:标题由本轮对话顺产,token 与费用天然落在 R7 那套 `daily_quota` 计数里;旁路子会话则要额外并进限额计数与 503 路径。

代价已认:**模型偶尔不调用**,那时标题退回现在的首行截断 —— 不比现状差,不存在回归。

从参考实现里**照抄的是提示词口径与 sanitize 规则**:一行、4–18 字、不带标点与引号、不要「新会话」「帮助」这类泛词、失败有兜底。

## 前置

- R2(`sessions` 表)· R6(`tool_config` 启停 + MCP 管理面)· R7(工具注册 / `agent_ro` 沙箱 / 限额)· R-VISITOR(会话归属)均已完成
- 规则 9:`docs/security.md` 的两处 R-TITLE 补记(§1 第 1 层、第 2 层)**先于代码**落盘
- 本机 Docker Desktop 已启动(`dev.ps1 test` 要本地 Postgres)

## 交付物

| 路径 | 内容 |
|---|---|
| `docs/security.md` | §1 第 1/2 层各一段 R-TITLE 补记:纯函数与数据面只读两条约束的**唯一例外**及其边界(规则 9,已先行) |
| `ROUNDS.md` | 功能边界第二次修订(规则 8 例外)· 进度表新行 · 「R-TITLE」拆解段 |
| `apps/api/agent/migrations/009_session_title.up.sql` | `sessions.title_source` 列 · NOLOGIN 角色 `agent_title` + 列级授权 · `tool_config` 种 `session_rename`(enabled = TRUE) |
| `apps/api/agent/title-db.ts` | 标题写通道:`SET LOCAL ROLE agent_title` + `statement_timeout`,与 `ro-db.ts` 同构但**不是** `READ ONLY` 事务 |
| `apps/api/agent/tools.ts` | 会话绑定工具注册表 `SESSION_TOOL_REGISTRY` + `session_rename` 实现 + `sanitizeTitle` + `buildSessionTools()` |
| `apps/api/agent/store.ts` | `sessionNeedsTitle()`(冷启动判据) |
| `apps/api/agent/runtime.ts` | 冷启动按「是否还需要命名」决定注册集合;系统提示按实际注册到的工具生成 |
| `apps/api/agent/title.test.ts` | 本轮验收项本身:列级授权 · 只命名一次 · sanitize · 闭包绑定 |
| `apps/api/agent/sandbox.test.ts` | 随注册表结构调整(第 1 层用例覆盖新增的会话绑定工具) |

**不交付**:前端任何改动(标题在会话列表里本来就渲染,每轮结束的 `refreshSessions()` 会带回新标题)。

## 验收

| # | 检查 | 命令 / 期望 | 结果 |
|---|---|---|---|
| 1 | 新会话首轮拿到模型起的标题 | 开一轮真实对话,`GET /agent/sessions` 的 `title` 不等于首条消息首行截断 | ✅ **生产实跑通过**(R11,2026-09-02):`title_source=agent`,标题由模型调 `session_rename` 起,见 round-11 任务卡「全链路验收」;本机验不了(本地库没有 LLM provider,`/agent/ask` 一律 503) |
| 2 | 命名过程在右侧视图可见 | 一轮命名里 `tool_execution_start` / `tool_call` / `tool_result` / `tool_execution_end` 四个事件到达观测者,`toolName = session_rename`,入参预览就是那个标题 | ✅ faux 探针实跑,四个事件全到(事件清单见「实测」);`agent/events.ts` 的白名单本就含 `toolName` 与 `argsPreview` / `inputPreview` |
| 3 | 一个会话只命名一次 | 已命名的会话冷启动不再注册该工具;直接写库也改不动(`WHERE title_source='derived'` 命中 0 行) | ✅ `title.test.ts`「只命名一次」段 |
| 4 | 写面被 Postgres 限死 | 以 `agent_title` 改 `sessions.last_active_at` / `visitor_id` / 写 `messages` / `DELETE FROM sessions` / 读 `llm_config` / 读 `notes_chapters` / `SELECT created_at` 全部 `permission denied`;只有改 `title` / `title_source` 成功 | ✅ `title.test.ts`「agent_title 角色」段 |
| 5 | 会话 id 不可由模型指定 | 工具 `parameters` 只有 `title` 且 `additionalProperties: false`;给会话 A 构建的工具即便被塞进 `sessionId: B` 也只改 A | ✅ `title.test.ts`「工具行为」段 |
| 6 | sanitize 生效 | 多行 / 引号 / 尾部标点(半角与全角)/ 引号与标点互相嵌套 / 控制字符 / 超长 / 全空白 逐条断言 | ✅ `title.test.ts`「sanitizeTitle」段(**互相嵌套那条是探针抓出来的真 bug**,见「实测」) |
| 7 | 可关停 | 经 MCP `tool_config_set session_rename enabled=false` 后新会话不注册该工具,标题回落首行截断 | ✅ 逻辑侧用例(`loadEnabledTools` 丢弃 / `buildSessionTools` 不产出)+ **所有者在生产经 MCP 实调验过**(2026-09-03 确认) |
| 8 | 无回归 | `dev.ps1 check` + `dev.ps1 test` 全绿;`dev.ps1 gen` 后 `api-client.ts` 无接口面变化 | ✅ 12 文件 211 用例全过;check 通过;gen 只有已知的 app slug 噪音(BACKLOG R3/R6),**接口面零变化**,已还原该文件 |

## 禁止

- 不改前端页面样式(规则 7)。本轮**前端一行都不改**:标题的渲染、会话列表、三视图全部照旧
- 不加设计稿没有的功能(规则 8)。本轮唯一的例外是 `session_rename` 这条通路本身,已由所有者裁定并写进 ROUNDS.md 功能边界段
- 不扩大 agent 侧的写面:除 `sessions.title` / `title_source` 两列外,不给 `agent_title` 任何别的授权,也不设 `ALTER DEFAULT PRIVILEGES`
- 不新增 LLM 出网路径(旁路子会话形态已被裁定否掉)
- 不动 `deriveTitle` 的现有行为 —— 它是本轮的**兜底**,模型不调用工具时标题还得靠它

## 代码审查

<!-- 完成后回填。审查路由见 CLAUDE.md「开发模式」:codex 独立审查,硬失败才降级 /code-review。 -->

- 审查方式:codex `/codex:review --background`(working tree diff)
- 轮次范围:第 1、2 轮全量(CLAUDE.md 审查范围:只有前两轮用固定全量范围)

**第 1 轮(1 条 findings:0×P1 · 1×P2)**

| # | 级别 | findings | 处置 |
|---|---|---|---|
| 1 | P2 | 命名成功后没从**活着的**会话里撤掉 `session_rename`:`title_source` 已是 `agent`,但会话手里的工具白名单与「本次会话还没有标题」这句系统提示都在 `createAgentSession` 时定格,热路径又因配置指纹没变而直接复用该会话、不再走 `sessionNeedsTitle`。模型可能每轮重复调用,白花 provider 往返、token 与轨迹事件(尽管 SQL 最终拒绝改名) | **采纳,按最小改动整改** |

整改内容与**为什么不按 findings 的字面做**:

- **改的是措辞,不是机制**(`runtime.ts` 的 `systemPromptFor`)。原文「本次会话还没有标题」是一句**断言**,
  而标题在本会话第一轮就会被写掉 —— 从那一刻起它就是过期的话,并持续怂恿模型再调一次。
  改成「本次会话**开始时**还没有标题……**命名过之后就不要再调用它**——一个会话只接受一次,
  重复调用只会拿回一句「已经设置过」」,这句话在整个会话生命周期里都成立。
- **不做「命名成功后从活着的会话里移除该工具」**:工具白名单在 `createAgentSession` 时定格,
  要撤只能重建会话 —— 那要给 `acquireSession` 新增一条**会话级重建触发**,属机制类改动,
  按 CLAUDE.md「审查边界」不在非阻塞 findings 的整改范围;而且重建一次(冷启动串行链 + 历史注入,
  几百毫秒)比它要省的那一次工具往返**贵得多**。
- **残留影响有界,已写进代码注释**:活着的会话上下文里就有模型自己刚才那次 `tool_call` 与结果,
  它没有理由再调;真正会「不记得自己命名过」的是**被回收后重建**的会话,而那条路径正好走
  `needsTitle`(冷启动查一次库,已命名就不注册)。两头都堵上之后,重复调用只剩「模型无视自己
  上下文」这一种可能,代价是一次空转的工具调用,SQL 那道闸兜底。

**第 2 轮(1 条 findings:0×P1 · 1×P2)**

| # | 级别 | findings | 处置 |
|---|---|---|---|
| 1 | P2 | `sanitizeTitle` 只去**尾部**那一小撮标点,模型给一串 `:` / `——` / `…` / `()` 时它们都不在字符类里,于是「纯标点」原样活下来、被当成合法标题写库并把 `title_source` 翻成 `agent`;而命名只有一次,那个没法用的标题就永久钉在会话列表上 —— 与工具自己「纯标点要拒绝」的契约相抵 | **采纳整改** |

整改内容(仍是最小改动:**改判断**,不新增机制):

- 判据从「去完标点还剩不剩字符」换成「**剩下的字符里有没有一个字母或数字**」:
  `if (!/[\p{L}\p{N}]/u.test(s)) return "";`。`\p{L}` / `\p{N}` 覆盖中日韩、拉丁、西里尔等,
  纯 emoji 一并落进这一档 —— 它在会话列表里同样不可用,退回去让模型重给。
- 空标题的处理路径没变(`execute` 里 `if (!clean) throw TITLE_EMPTY_TEXT`),
  所以这条整改**不会**让「已经命名过」的判定变松:被拒的标题根本不进库,`title_source` 保持 `derived`,
  模型下一次还能命名。
- 用例扩到 `::` / `——` / `……` / `()` / `()` / `🎉🎉` / `- -` 六种新形状。

**第 3 轮(1 条 findings:1×P1)**

| # | 级别 | findings | 处置 |
|---|---|---|---|
| 1 | **P1** | **写一次的命名被钉在第一轮,在「hi 开场」场景上失效**:首句是 `hi` / `你好` 时模型手里没有任何任务信息,而系统提示逼它当场命名 —— 得到「打招呼」这种标题,且因为只能命名一次,之后访客说出真正来意的那一轮**修不回来** | **所有者裁定不采纳**(2026-09-02);我先按「措辞整改」做了一版,所有者看后要求**回滚** |

处置过程要如实记:

- 我最初把它当成可以在措辞层整改的问题,把系统提示改成了「等你弄清访客要做什么之后再命名,
  招呼轮先别命名」。**所有者裁定这是典型的「自己加戏」**:命名时机从「第一轮」变成
  「模型自己判断的某一轮」,是给功能加了一层行为分支,属新增机制(CLAUDE.md 审查边界:
  非阻塞 findings 不新增机制;findings 指向设计取舍时回所有者层面定,不在复审循环里改)。
  **已回滚**到第 2 轮复审后的措辞:「本次会话开始时还没有标题:先调用一次 `session_rename`……
  命名过之后就不要再调用它」。时机与参考实现(pi 的 `auto-session-title`:首条输入即命名)一致。
- **接受的代价**(所有者裁定):首句是招呼时,标题可能是「打招呼」之类,且因只命名一次而永久。
  与本轮之前的「hi」相比不更差。要改只能放开「允许后续重命名」,那是所有者 2026-09-01 的裁定
  (只命名一次),本轮不动。已记 `rounds/BACKLOG.md`,后续审查再扫到同一处时不必逐轮重裁。

**第 4 轮(1 条 findings:1×P1)—— 随第 3 轮回滚作废**

| # | 级别 | findings | 处置 |
|---|---|---|---|
| 1 | **P1** | 工具自己的 `description` 里还留着「整个会话只需在第一轮调用一次」,与第 3 轮改过的系统提示互相打架 | **作废**:它只因第 3 轮那版整改而存在;回滚后 `description` / `promptSnippet` / 系统提示三处又回到同一口径(第一轮命名),已恢复原文 |

**第 5 轮(零 findings)**:在第 4 轮状态上发起、回滚前已在跑。原文:「No actionable correctness, security,
or Encore-specific defects were identified in the current changes. The TypeScript compilation check also
completed successfully.」它扫的是回滚**前**的代码;回滚后的代码 = 第 3 轮扫过的那份。两份状态各被全量扫过一次,
除所有者裁定不采纳的那条 P1 外均零 findings。

- 结论:**缺陷门禁 PASS**。五轮共 4 条 findings(2×P1 · 2×P2):2 条 P2 采纳整改(第 1、2 轮);
  第 3 轮 P1 所有者裁定不采纳并回滚(记 BACKLOG);第 4 轮 P1 随回滚作废。末轮零 findings。
  验收 #1 / #7 按先例交接 130 预发实测(见「本轮实测 · 交接」)。

## 失败处理

同一验收项针对性整改后连续 2 次验证仍不过 → 写 `rounds/round-title/BLOCKED.md`,停下呼人。禁止放宽验收标准自我通过。

**本轮的止损很便宜**:回退面是一条迁移加一个工具;线上真出问题时经 MCP `tool_config_set session_rename enabled=false` 即可当场停用,不需要发版、不需要回滚镜像。

## 本轮实测

### 数字

- `dev.ps1 test`:**12 文件 211 用例全过**(本轮新增 `title.test.ts`,13 个用例);`dev.ps1 check` 通过,迁移 009 在干净库上一次跑通
- faux 闭环单次 **2.5s**;`setSessionTitleAsAgent` 的一次事务(`SET LOCAL ROLE` + 单行 UPDATE)在本机 Postgres 上 < 10ms
- 本轮改动:3 个文件新增(迁移 / `title-db.ts` / `title.test.ts`)+ 4 个文件修改,**前端 0 行**

### faux 探针:命名闭环真的跑通了(按 round-07 的复现方法重建,跑完删除)

用 pi-ai 的 `faux` provider 扮演模型发一次 `session_rename` 的 tool call —— **全程不需要 LLM key**。
到达观测者的四个事件(顺序即实测顺序):

```
tool_execution_start  toolName=session_rename  args={"title":"「排查 SSE 断流」。"}
tool_call             toolName=session_rename  input={"title":"「排查 SSE 断流」。"}
tool_result           toolName=session_rename
tool_execution_end    toolName=session_rename  result={... "details":{"title":"排查 SSE 断流","changed":true}}
```

库里:`title = 排查 SSE 断流`、`title_source = agent`。
右侧面板要的东西齐了 —— `agent/events.ts` 的白名单本就带 `toolName` 与 `argsPreview`/`inputPreview`,
所以 Timeline 上会出现一行 `tool_call · session_rename`,**入参预览就是那个标题**,与截图里
`tool_call · notes_get_chapte` 是同一种呈现。

**探针没有提交**:它的 import 走的是 `pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/providers/faux.js`
这条深路径(穿过另一个包的私有 node_modules),pi 升级时会以「整个测试文件 import 失败」的方式炸掉整个套件 ——
与 R7 的裁定一致。要复现照 `rounds/round-07/round-07.md`「闭环验证怎么复现」那一节重建。

### 踩的坑

1. **sanitize 的引号与尾部标点会互相挡住,单趟 replace 必然剩一个字符**(探针第一次跑就抓到)。
   模型给的是 `「排查 SSE 断流」。`:先去引号时尾巴是句号(去不掉引号),先去句号时尾巴是引号(去不掉句号)。
   参考实现(pi 的 `auto-session-title`)也是单趟,同样会漏 —— 它没暴露只是因为模型不常两样都加。
   改成**循环到不动点**(每趟要么至少少一个字符要么跳出,必然收敛),并把这个形状写成用例钉住。
2. **`title` 非空不能当作「已命名」的判据**:首条用户消息落库时 `store.appendMessage` 就把首行写进去了。
   所以要单独一列 `title_source`,而不是复用「标题是不是空的」。
3. **列级 UPDATE 授权要连 SELECT 一起给**:`WHERE title_source = 'derived'` 与 `RETURNING id` 引用的列
   需要 SELECT 权限,列级 UPDATE **不含**读权限。少给的表现是运行期 `permission denied`,而不是编译期错误。

### 与计划的偏离

- **`guarded()` 多了一个失败文案参数**。原计划直接复用既有的固定文案,但那句是「查询失败,请稍后再试或换个问法」——
  对一次**写标题**的失败既不准确,也会诱导模型反复重试标题而不是回答问题。命名工具用
  「标题没能保存,不必重试,请继续回答访客的问题」。只读工具那句一字未动(用例仍钉着它)。
- **`buildSessionTools` 会按会话裁掉已命名会话的工具**(计划里只写了 SQL 那道闸)。多这一道的收益是:
  被空闲回收后重建的会话不会每轮都试着调一次命名工具再被库挡回去 —— 那会在轨迹面板上留下一串无意义的空转调用。

### 交接 R11(两条本机验不了的)

> **结果(2026-09-03)**:R11 跳过了 130,两条都在**生产**验掉——#1 R11 当日(`title_source=agent`),#7 所有者确认。本段保留为交接记录。

沿用 R-VISITOR 的先例(「本机验不了的在 130 上验掉」):

1. **验收 #1「真模型会不会照系统提示调这个工具」** —— 本机 `llm_config` 是空的(LLM 凭据只在 130 的库里),
   `/agent/ask` 一律 503,验不了。130 上开一轮真实对话即可,判据是左栏标题 + 右侧 Timeline 那一行。
   **模型不调用不是回归**:标题退回现在的首行截断,与本轮之前一模一样。
2. **验收 #7「经 MCP 关停」** —— 需要后端 + token 实连。130 上 `tool_config_set session_rename enabled=false`
   之后开新会话,确认 `agent tools enabled` 日志里没有它、标题回落首行截断。
