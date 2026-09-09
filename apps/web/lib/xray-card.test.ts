// R-CARDS 验收 #1 / #9 / #10:DSL 校验的每一条上限与口径(六种合法各一、每条上限各一、链接口径、
// 未知 kind、未知字段丢弃、tabs 嵌套拒)+ 流式「围栏未闭合」判据 + 排序比较器。
// 纯函数测试,不起 Next。经 `dev.ps1 test` → `bun test lib` 运行(node:test 写法,零新增依赖)。
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizePrefill } from "./ask-why";
import {
  CARD_LIMITS,
  DEFAULT_SUBMIT,
  cardHref,
  choiceWorstLength,
  compareCells,
  composeChoiceMessage,
  composeFormMessage,
  fenceUnterminated,
  formComplete,
  formWorstLength,
  isMonoColumn,
  leadingComponentFences,
  parseCard,
  sortRows,
  type ChoiceBody,
  type FormBody,
} from "./xray-card";

const json = (o: unknown) => JSON.stringify(o);
const kv = (extra: Record<string, unknown> = {}) => ({ v: 1, kind: "kv", rows: [{ k: "a", v: "1" }], ...extra });

describe("六种 kind 各一张合法卡", () => {
  it("kv", () => {
    const c = parseCard(json({ v: 1, kind: "kv", title: "T", rows: [{ k: "最低版本", v: "20.11" }] }));
    assert.deepEqual(c, { kind: "kv", rows: [{ k: "最低版本", v: "20.11" }], title: "T", collapsed: false, links: [] });
  });

  it("table(sortable 缺省 false)", () => {
    const c = parseCard(json({ v: 1, kind: "table", columns: ["工具", "上限"], rows: [["a", "1"], ["b", "2"]] }));
    assert.equal(c?.kind, "table");
    if (c?.kind !== "table") return;
    assert.deepEqual(c.columns, ["工具", "上限"]);
    assert.deepEqual(c.rows, [["a", "1"], ["b", "2"]]);
    assert.equal(c.sortable, false);
  });

  it("list(ordered / note 可选)", () => {
    const c = parseCard(json({ v: 1, kind: "list", ordered: true, items: [{ text: "一" }, { text: "二", note: "n" }] }));
    assert.equal(c?.kind, "list");
    if (c?.kind !== "list") return;
    assert.equal(c.ordered, true);
    assert.deepEqual(c.items, [{ text: "一" }, { text: "二", note: "n" }]);
  });

  it("stat(unit / note 可选,数字值转成字符串)", () => {
    const c = parseCard(json({ v: 1, kind: "stat", items: [{ label: "事件", value: 34, unit: "种" }, { label: "进程", value: "0" }] }));
    assert.equal(c?.kind, "stat");
    if (c?.kind !== "stat") return;
    assert.deepEqual(c.items, [{ label: "事件", value: "34", unit: "种" }, { label: "进程", value: "0" }]);
  });

  it("compare(a / b 允许空串:一方「无对应」是合法信息)", () => {
    const c = parseCard(json({ v: 1, kind: "compare", columns: ["pi", "SDK"], rows: [{ k: "分叉", a: "可 fork", b: "" }] }));
    assert.equal(c?.kind, "compare");
    if (c?.kind !== "compare") return;
    assert.deepEqual(c.columns, ["pi", "SDK"]);
    assert.deepEqual(c.rows, [{ k: "分叉", a: "可 fork", b: "" }]);
  });

  it("tabs(每页装一张叶子卡;页里的标题 / 卡底不认)", () => {
    const c = parseCard(
      json({
        v: 1,
        kind: "tabs",
        title: "环境",
        tabs: [
          { label: "Node", card: { kind: "kv", title: "ignored", rows: [{ k: "a", v: "1" }] } },
          { label: "Bun", card: { kind: "list", items: [{ text: "x" }] } },
        ],
      }),
    );
    assert.equal(c?.kind, "tabs");
    if (c?.kind !== "tabs") return;
    assert.equal(c.tabs.length, 2);
    assert.deepEqual(c.tabs[0].card, { kind: "kv", rows: [{ k: "a", v: "1" }] });
    assert.equal(c.tabs[1].card.kind, "list");
  });
});

