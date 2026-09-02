# Round TOOLS — Tools 工具面板(Runtime 右栏第 4 tab)

<!-- 命名轮,不属于 R0–R11 线性序列。拆解见 ROUNDS.md「R-TOOLS」。 -->

> 状态:进行中 —— 代码与验收已落地(2026-09-02,分支 `claude/round-tools-implementation-cd50cb`),codex 审查进行中
>
> 与 R11(生产部署上线)的先后**待所有者裁定**:本轮无迁移、无新依赖、不动部署形态,放在上线前后都成立。

## 目标

访客在 Runtime 右栏能看到这个 agent 的**全部 5 个工具**及其名称、描述、入参 JSON Schema 与输出形态,
且面板里的每一条元信息都与 `apps/api/agent/tools.ts` 逐字一致;端点响应中不出现任何服务端配置值。

范围依据:设计稿已于 2026-09-02 扩到 12 块(新增画板 `1f` 列表态 / `1g` 展开态),原型同步加了第 4 个面板 tab
与逐工具展开;边界修订记录见 ROUNDS.md 头部「2026-09-02 第三次修订」与 CLAUDE.md 规则 8 的同日修订。

## 前置

- R7(只读工具组 · `TOOL_REGISTRY`)、R-WEBSEARCH(`web_search`)、R-TITLE(`session_rename`)均已合并 `main` ✅
- 设计稿与原型已落盘存档 ✅(`design/Agent Runtime Workbench.dc.html` 的 `1f`/`1g`、`design/Agent X-Ray Prototype.dc.html` 的 `panel: 'tools'` + `openTool`)
- 无需新凭据、无需服务器、无需迁移

## 交付物

