# Round R-CARDS — 会话区信息卡片:内容级 `xray-card` 围栏块 + 声明式交互

<!-- 保存为 rounds/round-cards/round-cards.md;该轮其他管理产出放同一目录。 -->

> 状态:**设计稿 2026-09-09 已并入、开工中**(所有者裁定 2026-09-08:下一阶段三轮里的第三轮,排在 R-LEAK / R-CROSSLINK 之后;两者已分别发版 `e8ac83e` / `995dc49`)。分支 `round-cards`。
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
  ✅ 2026-09-09 并入:Cards 55,339 B / 2 块;`Mobile - Runtime` 234,371 B / 14 块(**离 256 KiB 只剩 27 KB**,下次给移动 Runtime 加画板要先拆文件);`- Runtime` 的 `diff | grep -c '^<'` 为 0,直接覆盖;Prototype 与 `support.js` md5 未变。
- R-CROSSLINK 已落地(`action.ask` 依赖它的预填原语;**没有它 `action` 字段整个不渲染**,其余五种交互不依赖)。
- R-PERF 的骨架语汇(`2i`)、R-MOBILE 的 `m-xscroll` / `SegmentedControl`。无新凭据、无新依赖(不引入图表库 / 表格库)、无新容器、无迁移、MCP 仍 51。

## 与画板的对照关系(拉回设计稿后逐项填)

| 画板 | 页面 / 组件 | 核对项 | 结果(2026-09-09 本机,faux provider) |
|---|---|---|---|
| `2s` 桌面 · 六种卡片 | `components/XrayCard.tsx` + `Markdown.tsx` | 六种 kind 的解剖:标题行 / 主体 / 卡底链接与动作按钮;`collapsed` 态;卡与正文的间距(会话区节奏 14) | ✅ 外框 r6 + `rgba(0,0,0,.03)` + 1px `#e0e0e0`、marginTop 14;标题行 mono 10/600 `#9ca3af` 0.08em;stat 三格 22/650 mono + 竖分隔;kv 收起态只剩标题行 + › 箭头;table 全出血、`web_search` / `300 字符` 两列 mono、`分组` 列系统字(与画板一致);list 序号列 22;compare 首列次级色;tabs 胶囊组选中白底 + 品牌色 600;卡底两条链接(站外带 `↗` + `target=_blank` + `rel`)+ ghost 32 动作按钮;`javascript:` 链接被丢、卡照常画 |
| `2t` 桌面 · 骨架 / 回落 / 交互态 | 同上 | 流式骨架;非法 JSON 回落成 `xray-card` 代码块;tabs 切换态;表头排序态(升 / 降小箭头);折叠态 | ✅ 「停」剧本三阶段截图:围栏未闭合 → 卡框 + 标题条(r6,`omPulseBg`)+ 三条正文条;闭合的坏 JSON **在流式进行中就**是 `xray-card` 代码块(2c 画法、无错误提示);闭合合法 → 卡。表头点第二列:降 ˅ → 升 ˄,当前列整格品牌色、列宽不动(221/128/88/107 两次一致);tabs 切到 Bun 1.2 只换主体;collapsed kv 点开 6 行、箭头转 ˅ |
| `4y` 移动 · 六种卡片 | `MobileChat.tsx` 走同一组件 | 横滚容器、堆叠规则、胶囊 tabs | ✅ 390 宽:`body.scrollWidth === 390`;stat 两列(176.6 × 2,第 2 格左分隔、第 3 格上分隔);table 单元格 nowrap、盒内横滚(377 > 353)、超出卡片右缘直接裁切;compare 堆叠(表头隐藏、行 block、A / B 各一行 `104px + 1fr`、列名 mono 10 小标题);tabs 换 `SegmentedControl` 皮(r9 容器 + 白底投影选中、**不套品牌色**);动作按钮胶囊 44 高 r22 `--m-fill` 品牌色 600、换到链接下方独占一行;链接各 32 高;collapsed 标题行 44;正文 p 15px 而卡内 13px(内核 token 照搬) |
| `4z` 移动 · 骨架 / 回落 / 交互态 | 同上 | 对位 `2t` | ✅ 同一组件、同一段 CSS:骨架条宽 100% / 100% / 62%(标题条 210 + `max-width:100%`);回落代码块正文横滚(既有 `pre` 的 `overflow:auto`);交互三连与桌面同一份状态 |

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

### 验收结果(2026-09-09,本机;faux provider 三套剧本:`六张` / `慢` / `停` / `工具`)