describe("回落:非法 / 未知 / 越界一律 null", () => {
  it("JSON 写坏(尾逗号)", () => {
    assert.equal(parseCard('{ "v": 1, "kind": "kv", "rows": [ { "k": "a", "v": "1" }, ] }'), null);
  });

  it("缺 v 或 v 不是 1", () => {
    assert.equal(parseCard(json({ kind: "kv", rows: [{ k: "a", v: "1" }] })), null);
    assert.equal(parseCard(json(kv({ v: 2 }))), null);
    assert.equal(parseCard(json(kv({ v: "1" }))), null);
  });

  it("未知 kind", () => {
    assert.equal(parseCard(json({ v: 1, kind: "chart", rows: [] })), null);
  });

  it("不是对象(数组 / 字符串)", () => {
    assert.equal(parseCard(json([kv()])), null);
    assert.equal(parseCard(json("kv")), null);
    assert.equal(parseCard("   "), null);
  });

  it("tabs 里再套 tabs 拒", () => {
    const inner = { kind: "tabs", tabs: [{ label: "x", card: { kind: "kv", rows: [{ k: "a", v: "1" }] } }] };
    assert.equal(parseCard(json({ v: 1, kind: "tabs", tabs: [{ label: "outer", card: inner }] })), null);
  });

  it("table 行长与列数不等:不补空、不截断,整卡回落", () => {
    assert.equal(parseCard(json({ v: 1, kind: "table", columns: ["a", "b"], rows: [["1"]] })), null);
    assert.equal(parseCard(json({ v: 1, kind: "table", columns: ["a"], rows: [["1", "2"]] })), null);
  });

  it("空表 / 空清单 / 空 tabs", () => {
    assert.equal(parseCard(json({ v: 1, kind: "kv", rows: [] })), null);
    assert.equal(parseCard(json({ v: 1, kind: "list", items: [] })), null);
    assert.equal(parseCard(json({ v: 1, kind: "tabs", tabs: [] })), null);
  });

  it("值的类型不对(对象 / 布尔 / null 当值)", () => {
    assert.equal(parseCard(json({ v: 1, kind: "kv", rows: [{ k: "a", v: { x: 1 } }] })), null);
    assert.equal(parseCard(json({ v: 1, kind: "kv", rows: [{ k: "a", v: true }] })), null);
    assert.equal(parseCard(json({ v: 1, kind: "kv", rows: [{ k: null, v: "1" }] })), null);
    assert.equal(parseCard(json(kv({ collapsed: "yes" }))), null);
    assert.equal(parseCard(json({ v: 1, kind: "table", columns: ["a"], rows: [["1"]], sortable: 1 })), null);
  });
});

describe("每条上限各一", () => {
  it("围栏原文 > 8 KB", () => {
    const rows = [{ k: "a", v: "x".repeat(CARD_LIMITS.text) }];
    // 20 行 × 200 字才 4 KB,凑不到 8 KB;用未知字段把体积撑过去 —— 字段会被丢弃,体积上限却先于字段判
    const fat = json(kv({ rows, pad: "y".repeat(CARD_LIMITS.fenceBytes) }));
    assert.equal(parseCard(fat), null);
    assert.notEqual(parseCard(json(kv({ rows }))), null);
    // 上限按围栏原文算、先于 trim:一段小 JSON 前后垫空白也不能绕过(codex 第 1 轮 P2)
    assert.equal(parseCard(" ".repeat(CARD_LIMITS.fenceBytes) + json(kv())), null);
    assert.notEqual(parseCard("  " + json(kv()) + "\n"), null);
  });

  it("rows / items > 20", () => {
    const rows = Array.from({ length: CARD_LIMITS.rows + 1 }, (_, i) => ({ k: `k${i}`, v: "v" }));
    assert.equal(parseCard(json({ v: 1, kind: "kv", rows })), null);
    assert.notEqual(parseCard(json({ v: 1, kind: "kv", rows: rows.slice(0, CARD_LIMITS.rows) })), null);
    const items = Array.from({ length: CARD_LIMITS.rows + 1 }, () => ({ text: "t" }));
    assert.equal(parseCard(json({ v: 1, kind: "list", items })), null);
  });

  it("table 列 > 6", () => {
    const columns = Array.from({ length: CARD_LIMITS.columns + 1 }, (_, i) => `c${i}`);
    assert.equal(parseCard(json({ v: 1, kind: "table", columns, rows: [columns] })), null);
    const six = columns.slice(0, CARD_LIMITS.columns);
    assert.notEqual(parseCard(json({ v: 1, kind: "table", columns: six, rows: [six] })), null);
  });

  it("tabs > 5", () => {
    const tab = { label: "t", card: { kind: "kv", rows: [{ k: "a", v: "1" }] } };
    assert.equal(parseCard(json({ v: 1, kind: "tabs", tabs: Array(CARD_LIMITS.tabs + 1).fill(tab) })), null);
    assert.notEqual(parseCard(json({ v: 1, kind: "tabs", tabs: Array(CARD_LIMITS.tabs).fill(tab) })), null);
  });

  it("stat 少于 2 格或多于 4 格", () => {
    const it1 = { label: "l", value: "1" };
    assert.equal(parseCard(json({ v: 1, kind: "stat", items: [it1] })), null);
    assert.equal(parseCard(json({ v: 1, kind: "stat", items: Array(CARD_LIMITS.statMax + 1).fill(it1) })), null);
    assert.notEqual(parseCard(json({ v: 1, kind: "stat", items: Array(CARD_LIMITS.statMax).fill(it1) })), null);
  });

  it("字符串 > 200 字;title > 60 字", () => {
    assert.equal(parseCard(json({ v: 1, kind: "kv", rows: [{ k: "a", v: "x".repeat(CARD_LIMITS.text + 1) }] })), null);
    assert.equal(parseCard(json(kv({ title: "t".repeat(CARD_LIMITS.title + 1) }))), null);
    assert.notEqual(parseCard(json(kv({ title: "t".repeat(CARD_LIMITS.title) }))), null);
  });

  it("links > 5;action.ask > 500", () => {
    const link = { text: "l", href: "/notes/a/b" };
    assert.equal(parseCard(json(kv({ links: Array(CARD_LIMITS.links + 1).fill(link) }))), null);
    assert.equal(parseCard(json(kv({ links: Array(CARD_LIMITS.links).fill(link) })))?.links.length, CARD_LIMITS.links);
    assert.equal(parseCard(json(kv({ action: { label: "问", ask: "a".repeat(CARD_LIMITS.ask + 1) } }))), null);
    assert.equal(parseCard(json(kv({ action: { label: "问", ask: "a".repeat(CARD_LIMITS.ask) } })))?.action?.ask.length, CARD_LIMITS.ask);
  });

  it("action 缺 label 或缺 ask 整卡回落(按钮没有文案 / 没有要放的话都画不出来)", () => {
    assert.equal(parseCard(json(kv({ action: { label: "问" } }))), null);
    assert.equal(parseCard(json(kv({ action: { ask: "为什么" } }))), null);
    assert.equal(parseCard(json(kv({ action: "问" }))), null);
  });
});

