// R-CARDS 验收 #1 / #9 / #10:DSL 校验的每一条上限与口径(六种合法各一、每条上限各一、链接口径、
// 未知 kind、未知字段丢弃、tabs 嵌套拒)+ 流式「围栏未闭合」判据 + 排序比较器。
// 纯函数测试,不起 Next。经 `dev.ps1 test` → `bun test lib` 运行(node:test 写法,零新增依赖)。
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CARD_LIMITS,
  cardHref,
  compareCells,
  fenceUnterminated,
  isMonoColumn,
  parseCard,
  sortRows,
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

describe("流式:围栏未闭合的判据(画板 2t 段①)", () => {
  const open = '正文一段。\n\n```xray-card\n{ "v": 1, "kind": "kv",';
  it("未闭合:代码正文是整篇正文的后缀 → 骨架", () => {
    assert.equal(fenceUnterminated(open, '{ "v": 1, "kind": "kv",\n'), true);
    assert.equal(fenceUnterminated("```xray-card\n", ""), true); // 刚开围栏、正文还是空串的第一帧
  });
  it("闭合了:后面跟着 ``` → 不是后缀 → 回落代码块", () => {
    assert.equal(fenceUnterminated(`${open} }\n\`\`\`\n`, '{ "v": 1, "kind": "kv", }\n'), false);
    assert.equal(fenceUnterminated(`${open} }\n\`\`\`\n\n后面还有话。`, '{ "v": 1, "kind": "kv", }\n'), false);
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
