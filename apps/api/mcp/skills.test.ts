// R-SKILLS 写面测试:一包文件的判据(shared/skill-pack)、整包 upsert 的幂等与原子性、
// 级联删除与分类保护、八个管理 tool 的入参 schema。经 `dev.ps1 test` 运行(CLAUDE.md 规则 2)。
//
// 覆盖面按「错了会静默」排序:
//   - 路径 / 种类 / NUL 的判据 —— 错了会把路径穿越或二进制放进 zip 条目名与页面
//   - 整包原子性 —— 错了「一个文件不合规」会留下半包
//   - 幂等 —— 错了同内容重发会假装有更新(首页「最近更新」失真)
//   - zip 回读一致 —— 错了访客下到的目录与页面上看到的不是同一份
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as z from "zod";
import { strFromU8, unzipSync } from "fflate";
import {
  MAX_SKILL_FILE_BYTES,
  checkSkillPath,
  countLines,
  frontmatterName,
  kindForPath,
  SkillPackError,
  skillPackHash,
  validateSkillPack,
  type SkillFileInput,
} from "../shared/skill-pack";
import { db } from "./db";
import * as store from "./store";
import { registerTools } from "./tools";

const NUL = String.fromCharCode(0);

const skillMd = (name: string, body = "# 标题\n\n## 何时用\n\n正文。\n") =>
  `---\nname: ${name}\ndescription: 测试用\n---\n\n${body}`;

const goodFiles = (name: string): SkillFileInput[] => [
  { path: "SKILL.md", content: skillMd(name) },
  { path: "scripts/run.py", content: "print('hi')\n" },
  { path: "references/format.md", content: "# 格式\n" },
  { path: "LICENSE", content: "MIT\n" },
];

/** 期望 validateSkillPack 拒绝,并回一句含关键词的可读理由 */
function rejects(name: string, files: SkillFileInput[], want: string | RegExp) {
  let msg = "NO ERROR";
  try {
    validateSkillPack(name, files);
  } catch (err) {
    expect(err).toBeInstanceOf(SkillPackError);
    msg = (err as Error).message;
  }
  expect(msg).toMatch(want);
}