describe("宽松的两处:未知字段丢弃、单条坏链接只丢那一条", () => {
  it("未知字段(卡级 / 行级)被丢弃,卡照常解析", () => {
    const c = parseCard(json({ v: 1, kind: "kv", icon: "⚡", color: "red", rows: [{ k: "a", v: "1", bold: true }] }));
    assert.deepEqual(c, { kind: "kv", rows: [{ k: "a", v: "1" }], collapsed: false, links: [] });
  });

  it("链接口径:http(s) 与 `/` 站内路径保留(外链标 external),其余逐条丢弃、不回落整卡(验收 #9)", () => {
    const c = parseCard(
      json(
        kv({
          links: [
            { text: "站内", href: "/notes/pi/agent-loop" },
            { text: "站外", href: "https://github.com/x/y" },
            { text: "js", href: "javascript:alert(1)" },
            { text: "data", href: "data:text/html,hi" },
            { text: "协议相对", href: "//evil.example/x" },
          ],
        }),
      ),
    );
    assert.deepEqual(c?.links, [
      { text: "站内", href: "/notes/pi/agent-loop", external: false },
      { text: "站外", href: "https://github.com/x/y", external: true },
    ]);
    // 不带 `/` 的相对路径、mailto、http 没主机、超长:都丢
    assert.equal(cardHref("notes/a"), null);
    // WHATWG URL 把反斜杠当正斜杠:`/\evil.com` 解析后是 https://evil.com/,与 `//evil` 同一类,必须丢;
    // 而路径中段的反斜杠(`/a\b` → `/a/b`)仍在本源,留着无害
    assert.equal(cardHref("/" + String.fromCharCode(92) + "evil.com/x"), null);
    assert.equal(cardHref("/" + String.fromCharCode(92) + "/evil.com"), null);
    assert.equal(cardHref("/a" + String.fromCharCode(92) + "b")?.external, false);
    assert.equal(cardHref("/%2F%2Fevil")?.external, false);
    assert.equal(cardHref("mailto:a@b.c"), null);
    assert.equal(cardHref("http://"), null);
    assert.equal(cardHref(`https://x.example/${"a".repeat(CARD_LIMITS.href)}`), null);
    assert.equal(cardHref("HTTP://X.EXAMPLE/p")?.external, true);
    assert.equal(cardHref(""), null);
    assert.equal(cardHref(42), null);
  });

  it("链接本身缺文案(或 links 不是数组)仍整卡回落 —— 那是形状错,不是地址错", () => {
    assert.equal(parseCard(json(kv({ links: [{ href: "/x" }] }))), null);
    assert.equal(parseCard(json(kv({ links: "no" }))), null);
  });

  it("collapsed 只在有 title 时成立(标题行是收起态唯一的把手)", () => {
    assert.equal(parseCard(json(kv({ collapsed: true })))?.collapsed, false);
    assert.equal(parseCard(json(kv({ collapsed: true, title: "T" })))?.collapsed, true);
    assert.equal(parseCard(json(kv({ collapsed: true, title: "" })))?.collapsed, false);
  });

  it("值里的 markdown / HTML / 公式记号原样留在字符串里(验收 #10:渲染器当纯文本)", () => {
    const c = parseCard(json({ v: 1, kind: "kv", rows: [{ k: "<b>k</b>", v: "**x** $y$ `z`" }] }));
    assert.deepEqual(c?.kind === "kv" ? c.rows[0] : null, { k: "<b>k</b>", v: "**x** $y$ `z`" });
  });
});

