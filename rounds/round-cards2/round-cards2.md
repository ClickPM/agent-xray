# Round R-CARDS-2 — 会话区 UI 组件 2.0:可回传卡片(A)+ 沙箱静态 HTML 组件(B)

<!-- 保存为 rounds/round-cards2/round-cards2.md;该轮其他管理产出放同一目录。 -->

> 状态:**实现完成、审查中**(所有者裁定 2026-09-09;设计稿同日并入 `design/`,同日在分支 `round-cards2` 实现;本机验收 20 项全过,见「本轮实测」)。
> 所有者原话(2026-09-09):「给 agent 增加一个 UI tools,支持回复结果中在对话区展示 UI 组件,由 agent 自主决定根据当前回答是否使用这个 tools」,三条限制:
> ① 支持两个区域二选一展示(折叠区和最终 message 中间 / 在 message 后面);② UI 组件提供几个标准模板,可直接套用模板生成样式,支持交互式样式,以及交互数据回传对话;
> ③ 支持不使用标准模板,只定义高度和宽度限制,由模型自主决定生成内容,类似 artifacts。
> 讨论时给出四档 A / B / C / D(见「所有者裁定」第二张表),所有者圈定 **A + B 合成一轮,C / D 暂不考虑**(记 BACKLOG)。
> **同日两处调整**(所有者):(a)回传不走预填 —— **单选点选项直接发送;多选加 submit 按钮,点击后发送**(表单同 submit 发送,实现者按同一口径推定,见裁定表第 4 行);
> (b)**每轮组件上限仍是两个**(与 R-CARDS「最多两张」一致,不收成一个)。
> 与 R-CARDS 同一形态:**仍是内容级围栏、不是 pi 工具**。名字里的「tools」沿用所有者口径,不指 pi 工具;工具级 = D 档,未选。
> 与 R-TOOLS / R-PERF / R-TOOLCARDS / R-SOURCE / R-CROSSLINK / R-CARDS 同一顺序、**不是**规则 8 的例外:画板先扩(桌面 `2u` / `2v` 放**新文件**
> `Agent X-Ray Cards 2.dc.html`;移动 `5a` / `5b` 放**新文件** `Agent X-Ray Mobile - Runtime 2.dc.html`,`5x` 号段待所有者确认),并入 `design/` 之后才开 `round-cards2`。
> 给 Claude Design 的提示词在 [`design-prompt.md`](design-prompt.md)。规则 9「先改文档」:`docs/security.md` §0 第 11 条已修订,第 12 条(卡片点击即发 = 模型预制的访客消息)
> 与第 13 条(模型输出渲染成自由 HTML)已随本任务卡写入。

## 目标

agent 在回复**最终回答**的开头或结尾嵌组件,**每轮最多两个**,两类任意组合:

- **A · 可回传卡片**:`xray-card` 在六种既有 kind 之外新增 `choice`(单选 / 多选)与 `form`(≤ 5 个字段)两种。**回传 = 发送**:
  单选卡点选项**直接把一句话作为访客消息发出**;多选卡与表单卡有一枚 submit 按钮,点击发送。发出的那句话**只由卡上可见的文本组成**
  (题干 + 所选 label / 字段 label + 访客自己填的值),没有隐藏模板;走既有 composer 发送路径,api 侧零改动。