describe("一包文件的判据(shared/skill-pack)", () => {
  it("路径规则:相对、无 ..、不以 / 开头、段字符集、段数 <= 4", () => {
    expect(checkSkillPath("SKILL.md")).toBeNull();
    expect(checkSkillPath("scripts/review.py")).toBeNull();
    expect(checkSkillPath("a/b/c/d.md")).toBeNull();
    expect(checkSkillPath("a/b/c/d/e.md")).toMatch(/段数/);
    expect(checkSkillPath("/SKILL.md")).toMatch(/相对路径/);
    expect(checkSkillPath("../SKILL.md")).toMatch(/\.\./);
    expect(checkSkillPath("scripts/../x.py")).toMatch(/\.\./);
    expect(checkSkillPath("scripts/./x.py")).toMatch(/\.\./);
    expect(checkSkillPath("scripts//x.py")).toMatch(/空段/);
    expect(checkSkillPath("scripts/")).toMatch(/空段/);
    expect(checkSkillPath("scripts\\x.py")).toMatch(/分隔符/);
    expect(checkSkillPath("my file.md")).toMatch(/A-Za-z0-9/);
    expect(checkSkillPath("中文.md")).toMatch(/A-Za-z0-9/);
    expect(checkSkillPath("")).toMatch(/不能为空/);
    expect(checkSkillPath(`${"a".repeat(201)}.md`)).toMatch(/200/);
  });

  it("种类由扩展名派生且是闭集;LICENSE 这类无扩展名的常见文本文件收成 text;svg / html / png 派生不出来", () => {
    expect(kindForPath("SKILL.md")).toBe("markdown");
    expect(kindForPath("scripts/x.py")).toBe("python");
    expect(kindForPath("run.sh")).toBe("shell");
    expect(kindForPath("a.ts")).toBe("typescript");
    expect(kindForPath("a.mjs")).toBe("javascript");
    expect(kindForPath("xray.json")).toBe("json");
    expect(kindForPath("a.yml")).toBe("yaml");
    expect(kindForPath("pyproject.toml")).toBe("toml");
    expect(kindForPath("requirements.txt")).toBe("text");
    expect(kindForPath("LICENSE")).toBe("text");
    expect(kindForPath("docs/README")).toBe("text");
    expect(kindForPath("Icon.PY")).toBe("python");
    for (const bad of ["logo.svg", "index.html", "a.png", "a.exe", "noext", ".hidden", "a.md."]) {
      expect(kindForPath(bad), bad).toBeNull();
    }
  });

  it("frontmatter 只认 --- 围起来的 key: value;引号两种都剥", () => {
    expect(frontmatterName("---\nname: x\n---\n")).toBe("x");
    expect(frontmatterName('---\nname: "x-y"\ndescription: d\n---\n')).toBe("x-y");
    expect(frontmatterName("---\r\nname: 'z'\r\n---\r\n")).toBe("z");
    expect(frontmatterName("---\ndescription: d\n---\n")).toBeNull();
    expect(frontmatterName("# 没有 frontmatter\nname: x\n")).toBeNull();
    expect(frontmatterName("---\nname: x\n")).toBeNull(); // 没闭合
  });

  it("行数:末尾换行不另起一行,空文件 0 行", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("a")).toBe(1);
    expect(countLines("a\n")).toBe(1);
    expect(countLines("a\nb")).toBe(2);
    expect(countLines("a\nb\n")).toBe(2);
  });

  it("合法包:SKILL.md 排首位、其余按路径;大小与行数派生正确", () => {
    const pack = validateSkillPack("x", goodFiles("x"));
    expect(pack.files.map((f) => f.path)).toEqual(["SKILL.md", "LICENSE", "references/format.md", "scripts/run.py"]);
    expect(pack.files.map((f) => f.sortOrder)).toEqual([0, 1, 2, 3]);
    expect(pack.files.map((f) => f.kind)).toEqual(["markdown", "text", "markdown", "python"]);
    expect(pack.files[3]).toMatchObject({ sizeBytes: 12, lineCount: 1 });
    expect(pack.totalBytes).toBe(pack.files.reduce((a, f) => a + f.sizeBytes, 0));
    // 中文按 UTF-8 字节计
    const cn = validateSkillPack("y", [{ path: "SKILL.md", content: skillMd("y", "你好\n") }]);
    expect(cn.files[0].sizeBytes).toBe(Buffer.byteLength(cn.files[0].content, "utf8"));
  });

  it("哈希无歧义:正文里含控制字符 + 另一个路径的单文件包,与真的两个文件的包哈希不同(codex 首轮 P2)", () => {
    const REC = String.fromCharCode(30);
    const SEP = String.fromCharCode(31);
    const meta = { categorySlug: "review", summary: "", sourceType: "own", repo: "a/b", repoUrl: null, version: null, sortOrder: 0 };
    const md = skillMd("x");
    // 旧的分隔符拼接下这两包的哈希输入逐字节相同:REC a.txt SEP 1 REC b.txt SEP 2
    const one = validateSkillPack("x", [{ path: "SKILL.md", content: md }, { path: "a.txt", content: `1${REC}b.txt${SEP}2` }]);
    const two = validateSkillPack("x", [{ path: "SKILL.md", content: md }, { path: "a.txt", content: "1" }, { path: "b.txt", content: "2" }]);
    expect(skillPackHash(meta, one.files)).not.toBe(skillPackHash(meta, two.files));
    // 元信息字段之间同理:summary 尾部带分隔符 + repo 前段,不等于分开的两个字段
    const h1 = skillPackHash({ ...meta, summary: `s${SEP}a/b`, repo: "c/d" }, two.files);
    const h2 = skillPackHash({ ...meta, summary: "s", repo: "a/b" }, two.files);
    expect(h1).not.toBe(h2);
    // 同一份内容、发布顺序不同 → 相同(排序在校验里做)
    const rev = validateSkillPack("x", [{ path: "b.txt", content: "2" }, { path: "a.txt", content: "1" }, { path: "SKILL.md", content: md }]);
    expect(skillPackHash(meta, rev.files)).toBe(skillPackHash(meta, two.files));
  });

  it("十二种非法输入逐条被拒,理由可读", () => {
    const md = skillMd("x");
    rejects("x", [{ path: "scripts/run.py", content: "" }], /缺少根目录的 SKILL.md/);
    rejects("x", [{ path: "docs/SKILL.md", content: md }], /缺少根目录的 SKILL.md/);
    // 括号用 . 占位:源码里的消息用的是全角括号,写进正则字面量容易与分组混淆
    rejects("x", [{ path: "SKILL.md", content: skillMd("y") }], /name.y.必须等于 skill 名.x./);
    rejects("x", [{ path: "SKILL.md", content: "# 没有 frontmatter\n" }], /缺少 frontmatter/);
    rejects("x", [{ path: "SKILL.md", content: md }, { path: "../evil.md", content: "" }], /\.\./);
    rejects("x", [{ path: "SKILL.md", content: md }, { path: "/etc/passwd", content: "" }], /相对路径/);
    rejects("x", [{ path: "SKILL.md", content: md }, { path: "bad name.md", content: "" }], /A-Za-z0-9/);
    rejects("x", [{ path: "SKILL.md", content: md }, { path: "a/b/c/d/e.md", content: "" }], /段数/);
    rejects("x", [{ path: "SKILL.md", content: md }, { path: "big.txt", content: "a".repeat(MAX_SKILL_FILE_BYTES + 1) }], /单文件上限/);
    rejects(
      "x",
      [
        { path: "SKILL.md", content: md },
        { path: "a.txt", content: "a".repeat(200 * 1024) },
        { path: "b.txt", content: "b".repeat(200 * 1024) },
        { path: "c.txt", content: "c".repeat(200 * 1024) },
      ],
      /整包超过/,
    );
    rejects("x", [{ path: "SKILL.md", content: md }, ...Array.from({ length: 64 }, (_, i) => ({ path: `f${i}.txt`, content: "" }))], /文件数 65/);
    rejects("x", [{ path: "SKILL.md", content: md }, { path: "bin.txt", content: `abc${NUL}def` }], /NUL/);
    rejects("x", [{ path: "SKILL.md", content: md }, { path: "logo.svg", content: "<svg/>" }], /派生不出文件种类/);
    rejects("x", [{ path: "SKILL.md", content: md }, { path: "bad.txt", content: "\ud800" }], /UTF-8/);
    rejects("x", [{ path: "SKILL.md", content: md }, { path: "A.md", content: "" }, { path: "a.md", content: "" }], /路径重复/);
    rejects("x", [], /不能为空/);
    rejects("Bad", [{ path: "SKILL.md", content: md }], /name 需匹配/);
  });
});

