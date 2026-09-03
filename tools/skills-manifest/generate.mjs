#!/usr/bin/env node
// skills 清单生成器(R-SKILLS-2,所有者裁定 6「可用集合在代码里,改 = 发版」)。
//
// 读 runner/skills/<name>/ → 生成**两份同源清单**:
//   - runner/manifest.json                 执行容器核对用:每个 skill 的 network 档次、每个文件 / 脚本的 sha256
//   - apps/api/shared/skills.generated.ts  api 用:同上 + SKILL.md 正文(skill_load 注入)+ xray.json 的脚本与入参 schema
// 两份都是生成物、都入库;apps/api/agent/skills-manifest.test.ts 把「生成物 == 现算」钉成测试。
//
// 刻意放在 tools/(Encore app root 之外,CLAUDE.md 规则 6),只用 node 标准库。
// 用法:node tools/skills-manifest/generate.mjs [--check]   (--check:只比对不写,漂移则退出码 1;dev.ps1 skills-gen 调它)
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const SKILLS_DIR = join(repoRoot, "runner", "skills");
const MANIFEST_OUT = join(repoRoot, "runner", "manifest.json");
const TS_OUT = join(repoRoot, "apps", "api", "shared", "skills.generated.ts");

// 与 apps/api/shared/skill-pack.ts 的 SKILL_NAME_RE / 路径规则同一口径:这些名字会进 URL、进 zip、进命令行
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SCRIPT_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}\.py$/;
const SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
const NETWORKS = new Set(["none", "egress"]);
const INPUT_TYPES = new Set(["string", "integer", "boolean"]);
const MAX_FILE_BYTES = 256 * 1024;
const MAX_FILES = 64;
const MAX_DESCRIPTION = 300;

function fail(msg) {
  console.error(`skills-manifest: ${msg}`);
  process.exit(1);
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/** 目录里所有普通文件的相对路径(/ 分隔、码点序),跳过隐藏文件与 __pycache__ */
function walk(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.name.startsWith(".") || entry.name === "__pycache__") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else if (entry.isFile()) out.push(relative(base, full).split("\\").join("/"));
  }
  return out.sort();
}

/** SKILL.md frontmatter 的 name / description(与 shared/skill-pack.ts 的 frontmatterName 同一最小解析) */
function frontmatter(md, skill) {
  const lines = md.split("\n");
  if (lines[0]?.trim() !== "---") fail(`${skill}/SKILL.md 缺少 frontmatter`);
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 0) fail(`${skill}/SKILL.md frontmatter 没闭合`);
  const fm = {};
  for (const line of lines.slice(1, end)) {
    const m = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*?)\s*$/.exec(line);
    if (m) fm[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return { fm, body: lines.slice(end + 1).join("\n").replace(/^\n+/, "") };
}

function checkSchema(skill, script, schema) {
  const where = `${skill}/xray.json scripts.${script}.input`;
  if (!schema || typeof schema !== "object") fail(`${where} 缺失`);
  if (schema.type !== "object") fail(`${where}.type 必须是 object`);
  if (schema.additionalProperties !== false) fail(`${where}.additionalProperties 必须是 false`);
  if (!schema.properties || typeof schema.properties !== "object") fail(`${where}.properties 缺失`);
  if (!Array.isArray(schema.required)) fail(`${where}.required 必须是数组`);
  const names = Object.keys(schema.properties);
  if (names.length === 0 || names.length > 16) fail(`${where}.properties 要有 1–16 个字段`);
  for (const [name, p] of Object.entries(schema.properties)) {
    if (!/^[a-z][a-zA-Z0-9_]{0,31}$/.test(name)) fail(`${where}.${name}:字段名只接受 camelCase / snake_case`);
    if (!INPUT_TYPES.has(p.type)) fail(`${where}.${name}.type 只接受 string / integer / boolean`);
    if (typeof p.description !== "string" || p.description.length === 0) fail(`${where}.${name} 缺 description`);
    if (p.type === "string" && (typeof p.maxLength !== "number" || p.maxLength > 4096)) {
      fail(`${where}.${name}:string 必须给 maxLength(≤ 4096)`);
    }
    for (const k of Object.keys(p)) {
      if (!["type", "description", "minLength", "maxLength", "minimum", "maximum"].includes(k)) {
        fail(`${where}.${name}:不认识的 schema 关键字 ${k}(只认 type / description / minLength / maxLength / minimum / maximum)`);
      }
    }
  }
  for (const r of schema.required) if (!names.includes(r)) fail(`${where}.required 里的 ${r} 不是已声明字段`);
  return {
    type: "object",
    properties: Object.fromEntries(names.map((n) => [n, { ...schema.properties[n] }])),
    required: [...schema.required],
    additionalProperties: false,
  };
}