| 文件 | 内容 | 落地 |
|---|---|---|
| `apps/api/agent/tools.ts` | **每个工具一份 META 常量**(名称 / 中文标签 / 描述 / promptSnippet / 入参 schema / **输出形态说明**),工具定义由它构造(`{...META, execute}`);`execute` 的实现不动 | ✅ `ToolMeta` / `ToolParametersSchema` 类型 + 5 份 META(`NOTES_*_META` ×3、`WEB_SEARCH_META`、`SESSION_RENAME_META`);`output` 必填;`web_search` 的 `phases` 键在 `Record<WebSearchPhase, string>` 上,websearch.ts 加阶段不补文案编译不过 |
| `apps/api/agent/catalog.ts`(新) | 只读端点,`expose: true` 且无需鉴权(与其它访客端点同口径),吐上述元信息 | ✅ `GET /agent/tools`;`toolCatalog()` 从三条构造路径派生分组;`publicEntry` 白名单序列化(只按名取字段,不 spread) |
| `apps/api/agent/catalog.test.ts`(新) | 元信息与工具定义一致性测试(见验收 #2)+ 响应不含配置值的断言(见验收 #3) | ✅ 12 个用例,对应验收 #2 / #3 / #6 |
| `apps/web/components/workbench/ToolsPanel.tsx`(新) | Tools 面板组件,逐画板对照 `1f` / `1g` | ✅ 按后端 `group` 渲染,`Record<ToolGroup, …>` 让「后端多出第四组」变成前端编译错误;约束徽标(`≤64` / `1–128`)从 JSON Schema 边界关键字派生 |
| `apps/web/components/workbench/Workbench.tsx` | tab 数组加第 4 项 `["tools", "Tools"]`,面板分支接上 | ✅ `PANEL_TABS` 四项;空会话下 Tools 例外于「前三个 tab 都落到 Lifecycle 待命图」 |
| `apps/web/lib/agent-api.ts` | 类型与调用 | ✅ `listTools()` + 从生成物派生的 `ToolCatalog` / `ToolGroup` / `ToolParamSchema` 类型 |
| `apps/web/lib/api-client.ts` | `dev.ps1 gen` 重新生成(生成物,不手改) | ✅ 已重生成;仅按 BACKLOG R3 的先例把 app slug 噪音(`936eu`↔`3vpi6`)那两行还原 |
| `docs/security.md` | §1 第 1 层 R-TOOLS 补记(规则 9):公开的是能力说明,不公开的是配置面,两层落点 | ✅ |
| `apps/api/agent/README.md` | 端点清单 + 「工具元信息 META」一节(新增工具要动的两处) | ✅ |
| `.claude/launch.json` | 加 `api` 配置(浏览器验证工具起后端用,`powershell -File dev.ps1`);非产品代码 | ✅ |

**端点不得吐**(所有者裁定,ROUNDS.md R-TOOLS):`execute` 函数本体、`ActiveWebSearchConfig` 的任何字段
(baseUrl / key / model / provider)、`dailySearchLimit` 与当日用量、`tool_config` 的 `enabled` 状态。

### 派生式:新增工具时不需要再看这个面板一眼(所有者裁定 2026-09-02)

**要解决的是**「每次发版顺便处理一下 Tools 面板的展示」这件事本身。光把端点写成「遍历注册表」不够 ——
画板 `1f/1g` 上有两样 pi 的 `ToolDefinition` **没有**的东西(工具分组、输出形态说明),
它们才是会反复要人手工补的地方。三条一起才成立:

1. **单一事实源 = META 常量**。每个工具的展示字段与它的定义写在同一处,定义由 META 构造。
   改 schema 必然改 META,面板不可能落后;**面板永远不是第二个要改的地方**。
2. **分组按注册路径派生,不手写**。在 `TOOL_REGISTRY` → 纯函数组;在 `SESSION_TOOL_REGISTRY` → 会话绑定组;
   走 `makeWebSearchTool` → 外呼组。分组本来就等于注册路径,手写只会写错。
3. **输出形态是 META 的必填字段**(TypeScript 强制)。漏写不是「面板少一行」而是**编译不过** ——
   拦在写工具的那一刻,不是拦在发版前。

**META 不许含配置值,这是结构性的而不是靠自觉**:META 定义在闭包**外面**,
`makeWebSearchTool(cfg)` 的 `cfg` 与 `sessionRename(ctx)` 的 `ctx` 在那个作用域里根本不存在。
今天没人往 description 里插「每日 N 次」,不代表明年没人插;放在闭包外面之后,插不进去。

**已知的一个洞,要写进实现注释**:派生只覆盖它认识的构造路径。今天是三条(两个注册表 + `makeWebSearchTool`),
将来有人加**第四条**构造路径且不进 META,派生法看不见它。验收 #2 的双向集合相等把这个洞收到
「加工具必经的两个地方」上 —— 见下。

## 验收

| # | 检查 | 命令 / 期望 | 结果 |
|---|---|---|---|
| 1 | 右栏出现第 4 个 tab | 本机 `dev.ps1` + `npm run dev`;tab 条四项,样式/间距/字号/选中态与前三个一致(规则 7:不新造 tab 样式) | ✅ 本机实测(空会话态与 Tools 选中态各一张截图,见「本轮实测」)。四个 tab 走**同一段**渲染代码(`PANEL_TABS.map`),tab 样式零新增 |
| 2 | 目录与实现**双向**对齐 | ①**逐字段**:测试从工具定义对象取 `name`/`label`/`description`/`parameters` 与端点吐的元信息比对,不一致即失败(**不靠眼看**);②**集合相等**:目录的 name 集合 == 两个注册表 + `web_search` 的并集,多一个少一个都失败;③**穿过库的兜底**:迁移里 `tool_config` 种下的每个名字都要有 META(新工具必经这两处,漏一处就红) | ✅ `catalog.test.ts`「目录与实现双向对齐」段:①对每条目录项按其 `group` 走**真实构造路径**取定义(`TOOL_REGISTRY[name]` / `SESSION_TOOL_REGISTRY[name](ctx)` / `makeWebSearchTool(假 cfg)`)后 `toEqual`;②集合相等 + 无重名;③`SELECT name FROM tool_config` 逐名断言,且先断言表非空(空表不许空转通过) |
| 3 | 响应不泄配置面 | 对端点响应做 grep:不含 key / baseUrl / model / provider / 限额数字 / `enabled`;`web_search` 的条目在**未配置**时也不暴露配置缺失细节 | ✅ `catalog.test.ts`「响应不泄配置面」段:一份**每个值独一无二**的假配置(9 个值)逐一 grep 不到、16 个配置面字段名 grep 不到、会话 id grep 不到;每条字段集 ⊆ 8 个白名单键;`web_search` 在 `websearch_config` 为空时照样列出、没有 available/configured/enabled 字段,且与带配置构造出的定义逐字段相等 |
| 4 | 空会话下也有内容 | 新开一个未发消息的会话,切到 Tools 仍显示完整清单(它不依赖 `events`) | ✅ 本机实测:「未选择会话」态点 Tools,五条全在(截图) |
| 5 | 逐画板对照 | 列表态对 `1f`、展开态对 `1g`(展开 `web_search`,含四阶段进度说明);分组色 `#6b7280` / `#2563eb` / `#f9c22e` | ✅ 列表态:三组分组头(色点 / 组名 / 组注)+ 卡片(等宽名 / 中文标签 / 组徽标 / 折叠箭头 / 单行省略描述)+ 三行脚注;展开态:全文描述 / INPUT(`query string 必填 2–300` + 描述)/ OUTPUT 两行 / PROGRESS `发起 → 已受理 → 检索中 → 综述中` + `tool_execution_update` 注。色值三个都是设计稿的 |
| 6 | 5 个工具齐 | `notes_list_series` · `notes_get_chapter` · `notes_search` · `web_search` · `session_rename`,分三组 | ✅ 端点实测响应 5 条、`pure` ×3 / `outbound` ×1 / `session` ×1;测试钉住三组齐全与顺序 |
| 7 | 测试与类型 | `dev.ps1 test` 全绿;`dev.ps1 gen` 后 `dev.ps1 check` 通过,前端引用生成类型无 `any` 兜底 | ✅ `dev.ps1 test`:**14 文件 291 用例全过**(新增 `catalog.test.ts` 12 个);`dev.ps1 gen` → `dev.ps1 check` 通过;额外跑了 `tsc --noEmit`:`apps/api` 与 `apps/web` 都是 0 错误(门禁不跑 tsc,见 BACKLOG);前端类型全部从生成物派生,无 `any` |

## 禁止

默认继承两条:不改前端页面样式(规则 7);不加设计稿没有的功能(规则 8)。本轮另加:

- **不做启停/限额展示**。所有者已裁定面板只读且静态;想改口径回所有者层面重定,不在实现或审查循环里自行决定。
- **不碰工具的执行逻辑**。把定义改写成 `{...META, execute}` 是本轮交付物,但 `execute` 体内、`guarded`、
  `loadEnabledTools` 的注册与丢弃判断、配额、外呼实现**一行不改**;改写前后既有测试用例必须原样通过。
- **不为面板另建一份手工目录**。那正是本轮要消灭的东西(见「派生式」一节)。
- **前端不得按工具名硬编码任何东西**——没有 `switch (tool.name)`、没有 `name → 中文/颜色` 的映射表。
  一律按后端给的 `group` 渲染(三组的色值是固定的,工具不是)。否则问题只是从后端搬到前端:
  新工具在 API 里自动出现,在页面上却没文案没样式。
- **不新增迁移、不动 `tool_config` 表**。
- **不改 Timeline / Chain View / Lifecycle Map 三个面板**,也不改左侧聊天区与顶部导航。
- **不为「Timeline 的 tool_call 行点进去跳到 Tools」做联动**——设计稿没有这条交互,想要就先改设计稿。

## 待所有者裁定(不要在本轮自行决定)

目录是**静态**的:5 个工具全列。若 `web_search` 未配置或被 `tool_config` 关掉,面板仍会列出它——
这与「不显示启停状态」是同一枚硬币的两面。若所有者认为「列了但用不了」比「泄配置面」更糟,
再单独裁定改口径。

## 代码审查

<!-- 完成后回填。审查路由见 CLAUDE.md「开发模式」:codex 独立审查,硬失败才降级 /code-review。 -->

- 审查方式:codex `/codex:review --background --scope branch`(分支对 `main` 的全量 diff)
- 轮次范围:第 1、2 轮全量(CLAUDE.md 审查范围:只有前两轮用固定全量范围)
- 一个操作坑:companion 用 `process.cwd()` 找仓库,Claude Code 的后台 Bash 任务不继承会话 cwd,第一次报
  「This command must run inside a Git repository」;命令前加 `cd <worktree>` 即可

**第 1 轮(1 条 findings:0×P1 · 1×P2)**

| # | 级别 | findings | 处置 |
|---|---|---|---|
| 1 | P2 | `resultCharLimit` 的契约不准确:`capText` 超限时**保留全部 8000 字符正文再追加截断标注**,实际返回文本长于端点与脚注宣称的「8000 字符上限」。建议二选一:在 `capText` 里给标注预留空间,或把这个值描述为正文预算而不是硬上限 | **采纳,按第二条(改描述)整改** |

整改内容与理由:

- **改的是契约描述,不是 `capText`**。给标注预留空间等于改工具结果的实际内容长度(模型少看到几十个字符),
  属工具执行逻辑,任务卡「禁止」段明写不碰;而且它是为一条 P2 新增行为,按 CLAUDE.md 审查边界不该做。
- 字段改名 `resultCharLimit` → **`resultBodyCharLimit`**,注释写清「正文预算,标注另加,整段结果可略长于 N」;
  脚注文案加「正文」二字(「工具结果**正文**统一 8000 字符上限 — 超出显式标注截断,不静默丢尾」)——
  画板原句按字面读确实不准,改文案不改机制。
- 测试从「N 不截、N+1 截」收紧为「N 字符原样;N+1 字符 = **前 N 字符原样 + 标注**,且总长 > N」,把这条语义钉死。
- `dev.ps1 gen` 重生成生成物(只有这个字段与注释变化,slug 噪音照旧还原两行)。

## 失败处理

同一验收项针对性整改后连续 2 次验证仍不过 → 写 `rounds/round-tools/BLOCKED.md`,停下呼人。禁止放宽验收标准自我通过。

## 本轮实测

### 数字

- `dev.ps1 test`:**14 文件 291 用例全过**(新增 `catalog.test.ts` 12 个;既有 `sandbox.test.ts` / `title.test.ts` 未改一行)。`dev.ps1 check` 通过;`tsc --noEmit` 在 `apps/api`、`apps/web` 各 0 错误
- 端点实测(本机 `GET /agent/tools`):5 条、三组、响应体里除 schema 边界数字外没有任何数字;`resultBodyCharLimit: 8000`(codex 第 1 轮后改名,见「代码审查」)
- 改动面:后端 2 个新文件(端点 + 测试)+ `tools.ts`(META 抽取)+ `websearch.ts`(1 行:`MAX_CITATIONS` 加 `export`);前端 1 个新组件 + `Workbench.tsx` 3 处 + `agent-api.ts` 1 段 + 生成物;文档 3 处
- `git diff -w` 核对:五个 `execute` 体、`guarded`、`loadEnabledTools`、`buildSessionTools` **零改动**(`session_rename` 的 execute 因外层多包了一层 `Object.assign` 而整体缩进 +2,`-w` 下为空)

### 派生式是怎么落地的(对照任务卡「派生式」三条)

1. **单一事实源**:五份 META 常量各在自己的工具旁边,定义是 `{ ...META, execute }`。`ToolMeta.output` 必填、`ToolParametersSchema` 只认本仓库用到的六个 JSON Schema 关键字 —— 类型不认的进不了 META
2. **分组派生**:`catalog.ts` 的 `toolCatalog()` 只做三件事:遍历 `TOOL_REGISTRY` → `pure`、取 `WEB_SEARCH_META` → `outbound`、遍历 `SESSION_TOOL_REGISTRY` 的 `factory.meta` → `session`。**没有 name → group 的表**
3. **输出形态必填**:`output` 在 `ToolMeta` 上没有 `?`;`outputNote` 里的数字(50 / 160 / 10)全是模板字面量引用 `MAX_ROWS` / `SNIPPET_CHARS` / `MAX_CITATIONS`,常量改了文案跟着改
4. **META 在闭包外面**:`WEB_SEARCH_META` 是模块常量,`makeWebSearchTool(cfg)` 只是 `{ ...WEB_SEARCH_META, execute }`;`SESSION_RENAME_META` 同理。`catalog.test.ts` 用一份每个值独一无二的假 `cfg` 真的构造了一次工具,再 grep 响应 —— 一个值都没出来
5. **已知的洞**已写进 `toolCatalog()` 的注释,兜底是测试的双向集合相等(目录 == 两个注册表 + `web_search`;`tool_config` 每个名字都有目录项)

### 踩的坑

1. **worktree 里跑 `dev.ps1 test` 先红 3 条**:`sandbox.test.ts` 外呼组三条报 `ConfigEncryptionKey 未配置`。原因是 `apps/api/.secrets.local.cue` 被 gitignore、只在主 checkout 里,新 worktree 没有;从主 checkout 复制一份后 14/14 全绿。**是环境不是代码**,与本轮改动无关
2. **Encore 类型化端点支持 `Record<string, T>`**(此前仓库里没用过,实测):生成物变成 `{ [key: string]: ToolParamSchema }`。所以入参 JSON Schema 能**原样**吐出(`properties` 保持对象),不必为了过 Encore 解析器改成数组形态,前端也就不用把它再拼回去
3. **pi 的 `TSchema` 在 TypeBox v1 里是空接口**(`export interface TSchema {}`),任何对象都可赋值 —— 所以 `ToolMeta.parameters` 用自定义的 `ToolParametersSchema` 接口与 `ToolDefinition.parameters` 交叉时没有冲突。pi-ai 的 provider 适配层只取 `name / description / parameters`(anthropic-messages.js / openai-completions.js 源码核实),META 摊进定义对象的 `output` / `phases` 不会进模型请求
4. **`dev.ps1 gen` 的 app slug 噪音**再次出现(`936eu` → `3vpi6`,worktree 是另一个本地 app id,BACKLOG R3 已记):只把那两行还原,其余生成内容(含 `deleteSession` 文档注释与源码同步)保留 —— 那是生成物本该有的样子

### 与计划的偏离

- **`makeWebSearchTool` 与 `websearch.ts` 的 `MAX_CITATIONS` 加了 `export`**。前者是让测试能「按真实构造路径」拿一份带假配置的定义与目录逐字段比对,并证明配置值进不了目录;后者是让 `outputNote` 的「来源最多 N 条」引用真实常量。两处实现体一行未动
- **端点响应多一个字段 `resultBodyCharLimit`**(画板脚注「工具结果统一 8000 字符上限」)。它是代码常量不是配置值(不在库里、不在 env 里,设计稿上本来就印着);前端写死一个 8000 就是「第二个要改的地方」,与本轮要消灭的东西同类。测试把它钉在 `capText` 的真实行为上(N 字符原样;N+1 字符 = 前 N 字符 + 截断标注)。**脚注文案比画板多了「正文」二字**(「工具结果正文统一 8000 字符上限」):codex 第 1 轮指出 `capText` 是「正文截到 N 再追加标注」,整段结果会略长于 N,画板原句按字面读是不准确的;改文案不改机制(见「代码审查」)
- **`SessionToolFactory` 从函数类型改成「可调用 + `meta`」接口**(`Object.assign(fn, { meta })`):面板要读会话绑定工具的 META,而工厂需要 `ctx` 才能调用 —— 不想为了读一份描述先造一个绑着假会话 id 的工具。`buildSessionTools` 的调用形式 `SESSION_TOOL_REGISTRY[name](ctx)` 不变
- **`.claude/launch.json` 加了 `api` 项**:浏览器验证工具要起后端(`powershell -File dev.ps1`),此前只有 `web`。非产品代码
- **分组的中文名 / 组注 / 徽标文案在前端**(`ToolsPanel.tsx` 的 `GROUPS`,按 `group` 键入):任务卡明确允许「按后端给的 group 渲染,三组的色值是固定的」;组名与组注同样是三组的固定属性(设计稿文案),不随工具变。放后端只会让端点多一段与工具无关的静态文案