| # | 结果 | 留证 |
|---|---|---|
| 1 | ✅ | `dev.ps1 check` 过;`dev.ps1 test`:api 35 文件 / 613 用例(新增 `cards-e2e` 1 条 + `runtime.test` 3 条,全绿)+ web `bun test lib` 88 用例(新增 `xray-card.test.ts` **32 条**);`apps/web` `tsc --noEmit` 过 |
| 2 | ✅ | `六张` 剧本:会话区 `[data-xray-card]` = stat / kv / table / list / compare / tabs 各一,逐项对照 2s(见上表) |
| 3 | ✅ | 同一轮里尾逗号坏 JSON 与 21 行超限两张 → 两个 `xray-card` 代码块(2c 画法、语言标签 `xray-card`、无错误提示);`lib` 用例另钉未知 kind / 缺 `v` / 类型不对 / 行长不等 / tabs 套 tabs |
| 4 | ✅ | `停` 剧本(正文停在围栏中间 25 s × 2):阶段①骨架(卡框 + 标题条脉动 + 三条正文条)→ 阶段②第一张换成卡、闭合的坏 JSON **立刻**是代码块、第二张骨架 → 阶段③ 2 卡 + 1 代码块、发送按钮回常态。判据是 `fenceUnterminated`(代码正文是整篇正文的后缀 = 未闭合),不靠解析器 position |
| 5 | ✅ | `工具` 剧本(先 `notes_search` 再吐正文):折叠行「处理详情 · 2 次模型往返 · 1 次工具调用 · 1.4s」出现在最上面,两张卡在折叠行**之下**的最终回答里(`compareDocumentPosition` FOLLOWING) |
| 6 | ✅ | `六张` 会话:实时渲染完 → 会话区 `innerHTML` sha256 `dcd4e581…0b228b`(38,168 字节);F5 后从侧栏重开同一会话 → 同一哈希、同六张卡 + 两代码块 |
| 7 | ✅ | tabs 切换 / 折叠展开 / 表头升降序(`Intl.Collator` numeric:300 > 128 > 120 > 64 > 60,稳定)/ 单选切面板都是本地状态;F5 回初始态(#6 的哈希相等即证);交互期间 Network 无新增 `/agent/*` 请求(与 #6 同一次会话) |
| 8 | ✅ | 点「帮我按这五步写一份接入清单」→ 输入框 `value` 正是 `action.ask`、聚焦、`md-chat` 数不变、未进入生成态;`onAsk` 不传时 `XrayCard` 不渲染按钮(`Markdown` 默认 `onAsk` 为空) |
| 9 | ✅ | `lib` 用例:`javascript:` / `data:` / `//evil` / `notes/a`(不带 `/`)/ `mailto:` / 超长 → 丢该条;`http(s)` 与 `/notes/…` 保留并标 `external`;浏览器里两条链接都带 `rel="noreferrer noopener"`,站外多 `target=_blank` |
| 10 | ✅ | `工具` 剧本的 kv:`<b>粗体标签</b>` / `**星号** 与 \`反引号\`` / `$x^2$ 与 $$y$$` / `[点我](javascript:alert(1))` 全部原样显示,单元格只有文本节点(`children.length === 0`) |
| 11 | ✅ | 往本机 `notes_chapters` 临时插一章、正文带同一段围栏 → `/notes/pi/tmp-xray-card-check` 渲染为 `xray-card` 代码块、`[data-xray-card]` 为 0(验完删行);`git diff` 不碰 `components/notes` / `skills` / `source` |
| 12 | ✅ | 390 × 845 移动壳:`body.scrollWidth === innerWidth`;表格在 `.xcard-scroll` 内横滚;逐项对照 4y / 4z(见上表) |
| 13 | ◐ | `runtime.test.ts` 钉住卡片段(零工具 / 有工具都送达、排在工具段落之后、六个 kind / 最多两张 / 8 KB / 不套 tabs / 不发送);`cards-e2e` 断言这一段真的到了 provider。**真实 provider 上的命中率待发版后在生产留证**:本机 `llm_config` 为空、没有任何真 key,不为此借用生产凭据 |
| 14 | ✅ | `git diff --stat main -- apps/web` 只有 `Markdown.tsx` / `Workbench.tsx` / `MobileChat.tsx` / `globals.css` 四处接线 + 三个新文件;`Markdown` 的 `cards` 不传时 `pre` 路径一字不变;`apps/api` 只有 `runtime.ts` 一段提示词 + 两个测试文件 |
| 15 | ✅ | `docs/architecture.md` 关键决策表新增一行;`docs/security.md` §0 第 11 条改「已落地」并指到边界;`design/README.md` 增删记录;MCP 仍 51(`docs/mcp.md` 未动);`docs/releases.md` 发版时补 |

### 数字与偏离

- **与画板的偏离(都是实现者定、画板没画到的角落)**:① `table` 列宽按内容自动(`width:100%` + auto layout),不是画板标注的 226/128/96/188 定宽 —— 那四个数是画板按那五行内容排出来的,排序只换行序、内容集合不变,列宽实测两次一致;② 无序 `list` 的项目符号取 mono `·`(画板只画了有序);③ 骨架标题条取 2t 的 210(4z 是 196),加 `max-width:100%` 让窄卡收得住;④ 没有标题行时主体上沿给 10px(画板六张卡都带标题);⑤ `collapsed` 但没有 `title` 时**不回落、按展开画**(标题行是收起态唯一的把手,没有把手的折叠态画不出来;记在 `lib` 头注释与用例);⑥ 有限数字值放行并转成字符串(`"value": 34` 模型几乎一定会写,它仍是纯文本);⑦ 移动端 `compare` 堆叠与 `stat` 两列按**卡内宽**用 CSS 容器查询判(画板 4y 的规则边界是卡宽 ≥ 480 不堆叠),不支持容器查询的老 webview 退化成桌面三列版式(记 BACKLOG);⑧ 堆叠态的列名小标题原样用 `columns` 里的字(画板把「Claude Agent SDK」缩成「CLAUDE SDK」是画布示意)。
- **流式骨架实际时长**:模型正常吐字时 = 从 ```xray-card` 那一行到闭合那一行的到达间隔(faux 400 字 / 300 ms 的档位下不足一秒);`停` 剧本人为拉到 25 s 才截得到图。
- **桌面既有页面**:`git diff --stat main -- apps/web` 之外零改动;`Markdown` 默认路径一字不变(验收 #14)。
- **提示词**:卡片段 12 行、六个形状各一行,排在所有工具段落之后、零工具也送达;`runtime.test.ts` 的「底座不点名任何工具」用例对它同样成立(段落里没有 `notes_` / `web_search` / `generate_image` / `session_rename` / `skill`)。

### 踩的坑

- **pi 在 `systemPromptOverride` 之后追加 `<project_context>`**(cwd 向上找到的仓库根 `AGENTS.md` + 「Current working directory」一行):`cards-e2e` 起初断言「卡片段是最后一段」,红了才发现;改成「它后面再没有工具段落」。生产容器里应为空但未核实,记 BACKLOG。
- **`cards-e2e` 起初照 `skills-e2e` 清空并复原 `tool_config`**,复原种子少了迁移 016 的三个 `source_*` 行,让 `source-tools.test.ts` 按文件顺序红(全量跑第一次 1 failed)。改成**不碰 `tool_config`**(假 LLM 从不发 tool call,工具开着无妨);同一根因 BACKLOG 里 R-SOURCE 已记过一条。
- **本机验收期间编辑 `apps/api` 下任何文件都会让 `encore run` 热重载**,在途的 `/agent/ask` SSE 被掐断、那一轮既无助手消息也无轨迹落库、前端停在「生成中」—— 第一次发 `六张` 就撞上(改了测试文件)。重发即可,记 BACKLOG。
- **Browser pane 隐藏时页面定时器被节流**:`javascript_tool` 里 `setTimeout` 轮询会超时(45 s),`requestAnimationFrame` 合帧的 delta 也只在下一次事件才提交(JS 快照比截图落后一拍)。判据改成:`computer.wait` 分段等待 + 每段一次短 JS + 截图为准;流式期间的中间态靠 faux 服务器人为停顿(`停` 剧本)而不是靠轮询抓。
- **Bash 工具的 heredoc 会把 `\\n` 折成 `\n`**(用户级 CLAUDE.md 记过的坑,这次在 python 脚本里再撞两次:`\n` 变成真换行进了 TS 源码,vitest 报 Transform failed)。含转义序列的脚本一律 Write 工具写成文件再跑。
- **GhostButton 内联的 `font: inherit` 简写**会把移动端胶囊的 `font-weight: 600` 冲掉(BACKLOG 里 R-MOBILE 记过同源问题),这里在 `.xcard-action` 上补 `!important`。