describe("Skills 技能库(mcp/store)", () => {
  /** 迁移 012 种下的四个分类;本文件会清空表,跑完复原 */
  const SEED_CATEGORIES: Array<[string, string, string, number]> = [
    ["framework", "开发框架", "#2563eb", 1],
    ["workflow", "工作流", "#16a34a", 2],
    ["review", "审查与质量", "#f9c22e", 3],
    ["writing", "写作与内容", "#8b5cf6", 4],
  ];

  async function clearAll() {
    await db.exec`DELETE FROM skill_files`;
    await db.exec`DELETE FROM skills`;
    await db.exec`DELETE FROM skills_categories`;
  }

  beforeEach(async () => {
    await clearAll();
    await store.upsertSkillCategory({ slug: "review", name: "审查与质量", dot: "#f9c22e", sortOrder: 3 });
  });

  afterAll(async () => {
    await clearAll();
    for (const [slug, name, dot, sortOrder] of SEED_CATEGORIES) {
      await store.upsertSkillCategory({ slug, name, dot, sortOrder });
    }
  });

  const base = (name: string, files = goodFiles(name)): store.UpsertSkillInput => ({
    name,
    categorySlug: "review",
    summary: "一句话",
    sourceType: "own",
    repo: "ClickPM/agent-skills",
    repoUrl: "https://github.com/ClickPM/agent-skills/tree/main/skills/x",
    version: "1.2",
    sortOrder: 0,
    files,
  });

  async function updatedAtOf(name: string): Promise<number> {
    const row = await db.rawQueryRow<{ t: number }>(
      `SELECT (extract(epoch FROM updated_at) * 1000)::double precision AS t FROM skills WHERE name = $1`,
      name,
    );
    return row!.t;
  }

  async function zipOf(name: string): Promise<Buffer> {
    const row = await db.rawQueryRow<{ zip: Uint8Array }>(`SELECT zip FROM skills WHERE name = $1`, name);
    return Buffer.from(row!.zip);
  }

  it("首次发布:created;文件全部入库、SKILL.md 首位;zip 解压回读与入参一致(条目名带 <name>/ 前缀)", async () => {
    const input = base("codex-review-loop");
    const r = await store.upsertSkill(input);
    expect(r).toMatchObject({ created: true, unchanged: false, fileCount: 4 });
    expect(r.zipSize).toBeGreaterThan(0);

    const got = await store.getSkill("codex-review-loop");
    expect(got?.files.map((f) => f.path)).toEqual(["SKILL.md", "LICENSE", "references/format.md", "scripts/run.py"]);
    expect(got).toMatchObject({ version: "1.2", repo: "ClickPM/agent-skills", fileCount: 4 });
    expect(got?.zipSize).toBe(r.zipSize);

    const unzipped = unzipSync(new Uint8Array(await zipOf("codex-review-loop")));
    const entries = Object.fromEntries(Object.entries(unzipped).map(([k, v]) => [k, strFromU8(v)]));
    expect(Object.keys(entries).sort()).toEqual(
      input.files.map((f) => `codex-review-loop/${f.path}`).sort(),
    );
    for (const f of input.files) expect(entries[`codex-review-loop/${f.path}`]).toBe(f.content);

    const file = await store.getSkillFile("codex-review-loop", "scripts/run.py");
    expect(file).toMatchObject({ kind: "python", content: "print('hi')\n", lineCount: 1 });
    expect(await store.getSkillFile("codex-review-loop", "nope.md")).toBeNull();
  });

  it("同内容重发 → unchanged,updated_at 与 zip 都不动;改一个文件 → updated,zip 重打", async () => {
    const input = base("x");
    await store.upsertSkill(input);
    const t1 = await updatedAtOf("x");
    const z1 = await zipOf("x");

    // 顺序打乱也算同一份内容(排序在校验里做)
    const r2 = await store.upsertSkill({ ...input, files: [...input.files].reverse() });
    expect(r2).toMatchObject({ created: false, unchanged: true });
    expect(await updatedAtOf("x")).toBe(t1);
    expect((await zipOf("x")).equals(z1)).toBe(true);

    const files = input.files.map((f) => (f.path === "scripts/run.py" ? { ...f, content: "print('changed')\n" } : f));
    const r3 = await store.upsertSkill({ ...input, files });
    expect(r3).toMatchObject({ created: false, unchanged: false });
    expect(await updatedAtOf("x")).toBeGreaterThan(t1);
    expect((await zipOf("x")).equals(z1)).toBe(false);
    expect((await store.getSkillFile("x", "scripts/run.py"))?.content).toBe("print('changed')\n");

    // 改元信息(summary)同样是真的更新
    const r4 = await store.upsertSkill({ ...input, files, summary: "改了描述" });
    expect(r4.unchanged).toBe(false);
  });

  it("整包替换:少报的文件被删掉", async () => {
    const input = base("x");
    await store.upsertSkill(input);
    await store.upsertSkill({ ...input, files: input.files.filter((f) => f.path !== "LICENSE") });
    const got = await store.getSkill("x");
    expect(got?.files.map((f) => f.path)).toEqual(["SKILL.md", "references/format.md", "scripts/run.py"]);
  });

  it("校验失败 → ConflictError,新 skill 库无残留、既有 skill 原样不动", async () => {
    const bad = base("fresh", [{ path: "SKILL.md", content: skillMd("fresh") }, { path: "../evil", content: "" }]);
    await expect(store.upsertSkill(bad)).rejects.toThrow(store.ConflictError);
    expect(await store.getSkill("fresh")).toBeNull();
    expect((await db.rawQueryAll(`SELECT 1 FROM skill_files WHERE skill_name = 'fresh'`)).length).toBe(0);

    const input = base("x");
    await store.upsertSkill(input);
    const t1 = await updatedAtOf("x");
    await expect(
      store.upsertSkill({ ...input, files: [{ path: "SKILL.md", content: skillMd("x") }, { path: `n${NUL}ul.txt`, content: "" }] }),
    ).rejects.toThrow(store.ConflictError);
    await expect(
      store.upsertSkill({ ...input, files: [{ path: "SKILL.md", content: skillMd("x") }, { path: "t.txt", content: `a${NUL}b` }] }),
    ).rejects.toThrow(/NUL/);
    expect(await updatedAtOf("x")).toBe(t1);
    expect((await store.getSkill("x"))?.fileCount).toBe(4);
  });

  it("未知分类 → NotFoundError(先建分类)", async () => {
    await expect(store.upsertSkill({ ...base("x"), categorySlug: "nope" })).rejects.toThrow(store.NotFoundError);
  });

  it("curated 包不带 repoUrl、不带 LICENSE 也能发布(所有者裁定非必填)", async () => {
    const r = await store.upsertSkill({
      ...base("pdf", [{ path: "SKILL.md", content: skillMd("pdf") }]),
      sourceType: "curated",
      repo: "anthropics/skills",
      repoUrl: null,
      version: null,
    });
    expect(r.created).toBe(true);
    expect(await store.getSkill("pdf")).toMatchObject({ repoUrl: null, version: null, sourceType: "curated", fileCount: 1 });
  });

  it("删 skill → 文件级联消失;删不存在的 → NotFoundError", async () => {
    await store.upsertSkill(base("x"));
    await store.deleteSkill("x");
    expect(await store.getSkill("x")).toBeNull();
    expect((await db.rawQueryAll(`SELECT 1 FROM skill_files WHERE skill_name = 'x'`)).length).toBe(0);
    await expect(store.deleteSkill("x")).rejects.toThrow(store.NotFoundError);
  });

  it("分类下还有 skill 时拒绝删分类;清空后可删;列出时带 skillCount", async () => {
    await store.upsertSkill(base("x"));
    await expect(store.deleteSkillCategory("review")).rejects.toThrow(store.ConflictError);
    expect((await store.listSkillCategories()).find((c) => c.slug === "review")?.skillCount).toBe(1);
    await store.deleteSkill("x");
    await store.deleteSkillCategory("review");
    expect((await store.listSkillCategories()).find((c) => c.slug === "review")).toBeUndefined();
    await expect(store.deleteSkillCategory("review")).rejects.toThrow(store.NotFoundError);
  });

  it("skills_list 可按分类过滤,按 sort_order 排", async () => {
    await store.upsertSkillCategory({ slug: "writing", name: "写作与内容", dot: "#8b5cf6", sortOrder: 4 });
    await store.upsertSkill({ ...base("b"), sortOrder: 2 });
    await store.upsertSkill({ ...base("a"), sortOrder: 1 });
    await store.upsertSkill({ ...base("w"), categorySlug: "writing" });
    // 不过滤:按 sort_order 再按名字 —— w(0) 排在 a(1) / b(2) 前面
    expect((await store.listSkills()).map((s) => s.name)).toEqual(["w", "a", "b"]);
    expect((await store.listSkills("review")).map((s) => s.name)).toEqual(["a", "b"]);
    expect((await store.listSkills("writing")).map((s) => s.name)).toEqual(["w"]);
  });
});

