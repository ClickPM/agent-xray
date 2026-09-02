# Round TOOLS — Tools 工具面板(Runtime 右栏第 4 tab)

<!-- 命名轮,不属于 R0–R11 线性序列。拆解见 ROUNDS.md「R-TOOLS」。 -->

> 状态:未开始
>
> 与 R11(生产部署上线)的先后**已由所有者裁定(2026-09-02):本轮先做**。本轮无迁移、无新依赖、不动部署形态,
> 放在上线前后都成立;定在前面的理由是 R11 无论如何要走一次「构建 → 130 预发验 → 生产发」
> (`main` 上 R-WEBSEARCH/R-TITLE 两轮从未部署过),带上本轮就只走一次,生产首发即最终形态。
>
> **约束**:R11 同日裁定「pg 备份继续不做」,派生出「上线期间不做不可逆迁移」——本轮**本来就无迁移**,
> 保持这样;若实现中发现需要迁移,停下回所有者(见 rounds/round-11/round-11.md「禁止」段)。

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

| 文件 | 内容 |
|---|---|
| `apps/api/agent/tools.ts` | **每个工具一份 META 常量**(名称 / 中文标签 / 描述 / promptSnippet / 入参 schema / **输出形态说明**),工具定义由它构造(`{...META, execute}`);`execute` 的实现不动 |
| `apps/api/agent/`(新端点文件) | 只读端点,`expose: true` 且无需鉴权(与其它访客端点同口径),吐上述元信息 |
| `apps/api/agent/*.test.ts` | 元信息与工具定义一致性测试(见验收 #2)+ 响应不含配置值的断言(见验收 #3) |
| `apps/web/components/workbench/ToolsPanel.tsx`(名字待定) | Tools 面板组件,逐画板对照 `1f` / `1g` |
| `apps/web/components/workbench/Workbench.tsx` | tab 数组加第 4 项 `["tools", "Tools"]`,面板分支接上 |
| `apps/web/lib/api-client.ts` | `dev.ps1 gen` 重新生成(生成物,不手改) |

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

| # | 检查 | 命令 / 期望 |
|---|---|---|
| 1 | 右栏出现第 4 个 tab | 本机 `dev.ps1` + `npm run dev`;tab 条四项,样式/间距/字号/选中态与前三个一致(规则 7:不新造 tab 样式) |
| 2 | 目录与实现**双向**对齐 | ①**逐字段**:测试从工具定义对象取 `name`/`label`/`description`/`parameters` 与端点吐的元信息比对,不一致即失败(**不靠眼看**);②**集合相等**:目录的 name 集合 == 两个注册表 + `web_search` 的并集,多一个少一个都失败;③**穿过库的兜底**:迁移里 `tool_config` 种下的每个名字都要有 META(新工具必经这两处,漏一处就红) |
| 3 | 响应不泄配置面 | 对端点响应做 grep:不含 key / baseUrl / model / provider / 限额数字 / `enabled`;`web_search` 的条目在**未配置**时也不暴露配置缺失细节 |
| 4 | 空会话下也有内容 | 新开一个未发消息的会话,切到 Tools 仍显示完整清单(它不依赖 `events`) |
| 5 | 逐画板对照 | 列表态对 `1f`、展开态对 `1g`(展开 `web_search`,含四阶段进度说明);分组色 `#6b7280` / `#2563eb` / `#f9c22e` |
| 6 | 5 个工具齐 | `notes_list_series` · `notes_get_chapter` · `notes_search` · `web_search` · `session_rename`,分三组 |
| 7 | 测试与类型 | `dev.ps1 test` 全绿;`dev.ps1 gen` 后 `dev.ps1 check` 通过,前端引用生成类型无 `any` 兜底 |

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

- 审查方式:<codex /codex:review | codex /codex:adversarial-review | /code-review(写明降级原因)>
- findings 处理:<逐条:采纳整改 / 不采纳及理由;或链接同目录记录文件>
- 结论:<PASS | 整改后 PASS>

## 失败处理

同一验收项针对性整改后连续 2 次验证仍不过 → 写 `rounds/round-tools/BLOCKED.md`,停下呼人。禁止放宽验收标准自我通过。

## 本轮实测

<!-- 完成后回填:实际数字、踩的坑、与设计/计划的偏离及原因 -->
