// 源码快照的收录闭集与判据(R-SOURCE,所有者裁定 2026-09-08 第 2 / 3 条)。
//
// 【与 apps/api/shared/source-pack.ts 同一口径】发布脚本在 Encore app root 之外(CLAUDE.md 规则 6),不能 import 那个文件,
// 所以 kind 表、路径规则、上限在这里重复了一份;apps/api/shared/source-pack.test.ts 把两份钉成一致 —— 改一处要改两处,漏了测试会红。
//
// 【收录范围是闭集,改 = 发版】(所有者裁定 2)含 rounds/;不含 lockfile、design/(画板不是源码且单文件超 256 KB)、
// .claude/ .agents/(工具链镜像)、.mcp.json(本机客户端配置)、图片与字体。
// 派生不出 kind 的扩展名**报错退出**而不是静默跳过 —— 闭集就得是有意维护的:出现新扩展名时,要么加进表、要么加进排除项。

export const MAX_FILE_BYTES = 256 * 1024;
export const MAX_FILES = 2000;
export const MAX_BATCH_BYTES = 512 * 1024;
export const MAX_BATCH_FILES = 200;
export const MAX_PATH_SEGMENTS = 12;
export const MAX_PATH_LENGTH = 300;

/** 扩展名 → kind(与 source-pack.ts 的 SOURCE_KIND_BY_EXT 一字不差) */
export const KIND_BY_EXT = Object.freeze({
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

/** 无扩展名的常见文本文件(与 source-pack.ts 的 SOURCE_KIND_BY_BASENAME 一字不差) */
export const KIND_BY_BASENAME = Object.freeze({
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

export function kindForPath(path) {
  const base = path.split("/").pop() ?? "";
  const byName = KIND_BY_BASENAME[base];
  if (byName) return byName;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return null;
  return KIND_BY_EXT[base.slice(dot + 1).toLowerCase()] ?? null;
}

const SEGMENT_RE = /^[A-Za-z0-9._()[\]-]+$/;

/** 路径规则。返回 null = 合法;否则是一句能行动的拒绝理由(与 source-pack.ts 的 checkSourcePath 同一套) */
export function checkPath(path) {
  if (path === "") return "path 不能为空";
  if (path.length > MAX_PATH_LENGTH) return `path 超过 ${MAX_PATH_LENGTH} 字符`;
  if (path.startsWith("/")) return `path 必须是相对路径,不能以 / 开头:${path}`;
  if (path.includes("\\")) return `path 只接受 / 作分隔符:${path}`;
  const segments = path.split("/");
  if (segments.length > MAX_PATH_SEGMENTS) return `path 段数超过 ${MAX_PATH_SEGMENTS}:${path}`;
  for (const seg of segments) {
    if (seg === "") return `path 含空段(连续的 / 或以 / 结尾):${path}`;
    if (seg === "." || seg === "..") return `path 不能含 . 或 .. 段:${path}`;
    if (!SEGMENT_RE.test(seg)) return `path 的每一段只接受 [A-Za-z0-9._()[]-]:${path}`;
  }
  return null;
}

// ───────────────────── 收录闭集(所有者裁定 2)─────────────────────

/** 收这些顶层目录,加上仓库根下的文件 */
export const INCLUDE_ROOTS = Object.freeze(["apps", "deploy", "docs", "rounds", "runner", "tools"]);

/** 不收的目录(仓库根相对,前缀匹配) */
export const EXCLUDE_DIRS = Object.freeze(["design", ".claude", ".agents", ".github", ".codex"]);

/** 不收的文件名(任意位置精确匹配) */
export const EXCLUDE_BASENAMES = Object.freeze(["package-lock.json", ".mcp.json", "bun.lockb", "bun.lock", "yarn.lock", "pnpm-lock.yaml"]);

/** 不收的扩展名:二进制、图片、字体 —— 它们本来也派生不出 kind,列在这里是为了「跳过」而不是「报错」 */
export const EXCLUDE_EXTS = Object.freeze(["png", "jpg", "jpeg", "gif", "webp", "ico", "svg", "woff", "woff2", "ttf", "otf", "pdf", "zip", "tar", "gz"]);

/**
 * 逐个点名不收的文件(仓库根相对路径,精确匹配)。目前只有一类:**按扩展名是文本、内容却故意带 NUL 的测试夹具**
 * (服务端「只收文本、无 NUL」的判据对它不成立,而那正是它存在的意义)。列在这里 = 有意跳过;不列就是 --check 报错。
 */
export const EXCLUDE_PATHS = Object.freeze(["apps/api/notes/notes.test.ts"]);

/**
 * 一条 `git ls-tree` 里的路径要不要收。回 true / false;不判 kind(kind 派生失败在调用方是**报错**,不是跳过)。
 */
export function includePath(path) {
  if (EXCLUDE_PATHS.includes(path)) return false;
  const segs = path.split("/");
  const base = segs[segs.length - 1];
  if (EXCLUDE_BASENAMES.includes(base)) return false;
  const dot = base.lastIndexOf(".");
  if (dot > 0 && EXCLUDE_EXTS.includes(base.slice(dot + 1).toLowerCase())) return false;
  if (segs.length === 1) return true; // 仓库根下的文件(CLAUDE.md / dev.ps1 / LICENSE …)
  if (EXCLUDE_DIRS.some((d) => path === d || path.startsWith(`${d}/`))) return false;
  return INCLUDE_ROOTS.includes(segs[0]);
}
