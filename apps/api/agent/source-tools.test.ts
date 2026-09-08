// R-SOURCE 三个源码只读工具(agent/tools.ts 的 source_list / source_read / source_search)的边界。
// 夹具直接写库(与 source/source.test.ts 同一做法);工具体经 queryAsAgentRo 读 —— 所以这里顺带验的是
// 「agent_ro 真的读得到两张表」(权限在 sandbox.test.ts 单独钉)。经 `dev.ps1 test` 运行(CLAUDE.md 规则 2)。
import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { toolCatalog } from "./catalog";
import { db } from "./db";
import { SOURCE_LIST_TOOL, SOURCE_READ_TOOL, SOURCE_SEARCH_TOOL, SOURCE_TOOL_NAMES, TOOL_REGISTRY } from "./tools";

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const SHA = "f".repeat(40);

async function clear() {
  await db.exec`DELETE FROM source_files`;
  await db.exec`DELETE FROM source_snapshots`;
}
beforeEach(clear);
afterAll(clear);

async function seed(files: Array<[string, string]>) {
  await db.rawExec(
    `INSERT INTO source_snapshots (sha, status, file_count, total_bytes, published_at) VALUES ($1, 'current', $2, $3, now())`,
    SHA,
    files.length,
    files.reduce((a, [, c]) => a + Buffer.byteLength(c, "utf8"), 0),
  );
  for (const [path, content] of files) {
    await db.rawExec(
      `INSERT INTO source_files (sha, path, kind, sha256, bytes, lines, content) VALUES ($1, $2, 'text', $3, $4, $5, $6)`,
      SHA,
      path,
      sha256(content),
      Buffer.byteLength(content, "utf8"),
      content.split("\n").length - (content.endsWith("\n") ? 1 : 0),
      content,
    );
  }
}

const TOOLS_TS = Array.from({ length: 12 }, (_, i) => `line ${i + 1}: const v${i + 1} = ${i + 1};`).join("\n") + "\n";
const FILES: Array<[string, string]> = [
  ["README.md", "# agent-xray\n\nHello Agent\n"],
  ["apps/api/agent/tools.ts", TOOLS_TS],
  ["apps/web/app/(site)/notes/[series]/page.tsx", "export default function Page() { return null; }\n"],
  ["docs/percent.md", "100% done_ok\nplain\n"],
];

async function run(name: string, params: Record<string, unknown>): Promise<{ text: string; details: Record<string, unknown> }> {
  const def = TOOL_REGISTRY[name];
  expect(def, `${name} 不在 TOOL_REGISTRY`).toBeDefined();
  const r = (await def.execute("call-1", params as never, new AbortController().signal, () => {})) as {
    content: [{ type: "text"; text: string }];
    details: Record<string, unknown>;
  };
  return { text: r.content[0].text, details: r.details };
}

describe("目录与分组", () => {
  it("三个工具在纯函数组,tool_config 种子(迁移 016)默认开", async () => {
    const cat = toolCatalog();
    for (const n of SOURCE_TOOL_NAMES) {
      const e = cat.find((t) => t.name === n);
      expect(e, n).toBeDefined();
      expect(e!.group).toBe("pure");
      expect(e!.output.length).toBeGreaterThan(0);
    }
    const rows = await db.rawQueryAll<{ name: string; enabled: boolean; dangerous: boolean }>(
      `SELECT name, enabled, dangerous FROM tool_config WHERE name = ANY($1) ORDER BY name`,
      [...SOURCE_TOOL_NAMES],
    );
    expect(rows.map((r) => [r.name, r.enabled, r.dangerous])).toEqual([
      [SOURCE_LIST_TOOL, true, false],
      [SOURCE_READ_TOOL, true, false],
      [SOURCE_SEARCH_TOOL, true, false],
    ]);
  });
});

describe("source_list", () => {
  it("没有快照时说清楚;有快照时首行是 snapshot 头,prefix 是纯前缀语义", async () => {
    expect((await run(SOURCE_LIST_TOOL, {})).text).toContain("还没有发布源码快照");
    await seed(FILES);
    const all = await run(SOURCE_LIST_TOOL, {});
    expect(all.text.split("\n")[0]).toBe(`snapshot ${SHA.slice(0, 7)} · 4 files`);
    expect(all.text).toContain("apps/web/app/(site)/notes/[series]/page.tsx · ");
    expect(all.details).toMatchObject({ count: 4, more: false });
    const apps = await run(SOURCE_LIST_TOOL, { prefix: "apps/api/" });
    expect(apps.text).toContain("apps/api/agent/tools.ts");
    expect(apps.text).not.toContain("README.md");
    // `%` / `_` 不是通配符
    expect((await run(SOURCE_LIST_TOOL, { prefix: "%" })).details).toMatchObject({ count: 0 });
    expect((await run(SOURCE_LIST_TOOL, { prefix: "nope/" })).text).toContain("没有以 nope/ 开头");
  });

  it("条数或字符预算任一越界 → 按整行截、带 more、提示收窄 prefix,且整段不超过结果正文上限", async () => {
    await seed(Array.from({ length: 405 }, (_, i) => [`many/f${String(i).padStart(3, "0")}.md`, "x\n"] as [string, string]));
    const r = await run(SOURCE_LIST_TOOL, {});
    const count = r.details.count as number;
    expect(r.details.more).toBe(true);
    expect(count).toBeGreaterThan(100);
    expect(count).toBeLessThan(405);
    expect(r.text).toContain(`只列了前 ${count} 条,收窄 prefix`);
    // 没有被 capText 切过:提示落在完整的一行后面,不带「已截断」标注
    expect(r.text).not.toContain("已截断");
    expect(r.text.length).toBeLessThanOrEqual(8000);
    // 行是完整的:最后一条路径是完整文件名
    const lines = r.text.split("\n");
    expect(lines[lines.length - 2]).toMatch(/^many\/f\d{3}\.md · 2 · 1$/);
  });
});

