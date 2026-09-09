// R-CARDS-2 验收 #8 的纯函数半边:「每轮最多两个组件」在 mdast 上按文档序数,列表项 / 引用块里的围栏与顶层一视同仁,
// 缩进代码块(lang 为 null)与别的语言不占名额。`bun test lib`(dev.ps1 test 的第二处)。
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { markComponentFences, remarkComponentBudget, type MdNode } from "./remark-component-budget";

const code = (lang: string | null): MdNode => ({ type: "code", lang });
const marked = (n: MdNode) => n.data?.hProperties?.dataXrayComponent === "1";

describe("markComponentFences:前 N 个 xray 围栏打标记", () => {
  it("卡 + 帧 + 卡:前两个打标记,第三个不打;别的语言与缩进代码块(lang null)不占名额", () => {
    const tree: MdNode = {
      type: "root",
      children: [
        { type: "paragraph", children: [{ type: "text" }] },
        code("ts"),
        code(null),
        code("xray-card"),
        code("xray-html"),
        code("xray-card"),
      ],
    };
    assert.equal(markComponentFences(tree, 2), 2);
    assert.deepEqual(tree.children!.map(marked), [false, false, false, true, true, false]);
  });

  it("列表项 / 引用块里的围栏按文档序数,与顶层一视同仁(codex 第 3 轮 P2 的场景:列表续行里的围栏是合法组件)", () => {
    const inList = code("xray-card");
    const inQuote = code("xray-html");
    const top = code("xray-card");
    const tree: MdNode = {
      type: "root",
      children: [
        { type: "list", children: [{ type: "listItem", children: [{ type: "paragraph", children: [] }, inList] }] },
        { type: "blockquote", children: [inQuote] },
        top,
      ],
    };
    assert.equal(markComponentFences(tree, 2), 2);
    assert.equal(marked(inList), true);
    assert.equal(marked(inQuote), true);
    assert.equal(marked(top), false);
  });

  it("不够 N 个就有几个标几个;一个都没有回 0,树不动", () => {
    const one: MdNode = { type: "root", children: [code("xray-html")] };
    assert.equal(markComponentFences(one, 2), 1);
    assert.equal(marked(one.children![0]), true);
    const none: MdNode = { type: "root", children: [code("ts"), { type: "paragraph", children: [] }] };
    assert.equal(markComponentFences(none, 2), 0);
    assert.equal(none.children![0].data, undefined);
  });

  it("语言标签必须完全匹配:xray-cards / xray / 大写都不算", () => {
    const tree: MdNode = { type: "root", children: [code("xray-cards"), code("xray"), code("XRAY-CARD"), code("xray-card")] };
    assert.equal(markComponentFences(tree, 2), 1);
    assert.deepEqual(tree.children!.map(marked), [false, false, false, true]);
  });

  it("已有的 data / hProperties 保留,只加一个键", () => {
    const node: MdNode = { type: "code", lang: "xray-card", data: { foo: 1, hProperties: { className: ["x"] } } };
    markComponentFences({ type: "root", children: [node] }, 2);
    assert.deepEqual(node.data, { foo: 1, hProperties: { className: ["x"], dataXrayComponent: "1" } });
  });

  it("remarkComponentBudget 是 unified 插件形态:工厂 → attacher → transformer(tree)(attacher 不带参数被 unified 调用)", () => {
    const tree: MdNode = { type: "root", children: [code("xray-card"), code("xray-card"), code("xray-card")] };
    const attacher = remarkComponentBudget(2);
    const transformer = attacher();
    assert.equal(typeof transformer, "function");
    transformer(tree);
    assert.deepEqual(tree.children!.map(marked), [true, true, false]);
  });
});
