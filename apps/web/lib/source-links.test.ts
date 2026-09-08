// `bun test lib`(dev.ps1 test 的第二处)。仓库内相对链接 → `/source/...` 的改写:只碰链接、不碰图片 / 围栏 / 绝对地址 / 锚点。
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSourcePath, rewriteSourceLinks } from "./source-links";

test("resolveSourcePath:按当前文件目录解析,.. 回退,超出仓库根回 null", () => {
  assert.equal(resolveSourcePath("README.md", "docs/security.md"), "docs/security.md");
  assert.equal(resolveSourcePath("docs/a.md", "../rounds/BACKLOG.md"), "rounds/BACKLOG.md");
  assert.equal(resolveSourcePath("docs/a.md", "./b.md"), "docs/b.md");
  assert.equal(resolveSourcePath("apps/api/agent/README.md", "../shared/skill-pack.ts"), "apps/api/shared/skill-pack.ts");
  assert.equal(resolveSourcePath("README.md", "../outside.md"), null);
  assert.equal(resolveSourcePath("docs/a.md", "../../x.md"), null);
});

test("rewriteSourceLinks:仓库内相对链接改成 /source/...,带锚点与 title 保留", () => {
  const md = "见 [安全](docs/security.md) 与 [路线图](ROUNDS.md#进度表),还有 [许可](LICENSE \"MIT\")。";
  assert.equal(
    rewriteSourceLinks(md, "README.md"),
    "见 [安全](/source/docs/security.md) 与 [路线图](/source/ROUNDS.md#进度表),还有 [许可](/source/LICENSE \"MIT\")。",
  );
  assert.equal(rewriteSourceLinks("[卡](../rounds/round-source/round-source.md)", "docs/security.md"), "[卡](/source/rounds/round-source/round-source.md)");
  // 路径段逐段编码
  assert.equal(rewriteSourceLinks("[页](app/(site)/page.tsx)", "apps/web/README.md"), "[页](/source/apps/web/app/(site)/page.tsx)");
});

test("rewriteSourceLinks:绝对地址 / 站内根路径 / 锚点 / 图片 / 围栏代码块 / 超出仓库根的都不动", () => {
  const md = [
    "[站点](https://www.kzgai.cloud/) [邮件](mailto:a@b.c) [首页](/notes) [锚](#top)",
    "![图](assets/x.png)",
    "```md",
    "[示例](docs/a.md)",
    "```",
    "[越界](../../etc/passwd)",
    "~~~",
    "[也是示例](b.md)",
    "~~~",
    "[真链接](docs/a.md)",
  ].join("\n");
  const out = rewriteSourceLinks(md, "README.md");
  const lines = out.split("\n");
  assert.equal(lines[0], "[站点](https://www.kzgai.cloud/) [邮件](mailto:a@b.c) [首页](/notes) [锚](#top)");
  assert.equal(lines[1], "![图](assets/x.png)");
  assert.equal(lines[3], "[示例](docs/a.md)");
  assert.equal(lines[5], "[越界](../../etc/passwd)");
  assert.equal(lines[7], "[也是示例](b.md)");
  assert.equal(lines[9], "[真链接](/source/docs/a.md)");
});