function readSkill(name) {
  if (!SKILL_NAME_RE.test(name)) fail(`目录名 ${name} 不匹配 ^[a-z0-9][a-z0-9-]{0,63}$`);
  const dir = join(SKILLS_DIR, name);
  const paths = walk(dir);
  if (paths.length === 0) fail(`${name}/ 是空目录`);
  if (paths.length > MAX_FILES) fail(`${name}/ 文件数 ${paths.length} 超过 ${MAX_FILES}`);
  if (!paths.includes("SKILL.md")) fail(`${name}/ 缺少 SKILL.md`);

  const files = [];
  const contents = new Map();
  for (const p of paths) {
    if (p.split("/").length > 4) fail(`${name}/${p}:路径超过 4 段`);
    for (const seg of p.split("/")) if (!SEGMENT_RE.test(seg)) fail(`${name}/${p}:路径段只接受 [A-Za-z0-9._-]`);
    const buf = readFileSync(join(dir, p));
    if (buf.length > MAX_FILE_BYTES) fail(`${name}/${p}:${buf.length} 字节,超过 ${MAX_FILE_BYTES}`);
    if (buf.includes(0)) fail(`${name}/${p}:含 NUL,不是文本文件`);
    // 【必须是 LF】哈希按字节算,而库内展示副本由所有者经 MCP 上传;一份 CRLF 的工作树副本会让
    // 「展示副本 == 代码副本」永远不成立,且 Windows 上 core.autocrlf 会悄悄制造这种差异。
    if (buf.includes(13)) fail(`${name}/${p}:含 CR(\\r),skill 文件必须是 LF 换行`);
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    } catch {
      fail(`${name}/${p}:不是合法 UTF-8`);
    }
    contents.set(p, text);
    files.push({ path: p, sha256: sha256(buf) });
  }

  const { fm, body } = frontmatter(contents.get("SKILL.md"), name);
  if (fm.name !== name) fail(`${name}/SKILL.md frontmatter 的 name(${fm.name})必须等于目录名`);
  if (!fm.description) fail(`${name}/SKILL.md frontmatter 缺 description(单行)`);
  if (fm.description.length > MAX_DESCRIPTION) fail(`${name}/SKILL.md description 超过 ${MAX_DESCRIPTION} 字符`);

  let network = "none";
  const scripts = [];
  if (contents.has("xray.json")) {
    let x;
    try {
      x = JSON.parse(contents.get("xray.json"));
    } catch (e) {
      fail(`${name}/xray.json 不是合法 JSON:${e.message}`);
    }
    if (x.network !== undefined) {
      if (!NETWORKS.has(x.network)) fail(`${name}/xray.json network 只接受 none / egress`);
      network = x.network;
    }
    if (!x.scripts || typeof x.scripts !== "object") fail(`${name}/xray.json 缺 scripts`);
    for (const [file, spec] of Object.entries(x.scripts)) {
      if (!SCRIPT_NAME_RE.test(file)) fail(`${name}/xray.json scripts.${file}:脚本名不合法`);
      const path = `scripts/${file}`;
      const entry = files.find((f) => f.path === path);
      if (!entry) fail(`${name}/xray.json 声明了 ${path},目录里没有这个文件`);
      if (typeof spec.description !== "string" || !spec.description) fail(`${name}/xray.json scripts.${file} 缺 description`);
      scripts.push({ file, sha256: entry.sha256, description: spec.description, input: checkSchema(name, file, spec.input) });
    }
    if (scripts.length === 0) fail(`${name}/xray.json 的 scripts 为空;不可运行的 skill 就别放 xray.json`);
    for (const f of files) {
      if (f.path.startsWith("scripts/") && f.path.endsWith(".py") && !scripts.some((s) => `scripts/${s.file}` === f.path)) {
        fail(`${name}/${f.path} 没在 xray.json 里声明:scripts/ 下的每个 .py 都必须有 description 与入参 schema,否则不许进镜像`);
      }
    }
  } else {
    for (const f of files) if (f.path.startsWith("scripts/")) fail(`${name}/ 有 scripts/ 却没有 xray.json`);
  }
  scripts.sort((a, b) => (a.file < b.file ? -1 : 1));
  return { name, description: fm.description, network, body, files, scripts };
}

