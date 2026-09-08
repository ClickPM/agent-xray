// R-SOURCE 判据测试(shared/source-pack):kind 闭集、路径规则、manifest 与内容校验,
// 以及与发布脚本 tools/source-publish/rules.mjs 的**两份口径一致**(那份在 Encore app root 之外,不能 import 本文件)。
// 经 `dev.ps1 test` 运行(CLAUDE.md 规则 2)。
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkSourceContent,
  checkSourcePath,
  MAX_SOURCE_BATCH_BYTES,
  MAX_SOURCE_BATCH_FILES,
  MAX_SOURCE_FILE_BYTES,
  MAX_SOURCE_FILES,
  MAX_SOURCE_PATH_LENGTH,
  MAX_SOURCE_PATH_SEGMENTS,
  SOURCE_KIND_BY_BASENAME,
  SOURCE_KIND_BY_EXT,
  sourceKindForPath,
  SourcePackError,
  validateSourceManifest,
} from "./source-pack";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const NUL = String.fromCharCode(0);
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** 一条合法的 Next 路由路径:括号与方括号、8 段 —— 收录集合里真实存在的形状 */
const ROUTE_PATH = "apps/web/app/(site)/notes/[series]/[chapter]/page.tsx";

describe("kind 闭集(sourceKindForPath)", () => {
  it("扩展名表与无扩展名表", () => {
    expect(sourceKindForPath("apps/api/agent/tools.ts")).toBe("typescript");
    expect(sourceKindForPath("apps/web/app/(site)/page.tsx")).toBe("typescript");
    expect(sourceKindForPath("tools/source-publish/publish.mjs")).toBe("javascript");
    expect(sourceKindForPath("runner/runner.py")).toBe("python");
    expect(sourceKindForPath("deploy/migrate.sh")).toBe("shell");
    expect(sourceKindForPath("dev.ps1")).toBe("powershell");
    expect(sourceKindForPath("apps/api/agent/migrations/016_source.up.sql")).toBe("sql");
    expect(sourceKindForPath("apps/web/app/globals.css")).toBe("css");
    expect(sourceKindForPath("deploy/docker-compose.yml")).toBe("yaml");
    expect(sourceKindForPath(".gitleaks.toml")).toBe("toml");
    expect(sourceKindForPath("apps/api/encore.app")).toBe("text");
    expect(sourceKindForPath("deploy/.env.example")).toBe("text");
    expect(sourceKindForPath("runner/Dockerfile")).toBe("dockerfile");
    expect(sourceKindForPath("deploy/Caddyfile")).toBe("text");
    expect(sourceKindForPath("LICENSE")).toBe("text");
    expect(sourceKindForPath(".gitignore")).toBe("text");
    expect(sourceKindForPath("README.md")).toBe("markdown");
  });

  it("派生不出来回 null(不回落成 text):图片 / 字体 / 未知扩展名 / 没有扩展名的陌生文件", () => {
    for (const p of ["apps/web/app/icon.svg", "apps/web/app/apple-icon.png", "apps/web/app/fonts/x.woff2", "x.bin", "runner/manifest", ".hidden"]) {
      expect(sourceKindForPath(p), p).toBeNull();
    }
  });
});

describe("路径规则(checkSourcePath)", () => {
  it("合法:相对、括号与方括号、<= 12 段", () => {
    expect(checkSourcePath(ROUTE_PATH)).toBeNull();
    expect(checkSourcePath("README.md")).toBeNull();
    expect(checkSourcePath("a/b/c/d/e/f/g/h/i/j/k/l.md")).toBeNull();
  });

  it("非法:空、超长、绝对、反斜杠、空段、. / ..、段字符集、超 12 段", () => {
    expect(checkSourcePath("")).toMatch(/不能为空/);
    expect(checkSourcePath(`${"a".repeat(MAX_SOURCE_PATH_LENGTH)}/b.md`)).toMatch(/超过/);
    expect(checkSourcePath("/README.md")).toMatch(/相对路径/);
    expect(checkSourcePath("apps\\api\\x.ts")).toMatch(/分隔符/);
    expect(checkSourcePath("apps//api.ts")).toMatch(/空段/);
    expect(checkSourcePath("apps/api/")).toMatch(/空段/);
    expect(checkSourcePath("../x.ts")).toMatch(/\.\./);
    expect(checkSourcePath("apps/./x.ts")).toMatch(/\.\./);
    expect(checkSourcePath("apps/a b.ts")).toMatch(/每一段/);
    expect(checkSourcePath("apps/$x.ts")).toMatch(/每一段/);
    expect(checkSourcePath("文档/x.md")).toMatch(/每一段/);
    expect(checkSourcePath("a/b/c/d/e/f/g/h/i/j/k/l/m.md")).toMatch(/段数/);
  });
});

