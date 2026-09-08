// `bun test lib`(dev.ps1 test 的第二处)。只改 link / definition 节点的 url;inlineCode / code / text 一律不动。
import { test } from "node:test";
import assert from "node:assert/strict";
import { rewriteLinkNodes, type MdNode } from "./remark-link-href";

test("rewriteLinkNodes:link 与 definition 的 url 被改写,code span / 围栏 / 文本原样", () => {
  const tree: MdNode & { children: MdNode[] } = {
    type: "root",
    children: [
      {
        type: "paragraph",
        children: [
          { type: "link", url: "docs/security.md", children: [{ type: "text" }] },
          { type: "inlineCode", url: undefined, children: undefined },
          { type: "text" },
        ],
      },
      { type: "code" },
      { type: "definition", url: "ROUNDS.md#x" },
      { type: "paragraph", children: [{ type: "link", url: "https://example.com", children: [] }] },
    ],
  };
  const seen: string[] = [];
  rewriteLinkNodes(tree, (url) => {
    seen.push(url);
    return url.startsWith("http") ? null : `/source/${url}`;
  });
  assert.deepEqual(seen, ["docs/security.md", "ROUNDS.md#x", "https://example.com"]);
  const p = tree.children[0] as MdNode & { children: MdNode[] };
  assert.equal(p.children[0].url, "/source/docs/security.md");
  assert.equal(p.children[1].type, "inlineCode");
  assert.equal(p.children[1].url, undefined);
  assert.equal(tree.children[2].url, "/source/ROUNDS.md#x");
  assert.equal((tree.children[3] as MdNode & { children: MdNode[] }).children[0].url, "https://example.com");
});
