// R-SKILLS-2 验收 ③:清单同源 —— 生成物(apps/api/shared/skills.generated.ts + runner/manifest.json)== 现算。
// 与 catalog.test.ts 的「目录 == 实现」同一思路:篡改 runner/skills 任一字节而不重跑 dev.ps1 skills-gen,这里就红。
// 测试读文件系统是允许的(它不是工具体);工具体本身从不碰文件系统。
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compareSkillFiles, sha256Utf8, skillCodeFingerprint, type GeneratedSkill } from "../shared/skill-manifest";
import { AGENT_SKILLS } from "../shared/skills.generated";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const SKILLS_DIR = join(repoRoot, "runner", "skills");
const MANIFEST = JSON.parse(readFileSync(join(repoRoot, "runner", "manifest.json"), "utf8")) as {
  version: number;
  skills: Record<string, { network: string; files: Record<string, string>; scripts: Record<string, string> }>;
};

function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".") || name === "__pycache__") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, base));
    else out.push(relative(base, full).split("\\").join("/"));
  }
  return out.sort();
}

const sha256File = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

describe("清单同源(验收 ③)", () => {
  it("runner/skills 的目录集合 == AGENT_SKILLS == manifest.json 的键集合", () => {
    const onDisk = readdirSync(SKILLS_DIR).filter((n) => !n.startsWith(".")).sort();
    expect(AGENT_SKILLS.map((s) => s.name)).toEqual(onDisk);
    expect(Object.keys(MANIFEST.skills).sort()).toEqual(onDisk);
    expect(onDisk.length).toBeGreaterThan(0);
  });

  it("每个 skill 的每个文件:磁盘现算 sha256 == generated.ts == manifest.json(多一个 / 少一个 / 改一字节都红)", () => {
    for (const s of AGENT_SKILLS) {
      const dir = join(SKILLS_DIR, s.name);
      const paths = walk(dir);
      const recomputed = paths.map((p) => ({ path: p, sha256: sha256File(join(dir, p)) }));
      expect(compareSkillFiles(s.files, recomputed), `${s.name}: generated.ts 与磁盘漂移`).toMatchObject({ status: "ok" });
      const fromManifest = Object.entries(MANIFEST.skills[s.name].files).map(([path, sha256]) => ({ path, sha256 }));
      expect(compareSkillFiles(s.files, fromManifest), `${s.name}: manifest.json 与 generated.ts 漂移`).toMatchObject({ status: "ok" });
      expect(MANIFEST.skills[s.name].network).toBe(s.network);
      // 脚本 sha 是同一份文件的 sha
      for (const x of s.scripts) {
        expect(s.files.find((f) => f.path === `scripts/${x.file}`)?.sha256).toBe(x.sha256);
        expect(MANIFEST.skills[s.name].scripts[x.file]).toBe(x.sha256);
      }
      expect(Object.keys(MANIFEST.skills[s.name].scripts).sort()).toEqual(s.scripts.map((x) => x.file).sort());
    }
  });

  it("每个 skill 都有 SKILL.md,且 body 是去掉 frontmatter 的正文(与磁盘一致)", () => {
    for (const s of AGENT_SKILLS) {
      expect(s.files.some((f) => f.path === "SKILL.md")).toBe(true);
      const md = readFileSync(join(SKILLS_DIR, s.name, "SKILL.md"), "utf8");
      expect(md.startsWith("---\n")).toBe(true);
      expect(md).toContain(`name: ${s.name}`);
      expect(md.endsWith(s.body)).toBe(true);
      expect(s.description.length).toBeGreaterThan(0);
      expect(s.description).not.toContain("\n");
    }
  });

  it("network 字段透传两份清单、缺省 none;本轮只允许 none(egress 由 R-WEBFETCH 接)", () => {
    for (const s of AGENT_SKILLS) {
      expect(["none", "egress"]).toContain(s.network);
      expect(s.network, `${s.name} 声明了 egress,本轮没有对应运行器`).toBe("none");
    }
    // text-tools 没写 network 也是 none(缺省);xray.json 里显式写了也一样
    expect(AGENT_SKILLS.find((s) => s.name === "encore-api")?.network).toBe("none");
  });

  it("可运行脚本都有 description 与 additionalProperties:false 的 schema,string 字段都有 maxLength", () => {
    for (const s of AGENT_SKILLS) {
      for (const x of s.scripts) {
        expect(x.description.length).toBeGreaterThan(0);
        expect(x.input.type).toBe("object");
        expect(x.input.additionalProperties).toBe(false);
        for (const [name, p] of Object.entries(x.input.properties)) {
          expect(["string", "integer", "boolean"]).toContain(p.type);
          if (p.type === "string") expect(p.maxLength, `${s.name}/${x.file}.${name}`).toBeLessThanOrEqual(4096);
        }
        for (const r of x.input.required) expect(Object.keys(x.input.properties)).toContain(r);
      }
    }
    const tt = AGENT_SKILLS.find((s) => s.name === "text-tools")!;
    expect(tt.scripts.map((x) => x.file)).toEqual(["json_pretty.py", "wordfreq.py"]);
  });

  it("skill 文件都是 LF(哈希按字节算;CRLF 副本会让「展示副本 == 代码副本」永远不成立)", () => {
    for (const s of AGENT_SKILLS) {
      for (const f of s.files) {
        const buf = readFileSync(join(SKILLS_DIR, s.name, f.path));
        expect(buf.includes(13), `${s.name}/${f.path} 含 CR`).toBe(false);
      }
    }
  });
});

