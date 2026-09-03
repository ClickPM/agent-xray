// R-SKILLS-2 验收 ④:四个条件真值表 —— 代码有 / 库无 → 不可用;库有未开 → 不可用;开了但 hash 不等 → 不可用且日志含 drift;
// 四条全真 → 可用。漂移判定:多一个文件 / 少一个 / 改一字节。另:validateSkillInput 的判据。
// 库里的展示副本用 runner/skills 的磁盘文件种(与所有者经 MCP 上传的效果相同)。经 `dev.ps1 test` 运行。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AGENT_SKILLS } from "../shared/skills.generated";
import { db } from "./db";
import { loadAgentSkills, MAX_SKILL_INPUT_CHARS, validateSkillInput } from "./skills-catalog";

const here = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = resolve(here, "..", "..", "..", "runner", "skills");

function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, base));
    else out.push(relative(base, full).split("\\").join("/"));
  }
  return out.sort();
}

/** 把代码副本种进库(= 所有者经 skills_upsert 上传了逐字节相同的展示副本),可选改动 */
async function seedFromCode(
  name: string,
  opts: { enabled?: boolean; mutate?: (files: Map<string, string>) => void } = {},
) {
  const dir = join(SKILLS_DIR, name);
  const files = new Map(walk(dir).map((p) => [p, readFileSync(join(dir, p), "utf8")]));
  opts.mutate?.(files);
  await db.rawExec(
    `INSERT INTO skills (name, category_slug, summary, source_type, repo, repo_url, version, sort_order,
                         zip, zip_size, content_hash, agent_enabled)
     VALUES ($1, 'framework', 'seed', 'own', 'ClickPM/agent-skills', NULL, NULL, 0, decode('', 'hex'), 0, $2, $3)`,
    name,
    `h-${name}`,
    opts.enabled ?? false,
  );
  for (const [path, content] of files) {
    await db.rawExec(
      `INSERT INTO skill_files (skill_name, path, kind, content, size_bytes, line_count, sort_order)
       VALUES ($1, $2, 'text', $3, $4, 1, 0)`,
      name,
      path,
      content,
      Buffer.byteLength(content, "utf8"),
    );
  }
}

async function clear() {
  await db.exec`DELETE FROM skill_files`;
  await db.exec`DELETE FROM skills`;
}

describe("四个条件真值表(验收 ④)", () => {
  beforeEach(clear);
  afterAll(clear);

  it("代码有 / 库无 → 不可用,dropped 说「库里没有」", async () => {
    const r = await loadAgentSkills();
    expect(r.skills).toEqual([]);
    expect(r.fingerprint).toBe("-");
    for (const s of AGENT_SKILLS) expect(r.dropped).toContain(`${s.name}(库里没有)`);
  });

  it("库有但没打开(默认 FALSE)→ 不可用", async () => {
    await seedFromCode("text-tools");
    const r = await loadAgentSkills();
    expect(r.skills).toEqual([]);
    expect(r.dropped).toContain("text-tools(agent_enabled=false)");
  });

  it("打开了但改了一字节 → 不可用,dropped 含 drift 与 changed 的路径", async () => {
    await seedFromCode("text-tools", {
      enabled: true,
      mutate: (files) => files.set("scripts/wordfreq.py", `${files.get("scripts/wordfreq.py")}#`),
    });
    const r = await loadAgentSkills();
    expect(r.skills).toEqual([]);
    const line = r.dropped.find((d) => d.startsWith("text-tools("));
    expect(line).toContain("drift");
    expect(line).toContain("changed scripts/wordfreq.py");
  });

  it("打开了但库里多一个文件 → drift(extra)", async () => {
    await seedFromCode("encore-api", { enabled: true, mutate: (files) => files.set("scripts/evil.py", "print('x')") });
    const r = await loadAgentSkills();
    expect(r.skills.map((s) => s.name)).not.toContain("encore-api");
    expect(r.dropped.find((d) => d.startsWith("encore-api("))).toContain("extra scripts/evil.py");
  });

  it("打开了但库里少一个文件 → drift(missing)", async () => {
    await seedFromCode("text-tools", { enabled: true, mutate: (files) => files.delete("xray.json") });
    const r = await loadAgentSkills();
    expect(r.skills).toEqual([]);
    expect(r.dropped.find((d) => d.startsWith("text-tools("))).toContain("missing xray.json");
  });

  it("四条全真 → 可用;集合按名字排序;指纹随集合变化", async () => {
    await seedFromCode("text-tools", { enabled: true });
    await seedFromCode("encore-api", { enabled: true });
    await seedFromCode("encore-database"); // 未开
    const r = await loadAgentSkills();
    expect(r.skills.map((s) => s.name)).toEqual(["encore-api", "text-tools"]);
    expect(r.dropped).toContain("encore-database(agent_enabled=false)");
    expect(r.fingerprint).not.toBe("-");
    // 可用的就是代码里那一份(正文 / 脚本 / schema 都来自 generated.ts,不来自库)
    const tt = r.skills.find((s) => s.name === "text-tools")!;
    expect(tt.scripts.map((x) => x.file)).toEqual(["json_pretty.py", "wordfreq.py"]);
    expect(tt.body).toBe(AGENT_SKILLS.find((s) => s.name === "text-tools")!.body);

    await db.rawExec(`UPDATE skills SET agent_enabled = TRUE WHERE name = 'encore-database'`);
    const r2 = await loadAgentSkills();
    expect(r2.skills.map((s) => s.name)).toEqual(["encore-api", "encore-database", "text-tools"]);
    expect(r2.fingerprint).not.toBe(r.fingerprint);

    await db.rawExec(`UPDATE skills SET agent_enabled = FALSE WHERE name = 'text-tools'`);
    const r3 = await loadAgentSkills();
    expect(r3.skills.map((s) => s.name)).toEqual(["encore-api", "encore-database"]);
  });

  it("库里的 SQL 侧哈希与代码侧的 UTF-8 字节哈希同口径(中文内容也一致)", async () => {
    // text-tools 的 SKILL.md 含中文:convert_to(content,'UTF8') 的 sha256 必须等于生成器对文件字节的 sha256
    await seedFromCode("text-tools", { enabled: true });
    const r = await loadAgentSkills();
    expect(r.skills.map((s) => s.name)).toEqual(["text-tools"]);
  });
});

