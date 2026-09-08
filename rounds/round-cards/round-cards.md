# Round R-CARDS — 会话区信息卡片:内容级 `xray-card` 围栏块 + 声明式交互

<!-- 保存为 rounds/round-cards/round-cards.md;该轮其他管理产出放同一目录。 -->

> 状态:**文档就绪、设计稿待交付、未开工**(所有者裁定 2026-09-08:下一阶段三轮里的第三轮,排在 R-LEAK / R-CROSSLINK 之后)。
> 所有者原话:「增加一个 UI 组件工具,支持 agent 在回复结果中插入现场写好的数据,以信息卡片形式进行展示(甚至可以在里面加一些交互)」。
> 形态裁定为 **2-A 内容级**(不是工具级 2-B,理由见下),所以名字里的「工具」不是 pi 工具:它是回复正文里的一个围栏块。
> 与 R-TOOLS / R-PERF / R-TOOLCARDS / R-SOURCE 同一顺序、**不是**规则 8 的例外:画板先扩(桌面 `2s` / `2t` 放**新文件**
> `Agent X-Ray Cards.dc.html`,移动端 `4y` / `4z` 追加进 `- Runtime`),并入 `design/` 之后才开 `round-cards`。
> 给 Claude Design 的提示词在 [`design-prompt.md`](design-prompt.md)。规则 9「先改文档」:`docs/security.md` §0 第 11 条(模型输出渲染成 UI 组件)已随本任务卡写入。

## 目标

