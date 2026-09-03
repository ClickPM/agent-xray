// Skills 技能库的「一包文件」判据(R-SKILLS,所有者裁定 2026-09-03)。
//
// 写面(apps/api/mcp/ 的 `skills_upsert`)用它把一包 `{path, content}` 校验、归一并打成 zip;
// 读面(apps/api/skills/)只需要 kind 的闭集来给响应定型。两个面刻意不互相 import
// (docs/security.md §4「两个面互不触碰」),所以判据落在 shared/ —— 与 site-tabs.ts 同一个安排。
//
// 【安全口径,docs/security.md §4 R-SKILLS 补记】skill 是访客可见、可下载的内容面:
//   · **只收文本**:UTF-8、无 NUL、无孤立代理对;kind 由扩展名派生且是闭集,派生不出来就拒 ——
//     二进制、SVG、HTML 一律进不来(它们没有文本 kind)。
//   · **路径会进目录树与 zip 条目名**:相对、无 `..`、不以 `/` 开头、段字符集 [A-Za-z0-9._-]、段数 <= 4。
//     不收就是防路径穿越;zip 条目名就是校验过的 path,不可能带绝对路径。
//   · 上限:64 个文件、单文件 256 KB、整包 512 KB。详情页一次取回整包,上限就是为此设的。
//   · `SKILL.md` 必须在根目录,且 frontmatter 的 `name` 必须等于 skill 名 ——
//     `npx skills add … --skill <name>` 装进去之后,Claude Code / Codex 按 frontmatter 认名字。
//
// 【本文件不碰文件系统、不执行任何内容】输入是字符串,输出是字符串与 Uint8Array。
import { createHash } from "node:crypto";
import { strToU8, zipSync, type Zippable } from "fflate";

/** skill 名 = 目录名 = URL 段;与 notes 的 slug 同一口径(会进 URL 与命令行)。 */
export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * `owner/repo`。按 GitHub 的用户名(1–39 位,字母数字与连字符)与仓库名(字母数字 . _ -)收紧:
 * 它会原样拼进访客可复制的 `npx skills add <repo> --skill <name>`,不接受任意字符串。
 */
export const SKILL_REPO_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;

export const MAX_SKILL_FILES = 64;
export const MAX_SKILL_FILE_BYTES = 256 * 1024;
export const MAX_SKILL_PACK_BYTES = 512 * 1024;
/** 路径段数上限(`a/b/c/d.md` 是 4 段);目录树与 zip 条目都按它封顶 */
export const MAX_SKILL_PATH_SEGMENTS = 4;
export const MAX_SKILL_PATH_LENGTH = 200;

/**
 * 文件种类的闭集。前端据此选渲染方式:markdown 走 Markdown 组件,其余走带行号的代码视图。
 *
 * 写成显式的字面量联合而不是 `(typeof SKILL_FILE_KINDS)[number]`:这个类型会进
 * skills 服务的 API 响应形状,而 Encore 的静态解析器不认索引访问类型
 * (`encore check` 报 unsupported indexed access type operation,2026-09-03 实测)。
 */
export type SkillFileKind =
  | "markdown"
  | "python"
  | "shell"
  | "typescript"
  | "javascript"
  | "json"
  | "yaml"
  | "toml"
  | "text";

export const SKILL_FILE_KINDS: readonly SkillFileKind[] = [
  "markdown",
  "python",
  "shell",
  "typescript",
  "javascript",
  "json",
  "yaml",
  "toml",
  "text",
];

/**
 * 扩展名 → kind。**不在表里的扩展名一律拒**(不是回落成 text):
 * 闭集的意义就是「派生不出 kind 的东西不是我们接受的文本文件」。
 */
const KIND_BY_EXT: Record<string, SkillFileKind> = {
  md: "markdown",
  markdown: "markdown",
  py: "python",
  sh: "shell",
  bash: "shell",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  txt: "text",
  rst: "text",
  cfg: "text",
  ini: "text",
  csv: "text",
};

/**
 * 没有扩展名却常见于 skill 目录的文本文件。LICENSE 是最要紧的一个:
 * 第三方 skill 的许可文件**不强制**(所有者裁定),但带了就得收得进来。
 */
const TEXT_BASENAMES = new Set([
  "LICENSE",
  "LICENCE",
  "NOTICE",
  "COPYING",
  "README",
  "CHANGELOG",
  "CODEOWNERS",
  "Makefile",
  "Dockerfile",
  ".gitignore",
  ".gitattributes",
  ".editorconfig",
  ".env.example",
]);