- **B · 静态 HTML 组件**:模型写一个 ` ```xray-html ` 围栏,里面是 HTML + CSS,会话区把它渲染进一个**全部限制**的 `<iframe sandbox="">`:
  不执行脚本、不出网、不出链、拿不到父页任何东西;宽 = 会话区正文宽,高由模型在围栏 info string 里声明并夹到上限,帧内滚动。

两者共用 R-CARDS 的三条既有规则:非法 / 超限回落成普通代码块;流式期间围栏未闭合先画骨架;刷新回放与实时一字不差。
**每轮最多两个组件**由前端硬限(最终回答段的前两个围栏),不再只靠提示词。

可证伪:faux provider 按剧本吐出 `choice` 单选 / 多选与 `form` 各一张、一个合法 `xray-html`、一个 16 KB + 1 字节的 `xray-html`、一条同一回复里三个围栏的回复、
一个含 `<script>` / `<img src="https://…">` / `<a href="https://…">` / `<meta http-equiv="refresh">` / `<link>` / CSS `url(https://…)` 的 `xray-html`;
会话区渲染三张卡 + 一帧 + 一个代码块 + 「第三个围栏是代码块」;点单选卡的一个选项 → 会话区立刻出现一条访客气泡、文本**精确等于**题干 + `: ` + 该选项 label,`POST /agent/ask` 被调用一次;
帧内 DOM 没有 `script` / `img` / `meta` / `link`,`href` 只剩 `#` 开头的;Browser pane 的网络面板**零第三方请求**;F5 前后会话区 `innerHTML` 的 sha256 一致;
`git diff --stat main -- apps/api` 只有 `runtime.ts` 的提示词段与它的测试。

## 所有者裁定(2026-09-09)

三条限制 + 两处调整 → 结论:

| # | 裁定项 | 结论 | 落点 |
|---|---|---|---|
| 1 | 位置二选一 | 位置① = **最终回答首**(折叠行之后、第一段正文之前);位置② = **最终回答末**。内容级下位置就是围栏在正文里的位置:由**提示词**约束,前端不搬动内容。两个组件可以一首一尾,也可以同在一处 | `runtime.ts` 组件段;画板 `2u`(①)/ `2v`(②) |
| 2 | 数量 | **每轮最多两个**(卡或 HTML 任意组合;所有者 2026-09-09 二次确认,不收成一个)。**前端硬限**:只有**最终回答段**的**前两个** xray 围栏渲染成组件,第三个起回落代码块;处理过程段里的围栏一律回落 | `Markdown.tsx`(组件预算)+ 提示词 |
| 3 | 标准模板 + 交互 | 沿用 `xray-card` 六种 kind 与四种声明式交互,**新增两种可回传 kind**:`choice` / `form`。不新造第三套语汇 | `lib/xray-card.ts` · `XrayCard.tsx` |
| 4 | 交互数据回传 | **回传 = 发送**(所有者 2026-09-09 调整,推翻讨论时的「预填档」):`choice` 单选**点选项即发送、没有按钮**;`choice` 多选与 `form` 有一枚 **submit 按钮**,点击发送(表单沿用 submit 口径,所有者未单独点名,实现者推定、可推翻)。发送走既有 composer 的发送函数,api 零改动。**发出的文本只由卡上可见文本组成**(WYSIWYG),这是本条的安全边界,见 `docs/security.md` §0 第 12 条 | `XrayCard.tsx` 的 `onSend` · `Workbench.tsx` / `MobileChat.tsx` 接线 |
| 5 | 自由内容 | ` ```xray-html ` → `<iframe sandbox="" srcdoc>` **静态档**:不给 `allow-scripts`、**永不**给 `allow-same-origin`;帧文档头部注入 meta CSP 不出网;前端窄清洗不出链、不换页 | `lib/xray-html.ts` · `XrayHtml.tsx` |
| 6 | 只定宽高 | 宽 = 会话区正文宽,模型控不到;高由模型在 info string 声明 `height=<px>`,夹到 **[160, 480]**(移动端上限 360),缺省 320;内容超高在帧内滚 | 同上 |
| 7 | 开关 | **v1 无运行期开关,关 = 发版**(与 R-CARDS 卡片、`runner/skills` 集合同口径)。关的语义是「模型不再产出」:api 侧一个常量掐掉提示词里的 HTML 段;历史消息里已产出的组件显示到会话过期(R-VISITOR 3 天)。MCP 运行期开关(表 + 两个工具 + 读端点)记 BACKLOG | `runtime.ts` |
| 8 | 不做 | **C 档**(帧给 `allow-scripts` + postMessage)与 **D 档**(pi 工具级 + 结构化回传 / 挂起等答)暂不考虑,记 BACKLOG;要做另裁定 | — |
| 9 | 顺序 | 先画板、再进轮次 | `2u` / `2v` + `5a` / `5b` |

讨论时的四档(记录用;A + B 被圈定,A 的回传随后由「预填」调成「发送」):

| 档 | 内容 | 机制代价 | 要动的约束 | 裁定 |
|---|---|---|---|---|
| A | `xray-card` 扩 kind(choice / form)+ 回传 | 零(前端 lib + 提示词 + 画板;发送复用 composer) | §0 第 10 条「不自动发送」开一条例外 → 新写第 12 条 | **做** |
| B | 新围栏 `xray-html`,sandbox iframe 静态档,内嵌 CSP,窄清洗 | 小(一个 iframe 组件 + 上限 + 骨架) | §0 第 11 条改写、加第 13 条 | **做** |
| C | B 的帧给 `allow-scripts`,postMessage 回传 | 中(第一处模型 JS 在访客端执行) | 第 13 条再改、加新威胁 | 暂不考虑 |
| D | 改成 pi 工具(R-CARDS 的 2-B)+ 结构化回传(挂起等答) | 重(payload / SSE / 2l 例外 / pending 登记 / 新端点) | 反转 R-TOOLCARDS 与 R-CARDS 两条裁定 | 暂不考虑 |

**为什么 A 与 B 拆成两个围栏、不装进同一个「UI tool」**:模板的安全来自闭集(JSON → 字段白名单 → React 元素),自由 HTML 的意义就是不闭集;
装在一起风险面按最松的那个算。分开之后 A 的路径与 R-CARDS 一字不差地延续,B 的三层防线只护 B。

**「点击即发」为什么还能收住**(讨论时我把它列为要单独裁定的一档,所有者已裁定做;边界正本是 `docs/security.md` §0 第 12 条):
预填的兜底是「访客发前能看见、能改」;改成发送后这一步没了,兜底换成三件事 ——
① **发出的文本 = 卡上可见的文本**:`prompt` 题干、所选 `label`、字段 `label`、访客自己填的值,**没有** `ask` 这类模型写、访客看不见的模板串;发出去的气泡与访客刚看到、刚点的字一一对应;
② **只由访客的一次点击触发**,渲染 / 滚动 / hover 都不触发,一轮生成中(`busy`)禁用,发过即锁;
③ **走既有 composer 发送路径**:同一个 `send`、同一套会话 / 配额 / 4000 字上限,服务端看到的就是一条普通访客消息,api 一行不改。
残余风险 = 模型通过「给选项」引导对话走向,那正是这个功能本身;所有者已认。

派生取舍(实现者定,画板照此画;可推翻):

1. **`choice` DSL**(`v` 必填 = 1):

   ```json
   { "v": 1, "kind": "choice", "title": "…", "prompt": "…", "multiple": false,
     "options": [{ "label": "…", "note": "…" }],
     "submit": "提交" }
   ```

   `options` 2–8 项,`label` ≤ 60、`note` ≤ 200(可选);`prompt` ≤ 200(可选,题干一行;**强烈建议写**,否则发出的文本只有 label);`multiple` 缺省 false;
   `submit` 只在 `multiple: true` 时有意义(按钮文案,≤ 20,缺省「提交」),单选卡**没有按钮**。
   **发送文本**:`prompt` + ASCII `: ` + 已选 `label` 按原顺序以「、」相连;没有 `prompt` 时只有 label 部分。单选:点选项即发送;多选:至少选中一项前按钮禁用。
   `action`(R-CARDS 的预填按钮)在两种新 kind 上**被忽略**(不回落,与 `collapsed` 无 `title` 时的处理同口径):一张卡只有一个出口。
2. **`form` DSL**:

   ```json
   { "v": 1, "kind": "form", "title": "…", "prompt": "…",
     "fields": [{ "label": "…", "type": "text", "placeholder": "…", "required": true },
                { "label": "…", "type": "select", "options": ["…", "…"], "required": false }],
     "submit": "提交" }
   ```

   `fields` 1–5 个,`type` 闭集 `text` / `select`;`label` ≤ 40、`placeholder` ≤ 100(可选)、`select.options` 2–8 项每项 ≤ 60、`required` 缺省 false;
   text 输入框 DOM `maxLength = 100`;`submit` ≤ 20,缺省「提交」。
   **发送文本(单行)**:`prompt`(有则跟一个 ASCII 空格)+ 每个非空字段的 `label` + ASCII `: ` + 值,字段之间以 ASCII `; ` 相连。全部 `required` 字段非空前按钮禁用。
   **为什么是单行**:发送前的清洗(复用 `sanitizePrefill`,去全部 `\p{Cc}` 含换行)会把多行压成一行、分隔消失;从一开始就按单行设计。
   分隔符**用 ASCII** 是刻意的:源码里手打的全角标点在本机会落成半角(项目记忆),按 ASCII 写就不存在这个问题。
3. **发送文本长度可证明 ≤ 1000**:清洗函数对超过 1000 的原文是「整段丢弃」,访客点了却没消息发出是最坏的体验。所以校验器在**解析期**按与清洗同一计量(UTF-16 `.length`)算
   **最坏组成长度**,超过 1000 **整卡回落**;运行期不再可能超。来源:`choice` 最坏 = 200 + 2 + 8 × 60 + 7 = 689;`form` 最坏 = 200 + 1 + 5 × (40 + 2 + 100 + 2) = 921。
   text 的 `maxLength` 按浏览器语义也是 UTF-16 单位,三处同一把尺;服务端 `MAX_PROMPT_CHARS = 4000` 远在其上。
4. **发送的接线**:`Workbench.tsx` 现有 `send`(读输入框状态)拆成 `sendText(text)` + `send = () => sendText(input)`,两条路径**同一个函数体**(建会话 / busy 守卫 / 错误分档 / 计数都不分叉);
   `XrayCard` 新增 `onSend(text)`,与既有 `onAsk` 并列,由会话区注入(与 `onAsk` 同一处)。发送前 `sanitizePrefill(text)`(名字是历史,函数就是「去控制字符 + 长度闸」),回 `null` 不发。
   **触发只认 React `onClick`**(选项行 / submit 按钮),键盘可达(Enter / Space 走同一 handler);不在 `onChange` / `onFocus` / effect 里发。
5. **两种态**:(a)**busy** —— 一轮生成中,选项与按钮禁用(与 composer 发送按钮同一判据、同一禁用视觉);(b)**已发送锁定** —— 发出后本卡选项不可点、已选高亮保留、按钮禁用、
   文案不变(不新增「已发送」字样,画板若给了再加)。锁定是**本地状态**,刷新回初始态(与 R-CARDS 第 8 条一致):重放后老卡又能点、再点 = 再发一条访客消息,认下(见已认代价)。
6. **两种新 kind 不能嵌进 `tabs`**(与「tabs 里不能再套 tabs」同一条);`collapsed` / `links` 按通用规则。
7. **最多两个的实现**:`AssistantMessage` 给**处理过程段**不传组件开关(`cards` / `html` 都不传,围栏全部回落代码块、进折叠行),给**最终回答段**传;
   渲染器只把最终段里**前两个** xray 围栏(不分卡 / HTML)当组件,第三个起走代码块出口。流式期间「最终段」= 最后一次工具调用之后的正文:
   若模型在组件之后又调了工具,这些组件会随正文进折叠行并变回代码块 —— 提示词要求组件只写在最终回答里,这条边界情况认下。
8. **`xray-html` 围栏与高度**:语言标签 `xray-html`,info string 只认一个键 `height=<整数>`(如 ` ```xray-html height=320 `)。
   读法不依赖 hast 的 `data.meta`:`Markdown` 已持有 `source` 与开围栏行号(`fenceUnterminated` 用的那两样),直接从源文本那一行取 info string。
   夹到 [160, 480](移动端 ≤ 360,按既有移动判据或容器查询,画板定);非整数 / 缺省 → 320。**骨架按夹取后的高度立住**:开围栏行一到高度就定了,闭合时不跳版。