describe("流式:围栏未闭合的判据(画板 2t 段①;入参是开围栏的行号)", () => {
  const F = "```";
  const BT = String.fromCharCode(96); // 单个反引号,用来拼四反引号的开围栏
  const open = `正文一段。\n\n${F}xray-card\n{ "v": 1, "kind": "kv",`;
  it("未闭合:开围栏之后没有独立的闭围栏行 → 骨架;刚开围栏的第一帧也算", () => {
    assert.equal(fenceUnterminated(open, 3), true);
    assert.equal(fenceUnterminated(`${F}xray-card\n`, 1), true);
    assert.equal(fenceUnterminated(`${F}xray-card`, 1), true);
  });
  it("闭合了:同种记号、不短于开围栏、独占一行 → 已闭合(后面有没有正文都一样;CRLF 与 ~~~ 同理)", () => {
    assert.equal(fenceUnterminated(`${open} }\n${F}\n`, 3), false);
    assert.equal(fenceUnterminated(`${open} }\n${F}\n\n后面还有话。`, 3), false);
    assert.equal(fenceUnterminated(`${open} }\r\n${F}   \r\n`, 3), false);
    assert.equal(fenceUnterminated(`~~~xray-card\n{}\n~~~`, 1), false);
  });
  it("闭围栏要不短于开围栏:四反引号开的块里一行三反引号不算闭合", () => {
    assert.equal(fenceUnterminated(`${F}${BT}xray-card\n{}\n${F}\n`, 1), true);
    assert.equal(fenceUnterminated(`${F}${BT}xray-card\n{}\n${F}\n${F}${BT}`, 1), false);
  });
  it("闭合的卡后面正好跟着与正文相同的文字,也不会被误判成未闭合(早先按后缀判会中招)", () => {
    assert.equal(fenceUnterminated(`${open} }\n${F}\n\n{ "v": 1, "kind": "kv", }`, 3), false);
  });
  it("卡写在列表项 / 引用块里:闭围栏带容器前缀也认", () => {
    assert.equal(fenceUnterminated(`1. 看:\n\n    ${F}xray-card\n    {}\n    ${F}`, 3), false);
    assert.equal(fenceUnterminated(`> ${F}xray-card\n> {}\n> ${F}`, 1), false);
  });
  it("开围栏紧跟在列表标记后面(`1. ` / `- ` + 围栏)也认得出,未闭合照样是骨架(codex 第 2 轮 P2)", () => {
    assert.equal(fenceUnterminated(`1. ${F}xray-card\n   { "v": 1,`, 1), true);
    assert.equal(fenceUnterminated(`1. ${F}xray-card\n   {}\n   ${F}`, 1), false);
    assert.equal(fenceUnterminated(`- ${F}xray-card\n  {}`, 1), true);
    assert.equal(fenceUnterminated(`> - ${F}xray-card\n>   {}\n>   ${F}`, 1), false);
  });
  it("开围栏那一行不是围栏时当作已闭合(宁可少画一次骨架)", () => {
    assert.equal(fenceUnterminated("不是围栏\n{}", 1), false);
    assert.equal(fenceUnterminated("x", 9), false);
  });
});