agent 在回复正文里写一个 ` ```xray-card ` 围栏块 + 一段 JSON,会话区把它渲染成一张信息卡片(六种闭集形态之一),
支持声明式交互(tabs 切换 / 折叠 / 表格排序 / 单选切面板 / 一个「把预设文本放进输入框」的动作按钮);
JSON 非法、超限或形态未知时**回落成普通代码块**;跑完折叠后卡片留在最终回答里(它是内容);刷新后回放与实时一字不差。

可证伪:faux provider 按剧本吐出六种卡片各一张 + 一张非法 JSON + 一张超限,会话区渲染六张卡 + 两个代码块;
F5 前后会话区 `innerHTML` 的 sha256 一致(R-TOOLCARDS 验收同款);`git diff --stat main -- apps/api` 只有 `runtime.ts` 的提示词段与它的测试;
`/notes/*` 页面对同一段围栏的渲染仍是代码块(Notes 默认不开卡片)。

## 所有者裁定(2026-09-08)

| # | 裁定项 | 结论 | 落点 |
|---|---|---|---|
| 1 | 形态 | **2-A 内容级围栏块**,不是 pi 工具 | 模型写 ` ```xray-card `;`Markdown.tsx` 的 `pre` 覆盖识别 `language-xray-card` |
| 2 | 卡片类型 | **闭集六种**:`kv` / `table` / `list` / `stat` / `compare` / `tabs` | `apps/web/lib/xray-card.ts` 校验;未知 `kind` 回落 |
| 3 | 交互边界 | **只允许声明式**:tabs / 折叠 / 表格排序 / 单选切面板;动作按钮唯一允许的动作 = 把一句预设文本放进输入框(R-CROSSLINK 的预填原语,不自动发送) | 无表达式求值、无模型给的 HTML / JS、无外部资源 |
| 4 | 顺序 | 先画板、再进轮次 | `2s` / `2t` + `4y` / `4z` |

**为什么不做工具级(2-B)**:① `tool_end` 帧与 `messages.payload` 现在**只带摘要字符串、永不带结构**(R-TOOLCARDS 裁定),
工具级要新增一个贯穿 turn-recorder / sessions 投影 / turn-view 的 `card` 字段;② 画板 `2l` 的折叠规则是「最终回答之前的一切进折叠行」,
工具调用属于处理过程,卡片会被折进去,得给 `2l` 加例外;③ 内容级的卡片是正文的一部分:随 `content` 落库、随 delta 流式到达、随折叠规则留在最终回答里,
三件事都不用新机制。代价是两条:模型收不到校验错误(非法 JSON 静默回落成代码块,访客看见裸 JSON)、Timeline 里看不到「画了一张卡」(与 markdown 表格同理)。
两条都记在下面「已认代价」。工具级留作备选,要做先重裁本条。

派生取舍(实现者定,画板照此画;可推翻):

1. **DSL v1 形状**(JSON,`v` 必填 = 1):

   ```json
   { "v": 1, "kind": "kv",      "title": "…", "rows": [{ "k": "…", "v": "…" }] }
   { "v": 1, "kind": "table",   "title": "…", "columns": ["…"], "rows": [["…", "…"]], "sortable": true }
   { "v": 1, "kind": "list",    "title": "…", "ordered": true, "items": [{ "text": "…", "note": "…" }] }
   { "v": 1, "kind": "stat",    "title": "…", "items": [{ "label": "…", "value": "…", "unit": "…", "note": "…" }] }
   { "v": 1, "kind": "compare", "title": "…", "columns": ["A", "B"], "rows": [{ "k": "…", "a": "…", "b": "…" }] }
   { "v": 1, "kind": "tabs",    "title": "…", "tabs": [{ "label": "…", "card": { …非 tabs 的一张卡… } }] }
   ```

   每种可选 `collapsed: true`(初始折叠,标题行可点开)、`links: [{ "text": "…", "href": "…" }]`(卡底一行链接)、
   `action: { "label": "…", "ask": "…" }`(卡底一枚按钮 → 预填)。**所有值都是字符串**,渲染为纯文本(React 转义),不解析 markdown、不解析 HTML。
2. **上限**(任一超限整卡回落):围栏原文 ≤ 8 KB;`rows` / `items` ≤ 20;`columns` ≤ 6;`tabs` ≤ 5 且每个 tab 里不能再套 `tabs`;
   字符串 ≤ 200 字符(`title` ≤ 60);`links` ≤ 5;`action.ask` ≤ 500。
3. **链接口径与 markdown 相同**:`href` 只收 `http(s)://` 与站内相对路径(`/` 开头、不含 `//`),渲染带 `rel="noreferrer noopener"`,其余丢弃该条链接(不回落整卡)。
   **v1 不收图片**(`generate_image` 的图片仍走 markdown `![]()`,那是既有路径)。
4. **流式期间**:围栏未闭合时 react-markdown 把它当未终结的代码块渲染,访客会看到半截 JSON 滚动。处理:`Markdown` 加 `streaming` 标志,
   `language-xray-card` 且 JSON 解析失败且 `streaming` 为真 → 渲染卡片骨架(`2i` 语汇:`#eeeeee` 填充、r7、`omPulseBg` 一块锚点),
   闭合后解析成功 → 换成卡片;闭合后仍失败 → 代码块(这时 `streaming` 已不成立)。
5. **只在会话区开**:`Markdown` 加 `cards` 开关,`Workbench.tsx` / `MobileChat.tsx` 传 true;Notes / Skills / Source 的渲染器不传,
   同一段围栏在那里就是代码块 —— Notes 的正文契约是「标准 markdown,服务端只校验不改写」(`docs/mcp.md`),不扩。要给 Notes 开是另一次裁定。
6. **系统提示加一段**(`runtime.ts`,单独一段、与工具无关):什么时候用卡片(访客要的是结构化数据:对比 / 清单 / 指标 / 键值,且条目 ≥ 3)、
   六种 `kind` 与形状(压缩到 20 行以内)、上限、**每次回复最多两张**、正文不复述卡片内容但要能独立成句(卡片回落时回复仍可读)、
   `action.ask` 只能写访客下一句可能想问的话、不在卡片里放链接以外的任何 URL。提示词修补也走完整 codex 循环。
7. **移动端**:`table` / `compare` 在 390 宽下放进既有 `m-xscroll` 容器横滚(页面本身不横滚,与 `2o` 长行同一规则);`compare` 两列窄于 160 时改为上下堆叠;
   `stat` 两列网格;tabs 胶囊化(`SegmentedControl` 既有语汇)。内核 token 照搬桌面,只做触控与换行适配(R-MOBILE 两层语言)。
8. **回放 = 实时**:卡片状态(哪个 tab / 折叠 / 排序)是纯前端状态,不产生事件、不落库,刷新回初始态;这与 R-TOOLCARDS 卡片展开态一致。

**已认代价**(所有者 2026-09-08 裁定 2-A 时一并认下):

- 模型写坏 JSON 时访客看到的是一个 `xray-card` 代码块里的裸 JSON,不是错误提示;缓解靠提示词里的形状表 + 上限,以及 faux 剧本的回归测试。
- Timeline 里没有「画了一张卡」的事件(它不是工具调用);与 markdown 表格同理。要它可见 = 工具级,另裁定。

## 前置

- **设计稿**:`2s` / `2t`(新文件 `Agent X-Ray Cards.dc.html`)+ `4y` / `4z`(追加进 `Mobile - Runtime`),并入 `design/`(四项判据全过)。
- R-CROSSLINK 已落地(`action.ask` 依赖它的预填原语;**没有它 `action` 字段整个不渲染**,其余五种交互不依赖)。
- R-PERF 的骨架语汇(`2i`)、R-MOBILE 的 `m-xscroll` / `SegmentedControl`。无新凭据、无新依赖(不引入图表库 / 表格库)、无新容器、无迁移、MCP 仍 51。

## 与画板的对照关系(拉回设计稿后逐项填)

| 画板 | 页面 / 组件 | 核对项 |
|---|---|---|
| `2s` 桌面 · 六种卡片 | `components/XrayCard.tsx` + `Markdown.tsx` | 六种 kind 的解剖:标题行 / 主体 / 卡底链接与动作按钮;`collapsed` 态;卡与正文的间距(会话区节奏 14) |
| `2t` 桌面 · 骨架 / 回落 / 交互态 | 同上 | 流式骨架;非法 JSON 回落成 `xray-card` 代码块;tabs 切换态;表头排序态(升 / 降小箭头);折叠态 |
| `4y` 移动 · 六种卡片 | `MobileChat.tsx` 走同一组件 | 横滚容器、堆叠规则、胶囊 tabs |
| `4z` 移动 · 骨架 / 回落 / 交互态 | 同上 | 对位 `2t` |

## 交付物

| 件 | 路径 | 内容 |
|---|---|---|
| 解析与校验 | `apps/web/lib/xray-card.ts` + `xray-card.test.ts` | 纯函数:围栏文本 → `CardSpec | null`;六种 kind 的字段白名单、上限、链接口径;**不认识的字段丢弃、不认识的 kind 回落** |
| 渲染 | `apps/web/components/XrayCard.tsx` | 六种 kind 各一个子组件;tabs / 折叠 / 排序 / 单选切面板的本地状态;`action` 经 props 回调到预填 |
| 接线 | `apps/web/components/Markdown.tsx` | `pre` 覆盖:`language-xray-card` 分流;新增 `cards?: boolean` 与 `streaming?: boolean` 两个 prop,默认都 false |
| 会话区 | `apps/web/components/workbench/Workbench.tsx` / `components/mobile/MobileChat.tsx` | 传 `cards` / `streaming`;`onAsk` 接到 `setDraft` |
| 提示词 | `apps/api/agent/runtime.ts` + `runtime.test.ts` | 卡片段(≤ 20 行);测试钉「每次最多两张」与六个 kind 名在 |
| faux 剧本 | `apps/api/agent/cards-e2e.test.ts`(或并进既有 e2e) | faux provider 吐六种 + 非法 + 超限,断言落库 `content` 原样(服务端不碰围栏) |
| 文档 | `docs/security.md` §0 第 11 条(已写)· `docs/architecture.md` 一段「会话区富内容 = 围栏 DSL,服务端不参与」· `design/README.md`(拉稿时)· `docs/releases.md` | |

**不交付**:pi 工具、`tool_config` 种子、`payload` / SSE 变动、迁移、MCP 变动、Notes 侧开卡片、图片 / 图表 / 图标、任何表达式或公式求值、
模型给的 HTML / CSS / JS、外部脚本或字体、卡片状态落库、`4z` 之后的移动端编号。

## 验收

| # | 检查 | 命令 / 期望 |
|---|---|---|
| 1 | 编译与测试 | `dev.ps1 check` / `dev.ps1 test` 全绿(web `bun test lib` 新增 `xray-card` ≥ 20 条:六种合法各一、每条上限各一、链接口径、未知 kind、未知字段丢弃、tabs 嵌套拒);`apps/web` `tsc --noEmit` 过 |
| 2 | 六种渲染 | 本机 faux 剧本:六张卡逐项对照 `2s` |
| 3 | 回落 | 非法 JSON / 超限 / 未知 kind → `xray-card` 代码块(既有代码块画法),对照 `2t` |
| 4 | 流式骨架 | 慢速 faux(逐字 delta):围栏未闭合期间是骨架、闭合后是卡;闭合后非法 → 代码块 |
| 5 | 折叠后仍在 | 一轮跑完(`2l` 折叠行出现)后卡片留在最终回答里 |
| 6 | 回放一致 | F5 前后会话区 `innerHTML` sha256 一致;历史会话(`GET /agent/sessions/:id`)渲染同样六张 |
| 7 | 交互 | tabs 切换 / 折叠 / 表头排序(字符串序,稳定)/ 单选切面板;刷新后回初始态;Network 零新增 |
| 8 | 动作按钮 | `action.ask` → 输入框带文本、未发送;R-CROSSLINK 未落地的分支里 `action` 不渲染 |
| 9 | 链接口径 | `javascript:` / `data:` / `//evil` / 相对路径不带 `/` 的 `href` 被丢弃;`http(s)` 与 `/notes/...` 保留且带 `rel` |
| 10 | 不解析 | 值里的 `<b>` / `**x**` / `$x$` 原样显示为文本 |
| 11 | Notes 不受影响 | 把同一段围栏放进一篇本机章节,`/notes/...` 渲染为代码块;`git diff` 不碰 `components/notes` / `skills` / `source` |
| 12 | 移动端 | 390 宽六张卡 `body.scrollWidth === innerWidth`;表格在容器内横滚;对照 `4y` / `4z` |
| 13 | 提示词 | `runtime.test.ts` 钉卡片段;真实 provider 上问一个「对比 A / B」类问题,拿到一张合法 `compare` 卡(留证在「本轮实测」) |
| 14 | 桌面既有零改动 | 画板之外的页面与组件 `git diff --stat` 为空(`Markdown.tsx` 的默认路径行为不变:`cards` 不传时与改前一字不差) |
| 15 | 文档同步 | `docs/architecture.md` 一段;`design/README.md` 增删记录;`docs/releases.md` 一行;MCP 51 不变 |

## 禁止

- 不做 pi 工具、不改 `payload` / SSE / 迁移 / MCP;不给 Notes 开卡片。
- 不引入图表库 / 表格库 / 富文本库;不渲染模型给的 HTML / CSS / JS;不做表达式求值;不加载外部资源。
- 动作按钮只能预填,不能发送、不能跳转、不能调用工具。
- 不把卡片状态落库或写存储。
- 默认继承两条:不改前端页面样式(规则 7,画板之外的一个像素都不动);不加设计稿没有的功能(规则 8)。

## 代码审查

<!-- 完成后回填。 -->

- 审查方式:codex `/codex:review --background`(前两轮全量;第 3 轮起 `--base <上一轮已审提交>`)。
  带给审查者的要求:只判定缺陷与严重级别,不展开设计方案;重点是 `xray-card.ts` 的校验是否闭合(未知字段 / 嵌套 / 上限 / 链接口径)与流式骨架的判定条件。
  **findings 若连续两轮落在同一块自建校验器上,停下回所有者重定方案,不堆补丁**(R-WEBFETCH 的教训)。
- findings 处理:<逐条>
- 结论:<PASS | 整改后 PASS>

## 失败处理

同一验收项针对性整改后连续 2 次验证仍不过 → 写 `rounds/round-cards/BLOCKED.md`,停下呼人。禁止放宽验收标准自我通过。

## 本轮实测

<!-- 完成后回填:真实 provider 上六种卡的命中率(问 10 个结构化问题各出几张、几张合法)、流式骨架的实际闪烁时长、与画板的偏离及原因、踩的坑 -->