/** 路径 → kind;派生不出来回 null(调用方据此拒绝)。 */
export function kindForPath(path: string): SkillFileKind | null {
  const base = path.split("/").pop() ?? "";
  if (TEXT_BASENAMES.has(base)) return "text";
  const dot = base.lastIndexOf(".");
  // `.gitignore` 这类以点开头、没有第二个点的名字,上面的表没收就不算有扩展名
  if (dot <= 0) return null;
  const ext = base.slice(dot + 1).toLowerCase();
  return KIND_BY_EXT[ext] ?? null;
}

const SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

/**
 * 路径规则。返回 null = 合法;否则是一句能行动的拒绝理由。
 * 单独导出是为了让测试逐条打:每一条规则都对应验收表里的一种非法输入。
 */
export function checkSkillPath(path: string): string | null {
  if (path === "") return "path 不能为空";
  if (path.length > MAX_SKILL_PATH_LENGTH) return `path 超过 ${MAX_SKILL_PATH_LENGTH} 字符`;
  if (path.startsWith("/")) return `path 必须是相对路径,不能以 / 开头:${path}`;
  if (path.includes("\\")) return `path 只接受 / 作分隔符:${path}`;
  const segments = path.split("/");
  if (segments.length > MAX_SKILL_PATH_SEGMENTS) {
    return `path 段数超过 ${MAX_SKILL_PATH_SEGMENTS}(至多三层目录):${path}`;
  }
  for (const seg of segments) {
    if (seg === "" ) return `path 含空段(连续的 / 或以 / 结尾):${path}`;
    if (seg === "." || seg === "..") return `path 不能含 . 或 .. 段:${path}`;
    if (!SEGMENT_RE.test(seg)) return `path 的每一段只接受 [A-Za-z0-9._-]:${path}`;
  }
  return null;
}

/** 有孤立的 UTF-16 代理对 = 不是合法 Unicode 文本,入库会变成 U+FFFD,与原文对不上 */
function hasLoneSurrogate(s: string): boolean {
  return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
}

/** 行数:`a\nb` 是 2 行,`a\nb\n` 也是 2 行(末尾换行不另起一行),空文件 0 行 */
export function countLines(content: string): number {
  if (content === "") return 0;
  const n = content.split("\n").length;
  return content.endsWith("\n") ? n - 1 : n;
}

/**
 * `SKILL.md` frontmatter 里的 `name`。只切 `---` 围起来的 `key: value` 行,不引 yaml 库
 * (与前端 lib/frontmatter.ts 同一套最小解析;两边都只认这一种形状)。
 * 没有 frontmatter、或里面没有 name → null。
 */
export function frontmatterName(md: string): string | null {
  const fm = splitFrontmatter(md);
  if (!fm) return null;
  for (const line of fm.split(/\r?\n/)) {
    const m = /^name\s*:\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    // `name: "x"` / `name: 'x'` 两种引号都剥掉
    return m[1].replace(/^(['"])(.*)\1$/, "$2");
  }
  return null;
}

/** 文档开头 `---` … `---` 之间的文本;不是这种形状回 null */
export function splitFrontmatter(md: string): string | null {
  const lines = md.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") return lines.slice(1, i).join("\n");
  }
  return null;
}

export class SkillPackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillPackError";
  }
}

export interface SkillFileInput {
  path: string;
  content: string;
}

export interface SkillFileEntry {
  path: string;
  kind: SkillFileKind;
  content: string;
  sizeBytes: number;
  lineCount: number;
  /** SKILL.md 恒为 0;其余按路径排序 */
  sortOrder: number;
}

export interface SkillPack {
  files: SkillFileEntry[];
  totalBytes: number;
}

/**
 * 校验并归一一包文件。任何一条不满足就抛 SkillPackError,**一个文件都不入库**
 * (调用方在事务里做,这里只负责判)。
 *
 * 排序:`SKILL.md` 恒在首位(画板 2g 的目录树第一行);其余按路径的码点序 ——
 * 目录树由前端从路径长出来,这里只保证顺序稳定、与发布顺序无关。
 */