describe("表头排序与 mono 列判据", () => {
  it("compareCells 是数值感知的字符串序(300 > 128 > 64,不是字典序)", () => {
    assert.ok(compareCells("300 字符", "64 字符") > 0);
    assert.ok(compareCells("128 字符", "300 字符") < 0);
    assert.ok(compareCells("a", "B") < 0);
  });
  it("sortRows 稳定:同值保持原行序;desc 是 asc 的镜像;不改原数组", () => {
    const rows = [["b", "2"], ["a", "1"], ["c", "2"], ["d", "10"]];
    const asc = sortRows(rows, 1, "asc");
    assert.deepEqual(asc.map((r) => r[0]), ["a", "b", "c", "d"]);
    const desc = sortRows(rows, 1, "desc");
    assert.deepEqual(desc.map((r) => r[0]), ["d", "b", "c", "a"]);
    assert.deepEqual(rows.map((r) => r[0]), ["b", "a", "c", "d"]);
  });
  it("isMonoColumn:数字开头或标识符样的列走 mono;中文列不走;全空列不走", () => {
    const rows = [["web_search", "300 字符", "外呼", ""], ["notes_search", "120 字符", "纯函数", ""]];
    assert.equal(isMonoColumn(rows, 0), true);
    assert.equal(isMonoColumn(rows, 1), true);
    assert.equal(isMonoColumn(rows, 2), false);
    assert.equal(isMonoColumn(rows, 3), false);
    assert.equal(isMonoColumn([["-3.5"], ["$12"]], 0), true);
  });
});

// ───────────────────── R-CARDS-2:两种可回传 kind(验收 #5 / #7)─────────────────────
//
// 【这组用例保护的是什么】`docs/security.md` §0 第 12 条的三件事里,前两件在 lib 里能钉住:
//   ① 发出的文本**只由**卡上可见文本(prompt / label / 字段 label / 访客值)组成 —— 任何非可见字段都不进文本;
//   ② 解析期按最坏组成长度卡在 1000 内(与 `sanitizePrefill` 同一把尺),运行期那把清洗闸永远吃不掉一次点击。
const SEP_LABEL = String.fromCharCode(0x3001); // 「、」
const choice = (extra: Record<string, unknown> = {}) => ({
  v: 1,
  kind: "choice",
  prompt: "你更想从哪条线入手?",
  options: [{ label: "纯函数组", note: "三个只读工具" }, { label: "沙箱执行组" }, { label: "外呼组" }, { label: "会话绑定组" }],
  ...extra,
});
const form = (extra: Record<string, unknown> = {}) => ({
  v: 1,
  kind: "form",
  prompt: "帮我定制学习路径",
  fields: [
    { label: "经验", type: "text", placeholder: "例:3 年", required: true },
    { label: "目标", type: "select", options: ["上线一个 agent 站", "读懂内核"], required: true },
    { label: "每周时间", type: "text" },
  ],
  ...extra,
});

describe("choice:形状与上限", () => {
  it("单选:multiple 缺省 false、submit 缺省「提交」、note 可选;title / links 按通用规则", () => {
    const c = parseCard(json(choice({ title: "学习路径 · 选一条主线" })));
    assert.equal(c?.kind, "choice");
    if (c?.kind !== "choice") return;
    assert.equal(c.multiple, false);
    assert.equal(c.submit, DEFAULT_SUBMIT);
    assert.equal(c.prompt, "你更想从哪条线入手?");
    assert.deepEqual(c.options[0], { label: "纯函数组", note: "三个只读工具" });
    assert.deepEqual(c.options[1], { label: "沙箱执行组" });
    assert.equal(c.title, "学习路径 · 选一条主线");
    assert.deepEqual(c.links, []);
  });
  it("多选:multiple: true 与自定义 submit 文案(≤ 20)", () => {
    const c = parseCard(json(choice({ multiple: true, submit: "就这几组" })));
    assert.equal(c?.kind, "choice");
    if (c?.kind !== "choice") return;
    assert.equal(c.multiple, true);
    assert.equal(c.submit, "就这几组");
    assert.equal(parseCard(json(choice({ submit: "x".repeat(CARD_LIMITS.submit + 1) }))), null);
  });
  it("options 2–8 项:1 项与 9 项都回落", () => {
    assert.equal(parseCard(json(choice({ options: [{ label: "只有一项" }] }))), null);
    assert.equal(parseCard(json(choice({ options: Array.from({ length: 9 }, (_, i) => ({ label: `o${i}` })) }))), null);
    assert.notEqual(parseCard(json(choice({ options: Array.from({ length: 8 }, (_, i) => ({ label: `o${i}` })) }))), null);
  });
  it("label ≤ 60、note ≤ 200、prompt ≤ 200;label 必填;multiple 不是布尔回落", () => {
    assert.notEqual(parseCard(json(choice({ options: [{ label: "x".repeat(60) }, { label: "y" }] }))), null);
    assert.equal(parseCard(json(choice({ options: [{ label: "x".repeat(61) }, { label: "y" }] }))), null);
    assert.equal(parseCard(json(choice({ options: [{ label: "a", note: "n".repeat(201) }, { label: "b" }] }))), null);
    assert.equal(parseCard(json(choice({ prompt: "p".repeat(201) }))), null);
    assert.equal(parseCard(json(choice({ options: [{ note: "没有 label" }, { label: "b" }] }))), null);
    assert.equal(parseCard(json(choice({ multiple: "yes" }))), null);
  });
  it("action 在 choice 上被忽略、不回落(一张卡只有一个出口);未知字段照常丢弃", () => {
    const c = parseCard(json(choice({ action: { label: "追问", ask: "再讲讲" }, icon: "x" })));
    assert.equal(c?.kind, "choice");
    assert.equal(c && "action" in c, false);
    assert.equal(c && "icon" in c, false);
  });
  it("不能嵌进 tabs(与 tabs 套 tabs 同一条)", () => {
    const c = parseCard(json({ v: 1, kind: "tabs", tabs: [{ label: "a", card: choice() }] }));
    assert.equal(c, null);
  });
});

