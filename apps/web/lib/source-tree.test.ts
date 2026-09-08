// `bun test lib`(dev.ps1 test 的第二处)。纯函数投影:目录树的顺序 / 折叠集合 / 体积文案。
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSourceTree, dirsOf, fmtLines, fmtSize } from "./source-tree";

const meta = (path: string, bytes = 100) => ({ path, kind: "text", bytes, lines: 1 });

test("buildSourceTree:每一层先目录后文件,各自码点序;目录带完整路径", () => {
  const tree = buildSourceTree([
    meta("apps/web/next.config.mjs"),
    meta("apps/web/app/(site)/notes/[series]/page.tsx"),
    meta("apps/api/agent/tools.ts"),
    meta("README.md"),
    meta("CLAUDE.md"),
    meta("deploy/Caddyfile"),
  ]);
  assert.deepEqual(
    tree.map((n) => n.name),
    ["apps", "deploy", "CLAUDE.md", "README.md"],
  );
  const apps = tree[0];
  assert.equal(apps.dir, "apps");
  assert.deepEqual(apps.children.map((n) => n.name), ["api", "web"]);
  const web = apps.children[1];
  assert.equal(web.dir, "apps/web");
  assert.deepEqual(web.children.map((n) => n.name), ["app", "next.config.mjs"]);
  const site = web.children[0].children[0];
  assert.equal(site.dir, "apps/web/app/(site)");
  assert.equal(site.children[0].children[0].dir, "apps/web/app/(site)/notes/[series]");
  assert.equal(site.children[0].children[0].children[0].path, "apps/web/app/(site)/notes/[series]/page.tsx");
});

test("dirsOf:当前文件经过的每一级目录;根文件为空", () => {
  assert.deepEqual(dirsOf("apps/api/agent/tools.ts"), ["apps", "apps/api", "apps/api/agent"]);
  assert.deepEqual(dirsOf("README.md"), []);
  assert.deepEqual(dirsOf("apps/web/app/(site)/notes/[series]/[chapter]/page.tsx"), [
    "apps",
    "apps/web",
    "apps/web/app",
    "apps/web/app/(site)",
    "apps/web/app/(site)/notes",
    "apps/web/app/(site)/notes/[series]",
    "apps/web/app/(site)/notes/[series]/[chapter]",
  ]);
});

test("fmtSize / fmtLines:画板的写法", () => {
  assert.equal(fmtSize(4198), "4.1 KB");
  assert.equal(fmtSize(83354), "81.4 KB");
  assert.equal(fmtSize(3153856), "3.0 MB");
  assert.equal(fmtSize(0), "0.0 KB");
  assert.equal(fmtLines(1930), "1,930 行");
  assert.equal(fmtLines(96), "96 行");
});
