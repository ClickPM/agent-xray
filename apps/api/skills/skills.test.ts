// R-SKILLS skills 服务测试:读面的分组 / 排序 / 边界,以及 zip 下载端点。
// 内容写入不在本服务里(由 mcp 管理面整包发布,写面测试在 mcp/mcp.test.ts),
// 所以这里的夹具直接写库 —— 与 notes.test.ts 同一做法。经 `dev.ps1 test` 运行(CLAUDE.md 规则 2)。
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { ServerResponse } from "node:http";
import { APIError, ErrCode } from "encore.dev/api";
import { strFromU8, unzipSync } from "fflate";
import { buildSkillZip, skillPackHash, validateSkillPack, type SkillFileInput } from "../shared/skill-pack";
import { db } from "./db";
import { getSkill, listSkills } from "./skills";
import { handleZip } from "./zip";

const T0 = Date.UTC(2026, 8, 1, 0, 0, 0);
const day = 86_400_000;

/** 迁移 012 种下的四个分类;本文件会清空 skills_categories,跑完复原(与 sandbox.test.ts 复原 tool_config 同一理由) */
const SEED_CATEGORIES: Array<[string, string, string, number]> = [
  ["framework", "开发框架", "#2563eb", 1],
  ["workflow", "工作流", "#16a34a", 2],
  ["review", "审查与质量", "#f9c22e", 3],
  ["writing", "写作与内容", "#8b5cf6", 4],
];

async function clearAll() {
  // 外键顺序:文件 → skill → 分类
  await db.exec`DELETE FROM skill_files`;
  await db.exec`DELETE FROM skills`;
  await db.exec`DELETE FROM skills_categories`;
}

beforeEach(clearAll);

afterAll(async () => {
  await clearAll();
  for (const [slug, name, dot, sort] of SEED_CATEGORIES) {
    await db.exec`
      INSERT INTO skills_categories (slug, name, dot, sort_order)
      VALUES (${slug}, ${name}, ${dot}, ${sort})
      ON CONFLICT (slug) DO NOTHING`;
  }
});

async function seedCategory(slug: string, name: string, sort: number, dot = "#2563eb") {
  await db.exec`
    INSERT INTO skills_categories (slug, name, dot, sort_order)
    VALUES (${slug}, ${name}, ${dot}, ${sort})`;
}

const skillMd = (name: string, body = "# 标题\n\n## 何时用\n\n正文。\n") =>
  `---\nname: ${name}\ndescription: 测试用\n---\n\n${body}`;

/** 与写面同一条路(校验 → 打 zip → 哈希),只是绕过 mcp 直接写库 */
async function seedSkill(opts: {
  name: string;
  category: string;
  sort?: number;
  sourceType?: "own" | "curated";
  repo?: string;
  repoUrl?: string | null;
  version?: string | null;
  summary?: string;
  updatedAt?: number;
  files?: SkillFileInput[];
}) {
  const files = opts.files ?? [
    { path: "scripts/run.py", content: "print('hi')\n" },
    { path: "SKILL.md", content: skillMd(opts.name) },
    { path: "references/format.md", content: "# 格式\n" },
  ];
  const pack = validateSkillPack(opts.name, files);
  const meta = {
    categorySlug: opts.category,
    summary: opts.summary ?? "一句话",
    sourceType: opts.sourceType ?? "own",
    repo: opts.repo ?? "ClickPM/agent-skills",
    repoUrl: opts.repoUrl === undefined ? "https://github.com/ClickPM/agent-skills" : opts.repoUrl,
    version: opts.version ?? null,
    sortOrder: opts.sort ?? 0,
  };
  const zip = Buffer.from(buildSkillZip(opts.name, pack.files));
  const updated = new Date(opts.updatedAt ?? T0).toISOString();
  await db.exec`
    INSERT INTO skills (name, category_slug, summary, source_type, repo, repo_url, version, sort_order,
                        zip, zip_size, content_hash, created_at, updated_at)
    VALUES (${opts.name}, ${meta.categorySlug}, ${meta.summary}, ${meta.sourceType}, ${meta.repo},
            ${meta.repoUrl}, ${meta.version}, ${meta.sortOrder}, ${zip}, ${zip.length},
            ${skillPackHash(meta, pack.files)}, ${updated}::timestamptz, ${updated}::timestamptz)`;
  for (const f of pack.files) {
    await db.exec`
      INSERT INTO skill_files (skill_name, path, kind, content, size_bytes, line_count, sort_order)
      VALUES (${opts.name}, ${f.path}, ${f.kind}, ${f.content}, ${f.sizeBytes}, ${f.lineCount}, ${f.sortOrder})`;
  }
  return { pack, zip };
}