describe("choice:发送文本只由 prompt + 所选 label 组成", () => {
  const body = parseCard(json(choice({ title: "T", multiple: true, submit: "提交", options: [{ label: "A", note: "note-A" }, { label: "B" }, { label: "C", note: "note-C" }] }))) as ChoiceBody;
  it("单选 = prompt + ASCII「: 」+ label", () => {
    assert.equal(composeChoiceMessage(body, [1]), "你更想从哪条线入手?: B");
  });
  it("多选按选项原顺序以「、」相连,与点选顺序无关", () => {
    assert.equal(composeChoiceMessage(body, [2, 0]), `你更想从哪条线入手?: A${SEP_LABEL}C`);
  });
  it("没有 prompt 时只有 label 部分;title / note / submit 不进文本", () => {
    const noPrompt = parseCard(json(choice({ prompt: undefined, title: "T" }))) as ChoiceBody;
    assert.equal(noPrompt.prompt, undefined);
    assert.equal(composeChoiceMessage(noPrompt, [0]), "纯函数组");
    const text = composeChoiceMessage(body, [0, 1, 2]);
    for (const hidden of ["T", "note-A", "note-C", "提交"]) assert.equal(text.includes(hidden), false, hidden);
  });
  it("越界与重复的下标忽略", () => {
    assert.equal(composeChoiceMessage(body, [9, 1, 1, -1]), "你更想从哪条线入手?: B");
  });
});

describe("会进消息的字段在解析期去不可见字符(codex 第 1 轮 P2:卡上看到的 = 发出去的)", () => {
  const RLO = String.fromCharCode(0x202e); // bidi 覆盖
  const ZWSP = String.fromCharCode(0x200b);
  it("choice:prompt / label 里的 U+202E、零宽空格、控制字符都在解析期去掉;note 不动(不进消息)", () => {
    const c = parseCard(json(choice({ prompt: `你更想${RLO}从哪条线入手?`, options: [{ label: `纯函数${ZWSP}组`, note: `n${ZWSP}` }, { label: "b" }] }))) as ChoiceBody;
    assert.equal(c.prompt, "你更想从哪条线入手?");
    assert.deepEqual(c.options.map((o) => o.label), ["纯函数组", "b"]);
    assert.equal(c.options[0].note, `n${ZWSP}`);
  });
  it("WYSIWYG 不变量:组成出来的消息再过一遍 sanitizePrefill 一字不变", () => {
    const c = parseCard(json(choice({ prompt: `题${RLO}干`, options: [{ label: `A${ZWSP}` }, { label: "B" }] }))) as ChoiceBody;
    const text = composeChoiceMessage(c, [0, 1]);
    assert.equal(sanitizePrefill(text), text);
    const f = parseCard(json(form({ prompt: `帮我${RLO}定制`, fields: [{ label: `经${ZWSP}验`, type: "select", options: [`3${RLO} 年`, "5 年"] }] }))) as FormBody;
    const ft = composeFormMessage(f, [f.fields[0].type === "select" ? f.fields[0].options[0] : ""]);
    assert.equal(ft, "帮我定制 经验: 3 年");
    assert.equal(sanitizePrefill(ft), ft);
  });
  it("去掉之后变空的 label 照常回落", () => {
    assert.equal(parseCard(json(choice({ options: [{ label: RLO + ZWSP }, { label: "b" }] }))), null);
  });
  it("长度按去掉之后的字算(60 个字 + 若干零宽仍通过)", () => {
    assert.notEqual(parseCard(json(choice({ options: [{ label: "x".repeat(60) + ZWSP.repeat(5) }, { label: "b" }] }))), null);
  });
});