describe("skill_run 入参校验(validateSkillInput)", () => {
  const schema = AGENT_SKILLS.find((s) => s.name === "text-tools")!.scripts.find((x) => x.file === "wordfreq.py")!.input;

  it("合法:只保留声明过的字段,可选字段可省", () => {
    expect(validateSkillInput(schema, JSON.stringify({ text: "a b", top: 5 }))).toEqual({ ok: true, value: { text: "a b", top: 5 } });
    expect(validateSkillInput(schema, JSON.stringify({ text: "a b" }))).toEqual({ ok: true, value: { text: "a b" } });
  });

  it("边界:maxLength 恰好 / 超一;minimum / maximum 恰好 / 超一;长度上限 4096 字符", () => {
    expect(validateSkillInput(schema, JSON.stringify({ text: "x".repeat(4000) })).ok).toBe(true);
    expect(validateSkillInput(schema, JSON.stringify({ text: "x".repeat(4001) })).ok).toBe(false);
    expect(validateSkillInput(schema, JSON.stringify({ text: "a", top: 50 })).ok).toBe(true);
    expect(validateSkillInput(schema, JSON.stringify({ text: "a", top: 51 })).ok).toBe(false);
    expect(validateSkillInput(schema, JSON.stringify({ text: "a", top: 0 })).ok).toBe(false);
    expect(validateSkillInput(schema, JSON.stringify({ text: "" })).ok).toBe(false);
    const long = `{"text":"${"y".repeat(MAX_SKILL_INPUT_CHARS)}"}`;
    expect(validateSkillInput(schema, long).ok).toBe(false);
  });

  it("类型与形状:布尔当整数 / 字符串当整数 / 数组 / 标量 / 嵌套对象 都拒", () => {
    expect(validateSkillInput(schema, JSON.stringify({ text: "a", top: true })).ok).toBe(false);
    expect(validateSkillInput(schema, JSON.stringify({ text: "a", top: "3" })).ok).toBe(false);
    expect(validateSkillInput(schema, "[]").ok).toBe(false);
    expect(validateSkillInput(schema, "null").ok).toBe(false);
    expect(validateSkillInput(schema, JSON.stringify({ text: { nested: 1 } })).ok).toBe(false);
  });

  it("原型链字段名不算已声明(__proto__ / constructor)", () => {
    expect(validateSkillInput(schema, '{"text":"a","constructor":{}}').ok).toBe(false);
    expect(validateSkillInput(schema, '{"text":"a","__proto__":{"x":1}}').ok).toBe(false);
  });

  it("NUL 与控制字符:JSON 转义形式的 NUL 也拒", () => {
    const withNul = JSON.stringify({ text: `a${String.fromCharCode(0)}b` });
    const r = validateSkillInput(schema, withNul);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("NUL");
  });
});
