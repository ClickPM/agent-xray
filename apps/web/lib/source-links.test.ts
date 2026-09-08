// `bun test lib`(dev.ps1 test 的第二处)。仓库内相对链接目标 → `/source/...`;绝对地址 / 站内根路径 / 锚点 / 越界的不动。
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSourcePath, sourceLinkHref } from "./source-links";

test("resolveSourcePath:按当前文件目录解析,.. 回退,超出仓库根回 null", () => {
  assert.equal(resolveSourcePath("README.md", "docs/security.md"), "docs/security.md");
  assert.equal(resolveSourcePath("docs/a.md", "../rounds/BACKLOG.md"), "rounds/BACKLOG.md");
  assert.equal(resolveSourcePath("docs/a.md", "./b.md"), "docs/b.md");
  assert.equal(resolveSourcePath("apps/api/agent/README.md", "../shared/skill-pack.ts"), "apps/api/shared/skill-pack.ts");
  assert.equal(resolveSourcePath("README.md", "../outside.md"), null);
  assert.equal(resolveSourcePath("docs/a.md", "../../x.md"), null);
});

test("sourceLinkHref:仓库内相对目标改成 /source/...,锚点保留、段逐段编码", () => {
  const fromReadme = sourceLinkHref("README.md");
  assert.equal(fromReadme("docs/security.md"), "/source/docs/security.md");
  assert.equal(fromReadme("ROUNDS.md#进度表"), "/source/ROUNDS.md#进度表");
  assert.equal(fromReadme("LICENSE"), "/source/LICENSE");
  assert.equal(sourceLinkHref("docs/security.md")("../rounds/round-source/round-source.md"), "/source/rounds/round-source/round-source.md");
  assert.equal(sourceLinkHref("apps/web/README.md")("app/(site)/page.tsx"), "/source/apps/web/app/(site)/page.tsx");
});

test("sourceLinkHref:绝对地址 / mailto / 站内根路径 / 纯锚点 / 空 / 越出仓库根 → null(不动)", () => {
  const f = sourceLinkHref("README.md");
  for (const u of ["https://www.kzgai.cloud/", "mailto:a@b.c", "/notes", "#top", "", "../../etc/passwd", "#"]) {
    assert.equal(f(u), null, u);
  }
});