describe("manifest 校验(validateSourceManifest)", () => {
  const entry = (path: string, extra: Partial<{ sha256: string; bytes: number; lines: number }> = {}) => ({
    path,
    sha256: sha(path),
    bytes: 10,
    lines: 1,
    ...extra,
  });

  it("归一:按路径码点序、带 kind", () => {
    const out = validateSourceManifest([entry("b.md"), entry("a/x.ts"), entry("README.md")]);
    expect(out.map((e) => e.path)).toEqual(["README.md", "a/x.ts", "b.md"]);
    expect(out.map((e) => e.kind)).toEqual(["markdown", "typescript", "markdown"]);
  });

  it("逐条拒:空、超数、重复(不区分大小写)、坏路径、无 kind、坏 sha256、bytes 越界、lines 非整数", () => {
    const rejects = (files: Parameters<typeof validateSourceManifest>[0], want: RegExp) => {
      let msg = "NO ERROR";
      try {
        validateSourceManifest(files);
      } catch (err) {
        expect(err).toBeInstanceOf(SourcePackError);
        msg = (err as Error).message;
      }
      expect(msg).toMatch(want);
    };
    rejects([], /不能为空/);
    rejects(Array.from({ length: MAX_SOURCE_FILES + 1 }, (_, i) => entry(`f${i}.md`)), /超过上限/);
    rejects([entry("A.md"), entry("a.md")], /重复/);
    rejects([entry("../a.md")], /\.\./);
    rejects([entry("a.png")], /派生不出/);
    rejects([entry("a.md", { sha256: "xyz" })], /sha256/);
    rejects([entry("a.md", { bytes: MAX_SOURCE_FILE_BYTES + 1 })], /bytes/);
    rejects([entry("a.md", { bytes: -1 })], /bytes/);
    rejects([entry("a.md", { lines: 1.5 })], /lines/);
  });
});

describe("内容校验(checkSourceContent)", () => {
  it("回 sha256 / bytes / lines 三个数,行数口径与 skill-pack 一致", () => {
    const f = checkSourceContent("a.md", "x\ny\n");
    expect(f).toEqual({ sha256: sha("x\ny\n"), bytes: 4, lines: 2 });
    expect(checkSourceContent("a.md", "").lines).toBe(0);
    expect(checkSourceContent("a.md", "中文").bytes).toBe(6);
  });

  it("拒:NUL、孤立代理对、超 256 KB", () => {
    expect(() => checkSourceContent("a.md", `x${NUL}y`)).toThrow(/NUL/);
    expect(() => checkSourceContent("a.md", "x\uD800y")).toThrow(/UTF-8/);
    expect(() => checkSourceContent("a.md", "a".repeat(MAX_SOURCE_FILE_BYTES + 1))).toThrow(/超过单文件上限/);
    expect(checkSourceContent("a.md", "a".repeat(MAX_SOURCE_FILE_BYTES)).bytes).toBe(MAX_SOURCE_FILE_BYTES);
  });
});

describe("与发布脚本 rules.mjs 同一口径(改一处要改两处)", () => {
  it("kind 表、上限、路径规则逐项相等", async () => {
    const rules = (await import(pathToFileURL(join(repoRoot, "tools", "source-publish", "rules.mjs")).href)) as {
      KIND_BY_EXT: Record<string, string>;
      KIND_BY_BASENAME: Record<string, string>;
      MAX_FILE_BYTES: number;
      MAX_FILES: number;
      MAX_BATCH_BYTES: number;
      MAX_BATCH_FILES: number;
      MAX_PATH_SEGMENTS: number;
      MAX_PATH_LENGTH: number;
      kindForPath: (p: string) => string | null;
      checkPath: (p: string) => string | null;
    };
    expect({ ...rules.KIND_BY_EXT }).toEqual({ ...SOURCE_KIND_BY_EXT });
    expect({ ...rules.KIND_BY_BASENAME }).toEqual({ ...SOURCE_KIND_BY_BASENAME });
    expect(rules.MAX_FILE_BYTES).toBe(MAX_SOURCE_FILE_BYTES);
    expect(rules.MAX_FILES).toBe(MAX_SOURCE_FILES);
    expect(rules.MAX_BATCH_BYTES).toBe(MAX_SOURCE_BATCH_BYTES);
    expect(rules.MAX_BATCH_FILES).toBe(MAX_SOURCE_BATCH_FILES);
    expect(rules.MAX_PATH_SEGMENTS).toBe(MAX_SOURCE_PATH_SEGMENTS);
    expect(rules.MAX_PATH_LENGTH).toBe(MAX_SOURCE_PATH_LENGTH);
    const samples = [
      ROUTE_PATH, "README.md", "LICENSE", "runner/Dockerfile", "apps/api/encore.app", "x.png", "a b.md", "../a.md", "/a.md",
      "apps//x.ts", "a/b/c/d/e/f/g/h/i/j/k/l/m.md", ".gitignore", "deploy/.env.example", "文档/x.md",
    ];
    for (const p of samples) {
      expect(rules.kindForPath(p), `kind ${p}`).toBe(sourceKindForPath(p));
      expect(rules.checkPath(p) === null, `path ${p}`).toBe(checkSourcePath(p) === null);
    }
  });
});