describe("choice:解析期最坏长度(UTF-16)", () => {
  it("8 × 60 字 label + 200 字 prompt = 689 → 通过", () => {
    const c = parseCard(json(choice({ prompt: "p".repeat(200), options: Array.from({ length: 8 }, () => ({ label: "l".repeat(60) })) })));
    assert.equal(c?.kind, "choice");
    if (c?.kind !== "choice") return;
    assert.equal(choiceWorstLength(c), 200 + 2 + 8 * 60 + 7);
  });
  it("计量按 UTF-16:emoji 算两个单位,与 label ≤ 60 同一把尺", () => {
    const heart = String.fromCodePoint(0x1f49c);
    assert.notEqual(parseCard(json(choice({ options: [{ label: heart.repeat(30) }, { label: "b" }] }))), null); // 60 单位
    assert.equal(parseCard(json(choice({ options: [{ label: heart.repeat(31) }, { label: "b" }] }))), null); // 62 单位
  });
});

describe("form:形状与上限", () => {
  it("三字段(text / select / text):required 缺省 false、placeholder 可选、type 缺省 text", () => {
    const c = parseCard(json(form({ title: "学习路径定制" })));
    assert.equal(c?.kind, "form");
    if (c?.kind !== "form") return;
    assert.equal(c.submit, DEFAULT_SUBMIT);
    assert.deepEqual(c.fields[0], { label: "经验", type: "text", placeholder: "例:3 年", required: true });
    assert.deepEqual(c.fields[1], { label: "目标", type: "select", options: ["上线一个 agent 站", "读懂内核"], required: true });
    assert.deepEqual(c.fields[2], { label: "每周时间", type: "text", required: false });
  });
  it("fields 1–5:0 与 6 都回落", () => {
    assert.equal(parseCard(json(form({ fields: [] }))), null);
    assert.equal(parseCard(json(form({ fields: Array.from({ length: 6 }, (_, i) => ({ label: `f${i}` })) }))), null);
    assert.notEqual(parseCard(json(form({ fields: Array.from({ length: 5 }, (_, i) => ({ label: `f${i}` })) }))), null);
  });
  it("type 闭集 text / select;select.options 2–8 项每项 ≤ 60;label ≤ 40;placeholder ≤ 100", () => {
    assert.equal(parseCard(json(form({ fields: [{ label: "a", type: "number" }] }))), null);
    assert.equal(parseCard(json(form({ fields: [{ label: "a", type: "select", options: ["只一项"] }] }))), null);
    assert.equal(parseCard(json(form({ fields: [{ label: "a", type: "select", options: Array.from({ length: 9 }, (_, i) => `o${i}`) }] }))), null);
    assert.equal(parseCard(json(form({ fields: [{ label: "a", type: "select", options: ["x".repeat(61), "b"] }] }))), null);
    assert.equal(parseCard(json(form({ fields: [{ label: "l".repeat(41) }] }))), null);
    assert.equal(parseCard(json(form({ fields: [{ label: "a", placeholder: "p".repeat(101) }] }))), null);
    assert.equal(parseCard(json(form({ fields: [{ label: "a", required: "yes" }] }))), null);
  });
  it("action 在 form 上被忽略;不能嵌进 tabs", () => {
    const c = parseCard(json(form({ action: { label: "追问", ask: "再讲讲" } })));
    assert.equal(c?.kind, "form");
    assert.equal(c && "action" in c, false);
    assert.equal(parseCard(json({ v: 1, kind: "tabs", tabs: [{ label: "a", card: form() }] })), null);
  });
});