describe("skills 管理 tool 的入参 schema", () => {
  interface Registered {
    name: string;
    config: { inputSchema?: Record<string, z.ZodType> };
  }
  const registered: Registered[] = [];
  const fakeServer = {
    registerTool(name: string, config: Registered["config"]) {
      registered.push({ name, config });
    },
  };
  registerTools(fakeServer as never, {});

  const schemaOf = (name: string) => {
    const t = registered.find((r) => r.name === name);
    expect(t, `${name} 未注册`).toBeDefined();
    return z.object(t!.config.inputSchema!);
  };

  it("八个 skills tool 都注册了(分类三个 + skill 五个)", () => {
    for (const name of [
      "skills_categories_list",
      "skills_category_upsert",
      "skills_category_delete",
      "skills_list",
      "skills_get",
      "skills_file_get",
      "skills_upsert",
      "skills_delete",
    ]) {
      expect(registered.map((r) => r.name)).toContain(name);
    }
  });

  it("skills_upsert:sourceType 闭集、repo 形状、repoUrl 只收 http(s)、files 1–64", () => {
    const schema = schemaOf("skills_upsert");
    const ok = {
      name: "x",
      categorySlug: "review",
      sourceType: "own",
      repo: "ClickPM/agent-skills",
      files: [{ path: "SKILL.md", content: "---\nname: x\n---\n" }],
    };
    expect(schema.safeParse(ok).success).toBe(true);
    // 省略 repoUrl / version / summary / sortOrder 都合法(非必填)
    expect(schema.safeParse({ ...ok, repoUrl: "https://github.com/ClickPM/agent-skills" }).success).toBe(true);
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "https://", "github.com/x", ""]) {
      expect(schema.safeParse({ ...ok, repoUrl: bad }).success, bad).toBe(false);
    }
    expect(schema.safeParse({ ...ok, sourceType: "third" }).success).toBe(false);
    for (const bad of ["ClickPM", "a/b/c", "-x/y", "x/", "x y/z", "ClickPM/agent skills"]) {
      expect(schema.safeParse({ ...ok, repo: bad }).success, bad).toBe(false);
    }
    expect(schema.safeParse({ ...ok, name: "Bad" }).success).toBe(false);
    expect(schema.safeParse({ ...ok, files: [] }).success).toBe(false);
    const many = Array.from({ length: 65 }, (_, i) => ({ path: `f${i}.txt`, content: "" }));
    expect(schema.safeParse({ ...ok, files: many }).success).toBe(false);
    expect(schema.safeParse({ ...ok, files: many.slice(0, 64) }).success).toBe(true);
    expect(schema.safeParse({ ...ok, files: [{ path: "", content: "" }] }).success).toBe(false);
  });

  it("skills_file_get / skills_delete 只收合法 skill 名", () => {
    expect(schemaOf("skills_file_get").safeParse({ name: "x", path: "SKILL.md" }).success).toBe(true);
    expect(schemaOf("skills_file_get").safeParse({ name: "X", path: "SKILL.md" }).success).toBe(false);
    expect(schemaOf("skills_delete").safeParse({ name: "a-b" }).success).toBe(true);
    expect(schemaOf("skills_delete").safeParse({ name: "a_b" }).success).toBe(false);
  });
});