/** 端点抛的是 APIError;取它的 code 做断言,避免比对文案 */
async function codeOf(p: Promise<unknown>): Promise<ErrCode | "no-error"> {
  try {
    await p;
    return "no-error";
  } catch (err) {
    if (err instanceof APIError) return err.code;
    throw err;
  }
}

describe("首页 GET /skills", () => {
  it("没有 skill 时:空分类不出现,total 0,latest null", async () => {
    await seedCategory("framework", "开发框架", 1);
    const r = await listSkills();
    expect(r.categories).toEqual([]);
    expect(r.total).toBe(0);
    expect(r.latest).toBeNull();
  });

  it("分类按 sort_order、组内按 sort_order;卡片带文件数与出处;latest 取最近更新", async () => {
    await seedCategory("writing", "写作与内容", 4, "#8b5cf6");
    await seedCategory("framework", "开发框架", 1, "#2563eb");
    await seedCategory("workflow", "工作流", 2, "#16a34a"); // 没有 skill,不该出现
    await seedSkill({ name: "b-skill", category: "framework", sort: 2, updatedAt: T0 + day });
    await seedSkill({ name: "a-skill", category: "framework", sort: 1, sourceType: "curated", repo: "encoredev/skills", repoUrl: null });
    await seedSkill({ name: "pdf", category: "writing", updatedAt: T0 + 3 * day });

    const r = await listSkills();
    expect(r.categories.map((c) => c.slug)).toEqual(["framework", "writing"]);
    expect(r.categories[0].dot).toBe("#2563eb");
    expect(r.categories[0].skills.map((s) => s.name)).toEqual(["a-skill", "b-skill"]);
    expect(r.categories[0].skills[0]).toMatchObject({
      sourceType: "curated",
      repo: "encoredev/skills",
      repoUrl: null,
      fileCount: 3,
    });
    expect(r.categories[0].skills[1].updatedAt).toBe(new Date(T0 + day).toISOString());
    expect(r.total).toBe(3);
    expect(r.latest).toEqual({ name: "pdf", updatedAt: new Date(T0 + 3 * day).toISOString() });
  });
});

describe("详情 GET /skills/:name", () => {
  it("文件顺序 SKILL.md 首位、其余按路径;元信息与统计对得上", async () => {
    await seedCategory("review", "审查与质量", 3);
    const { pack, zip } = await seedSkill({ name: "codex-review-loop", category: "review", version: "1.2" });
    const r = await getSkill({ name: "codex-review-loop" });
    expect(r.files.map((f) => f.path)).toEqual(["SKILL.md", "references/format.md", "scripts/run.py"]);
    expect(r.files.map((f) => f.kind)).toEqual(["markdown", "markdown", "python"]);
    expect(r.fileCount).toBe(3);
    expect(r.totalBytes).toBe(pack.totalBytes);
    expect(r.zipSize).toBe(zip.length);
    expect(r).toMatchObject({
      categorySlug: "review",
      categoryName: "审查与质量",
      version: "1.2",
      repo: "ClickPM/agent-skills",
      sourceType: "own",
    });
    expect(r.files[2].lineCount).toBe(1);
    expect(r.files[2].content).toBe("print('hi')\n");
  });

  it("未知 name → not_found;形状不合法(大写 / 非 ASCII)→ invalid_argument", async () => {
    expect(await codeOf(getSkill({ name: "nope" }))).toBe(ErrCode.NotFound);
    expect(await codeOf(getSkill({ name: "Nope" }))).toBe(ErrCode.InvalidArgument);
    expect(await codeOf(getSkill({ name: "技能" }))).toBe(ErrCode.InvalidArgument);
    expect(await codeOf(getSkill({ name: "a".repeat(65) }))).toBe(ErrCode.InvalidArgument);
  });
});