function buildAll() {
  if (!existsSync(SKILLS_DIR)) fail(`找不到 ${SKILLS_DIR}`);
  const names = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort();
  if (names.length === 0) fail(`${SKILLS_DIR} 下没有任何 skill`);
  return names.map(readSkill);
}

function renderManifest(skills) {
  const out = { version: 1, skills: {} };
  for (const s of skills) {
    out.skills[s.name] = {
      network: s.network,
      files: Object.fromEntries(s.files.map((f) => [f.path, f.sha256])),
      scripts: Object.fromEntries(s.scripts.map((x) => [x.file, x.sha256])),
    };
  }
  return `${JSON.stringify(out, null, 2)}\n`;
}

function renderTs(skills) {
  const header = [
    "// 【生成物,勿手改】由 tools/skills-manifest/generate.mjs 从 runner/skills/ 生成(dev.ps1 skills-gen)。",
    "// 与 runner/manifest.json 同源:每个文件的 sha256 逐一相等,apps/api/agent/skills-manifest.test.ts 钉住。",
    "// 改 skill = 改 runner/skills/ 里的文件 → 重跑生成 → 发版(所有者裁定 6,rounds/round-skills/research.md §2.2)。",
    "// 库里(R-SKILLS 1.0 的 skills / skill_files)只能在这个集合之内打开 / 关闭,且展示副本必须与这里逐文件 hash 一致。",
    'import type { GeneratedSkill } from "./skill-manifest";',
    "",
    "export const AGENT_SKILLS: readonly GeneratedSkill[] = ",
  ].join("\n");
  const body = JSON.stringify(
    skills.map((s) => ({
      name: s.name,
      description: s.description,
      network: s.network,
      body: s.body,
      files: s.files,
      scripts: s.scripts,
    })),
    null,
    2,
  );
  return `${header}${body} as const;\n`;
}

const skills = buildAll();
const manifest = renderManifest(skills);
const ts = renderTs(skills);
const check = process.argv.includes("--check");
const current = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const drift = [MANIFEST_OUT, TS_OUT].filter((p, i) => current(p) !== [manifest, ts][i]);

if (check) {
  if (drift.length) {
    console.error(`skills-manifest: 生成物已漂移,重跑 dev.ps1 skills-gen:\n  ${drift.map((p) => relative(repoRoot, p)).join("\n  ")}`);
    process.exit(1);
  }
  console.log(`skills-manifest: ${skills.length} 个 skill,生成物一致`);
} else {
  writeFileSync(MANIFEST_OUT, manifest);
  writeFileSync(TS_OUT, ts);
  console.log(
    `skills-manifest: ${skills.length} 个 skill → ${relative(repoRoot, MANIFEST_OUT)} + ${relative(repoRoot, TS_OUT)}` +
      (drift.length ? "(已更新)" : "(无变化)"),
  );
  for (const s of skills) {
    console.log(`  ${s.name}  network=${s.network}  files=${s.files.length}  scripts=${s.scripts.map((x) => x.file).join(",") || "-"}`);
  }
}
