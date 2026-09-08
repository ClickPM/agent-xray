// Source 源码快照的「一批文件」判据(R-SOURCE,所有者裁定 2026-09-08)。
//
// 写面(apps/api/mcp/ 的 `source_*`)用它校验 manifest 与逐批上传的内容;
// 读面(apps/api/source/)只需要 kind 的闭集与路径规则来给响应定型与挡脏参数。
// 两个面刻意不互相 import(docs/security.md §4「两个面互不触碰」),所以判据落在 shared/ ——
// 与 skill-pack.ts / site-tabs.ts 是同一个安排。
//
// 【安全口径,docs/security.md §4 R-SOURCE 补记】源码是访客可见的内容面,与 skills 同一条线:
//   · **只收文本**:UTF-8、无 NUL、无孤立代理对;kind 由扩展名 / 文件名派生且是闭集,派生不出来就拒 ——
//     二进制、图片、字体一律进不来(它们没有文本 kind)。
//   · **路径会进目录树与 URL**:相对、无 `..`、不以 `/` 开头、无反斜杠、段字符集 [A-Za-z0-9._()[]-]
//     (Next 路由段要 `(site)` `[series]`)、段数 <= 12、长度 <= 300。
//   · 上限:一个快照 <= 2000 个文件、单文件 256 KB(所有者裁定 3)、一批上传 <= 512 KB(与 skills 整包同一档)。
//
// 【与 tools/source-publish/rules.mjs 同一口径】发布脚本在 Encore app root 之外(规则 6),不能 import 本文件,
// 所以 kind 表与路径规则在那里重复了一份;apps/api/shared/source-pack.test.ts 把两份钉成一致。
//
// 【本文件不碰文件系统、不执行任何内容】输入是字符串,输出是字符串与数字。
import { createHash } from "node:crypto";
import { countLines } from "./skill-pack";

export const SOURCE_SHA_RE = /^[0-9a-f]{40}$/;
export const SOURCE_SHA256_RE = /^[0-9a-f]{64}$/;

/** 单文件上限 256 KB(所有者裁定 3) */
export const MAX_SOURCE_FILE_BYTES = 256 * 1024;
/** 一批 `source_files_put` 的内容总量上限(与 skills 整包 512 KB 同一档) */
export const MAX_SOURCE_BATCH_BYTES = 512 * 1024;
/** 一个快照的文件数上限(当前收录集合约 300;留一个数量级的余量) */
export const MAX_SOURCE_FILES = 2000;
/** 一批 put 的文件数上限 */
export const MAX_SOURCE_BATCH_FILES = 200;
export const MAX_SOURCE_PATH_SEGMENTS = 12;
export const MAX_SOURCE_PATH_LENGTH = 300;

/**
 * 文件种类的闭集。前端据此选渲染方式:markdown 走 Markdown 组件,其余走带行号的代码视图
 * (高亮只对 python / typescript / javascript / shell 四种,其余等宽正文色 —— 与 lib/highlight.ts 同一口径)。
 *
 * 写成显式的字面量联合而不是 `(typeof SOURCE_FILE_KINDS)[number]`:这个类型会进
 * source 服务的 API 响应形状,而 Encore 的静态解析器不认索引访问类型(R-SKILLS 实测)。
 */
export type SourceFileKind =
  | "markdown"
  | "typescript"
  | "javascript"
  | "python"
  | "shell"
  | "powershell"
  | "sql"
  | "json"
  | "yaml"
  | "toml"
  | "css"
  | "dockerfile"
  | "text";

export const SOURCE_FILE_KINDS: readonly SourceFileKind[] = [
  "markdown",
  "typescript",
  "javascript",
  "python",
  "shell",
  "powershell",
  "sql",
  "json",
  "yaml",
  "toml",
  "css",
  "dockerfile",
  "text",
];

/**
 * 扩展名 → kind。**不在表里的扩展名一律拒**(不是回落成 text):
 * 闭集的意义就是「派生不出 kind 的东西不是我们接受的文本文件」。
 * 与 tools/source-publish/rules.mjs 的 KIND_BY_EXT 一字不差(测试钉住)。
 */
export const SOURCE_KIND_BY_EXT: Readonly<Record<string, SourceFileKind>> = Object.freeze({
  md: "markdown",
  markdown: "markdown",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  py: "python",
  sh: "shell",
  bash: "shell",
  ps1: "powershell",
  sql: "sql",
  json: "json",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  css: "css",
  txt: "text",
  rst: "text",
  cfg: "text",
  ini: "text",
  csv: "text",
  example: "text",
  app: "text",
});

/**
 * 没有扩展名却常见于仓库的文本文件(文件名精确匹配)。
 * 与 tools/source-publish/rules.mjs 的 KIND_BY_BASENAME 一字不差(测试钉住)。
 */
export const SOURCE_KIND_BY_BASENAME: Readonly<Record<string, SourceFileKind>> = Object.freeze({
  Dockerfile: "dockerfile",
  Caddyfile: "text",
  LICENSE: "text",
  LICENCE: "text",
  NOTICE: "text",
  COPYING: "text",
  README: "text",
  CHANGELOG: "text",
  CODEOWNERS: "text",
  Makefile: "text",
  ".gitignore": "text",
  ".gitattributes": "text",
  ".dockerignore": "text",
  ".editorconfig": "text",
  ".env.example": "text",
});