describe("一致性判据(shared/skill-manifest)", () => {
  const code: GeneratedSkill["files"] = [
    { path: "SKILL.md", sha256: "a".repeat(64) },
    { path: "scripts/x.py", sha256: "b".repeat(64) },
  ];

  it("集合相等且哈希相等 = ok;顺序无关", () => {
    expect(compareSkillFiles(code, [...code].reverse())).toEqual({ status: "ok", missing: [], extra: [], changed: [] });
  });

  it("少一个 / 多一个 / 改一字节 各自报出来", () => {
    expect(compareSkillFiles(code, [code[0]])).toMatchObject({ status: "drift", missing: ["scripts/x.py"] });
    expect(compareSkillFiles(code, [...code, { path: "extra.md", sha256: "c".repeat(64) }])).toMatchObject({
      status: "drift",
      extra: ["extra.md"],
    });
    expect(compareSkillFiles(code, [code[0], { path: "scripts/x.py", sha256: "d".repeat(64) }])).toMatchObject({
      status: "drift",
      changed: ["scripts/x.py"],
    });
    expect(compareSkillFiles(code, [])).toMatchObject({ status: "drift", missing: ["SKILL.md", "scripts/x.py"] });
  });

  it("sha256Utf8 与生成器对磁盘文件的算法同口径(UTF-8 字节)", () => {
    const tt = AGENT_SKILLS.find((s) => s.name === "text-tools")!;
    const content = readFileSync(join(SKILLS_DIR, "text-tools", "SKILL.md"), "utf8");
    expect(sha256Utf8(content)).toBe(tt.files.find((f) => f.path === "SKILL.md")!.sha256);
    // 改一字节就变
    expect(sha256Utf8(`${content} `)).not.toBe(sha256Utf8(content));
  });

  it("代码指纹随任一文件哈希变化", () => {
    const tt = AGENT_SKILLS.find((s) => s.name === "text-tools")!;
    const mutated = { ...tt, files: tt.files.map((f, i) => (i === 0 ? { ...f, sha256: "0".repeat(64) } : f)) };
    expect(skillCodeFingerprint(mutated)).not.toBe(skillCodeFingerprint(tt));
    expect(skillCodeFingerprint({ ...tt })).toBe(skillCodeFingerprint(tt));
  });
});
