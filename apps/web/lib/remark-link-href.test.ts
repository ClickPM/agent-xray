// `bun test lib`(dev.ps1 test 的第二处)。只改 link 节点的 url;inlineCode / code / text / image / definition / linkReference 一律不动。
import { test } from "node:test";
import assert from "node:assert/strict";
import { rewriteLinkNodes, type MdNode } from "./remark-link-href";

test("rewriteLinkNodes:只有 link 的 url 被改写;code span / 围栏 / 文本 / 图片 / 引用式定义原样", () => {
  const tree: MdNode & { children: MdNode[] } = {
    type: "root",
    children: [
      {
        type: "paragraph",
        children: [
          { type: "link", url: "docs/security.md", children: [{ type: "text" }] },
          { type: "inlineCode" },
          { type: "text" },
          { type: "image", url: "assets/x.png" },
          { type: "imageReference" },
          { type: "linkReference" },
        ],
      },
      { type: "code" },
      // 引用式图片与引用式链接共用 definition:改了它图片就指到源码页(codex 第 4 轮 P2),所以整类不碰
      { type: "definition", url: "assets/y.png" },
      { type: "definition", url: "ROUNDS.md#x" },
      { type: "paragraph", children: [{ type: "link", url: "https://example.com", children: [] }] },
    ],
  };
  const seen: string[] = [];
  rewriteLinkNodes(tree, (url) => {
    seen.push(url);
    return url.startsWith("http") ? null : `/source/${url}`;
  });
  assert.deepEqual(seen, ["docs/security.md", "https://example.com"]);
  const p = tree.children[0] as MdNode & { children: MdNode[] };
  assert.equal(p.children[0].url, "/source/docs/security.md");
  assert.equal(p.children[3].url, "assets/x.png");
  assert.equal(tree.children[2].url, "assets/y.png");
  assert.equal(tree.children[3].url, "ROUNDS.md#x");
  assert.equal((tree.children[4] as MdNode & { children: MdNode[] }).children[0].url, "https://example.com");
});