9. **`srcdoc` 由父页拼装**,模型片段只占 body:

   ```
   <!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
   <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
   <style>…基础样式 + --xh-* 变量…</style></head><body>…清洗后的片段…</body></html>
   ```

   模型片段里的 `</body></html>` 逃逸无效(整段都在 sandbox 里,后面接的任何东西同样不执行、不出网);模型自己再写一条 meta CSP 只会与父页那条**取交集**,放松不了。
   基础样式:`margin:0; padding:12px; box-sizing:border-box; font:14px/1.6 var(--xh-sans); color:var(--xh-fg); background:var(--xh-bg); overflow-wrap:anywhere`,`svg, table { max-width: 100% }`。
   **帧元素**:`sandbox=""`(空串 = 全部限制)、`srcDoc`、`referrerPolicy="no-referrer"`、`loading="lazy"`、固定 `title`(如「agent 生成的组件」)、`width:100%`、`height` = 夹取值、无 `allow` 属性;
   按(围栏原文, 主题)记忆化,一次围栏只建一次帧、无关重渲染不重建(重建 = 帧闪)。
10. **窄清洗(`DOMParser` 一遍)的职责只有一件:不出链、不换页**。sandbox 与 CSP 都拦不住帧**自导航**(`<a href>` 点击、`<meta http-equiv="refresh">`),
    帧内加载第三方页 = 访客 IP 泄给第三方 + 站内出现看不到地址栏的外站内容(威胁 9 的同族)。清洗规则:
    - 去元素:`script` / `iframe` / `frame` / `frameset` / `object` / `embed` / `applet` / `form` / `input` / `textarea` / `select` / `button` / `meta` / `link` / `base` / `img` / `picture` / `source` / `video` / `audio` / `track`;
    - 去属性:所有 `on*`;所有 URL 承载属性(`href` / `src` / `srcset` / `xlink:href` / `action` / `formaction` / `poster` / `ping` / `background` / `data` / `cite` / `longdesc` / `usemap`),
      **除非**值去掉空白与控制字符后以 `#` 开头(帧内锚点);`target` 一律去;
    - 保留:`style`(元素与属性;`@import` / `url()` 的外部抓取由 CSP 挡)、`details` / `summary`(**唯一**的无脚本交互)、内联 `svg`(`use href="#id"` 可用)、`math`、表格 / 列表 / 标题 / `pre` / `code` / `blockquote` 等全部排版元素。
    **它不是 XSS 防线**:「不执行」由 sandbox 保证,清洗被绕过的最坏结果是一次点击后帧内换页,那个页仍在同一个 sandbox 里。所以**不引 DOMPurify**:
    自写窄清洗的判定部分是两个纯函数(`shouldDropElement(tag)` / `shouldDropAttribute(name, value)`),`bun test lib` 钉住;DOM 遍历是薄壳,整体在 faux 剧本 + Browser pane 里用夹具核(验收 #9)。
    审查者或所有者若更想要 DOMPurify(多一个运行时依赖,§7 供应链),改这一条即可。
11. **主题跟随**:拼 `srcdoc` 时从父页 `getComputedStyle(document.documentElement)` 读站点既有的颜色 / 字体变量,注成 `--xh-bg` / `--xh-fg` / `--xh-muted` / `--xh-border` / `--xh-brand` / `--xh-sans` / `--xh-mono`;
    切换主题 → 依赖变化 → 重拼 `srcdoc` → 帧重载(静态内容,肉眼一闪,无状态可丢)。提示词要求配色只用 `var(--xh-*)`,不强制。
12. **上限**:围栏正文 ≤ **16 KB**(UTF-8 字节,复用 `xray-card.ts` 的 `TextEncoder` 计量),超过整段回落代码块(语言标签 `xray-html`)。
    为什么不是 artifacts 常见的 32–64 KB:16 KB ≈ 5k token,流式期间访客要盯着骨架约一分钟,也直接计入访客配额;静态 HTML + CSS 画一张时间线 / 架构示意 3–8 KB 足够。
    提示词**建议** ≤ 6 KB。**流式期间不做渐进渲染**:每个 delta 重拼 `srcdoc` = 每个 delta 重载帧;围栏闭合前只有骨架。两个组件都是 HTML 时上限相加(最坏 32 KB),不另设总量。
13. **只在会话区开**:`Markdown` 加 `html` prop(默认关),`Workbench.tsx` / `MobileChat.tsx` 只给最终回答段传;Notes / Skills / Source 的渲染器不传,
    同一段 ` ```xray-html ` 在那里就是代码块(Notes 正文契约「标准 markdown」不扩)。
14. **移动端**(`5a` / `5b`):`choice` 选项行与 `form` 输入框 44 命中,submit 按钮胶囊、独占一行(照 `4y` 的既有裁定);帧高上限 360,帧宽 = 正文宽,帧内横向内容在帧内滚、页面不横滚。
    单选卡在触屏上**一次点按即发送**,误触成本所有者已认;滚动手势不触发 click,这是浏览器语义。`form` 的输入框在会话列表里聚焦时,依赖浏览器默认的 `scrollIntoView` 不被键盘遮住
    (R-MOBILE 的键盘避让原语只管 composer),验收 #16 实测。
15. **回放 = 实时**:两种新卡的选择 / 填写 / 锁定是纯前端状态,不产生事件、不落库,刷新回初始态;`srcdoc` 是(围栏原文, 主题)的确定性函数,同一主题下刷新前后一字不差。
16. **提示词**(`runtime.ts`,`CARDS_CLAUSE` 扩成组件段,仍单独一段、与工具无关、永远最后一段):
    ① **每次回复最多两个组件**(卡或 HTML 任意组合),放在最终回答的**开头或结尾**、不放中间、不放处理过程里;
    ② 什么时候用卡(结构化数据,沿用 R-CARDS 口径)、什么时候用 `choice` / `form`(要访客做选择 / 提供几项信息再继续时)、什么时候用 HTML(布局类:时间线 / 流程 / 架构示意 / 带排版的说明,八种卡装不下的);
    ③ 两种新 kind 的形状各一行 + **回传语义**:访客点选项 / 按钮后,「题干: 选项」或「题干 字段: 值; …」会**作为访客的下一条消息直接发出**,所以 `prompt` 要写成一句完整的问题、`label` 要能单独成立、
    发出的那句话模型下一轮会原样收到;
    ④ HTML 规则:只写 HTML + CSS;不写 `script` / 表单 / 链接 / 图片 / 任何外部资源(会被去掉或拦下,写了等于白写);配色只用 `var(--xh-*)`;开围栏行声明 `height=<px>`(160–480);建议 ≤ 6 KB、上限 16 KB;
    ⑤ 沿用:正文不复述组件内容但要能独立成句。**提示词修补也走完整 codex 循环**(项目记忆)。
    `HTML_COMPONENT_ENABLED` 常量掐掉的是 ④ 与 ② 里的 HTML 半句,卡片段不受影响。

**已认代价**(所有者 2026-09-09 圈定 A + B 并调整回传方式时一并认下):

- **访客失去发前审阅**:点选项 / 按钮即发送,不再经输入框。兜底换成「发出的文本 = 卡上可见的文本」与「只由一次点击触发」(§0 第 12 条);
  模型仍能通过给什么选项来引导对话,这是功能本身。触屏误触即发一条消息。
- 刷新后老卡解锁、再点再发(锁定是本地状态);每次都是一条普通访客消息、计入既有配额,无放大。
- 模型写坏 HTML 时访客看到的是一个 `xray-html` 代码块里最多 16 KB 的裸 HTML(R-CARDS 同类代价,更长);缓解只有提示词与 faux 剧本回归。
- **关 = 发版,且只停产出**:历史消息里已产出的组件继续显示到会话过期,不回溯隐藏。
- 帧内**没有脚本**:交互只剩 `details` / `summary`;想要 JS 交互 = C 档,另裁定。帧内**没有链接与图片**:要链接写在正文 markdown 里(既有口径)。
- 切换主题时帧重载一闪(静态,无状态丢失)。
- 模型输出成本上升:一个 6 KB 组件 ≈ 2k 输出 token,两个组件都是 HTML 时最坏 32 KB;计入既有 `total_tokens` 与日配额,**不加新限额**。
- 窄清洗可能有漏,漏的后果被 sandbox 封在「一次点击后帧内换页」;修漏 = 改判定函数 + 加夹具,不改机制。
- iOS WebKit 对 iframe 尺寸历史上有「按内容撑开」的怪癖,本轮验收只到 Browser pane 的移动预设,**所有者真机核一次**。
- 处理过程段里的卡片改为代码块(所有者若觉得处理过程段该保留卡片,改 `AssistantMessage` 一处传参即可)。
- Timeline 里仍没有「画了组件」的事件(同 R-CARDS);由卡片发出的访客消息在 Timeline 里就是一次普通 `turn_start`,不标来源。

## 前置

- **设计稿**:`2u` / `2v`(新文件 `Agent X-Ray Cards 2.dc.html`)+ `5a` / `5b`(新文件 `Agent X-Ray Mobile - Runtime 2.dc.html`),四项判据(字节数 / 闭合标签 / div 开合 / 画板数)全过后并入 `design/`。
  **`5x` 号段待所有者确认**(CLAUDE.md 规则 8 只写了「建议移动端继续占 `5x` 段从 `5a` 起」);确认前提示词按 `5a` / `5b` 写,若改号段只改编号不改内容。
  两份既有大文件都不碰:`Workbench` 离 256 KiB 只剩 9 KB,`Mobile - Runtime` 只剩 27 KB(一块移动画板约 27 KB,放不进)。
- R-CARDS `d342b18` 与 R-CROSSLINK `995dc49` 已在生产:卡片渲染路径、骨架语汇、`m-xscroll` / `SegmentedControl`、composer 的 `send` / `busy` 都在。
- 无新凭据、无新依赖(不引 DOMPurify / iframe-resizer / 图表库)、无新容器、无迁移、无新端点、MCP 仍 51。

## 与画板的对照关系(拉回设计稿后逐项填)

| 画板 | 内容 | 实现落点 | 状态 |
|---|---|---|---|
| `2u` | 桌面 · 两种可回传卡 + 位置① + 单选发送后的锁定态与紧随的访客气泡 + 多选 / 表单的 submit 禁用与可用态 + busy 态 | `XrayCard.tsx`(`Choice` / `Form` / `Indicator` / `Prompt`)· `ComposerContext.tsx`(busy / onSend)· `Workbench.tsx`(`sendText` / `sendFromCard`) | ✅ 已落地(2026-09-09):选择指示 15px 圆点 / r4 方框、常态 `--border` + 白底、选中 `--accent`;选项行 padding 9/12 + 1px 行间;题干 13/1.7 `--text-muted`;submit = 既有 `GhostButton` 32/r7;三态(idle / busy / locked)按标本①–⑦ |
| `2v` | 桌面 · `xray-html` 帧 + 位置② + 流式骨架(按声明高度)+ 回落代码块 + 高度夹取 + 主题态 + 「一轮两个组件」示意 | `XrayHtml.tsx`(帧 + 骨架 + 主题快照)· `lib/xray-html.ts` · `ChatFence.tsx`(三个出口 + 预算) | ✅ 已落地:帧 r7 + 1px `--border`、无工具栏、`marginTop` 14 与代码块同节奏;骨架 = 同一外框 + 三条 r4 骨架条(首条 `omPulseBg`);回落 = `CodeBlock`(语言标签 `xray-html`);主题态照标本⑤(注入九个 `--xh-*`) |
| `5a` | 移动 · 两种可回传卡(44 命中、胶囊 submit、键盘弹起态、锁定态) | `globals.css`(`.xcard-opt` / `.xcard-submit` / `.xcard-input` 三组移动规则)· `MobileChat.tsx`(零改动,靠 Context) | ✅ 已落地:选项行 min-height 44 + 指示居中;submit 胶囊 44 / r22 / `--m-fill` 底 / 品牌色 15/600 / 独占一行;输入框 44 / r10 / `--m-fill` / 15px,聚焦白底 + 品牌色描边,锁定底 `.08`。键盘弹起态靠浏览器默认 `scrollIntoView`(任务卡派生取舍 14),真机待所有者核 |
| `5b` | 移动 · `xray-html` 帧(高 ≤ 360、帧内横滚、页面不横滚)+ 骨架 + 回落 | `XrayHtml.tsx`(`useIsMobile` → 上限 360)· `lib/xray-html.ts`(移动端 `summary` 44) | ✅ 已落地:390 宽实测帧 354×360、`body.scrollWidth === innerWidth`;帧内横滚由模型片段自己的 `overflow-x:auto` 盒承担(基础样式只给 `svg, table { max-width: 100% }`) |

## 交付物

- `apps/web/lib/xray-card.ts`:`choice` / `form` 两种 kind 的校验、组成发送文本的纯函数(`composeChoiceMessage` / `composeFormMessage`)、解析期最坏长度判定;`xray-card.test.ts` 新增 ≥ 15 条。
- `apps/web/lib/xray-html.ts`(新):info string 解析与高度夹取、字节上限、`shouldDropElement` / `shouldDropAttribute` 两个判定纯函数、`srcdoc` 拼装(纯字符串部分);`xray-html.test.ts` ≥ 20 条(含 `javascript:` / 带控制字符的 `href` / `xlink:href` / `srcset` / `formaction` / `ping` / 大小写与空白变体)。
- `apps/web/components/XrayCard.tsx`:两种新 kind 的渲染、`onSend` prop、busy 与锁定两种态。
- `apps/web/components/XrayHtml.tsx`(新):`DOMParser` 遍历薄壳 + 帧 + 骨架 + 主题重建。
- `apps/web/components/Markdown.tsx`:`html` prop(默认关);三个出口**挪进新文件** `components/ChatFence.tsx`(恒等的围栏渲染器 + `ChatFenceContext`,理由见「本轮实测 · 偏离」第 1 条),Notes 的普通代码块抽成 `components/CodeBlock.tsx`(标记一字不改);组件预算 = 新文件 `lib/remark-component-budget.ts`(remark 插件,在 mdast 上给前两个 xray 围栏打标记;所有者裁定 A,见「代码审查」第 3 轮)。
- `apps/web/components/ComposerContext.tsx`(新):`busy` / `onSend` 经 Context 直达 `XrayCard`,不经 `Markdown` props(同一条理由)。
- `apps/web/components/workbench/Workbench.tsx` / `apps/web/components/mobile/MobileChat.tsx`:`send` 拆成 `sendText(text)` + `send`,`sendFromCard` 经 `ComposerContext.Provider` 注入两套壳;最终回答段开组件、处理过程段 `components={false}`;`MobileChat` 只改注释。
- `apps/web/app/globals.css`:两种新卡与帧的移动端差别(按 `5a` / `5b`)。
- `apps/api/agent/runtime.ts`:`CARDS_CLAUSE` 扩成组件段 + `HTML_COMPONENT_ENABLED` 常量;`runtime.test.ts` / `cards-e2e.test.ts` 更新(faux 剧本加三张新卡 + 四个 HTML 用例 + 三围栏用例)。
- 文档:`docs/security.md` §0 第 11 条修订 + 第 12 / 13 条(已写,落地后翻「已落地」)· `docs/architecture.md` 关键决策表加一行 · `design/README.md` 增删记录 · `docs/releases.md`(发版时)· `ROUNDS.md` 进度。
- **不交付**:pi 工具 / `payload` 与 SSE / 迁移 / 新端点 / MCP(仍 51)/ Notes 侧 / `allow-scripts` / `allow-same-origin` / postMessage / 帧内图片与链接 / 运行期开关 / 任何新依赖。

## 验收

| # | 检查 | 命令 / 期望 |
|---|---|---|
| 1 | 编译与测试 | `dev.ps1 check` 过;`dev.ps1 test` 全绿(api 含 `runtime` / `cards-e2e` 更新;web `xray-card` 新增 ≥ 15 条、`xray-html` ≥ 20 条);`apps/web` 的 `npx tsc --noEmit` 过(项目记忆:check / test 不拦 web 的 TS 错) |
| 2 | `choice` 单选 = 点即发 | 四选项卡,没有按钮;点第二项 → 会话区立刻出现访客气泡,文本**精确等于** `prompt` + `: ` + 该 label;`POST /agent/ask` 恰好一次;卡进入锁定态(选项不可点、第二项高亮);无 `prompt` 的卡发出的只有 label |
| 3 | `choice` 多选 = submit 发 | 未选 → 按钮禁用;选两项 → 可用;点按钮 → 一条气泡,文本 = `prompt` + `: ` + 两个 label 以「、」相连;缺省按钮文案「提交」;卡锁定 |
| 4 | `form` = submit 发 | 3 字段(text / select / text,一个 `required`);required 空 → 禁用;全填 → 点按钮一条气泡,单行、ASCII `: ` 与 `; ` 分隔、按字段顺序、空字段省略;5 字段全部 100 字满值 + 200 字 `prompt` → 仍发出(未被清洗闸丢弃);卡锁定 |
| 5 | WYSIWYG | 单测:三个组成函数的输出**只由** `prompt` / `label` / 字段 `label` / 访客值拼成,任何非可见字段(`title` / `note` / `placeholder` / `submit` / `links`)都不进文本;`action` 在新 kind 上被忽略 |
| 6 | 触发边界 | 渲染 / 滚动 / hover / 聚焦都不发;busy 期间点选项与按钮不发(计数 `POST /agent/ask` 不变);键盘 Enter / Space 走同一 handler;锁定后再点不发 |
| 7 | 解析期最坏长度 | 单测:`choice` 8 × 60 字 label + 200 字 prompt → 通过;9 项 / 61 字 → 回落;`form` 5 字段 + 201 字 prompt → 回落;计量按 UTF-16(emoji 用例) |
| 8 | 最多两个 | 同一最终回答里三个围栏(卡 + HTML + 卡、HTML + HTML + 卡两种顺序)→ 前两个是组件、第三个代码块;处理过程段里的围栏 → 代码块(展开折叠行可见);一首一尾各一个 → 两个都渲染 |
| 9 | 帧属性与清洗 | `iframe` 的 `sandbox` 属性为空串、无任何 `allow-*`;`referrerpolicy="no-referrer"`;`srcdoc` 里 `<meta http-equiv="Content-Security-Policy">` 在任何模型内容之前;帧内 DOM(读 `srcdoc` 字符串或 `contentDocument`)没有 `script` / `img` / `meta`(除父页那条)/ `link` / `form` / `input` / `button` / `on*` 属性;所有 `href` 以 `#` 开头;`<details>` / `<style>` / 内联 `<svg>` 保留 |
| 10 | 出网为零 | 夹具含 `<img src="https://…">`、`<link rel=stylesheet href=https://…>`、`<style>@import url(https://…); body{background:url(https://…)}</style>`、`@font-face src:url(https://…)`、`<a href="https://…">`、`<meta http-equiv="refresh" content="0;url=https://…">` → Browser pane `read_network_requests` 无任何第三方请求;点 `<a>` 帧不换页 |
| 11 | 高度 | `height=` 缺省 → 320;`height=9999` → 480;`height=10` → 160;`height=abc` → 320;移动预设下 `height=480` → 360;骨架高度 = 夹取后高度 |
| 12 | 上限与回落 | 16 KB + 1 字节 → 代码块(语言标签 `xray-html`);未知 kind / 坏 JSON 仍回落(R-CARDS 回归) |
| 13 | 流式 | 围栏未闭合 → 骨架(高度已定、不跳版);闭合 → 帧;整轮里帧只创建一次(`javascript_tool` 数 `iframe` 的 load 事件或对比节点身份) |
| 14 | 回放 = 实时 | 三张新卡 + 一帧的两轮,F5 前后会话区 `innerHTML` sha256 一致(同一主题下;新卡回初始态是预期,sha 按初始态比) |
| 15 | 主题 | 切深色 → `srcdoc` 里的 `--xh-*` 值随之变、帧背景与站点一致;切回一致 |
| 16 | 移动端 | Browser pane 移动预设 390:两种新卡 44 命中、submit 胶囊独占一行、单选点即发;`form` 输入框聚焦时可见;帧高 ≤ 360、帧内横向内容可滚、页面不横滚 |
| 17 | 其它页面不受影响 | `/notes/*` / `/skills/*` / `/source/*` 对同一段 ` ```xray-html ` 与 ` ```xray-card `(choice)的渲染仍是代码块 |
| 18 | 提示词 + 真实 provider 留证 | `runtime.test.ts` 断言组件段含「最多两个」「开头或结尾」「直接发出」「xray-html」「height=」与两种新 kind;发版后在生产各跑出一张 `choice` 卡(点一次、看到气泡与下一轮)与一个 HTML 组件,截图留证(R-CARDS #13 同款) |
| 19 | 既有零改动 | `Markdown` 不传 `html` / `onSend` 时输出与改前一字不差(快照);既有六种卡的 `action` 仍是预填、不发送;`git diff --stat main -- apps/api` 只有 `runtime.ts` 与其测试;`design/` 之外一个像素不动(规则 7) |
| 20 | 文档同步 | `docs/security.md` §0 第 11 / 12 / 13 条翻「已落地」并核对边界文件名;`docs/architecture.md` 一行;`design/README.md` 增删记录;`ROUNDS.md` 进度;发版后 `docs/releases.md` |

## 禁止

- 不做 pi 工具、不改 `payload` / SSE / 迁移 / MCP、不加端点;不给 Notes / Skills / Source 开任何组件。
- 发送**只能**经既有 composer 的发送函数、**只能**由访客对卡片的一次点击触发;发送文本**只能**由卡上可见文本与访客自己填的值组成,不得带任何模型写的隐藏模板;不做「发送后自动追问」「连发」「定时发」。
- 帧**不给** `allow-scripts` / `allow-same-origin` / `allow-forms` / `allow-popups` / `allow-top-navigation` 及任何 `allow-*`;不做 postMessage;不做帧内链接 / 图片 / 外部资源;不做高度自适应;帧里的任何东西都不能触发发送。
- 不引入任何新依赖(DOMPurify / iframe-resizer / 图表库 / 表格库都不要);不渲染模型 HTML 到父页 DOM(`dangerouslySetInnerHTML` 一处不加)。
- 不做运行期开关机制(表 / MCP 工具 / 读端点);关 = 改常量 + 发版。
- 不把组件状态落库或写存储;不给 Timeline 加事件;不给由卡片发出的访客消息加任何标记或字段。
- 默认继承两条:不改前端页面样式(规则 7,画板之外的一个像素都不动);不加设计稿没有的功能(规则 8)。

## 代码审查

<!-- 完成后回填。审查路由见 CLAUDE.md「开发模式」:codex 独立审查,硬失败才降级 /code-review。 -->

- 审查方式:codex `review --scope branch`(PowerShell `Start-Process` 脱离启动 + Monitor 盯 `.out`,项目记忆的做法;前两轮全量,第 3 轮起 `--base <上一轮已审提交>`)。
  带给审查者的要求:只判定缺陷与严重级别,不展开设计方案;重点是窄清洗的判定函数(不出链 / 不换页)、可回传卡的 WYSIWYG 与发送边界、组件预算。
  **findings 若连续两轮落在同一块自建机制上(最可能是窄清洗),停下回所有者重定方案,不堆补丁**(项目记忆)。

**第 1 轮**(全量 `branch diff against main`,提交 `1762b40`;18.7 分钟):5 条 findings,**2 P1 + 3 P2**;**4 条采纳整改、1 条 P1 不采纳(有实证)**。

| # | finding | 处理 |
|---|---|---|
| 1 | **P1 · `DOMParser` 解析时就可能抓取子资源**(`lib/xray-html.ts` `sanitizeFragment`):「在解析惰性文档时会抓 `<img>` / `<iframe>` 的浏览器里」,清洗之前请求就发出去了,CSP 在帧里、管不到父页 | **不采纳,有实证**。HTML 规范:`DOMParser` 产出的文档没有浏览环境、**不是 fully active**,图片的「update the image data」、`iframe` 的「process the iframe attributes」、媒体元素的资源选择、`object` / `embed` 的加载算法都以「node document 是 fully active」为前提,惰性文档里一律不启动(DOMPurify 就是靠这一条才敢用 DOMParser)。本机 Chromium 实证:在站点页面里 `new DOMParser().parseFromString(...)` 一段含 `img` / `link` / `iframe` / `video` / `audio` / `object` / `embed` / `script` / `@import` + `url()` / `input type=image` / SVG `image` / `picture+source` 共 12 个指向 `localhost:4000/probe-*` 的元素 → `read_network_requests` 与 `performance.getEntriesByType("resource")` 都没有任何 `probe-` 请求。finding 措辞本身是「in browsers that…」的假设句,没有点名任何一个真会这么做的现代浏览器;没有一个可替代的路径能比惰性文档更「不能发请求」(`createHTMLDocument` / `<template>` 是同一类)。记任务卡,不改代码 |
| 2 | **P1 · SVG SMIL 动画元素能在清洗之后改写锚点**(`lib/xray-html.ts`):`<a href="#x"><set attributeName="href" to="https://evil"/></a>` 过清洗时是帧内锚点,渲染后 `<set>` 不靠脚本就把 href 改成外站,点一下帧自导航 —— sandbox 与 CSP 都拦不住,正是这层清洗唯一要堵的口 | **采纳**。`DROP_ELEMENTS` 加 `set` / `animate` / `animateMotion` / `animateTransform` / `animateColor` / `discard` / `mpath`(没有脚本、没有动画,属性在清洗之后就再也不会变);用例 +1(含大小写),`cards-e2e` 敌意片段与 faux 剧本各加一段 `<a href="#top"><set …/><animate …/></a>`,浏览器复核 `srcdoc` 里五种 SMIL 元素都是 0、`<a>` 只剩 `#top` |
| 3 | **P2 · 可回传卡的题干 / label 接受不可见字符**(`lib/xray-card.ts`):U+202E 这类 bidi 覆盖在卡上会改变显示顺序,发送前又被 `sanitizePrefill` 去掉 —— 访客看到的不是发出去的,违反 §0 第 12 条 ① | **采纳**。`ask-why.ts` 抽出 `stripInvisible`(与 `sanitizePrefill` 同一条正则),`parseBody` 对**会进消息的字段**(prompt / 选项 label / 字段 label / select 选项)在解析期先去再判长度;不进消息的 title / note / placeholder / submit 不动。用例 +4(含「组成出来的消息再过一遍 `sanitizePrefill` 一字不变」这条不变量);浏览器复核 `隐形` 剧本:卡上没有 U+202E / U+200B,发出的文本与卡上逐字相同 |
| 4 | **P2 · 没有题干、字段全可选的表单一个字没填也能按,点了组成空串被清洗闸丢弃,卡却锁了**(`XrayCard.tsx`) | **采纳**,两处:① `formComplete` 加「组成出来的消息非空」;② `ComposerContext.onSend` 改回 `boolean`(清洗闸丢弃 / `sendText` 的 busy 或历史加载守卫拒收都回 false),三处点击**发出去了才锁**(单选连选中态也不留)。用例 +1;浏览器复核 `空表单` 剧本:初始禁用、填一个字段后可用、提交 → `邮箱: a@b.c` 且锁定 |
| 5 | **P2 · 提示词里 form 的上限没点全**(`runtime.ts`):只说了字段数 / type / label ≤ 40 / text 100,下一句「每个字符串 ≤ 200 字」会让模型写出 placeholder > 100、select 选项 > 8 或 > 60、submit > 20 的表单,静默回落成代码块 | **采纳**。form 那一行补齐 placeholder ≤ 100、select options 2–8 项每项 ≤ 60、submit ≤ 20(缺省「提交」);`runtime.test.ts` 逐条断言五个上限短语 |

审查者推理里还提到但**没有**列为 finding 的两处,顺手核过:「`sendTextRef` 在 passive effect 里同步、点击可能拿到旧闭包」—— React 18 在处理下一个离散事件之前一定先冲掉上一次提交的 passive effect,点击永远拿到最新的 `sendText`,且整改 #4 后即使拒收也不会锁卡;「`leadingComponentFences` 与 micromark 的围栏判据有出入」—— 两边不一致的后果只是那一个围栏回落成代码块(与 `fenceUnterminated` 同一口径),未列 finding、不改。

复验:`bun test lib` **146** 用例全绿(+6),`tsc --noEmit` 过,`dev.ps1 test agent/runtime.test.ts agent/cards-e2e.test.ts` 43 用例过;浏览器按上表逐条复核(faux 剧本新增 `空表单` / `隐形`,`敌意` 加 SMIL)。

**第 2 轮**(仍全量,提交 `e415ec5`;15.7 分钟):2 条 findings,**1 P1 + 1 P2**;**P2 采纳、P1 再次不采纳(同第 1 轮 #1,理由与实证写进代码注释)**。

| # | finding | 处理 |
|---|---|---|
| 1 | **P1 · `DOMParser` 解析前应先让原文「不可抓取」**(`lib/xray-html.ts`)—— 与第 1 轮 #1 同一条,措辞仍是「some browsers may」 | **不采纳**,理由同第 1 轮 #1(惰性文档不是 fully active,规范里所有子资源加载算法都不启动;本机 12 种资源元素实证零请求;不存在比惰性文档更「不能发请求」的解析路径,`createHTMLDocument` / `<template>` 是同一类)。这次把规范依据与实证**写进 `sanitizeFragment` 的注释**,让第 3 轮起审整改 diff 时看得到。**这不是「同一块自建机制连续两轮出 findings」**:两轮里对这层清洗只有第 1 轮 #2(SMIL)是真缺陷,#1 是同一条被重复提出的假设;所有者若仍不放心,可裁定换 DOMPurify —— 但 DOMPurify 走的正是同一条 DOMParser 路径,对这条假设没有任何帮助 |
| 2 | **P2 · 组件预算扫描器把四个空格缩进的行当围栏**(`lib/xray-card.ts` `leadingComponentFences`):顶层四个空格起头是缩进代码块,micromark 不当围栏;模型先用缩进代码块演示语法、再给两个真组件,第二个真组件就被挤成代码块 | **采纳**。抽出三处共用的 `fenceOpener`(容器前缀各 ≤ 3 空格 + `>` / 列表标记,可叠;记号前 ≤ 3 空格;反引号围栏的 info string 不含反引号),`fenceUnterminated` / `leadingComponentFences` / `fenceInfo` 都改用它。用例 +2(顶层 4 空格 / 引用块内 5 空格 / 列表标记后 1–3 空格 / info 含反引号)+ `fenceInfo` 2 条断言;浏览器复核 `缩进` 剧本(缩进演示 + 卡 + 帧 → 演示是代码块、卡与帧都渲染) |

复验:`bun test lib` **148** 用例全绿(+2),`tsc --noEmit` 过。

**第 3 轮**(按流程只审整改 diff,`--base e415ec5`,提交 `0c59fdb`;5.5 分钟):1 条 finding,**P2**。

| # | finding | 处理 |
|---|---|---|
| 1 | **P2 · 收紧到 ≤ 3 空格之后,列表续行里的合法围栏被拒**(`lib/xray-card.ts` `fenceOpener`):`1. text\n\n    ```xray-card` 的四个空格是列表容器缩进,micromark 照常产出 fenced code,扫描器脱离上下文按顶层缩进拒掉 → 组件回落成代码块,基线版本反而认得 | **停下回所有者重定方案**(项目记忆「审查循环不是设计」:第 2、3 轮 findings 连续落在同一块自建机制 —— 扫描器在重新实现 CommonMark 的一角,补列表上下文之后 lazy continuation / tab / 嵌套还会再来)。给所有者三档:A 用解析器自己的树数(推荐)/ B 扫描器补列表上下文 / C 认下不改记 BACKLOG。**所有者裁定 A**(2026-09-09)。落地:新文件 `lib/remark-component-budget.ts` —— 一个 remark 插件(与 `remarkDollarGuard` / `remarkLinkHref` 同一形态,排在它们之后)在 micromark 产出的 mdast 上按文档序给前两个 xray 围栏的 `code` 节点打 `data.hProperties.dataXrayComponent`,经 mdast-util-to-hast 落到 `<code>` 的 `data-xray-component` prop,`ChatFencePre` 只认这个标记;围栏是不是围栏由 micromark 说了算,两边**不可能**再不一致。逐行正则扫描器 `leadingComponentFences` 删除;`fenceOpener` 回到宽松前缀(它只在 micromark 已认定为围栏的行上读记号与 info string,不判「是不是」)。用例:`remark-component-budget.test.ts` 新增 6 条(列表项 / 引用块 / 缩进代码块 lang=null / 语言标签精确 / 保留既有 data),`xray-card.test.ts` 的扫描器用例换成 `fenceOpener` 读法 1 条,`fenceInfo` 的四空格断言反转。浏览器复核 `列表`(列表续行里的卡 + 帧:卡渲染在 `<li>` 里)/ `缩进` / `三个` / `处理` / `帧` 五个剧本 |

复验:`bun test lib` **149** 用例全绿(11 个文件),`tsc --noEmit` 过。第一版把插件写成了 transformer 而不是 attacher(unified 调 attacher 时没有 tree → 整页掉进错误边界),本机第一次跑就撞上、改成与 `remarkLinkHref` 同一形状(工厂 → attacher → transformer)后过。

## 失败处理

同一验收项针对性整改后连续 2 次验证仍不过 → 写 `rounds/round-cards2/BLOCKED.md`,停下呼人。禁止放宽验收标准自我通过。
项目记忆两条一并适用:findings 连续两轮落在同一块自建机制上(最可能是第 10 条的窄清洗)就停下回所有者重定方案,不堆补丁;审查收口之后才 `dev.ps1 build`。

## 本轮实测

### 验收结果(2026-09-09,本机;faux provider 剧本 `选择` / `多选` / `表单` / `大表单` / `无题干` / `帧` / `敌意` / `超限` / `三个` / `两帧` / `高9999` / `高10` / `高abc` / `高无` / `停` / `工具` / `处理`,脚本留 scratchpad 不入库)

| # | 结果 | 留证 |
|---|---|---|
| 1 | ✅ | `dev.ps1 check` 过;`dev.ps1 test`:api 35 文件 / 614 用例(613 过 + `source-tools.test.ts` 1 条**已知**文件顺序 flake,BACKLOG 里 R-SOURCE / R-CARDS 记过,单跑 9/9 过;本轮新增 `runtime.test` 1 条 + `cards-e2e` 断言 6 条)+ web `bun test lib` **140** 用例(`xray-card.test.ts` 37 → 64,+27;`xray-html.test.ts` 新增 20;审查第 1 轮整改后 **146**);`apps/web` `tsc --noEmit` 过;`next build` 过(见下) |
| 2 | ✅ | `选择`:四选项、无按钮、`role=radio` `tabIndex=0`;点第二项 → 会话区立刻一条访客气泡,文本**精确等于** `你更想从哪条线入手?: 沙箱执行组`;`POST /agent/ask` 计数 1 → 2;卡锁定(第二项 `aria-checked=true`、四行 `aria-disabled` + `tabIndex=-1` + `cursor:default`),下一轮结束后仍锁定;`无题干` 卡发出的只有 `先看内核`、且 `action` 被忽略(无按钮、无卡底) |
| 3 | ✅ | `多选`:未选 → submit `disabled` 且字 `--text-dim`;点第 3、第 2 项 → 可用(字 `--text-muted`);提交 → `哪几组工具你想先看源码?: 外呼组、沙箱执行组`(按**选项原顺序**,不按点选顺序);缺省文案「提交」;锁定后未选 label 降到 `--text-dim`、已选保持 `--text`;卡底 1 条站内链接照常 |
| 4 | ✅ | `表单`:text / select / text,两个必填(mono 10「必填」);填一个仍禁用;全填可用;提交 → `帮我定制学习路径 经验: 3 年; 目标: 上线一个 agent 站; 每周时间: 5 小时`;锁定后字段 `disabled`、值保留、底 `rgba(0,0,0,.02)`。`大表单`(5 字段 × 100 字 + 200 字 prompt)→ 发出 **734** 字、4 个 `; `、未被清洗闸丢弃 |
| 5 | ✅ | `lib` 用例:两个组成函数的输出只由 prompt / label / 字段 label / 访客值拼成,`title` / `note` / `placeholder` / `submit` 逐一断言不进文本;`action` 在两种新 kind 上被忽略、不回落;`composeChoiceMessage` 对越界 / 重复下标免疫 |
| 6 | ✅ | 生成中(`停` 剧本 25 s 停顿期间)点一张未锁的 `无题干` 卡 → 四行 `aria-disabled`、`POST /agent/ask` 计数不变(19 → 19)、卡未锁;生成结束后再点 → 发出。键盘:在第三项上 `keydown Enter` → `…: 外呼组` 发出。整个会话 `POST /agent/ask` 次数 = 手发次数 + 点击次数,渲染 / 滚动 / hover 没有多出一条 |
| 7 | ✅ | `lib` 用例:`choice` 8 × 60 + 200 = 689 通过、9 项 / 61 字回落;emoji 按 UTF-16 算两个单位(30 个过、31 个回落);`form` 5 字段 + 200 字 = **919** 通过(任务卡写的 921 多算了一个分隔符,函数算出来的为准)、201 字回落;select 按最长一项算 |
| 8 | ✅ | `三个`(卡 + 帧 + 卡)→ `choice`、帧、`xray-card` 代码块;`两帧`(帧 + 帧 + 卡)→ 帧、帧、`xray-card` 代码块;`处理`(第一次往返的正文里带一张卡、再调工具)→ 展开折叠行,处理过程段里那张卡是 `xray-card` 代码块,最终回答里的卡照常;`工具` → 折叠行「处理详情 · 2 次模型往返 · 1 次工具调用」在卡之前(`compareDocumentPosition` FOLLOWING) |
| 9 | ✅ | 帧元素:`sandbox=""`、无 `allow`、`referrerpolicy=no-referrer`、`loading=lazy`、`title=agent 生成的组件`、`contentDocument === null`(opaque origin);`srcdoc` 里 CSP `<meta>` 在 `<body>` 之前(下标 111 < 3200+);`敌意` 剧本的 `srcdoc` 经 `DOMParser` 复核:`script` / `img` / `link` / `form` / `input` / `button` / `iframe` 全 0、`on*` 属性 0、只剩两条 `<meta>`(charset + CSP),`href` 只剩 `#top` / `#c`(`<use href="#c">` 保留),`<a href="https://…" target>` 与 `<a href="javascript:">` 都变成裸 `<a>`,svg 里的 `<a xlink:href>` 同样,`<details>` 与两条 `<style>` 保留(`@import` / `url()` 留在 CSS 里,由 CSP 挡) |
| 10 | ✅ | `read_network_requests` 过滤 `example.com` 为空(整个会话);两帧内容的 `--xh-*` 引用都解析成站点色 |
| 11 | ✅ | 缺省 → 320;`height=9999` → 480;`height=10` → 160;`height=abc` → 320;390 宽移动壳 `height=9999` → **360**(帧 354 × 360);`停` 剧本骨架外框实测 320 高 = 闭合后帧高,不跳版 |
| 12 | ✅ | 16 KB + 1 字节 → `xray-html` 代码块(`pre` 16,386 字符含尾换行);R-CARDS 的坏 JSON / 超限 / 未知 kind 用例全在 `lib` 回归 |
| 13 | ✅ | `停`(围栏中间停 25 s):停顿期间 `[data-xray-html=skeleton]` 320 高 + 三条骨架条;闭合后原位换成帧。`两帧`:第一帧闭合后正文又流了 4 s 以上,帧节点 **身份不变**(`===` 且 `srcdoc` 相同,`isConnected`) |
| 14 | ✅ | 新会话 `帧` + `三个` 两轮:实时渲染完会话区 `innerHTML` sha256 `0059e68a…2173`(16,816 字节)= F5 后从侧栏重开同一会话的哈希 |
| 15 | ✅ | `html.dark` 加上 → 两帧 `srcdoc` 里 `--xh-bg:#1a1a1a` / `--xh-fg:#e8e8e8` / `--xh-brand:#60a5fa`;去掉 → 回 `#ffffff`,哈希回到 #14 的同值 |
| 16 | ✅ | 390 × 845 移动壳:选项行 58 高(`min-height:44`、`align-items:center`);submit 胶囊 332 × 44、r22、15/600、`--m-fill` 底、禁用字 `#9ca3af`、独占一行;输入框 44 高、r10、15px、`--m-fill` 底、描边透明(text 与 select 同一副);`body.scrollWidth === innerWidth === 390`;单选**一次点按即发**(`你更想从哪条线入手?: 沙箱执行组`);帧内 `summary{min-height:44px}` 注入。键盘弹起态未在 Browser pane 里验(系统键盘拿不到),真机待所有者核 |
| 17 | ✅ | 往本机 `notes_chapters` 临时插一章(`/notes/pi/tmp-xray-cards2-check`,正文带同一段 ` ```xray-html height=320 ` 与一张 `choice` 卡)→ 两个代码块(语言标签 `xray-html` / `xray-card`)、`[data-xray-card]` 与 `iframe` 都为 0;验完删行 |
| 18 | ✅ | `runtime.test.ts` 断言组件段含「每次回复最多两个组件」「最终回答的开头或结尾」「作为访客的下一条消息直接发出」「```xray-html height=」「160–480」「上限 16 KB」「var(--xh-bg)」「唯一可用的交互是 <details>」与八个 kind;`cards-e2e` 断言这一段真的到了 provider。**真实 provider 留证待发版后在生产补**(R-CARDS #13 同款) |
| 19 | ✅ | `git diff --stat main -- apps/api` 只有 `runtime.ts` + `runtime.test.ts` + `cards-e2e.test.ts`;既有六种卡的路径、`action` 预填、`Markdown` 不传 `cards` / `html` 时的 `pre`(`plainPre` → `CodeBlock`,标记逐字节同一块)都不变;`design/` 之外没有动任何页面样式(移动端三组新规则只作用于新卡的类名) |
| 20 | ✅ | `docs/security.md` §0 第 11 / 12 / 13 条翻「同日落地」并指到边界文件;`docs/architecture.md` 关键决策表一行;`design/README.md` 两行文件表 + 增删记录 + 256 KiB 预警段;CLAUDE.md 规则 8 计数(桌面 29 / 移动 28)与 R-CARDS-2 段;ROUNDS.md 计数 / 第十四次修订 / 进度表 / 轮次段;MCP 仍 51(`docs/mcp.md` 未动);`docs/releases.md` 发版时补 |

### 数字与偏离

1. **渲染器改成恒等组件 + 两个 Context,而不是任务卡设想的「`Markdown` 加 `onSend` / `busy` props + 内联 `pre`」**(`components/ChatFence.tsx` / `ComposerContext.tsx` / `CodeBlock.tsx` 三个新文件)。第一版按任务卡写完后本机实测:点选项发送 → 一轮生成结束 → 卡回到未选未锁。根因是 react-markdown 把 `components.pre` 当**元素类型**,内联回调每次渲染都是新函数,React 认成不同类型整棵重挂,卡的本地态被清;同一根因下帧在围栏闭合后正文每来一个 delta 就重载一次。
   于是:① 会话区的 `pre` 是模块级的 `ChatFencePre`,渲染时会变的东西(源文本 / 预算 / 开关 / 流式态 / `onAsk`)经 `ChatFenceContext` 送进去;② `busy` / `onSend` 经 `ComposerContext` 从 `Workbench` 直达 `XrayCard`,`AssistantMessage` 的 memo 在一轮前后都不重渲染;③ Notes / Skills / Source 仍走内联的 `plainPre`(重挂对纯静态代码块无所谓),标记抽成 `CodeBlock` 保证逐字节相同。`Markdown` 因此只多 `html` 一个 prop。**不是新机制**:Context 是 React 自带的,没有新协议 / 队列 / 配置。
2. `form.fields[].type` 缺省按 `text`(任务卡写的是闭集 text / select;缺失是模型最可能的笔误,text 是无害的那个;其它值仍回落)。
3. 窄清洗名单比任务卡多四个元素(SVG `image` / `template` / `portal` / `fencedframe`)与八个古老的 URL 属性名(`srcdoc` / `manifest` / `codebase` / `archive` / `classid` / `profile` / `dynsrc` / `lowsrc`),都是同类补齐,判定函数与用例一并钉住。
4. `form` 解析期最坏长度实际 **919**(任务卡 921 把分隔符多算了一个:5 段只有 4 个 `; `);两个数都远在 1000 内,`lib/xray-card.ts` 注释与用例按 919。
5. 帧基础样式给了 `a{color:var(--xh-brand)}`:链接元素本身保留(只剥 `href`),给它品牌色是让模型写的「链接」在帧里至少看得出是一个词;点了没有任何反应。`--xh-mono` 注入前去掉 Next 的 `var(--font-jetbrains-mono)`(那个 `@font-face` 只在父文档里,帧又不放字体请求),落到 `"JetBrains Mono", monospace`。
6. 帧的移动端上限 360 由 `useIsMobile` 在组件里夹(渲染器拿不到视口),骨架用同一个 hook,两者高度永远一致。
7. 处理过程段里的卡片(含 R-CARDS 的六种)改为代码块(任务卡「已认代价」最后一条);`splitTurn` 与 `AssistantTurn` 的段落划分零改动。
8. 提示词组件段 22 行(R-CARDS 12 行 + 两种新 kind 各一行 + 回传语义一行 + HTML 段一行 + 位置 / 用途各一句),`HTML_COMPONENT_ENABLED = false` 时掐掉三处 HTML 半句;段落头从「【信息卡片】」改为「【UI 组件】」,两个测试文件同步。
9. **审查第 1 轮带来的三处口径变化**(见「代码审查」):会进消息的字段在解析期先去不可见字符(`stripInvisible`,与 `sanitizePrefill` 同一条正则)—— 这是 `lib/xray-card.ts` 头注释里的第三条宽松处理;`onSend` 回 `boolean`、**发出去了才锁**;窄清洗名单再加七个 SVG SMIL 动画元素。
10. **「前两个围栏」不再扫源文本,改在解析器的树上数**(审查第 2、3 轮 → 所有者裁定 A):任务卡派生取舍 7 说的「渲染器只把最终段里前两个 xray 围栏当组件」不变,数的位置从逐行正则挪到 remark 插件 `lib/remark-component-budget.ts`,理由与形态见「代码审查」第 3 轮。

### 踩的坑

- **内联 `pre` 回调 = 每次渲染重挂子树**(见偏离 1)。R-CARDS 没暴露是因为 memo 的 `AssistantMessage` 让已完成的消息不再渲染;本轮 `busy` 一进 props 就现形。教训:凡是要在 react-markdown 的 `components` 里放**有状态 / 有 DOM 身份**的东西,组件类型必须恒等。
- **Browser pane 隐藏时 `requestAnimationFrame` 不回调**(项目记忆),流式期间合帧的 delta 根本不提交到 DOM,骨架 / 帧身份都看不到。本次在验收页里把 `window.requestAnimationFrame` 换成 `setTimeout(16)`(只在页面里改,代码零改动)才观察到停顿期间的骨架与两帧剧本里的节点身份。
- **faux 剧本关键字互相包含**:`大表单` 含 `表单`、由卡片发出的访客消息「哪几组工具…」含 `工具`,第一版剧本因此串台(多出一张不该有的卡、一次不该有的工具往返)。剧本按「长关键字在前」排序,新起一个端口 + `UPDATE llm_config SET base_url` 切过去;**同一会话下一轮就连新地址**(runtime 每轮读配置),在途那一轮会挂在旧端口上,切端口要在两轮之间。
- `next build` 是 web 侧唯一拦 TS / RSC 错误的门(项目记忆),`dev.ps1 check` / `test` / `next dev` 都不拦;本轮跑了一次(结果见验收 #1)。
- `dev.ps1 test` 全量跑出 `source-tools.test.ts` 1 条红:BACKLOG 里记过的文件顺序 flake(别的测试 afterAll 复原 `tool_config` 种子时漏掉迁移 016 的三个 `source_*` 行),与本轮无关,单跑绿。