describe("source_read", () => {
  it("整文件带行号;行区间;超出上限的续读提示;不存在的路径", async () => {
    await seed(FILES);
    const whole = await run(SOURCE_READ_TOOL, { file: "apps/api/agent/tools.ts" });
    expect(whole.text.split("\n")[0]).toBe(`# apps/api/agent/tools.ts @ ${SHA.slice(0, 7)} · text · L1–L12 / 12`);
    expect(whole.text).toContain(" 1| line 1: const v1 = 1;");
    expect(whole.text).toContain("12| line 12: const v12 = 12;");
    expect(whole.details).toMatchObject({ found: true, from: 1, to: 12, total: 12 });

    const part = await run(SOURCE_READ_TOOL, { file: "apps/api/agent/tools.ts", startLine: 5, endLine: 7 });
    expect(part.text).toContain("L5–L7 / 12");
    expect(part.text).toContain("5| line 5");
    expect(part.text).toContain("7| line 7");
    expect(part.text).not.toContain("line 8");
    // endLine < startLine → 当作只读 startLine 那一行
    const one = await run(SOURCE_READ_TOOL, { file: "apps/api/agent/tools.ts", startLine: 9, endLine: 3 });
    expect(one.text).toContain("L9–L9 / 12");
    // 起点越界 → 夹到末行
    expect((await run(SOURCE_READ_TOOL, { file: "apps/api/agent/tools.ts", startLine: 99 })).text).toContain("L12–L12 / 12");

    const miss = await run(SOURCE_READ_TOOL, { file: "nope.ts" });
    expect(miss.text).toContain("快照里没有 nope.ts");
    expect(miss.details).toMatchObject({ found: false });
  });

  it("空文件:明说 0 行,不编出 L1(codex 第 2 轮 P3)", async () => {
    await seed([["empty.txt", ""]]);
    const r = await run(SOURCE_READ_TOOL, { file: "empty.txt" });
    expect(r.text).toContain("空文件(0 行)");
    expect(r.text).not.toContain("L1");
    expect(r.details).toMatchObject({ found: true, from: 0, to: 0, total: 0 });
  });

  it("超过 400 行只回前 400 行并提示 startLine 续读", async () => {
    const big = Array.from({ length: 450 }, (_, i) => `L${i + 1}`).join("\n") + "\n";
    await seed([["big.txt", big]]);
    const r = await run(SOURCE_READ_TOOL, { file: "big.txt" });
    expect(r.text).toContain("L1–L400 / 450");
    expect(r.text).toContain("继续用 startLine=401 读");
    expect(r.text).not.toContain("| L401");
  });

  it("长行按字符预算整行截:提示落在完整一行后面,不被 capText 切在半行;单行超预算也至少给一行", async () => {
    const wide = Array.from({ length: 300 }, (_, i) => `row${i + 1} ${"x".repeat(90)}`).join("\n") + "\n";
    await seed([["wide.txt", wide], ["oneline.txt", `${"y".repeat(9000)}\nsecond\n`]]);
    const r = await run(SOURCE_READ_TOOL, { file: "wide.txt" });
    const to = r.details.to as number;
    expect(to).toBeGreaterThan(10);
    expect(to).toBeLessThan(300);
    expect(r.text).toContain(`L1–L${to} / 300`);
    expect(r.text).toContain(`继续用 startLine=${to + 1} 读`);
    expect(r.text).not.toContain("已截断");
    expect(r.text.length).toBeLessThanOrEqual(8000);
    // 一行 9000 字符:仍然回这一行(被 capText 按字符截并标注),to 记 1,续读提示指向第 2 行
    const one = await run(SOURCE_READ_TOOL, { file: "oneline.txt" });
    expect(one.details).toMatchObject({ from: 1, to: 1, total: 2 });
    expect(one.text).toContain("已截断");
  });
});

describe("source_search", () => {
  it("大小写不敏感的逐行子串;prefix 限定;% _ 是字面量;hits 带 path / line / text", async () => {
    await seed(FILES);
    const r = await run(SOURCE_SEARCH_TOOL, { query: "hello agent" });
    const hits = (JSON.parse(r.text) as { hits: Array<{ path: string; line: number; text: string }> }).hits;
    expect(hits).toEqual([{ path: "README.md", line: 3, text: "Hello Agent" }]);
    const scoped = await run(SOURCE_SEARCH_TOOL, { query: "const", prefix: "apps/web/" });
    expect(scoped.text).toContain("没有匹配");
    const pct = await run(SOURCE_SEARCH_TOOL, { query: "100% done_ok" });
    expect(JSON.parse(pct.text).hits).toEqual([{ path: "docs/percent.md", line: 1, text: "100% done_ok" }]);
    expect((await run(SOURCE_SEARCH_TOOL, { query: "100_ done" })).text).toContain("没有匹配");
  });

  it("超过 40 行命中 → 截到 40 并带 more", async () => {
    await seed([["many.txt", Array.from({ length: 45 }, (_, i) => `needle ${i}`).join("\n") + "\n"]]);
    const r = await run(SOURCE_SEARCH_TOOL, { query: "needle" });
    const parsed = JSON.parse(r.text) as { hits: unknown[]; more?: boolean };
    expect(parsed.hits).toHaveLength(40);
    expect(parsed.more).toBe(true);
    expect(r.details).toMatchObject({ count: 40, more: true });
  });
});