describe("form:发送文本单行、ASCII 分隔、按字段顺序、空字段省略", () => {
  const body = parseCard(json(form())) as FormBody;
  it("全填 = prompt + 空格 + 「label: 值」以「; 」相连", () => {
    assert.equal(composeFormMessage(body, ["3 年", "上线一个 agent 站", "5 小时"]), "帮我定制学习路径 经验: 3 年; 目标: 上线一个 agent 站; 每周时间: 5 小时");
  });
  it("空字段(含只有空白)省略;值两端空白去掉", () => {
    assert.equal(composeFormMessage(body, ["3 年", "", "  "]), "帮我定制学习路径 经验: 3 年");
    assert.equal(composeFormMessage(body, [" 3 年 ", "读懂内核"]), "帮我定制学习路径 经验: 3 年; 目标: 读懂内核");
  });
  it("没有 prompt 时从第一个「label: 值」起头;全空时没有 prompt 就是空串", () => {
    const noPrompt = parseCard(json(form({ prompt: undefined }))) as FormBody;
    assert.equal(composeFormMessage(noPrompt, ["3 年"]), "经验: 3 年");
    assert.equal(composeFormMessage(noPrompt, []), "");
    assert.equal(composeFormMessage(body, []), "帮我定制学习路径");
  });
  it("placeholder / title / submit 不进文本", () => {
    const text = composeFormMessage(parseCard(json(form({ title: "TT", submit: "发出" }))) as FormBody, ["a", "b", "c"]);
    for (const hidden of ["TT", "发出", "例:3 年"]) assert.equal(text.includes(hidden), false, hidden);
  });
  it("formComplete:全部 required 非空才为真", () => {
    assert.equal(formComplete(body, ["3 年", "", "x"]), false);
    assert.equal(formComplete(body, ["3 年", "读懂内核", ""]), true);
    assert.equal(formComplete(body, ["  ", "读懂内核", ""]), false);
  });
  it("formComplete:没有题干、字段全可选、一个字没填 → 消息为空 → 不能按(codex 第 1 轮 P2);填一个就能按;有题干时空表单也能按(消息 = 题干)", () => {
    const optional = parseCard(json(form({ prompt: undefined, fields: [{ label: "a" }, { label: "b" }] }))) as FormBody;
    assert.equal(formComplete(optional, ["", ""]), false);
    assert.equal(formComplete(optional, ["  ", ""]), false);
    assert.equal(formComplete(optional, ["", "x"]), true);
    const withPrompt = parseCard(json(form({ fields: [{ label: "a" }] }))) as FormBody;
    assert.equal(formComplete(withPrompt, [""]), true);
  });
});

describe("form:解析期最坏长度(UTF-16)", () => {
  it("5 字段 + 200 字 prompt = 919 → 通过(任务卡写的 921 多算了一个分隔符:5 段只有 4 个「; 」);201 字 prompt → 回落", () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ label: `${"l".repeat(38)}${i.toString().padStart(2, "0")}`, type: "text" }));
    const ok = parseCard(json(form({ prompt: "p".repeat(200), fields: five })));
    assert.equal(ok?.kind, "form");
    if (ok?.kind !== "form") return;
    assert.equal(formWorstLength(ok), 200 + 1 + 5 * (40 + 2 + 100) + 4 * 2);
    assert.ok(formWorstLength(ok) <= CARD_LIMITS.message);
    assert.equal(parseCard(json(form({ prompt: "p".repeat(201), fields: five }))), null);
  });
  it("select 按最长一项算;label 超 40 本身就回落", () => {
    const c = parseCard(json(form({ prompt: undefined, fields: [{ label: "L", type: "select", options: ["a", "abc"] }] })));
    assert.equal(c?.kind, "form");
    if (c?.kind !== "form") return;
    assert.equal(formWorstLength(c), "L: abc".length);
  });
});

describe("leadingComponentFences:最终回答段前 N 个 xray 围栏的开围栏行号", () => {
  const F = "```";
  it("卡 + 帧 + 卡:只回前两个;第三个不在集合里", () => {
    const src = ["正文", `${F}xray-card`, "{}", F, "中间", `${F}xray-html height=320`, "<p>x</p>", F, `${F}xray-card`, "{}", F].join("\n");
    assert.deepEqual(leadingComponentFences(src, 2), [2, 6]);
    assert.deepEqual(leadingComponentFences(src, 3), [2, 6, 9]);
  });
  it("普通代码块不占名额;代码块里演示的 ```xray-card 不算围栏", () => {
    const src = [`${F}ts`, "const a = 1;", F, "````md", `${F}xray-card`, "{}", F, "````", `${F}xray-card`, "{}", F].join("\n");
    assert.deepEqual(leadingComponentFences(src, 2), [9]);
  });
  it("容器前缀与列表标记后的开围栏都认;波浪线围栏也认;未闭合的围栏(流式中)也占名额", () => {
    const src = ["- 第一项", `  ${F}xray-card`, "  {}", `  ${F}`, "> 引用", `> ~~~xray-html`, "> <b>x</b>", "> ~~~", `1. ${F}xray-card`, "{"].join("\n");
    assert.deepEqual(leadingComponentFences(src, 5), [2, 6, 9]);
  });
  it("语言标签必须完全匹配:xray-cards / xray 不算", () => {
    const src = [`${F}xray-cards`, "{}", F, `${F}xray`, "{}", F, `${F}xray-html`, "", F].join("\n");
    assert.deepEqual(leadingComponentFences(src, 2), [7]);
  });
});