export function validateSkillPack(skillName: string, files: SkillFileInput[]): SkillPack {
  if (!SKILL_NAME_RE.test(skillName)) throw new SkillPackError("name 需匹配 ^[a-z0-9][a-z0-9-]{0,63}$");
  if (files.length === 0) throw new SkillPackError("files 不能为空:至少要有 SKILL.md");
  if (files.length > MAX_SKILL_FILES) {
    throw new SkillPackError(`文件数 ${files.length} 超过上限 ${MAX_SKILL_FILES}`);
  }

  const seen = new Map<string, string>();
  const entries: SkillFileEntry[] = [];
  let totalBytes = 0;

  for (const f of files) {
    const reason = checkSkillPath(f.path);
    if (reason) throw new SkillPackError(reason);
    // 大小写不敏感地去重:zip 在 Windows / macOS 上解压时 `A.md` 与 `a.md` 会互相覆盖,
    // 「解压回读一致」这条验收就不成立
    const key = f.path.toLowerCase();
    const dup = seen.get(key);
    if (dup !== undefined) throw new SkillPackError(`路径重复(不区分大小写):${dup} 与 ${f.path}`);
    seen.set(key, f.path);

    const kind = kindForPath(f.path);
    if (!kind) {
      throw new SkillPackError(
        `${f.path}:派生不出文件种类(只收 ${SKILL_FILE_KINDS.join(" / ")};二进制、svg、html 不接受)`,
      );
    }
    if (f.content.includes("\u0000")) throw new SkillPackError(`${f.path}:含 NUL 字节,不是文本文件`);
    if (hasLoneSurrogate(f.content)) throw new SkillPackError(`${f.path}:不是合法的 UTF-8 文本`);

    const sizeBytes = Buffer.byteLength(f.content, "utf8");
    if (sizeBytes > MAX_SKILL_FILE_BYTES) {
      throw new SkillPackError(`${f.path}:${sizeBytes} 字节,超过单文件上限 ${MAX_SKILL_FILE_BYTES}`);
    }
    totalBytes += sizeBytes;
    if (totalBytes > MAX_SKILL_PACK_BYTES) {
      throw new SkillPackError(`整包超过 ${MAX_SKILL_PACK_BYTES} 字节上限`);
    }
    entries.push({ path: f.path, kind, content: f.content, sizeBytes, lineCount: countLines(f.content), sortOrder: 0 });
  }

  const skillMd = entries.find((e) => e.path === "SKILL.md");
  if (!skillMd) throw new SkillPackError("缺少根目录的 SKILL.md(必须恰好叫 SKILL.md)");
  const fmName = frontmatterName(skillMd.content);
  if (fmName === null) throw new SkillPackError("SKILL.md 缺少 frontmatter 的 name 字段");
  if (fmName !== skillName) {
    throw new SkillPackError(`SKILL.md frontmatter 的 name(${fmName})必须等于 skill 名(${skillName})`);
  }

  entries.sort((a, b) => {
    if (a.path === "SKILL.md") return -1;
    if (b.path === "SKILL.md") return 1;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
  entries.forEach((e, i) => (e.sortOrder = i));
  return { files: entries, totalBytes };
}

/** 字段分隔符:路径与正文里都不可能出现的字节 */
const SEP = "\u001f";
const REC = "\u001e";

/**
 * 整包内容哈希 —— 「这次 upsert 有没有真的改东西」的判据(与 notes 的 chapterHash 同一用途)。
 * 参与的是所有会影响页面呈现的字段:改一句 summary、换一个分类、动一个文件,都是真的更新。
 */
export function skillPackHash(meta: {
  categorySlug: string;
  summary: string;
  sourceType: string;
  repo: string;
  repoUrl: string | null;
  version: string | null;
  sortOrder: number;
}, files: readonly SkillFileEntry[]): string {
  const h = createHash("sha256");
  h.update(
    [
      meta.categorySlug,
      meta.summary,
      meta.sourceType,
      meta.repo,
      meta.repoUrl ?? "",
      meta.version ?? "",
      String(meta.sortOrder),
    ].join(SEP),
    "utf8",
  );
  for (const f of files) h.update(`${REC}${f.path}${SEP}${f.content}`, "utf8");
  return h.digest("hex");
}

/**
 * 打 zip。条目名 = `<skillName>/<path>`:解压出来就是一个可以直接放进 `.claude/skills/` 的目录,
 * 与 `npx skills add` 装出来的形状一致。
 *
 * mtime 钉死:fflate 默认取「现在」,同一份内容两次打包字节不同 —— 那会让 zip 的 ETag
 * 没法从内容哈希派生。这里的 ETag 是 content_hash,zip 字节只需要「内容相同则相同」。
 */
export function buildSkillZip(skillName: string, files: readonly SkillFileEntry[]): Uint8Array {
  const mtime = new Date(Date.UTC(2020, 0, 1));
  const tree: Zippable = {};
  for (const f of files) tree[`${skillName}/${f.path}`] = [strToU8(f.content), { mtime }];
  return zipSync(tree, { level: 6 });
}