/** 路径 → kind;派生不出来回 null(调用方据此拒绝)。 */
export function sourceKindForPath(path: string): SourceFileKind | null {
  const base = path.split("/").pop() ?? "";
  const byName = SOURCE_KIND_BY_BASENAME[base];
  if (byName) return byName;
  const dot = base.lastIndexOf(".");
  // `.gitignore` 这类以点开头、没有第二个点的名字,上面的表没收就不算有扩展名
  if (dot <= 0) return null;
  const ext = base.slice(dot + 1).toLowerCase();
  return SOURCE_KIND_BY_EXT[ext] ?? null;
}

const SEGMENT_RE = /^[A-Za-z0-9._()[\]-]+$/;

/**
 * 路径规则。返回 null = 合法;否则是一句能行动的拒绝理由。
 * 单独导出是为了让测试逐条打:每一条规则都对应验收表里的一种非法输入。
 */
export function checkSourcePath(path: string): string | null {
  if (path === "") return "path 不能为空";
  if (path.length > MAX_SOURCE_PATH_LENGTH) return `path 超过 ${MAX_SOURCE_PATH_LENGTH} 字符`;
  if (path.startsWith("/")) return `path 必须是相对路径,不能以 / 开头:${path}`;
  if (path.includes("\\")) return `path 只接受 / 作分隔符:${path}`;
  const segments = path.split("/");
  if (segments.length > MAX_SOURCE_PATH_SEGMENTS) {
    return `path 段数超过 ${MAX_SOURCE_PATH_SEGMENTS}:${path}`;
  }
  for (const seg of segments) {
    if (seg === "") return `path 含空段(连续的 / 或以 / 结尾):${path}`;
    if (seg === "." || seg === "..") return `path 不能含 . 或 .. 段:${path}`;
    if (!SEGMENT_RE.test(seg)) return `path 的每一段只接受 [A-Za-z0-9._()[]-]:${path}`;
  }
  return null;
}

/** 有孤立的 UTF-16 代理对 = 不是合法 Unicode 文本,入库会变成 U+FFFD,与原文对不上 */
function hasLoneSurrogate(s: string): boolean {
  return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
}

/** UTF-8 字节的 sha256(十六进制)。与发布脚本对 `git show` 出来的字节算的是同一个值。 */
export function sourceSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export class SourcePackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourcePackError";
  }
}

export interface SourceManifestInput {
  path: string;
  sha256: string;
  bytes: number;
  lines: number;
}

export interface SourceManifestEntry extends SourceManifestInput {
  kind: SourceFileKind;
}

/**
 * 校验并归一一份 manifest(`source_snapshot_begin` 的入参)。任何一条不满足就抛 SourcePackError,
 * **一行都不入库**(调用方在事务里做,这里只负责判)。返回按路径码点序排好的条目。
 */
export function validateSourceManifest(files: SourceManifestInput[]): SourceManifestEntry[] {
  if (files.length === 0) throw new SourcePackError("files 不能为空");
  if (files.length > MAX_SOURCE_FILES) throw new SourcePackError(`文件数 ${files.length} 超过上限 ${MAX_SOURCE_FILES}`);
  const seen = new Map<string, string>();
  const out: SourceManifestEntry[] = [];
  for (const f of files) {
    const reason = checkSourcePath(f.path);
    if (reason) throw new SourcePackError(reason);
    // 大小写不敏感地去重:URL 与目录树在大小写不敏感的文件系统上会互相覆盖
    const key = f.path.toLowerCase();
    const dup = seen.get(key);
    if (dup !== undefined) throw new SourcePackError(`路径重复(不区分大小写):${dup} 与 ${f.path}`);
    seen.set(key, f.path);
    const kind = sourceKindForPath(f.path);
    if (!kind) {
      throw new SourcePackError(`${f.path}:派生不出文件种类(只收 ${SOURCE_FILE_KINDS.join(" / ")};二进制、图片、字体不接受)`);
    }
    if (!SOURCE_SHA256_RE.test(f.sha256)) throw new SourcePackError(`${f.path}:sha256 不是 64 位十六进制`);
    if (!Number.isInteger(f.bytes) || f.bytes < 0 || f.bytes > MAX_SOURCE_FILE_BYTES) {
      throw new SourcePackError(`${f.path}:bytes 必须在 0–${MAX_SOURCE_FILE_BYTES} 之间`);
    }
    if (!Number.isInteger(f.lines) || f.lines < 0) throw new SourcePackError(`${f.path}:lines 必须是非负整数`);
    out.push({ path: f.path, sha256: f.sha256, bytes: f.bytes, lines: f.lines, kind });
  }
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}

export interface SourceContentFacts {
  sha256: string;
  bytes: number;
  lines: number;
}

/**
 * 逐文件内容判据(`source_files_put` 的入参):文本性 + 上限,并算出与 manifest 比对用的三个数。
 * 不看 path 是否在 manifest 里 —— 那是库的事(store 在事务里查)。
 */
export function checkSourceContent(path: string, content: string): SourceContentFacts {
  if (content.includes("\u0000")) throw new SourcePackError(`${path}:含 NUL 字节,不是文本文件`);
  if (hasLoneSurrogate(content)) throw new SourcePackError(`${path}:不是合法的 UTF-8 文本`);
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_SOURCE_FILE_BYTES) {
    throw new SourcePackError(`${path}:${bytes} 字节,超过单文件上限 ${MAX_SOURCE_FILE_BYTES}`);
  }
  return { sha256: sourceSha256(content), bytes, lines: countLines(content) };
}

/** 页面与工具显示用的短 SHA(前 7 位) */
export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}