/** 收集状态码、响应头与正文的假响应 */
function fakeResp() {
  const chunks: Buffer[] = [];
  const state: { status: number; headers: Record<string, string> } = { status: 0, headers: {} };
  const resp = {
    writeHead(status: number, headers?: Record<string, string>) {
      state.status = status;
      state.headers = headers ?? {};
      return resp;
    },
    end(chunk?: Buffer | string) {
      if (chunk !== undefined) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    },
  };
  return {
    resp: resp as unknown as ServerResponse,
    state,
    body: () => Buffer.concat(chunks),
  };
}

describe("zip 下载 GET /assets/skills/<name>.zip", () => {
  it("200 + application/zip + attachment + nosniff + 强 ETag;解压后文件集合与内容与库内一致", async () => {
    await seedCategory("review", "审查与质量", 3);
    const files: SkillFileInput[] = [
      { path: "SKILL.md", content: skillMd("codex-review-loop", "# 中文\n\n正文 ✓\n") },
      { path: "scripts/review.py", content: "import sys\nprint(sys.argv)\n" },
    ];
    await seedSkill({ name: "codex-review-loop", category: "review", files });
    const { resp, state, body } = fakeResp();
    await handleZip({ url: "/assets/skills/codex-review-loop.zip", method: "GET", headers: {} }, resp);
    expect(state.status).toBe(200);
    expect(state.headers["Content-Type"]).toBe("application/zip");
    expect(state.headers["Content-Disposition"]).toBe('attachment; filename="codex-review-loop.zip"');
    expect(state.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(state.headers["Cache-Control"]).not.toContain("immutable");
    expect(state.headers.ETag).toMatch(/^"[0-9a-f]{64}"$/);
    expect(Number(state.headers["Content-Length"])).toBe(body().length);

    const unzipped = unzipSync(new Uint8Array(body()));
    const got = Object.fromEntries(Object.entries(unzipped).map(([k, v]) => [k, strFromU8(v)]));
    expect(got).toEqual({
      "codex-review-loop/SKILL.md": files[0].content,
      "codex-review-loop/scripts/review.py": files[1].content,
    });
  });

  it("HEAD 不带正文;If-None-Match 命中 → 304", async () => {
    await seedCategory("review", "审查与质量", 3);
    await seedSkill({ name: "x", category: "review" });
    const head = fakeResp();
    await handleZip({ url: "/assets/skills/x.zip", method: "HEAD", headers: {} }, head.resp);
    expect(head.state.status).toBe(200);
    expect(head.body().length).toBe(0);

    const etag = head.state.headers.ETag;
    const again = fakeResp();
    await handleZip({ url: "/assets/skills/x.zip", method: "GET", headers: { "if-none-match": etag } }, again.resp);
    expect(again.state.status).toBe(304);
    expect(again.body().length).toBe(0);
  });

  it("未知 skill / 不是 .zip / 名字形状不对 → 404", async () => {
    for (const url of ["/assets/skills/nope.zip", "/assets/skills/x.tar", "/assets/skills/Bad.zip", "/assets/skills/..zip"]) {
      const { resp, state } = fakeResp();
      await handleZip({ url, method: "GET", headers: {} }, resp);
      expect(state.status, url).toBe(404);
    }
  });
});
