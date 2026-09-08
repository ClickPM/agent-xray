// R-SOURCE source 服务测试:读面只看 current、含括号 / 方括号的路径能取、404 / 400 的分界。
// 内容写入不在本服务里(由 mcp 的 source_* 发布,写面测试在 mcp/source.test.ts),
// 所以这里的夹具直接写库 —— 与 skills.test.ts 同一做法。经 `dev.ps1 test` 运行(CLAUDE.md 规则 2)。
import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { APIError, ErrCode } from "encore.dev/api";
import { SOURCE_REPO, SOURCE_REPO_URL } from "../shared/source-repo";
import { db } from "./db";
import { getSource, getSourceFile } from "./source";

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const SHA_A = "1".repeat(40);
const SHA_B = "2".repeat(40);
const ROUTE = "apps/web/app/(site)/notes/[series]/[chapter]/page.tsx";

async function clear() {
  await db.exec`DELETE FROM source_files`;
  await db.exec`DELETE FROM source_snapshots`;
}
beforeEach(clear);
afterAll(clear);

async function seed(sha: string, status: "current" | "staging", files: Array<[string, string, string]>, opts: { nullContent?: string[] } = {}) {
  await db.rawExec(
    `INSERT INTO source_snapshots (sha, status, file_count, total_bytes, published_at)
     VALUES ($1, $2, $3, $4, CASE WHEN $2 = 'current' THEN now() ELSE NULL END)`,
    sha,
    status,
    files.length,
    files.reduce((a, [, , c]) => a + Buffer.byteLength(c, "utf8"), 0),
  );
  for (const [path, kind, content] of files) {
    const isNull = opts.nullContent?.includes(path) ?? false;
    await db.rawExec(
      `INSERT INTO source_files (sha, path, kind, sha256, bytes, lines, content) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      sha,
      path,
      kind,
      sha256(content),
      Buffer.byteLength(content, "utf8"),
      content.split("\n").length - (content.endsWith("\n") ? 1 : 0),
      isNull ? null : content,
    );
  }
}

const FILES: Array<[string, string, string]> = [
  ["README.md", "markdown", "# x\n"],
  ["apps/api/agent/tools.ts", "typescript", "const a = 1;\nconst b = 2;\n"],
  [ROUTE, "typescript", "export default 1;\n"],
];

describe("GET /source", () => {
  it("没有 current → not_found", async () => {
    await expect(getSource()).rejects.toMatchObject({ code: ErrCode.NotFound });
    await seed(SHA_A, "staging", FILES);
    await expect(getSource()).rejects.toMatchObject({ code: ErrCode.NotFound });
  });

  it("回 current 的头部与全部文件元信息(不含内容),仓库常量随快照下发", async () => {
    await seed(SHA_A, "current", FILES);
    const r = await getSource();
    expect(r.snapshot.sha).toBe(SHA_A);
    expect(r.snapshot.shortSha).toBe("1111111");
    expect(r.snapshot.fileCount).toBe(3);
    expect(r.snapshot.repo).toBe(SOURCE_REPO);
    expect(r.snapshot.repoUrl).toBe(SOURCE_REPO_URL);
    expect(Date.parse(r.snapshot.publishedAt)).toBeGreaterThan(0);
    expect(r.files.map((f) => f.path)).toEqual([...FILES.map((f) => f[0])].sort());
    expect(r.files.find((f) => f.path === ROUTE)).toEqual({ path: ROUTE, kind: "typescript", bytes: 18, lines: 1 });
    expect(JSON.stringify(r)).not.toContain("const a = 1");
  });
});

describe("GET /source/file", () => {
  it("含括号 / 方括号的路径能取;头部、文件与目录树元信息属于同一快照(页面只打这一次)", async () => {
    await seed(SHA_A, "current", FILES);
    const r = await getSourceFile({ path: ROUTE });
    expect(r.path).toBe(ROUTE);
    expect(r.kind).toBe("typescript");
    expect(r.content).toBe("export default 1;\n");
    expect(r.lines).toBe(1);
    expect(r.snapshot.sha).toBe(SHA_A);
    // 目录树元信息随文件一起回(codex 首轮 P2:分两次取会在发布并发时拼出两版),码点序、不含内容
    expect(r.files.map((f) => f.path)).toEqual([...FILES.map((f) => f[0])].sort());
    expect(r.files.find((f) => f.path === ROUTE)).toEqual({ path: ROUTE, kind: "typescript", bytes: 18, lines: 1 });
    expect(JSON.stringify(r.files)).not.toContain("const a = 1");
  });

  it("形状不合法 → invalid_argument;不存在 → not_found;staging 里的文件不可见;content 为 NULL 的不可见", async () => {
    await seed(SHA_A, "current", FILES, { nullContent: ["README.md"] });
    await seed(SHA_B, "staging", [["docs/only-in-staging.md", "markdown", "x\n"]]);
    for (const bad of ["../README.md", "/README.md", "a b.md", "", "apps\\api\\x.ts"]) {
      await expect(getSourceFile({ path: bad }), bad).rejects.toMatchObject({ code: ErrCode.InvalidArgument });
    }
    await expect(getSourceFile({ path: "docs/only-in-staging.md" })).rejects.toMatchObject({ code: ErrCode.NotFound });
    await expect(getSourceFile({ path: "apps/api" })).rejects.toMatchObject({ code: ErrCode.NotFound });
    await expect(getSourceFile({ path: "README.md" })).rejects.toMatchObject({ code: ErrCode.NotFound });
    expect((await getSourceFile({ path: "apps/api/agent/tools.ts" })).lines).toBe(2);
  });

  it("错误对象是 APIError(前端 notFoundOnBadRoute 只认它)", async () => {
    await expect(getSourceFile({ path: "x.md" })).rejects.toBeInstanceOf(APIError);
  });
});
