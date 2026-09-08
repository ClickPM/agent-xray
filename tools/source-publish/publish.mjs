#!/usr/bin/env node
// 源码快照发布脚本(R-SOURCE,所有者裁定 2026-09-08:快照随每次生产发版自动发,挂 dev.ps1 ship)。
//
//   node tools/source-publish/publish.mjs --sha <ref> --mcp <url> --token-env <ENV_NAME>   发布
//   node tools/source-publish/publish.mjs --sha <ref> --check                                只校验、不联网(dev.ps1 build 调)
//
// 【只从 git 树取文件,永不读工作树】`git ls-tree -r <sha>` 列路径、`git cat-file --batch` 取内容 ——
// `.secrets.local.cue` / `.env` / 未提交的文件在结构上进不来(docs/security.md §4 R-SOURCE 补记),
// 也不依赖当前 checkout 是哪个分支:ship 一个旧 sha 就发那个旧 sha 的快照。
//
// 【三段式,增量】begin 带整份 manifest(path / sha256 / bytes / lines),服务端把 current 里没变的文件直接复制,
// 只回「还缺哪些」;这里按 ≤ 512 KB / ≤ 200 个一批 put;最后 commit 单事务翻 current。同 sha 重跑 = 全部 reused、commit unchanged。
//
// 【协议】直连 /api/mcp 要带齐 2026-07-28 的逐请求契约(apps/api/mcp/README.md「三条容易改错的地方」第 3 条):
// Accept 同时含 json 与 event-stream、Mcp-Method / Mcp-Name 头、params._meta 三个带命名空间的键(缺了会静默落到 legacy 路径)。
// token 从 --token-env 指名的环境变量读,不进命令行、不进日志。
//
// 刻意放在 tools/(Encore app root 之外,CLAUDE.md 规则 6),只用 node 标准库;判据在 ./rules.mjs(与 api 侧同口径,测试钉住)。
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkPath,
  includePath,
  kindForPath,
  MAX_BATCH_BYTES,
  MAX_BATCH_FILES,
  MAX_FILE_BYTES,
  MAX_FILES,
} from "./rules.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

function fail(msg) {
  console.error(`source-publish: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check") out.check = true;
    else if (a === "--sha") out.sha = argv[++i];
    else if (a === "--mcp") out.mcp = argv[++i];
    else if (a === "--token-env") out.tokenEnv = argv[++i];
    else fail(`不认识的参数 ${a}`);
  }
  if (!out.sha) fail("缺 --sha <ref>");
  if (!out.check) {
    if (!out.mcp) fail("缺 --mcp <url>(或加 --check 只校验)");
    if (!out.tokenEnv) fail("缺 --token-env <ENV_NAME>");
  }
  return out;
}

/** 一律拿 Buffer 回来(不给 encoding):内容按字节算 sha256,再按 UTF-8 严格解码 */
function git(args, opts = {}) {
  return execFileSync("git", ["-C", repoRoot, ...args], { maxBuffer: 256 * 1024 * 1024, ...opts });
}

/** 行数口径与 api 侧 countLines 一致:`a\nb` 是 2 行,`a\nb\n` 也是 2 行,空文件 0 行 */
function countLines(text) {
  if (text === "") return 0;
  const n = text.split("\n").length;
  return text.endsWith("\n") ? n - 1 : n;
}

/** 收录集合:git 树里的路径 → 通过闭集筛选的文本文件(含内容与三个数) */
function collect(sha) {
  const listed = git(["ls-tree", "-r", "-z", "--name-only", sha]).toString("utf8").split("\0").filter(Boolean);
  const wanted = listed.filter(includePath).sort();
  if (wanted.length === 0) fail(`${sha} 的树里没有任何可收录的文件`);
  if (wanted.length > MAX_FILES) fail(`收录 ${wanted.length} 个文件,超过上限 ${MAX_FILES}`);

  // 一次 cat-file --batch 取全部内容:每条回 `<oid> blob <size>\n<内容>\n`
  const input = wanted.map((p) => `${sha}:${p}\n`).join("");
  const out = git(["cat-file", "--batch"], { input });
  const problems = [];
  const files = [];
  let pos = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (const path of wanted) {
    const nl = out.indexOf(0x0a, pos);
    if (nl < 0) fail(`cat-file 输出在 ${path} 处截断`);
    const header = out.subarray(pos, nl).toString("utf8");
    const m = /^([0-9a-f]{40}) blob (\d+)$/.exec(header);
    if (!m) fail(`cat-file 对 ${path} 回了 ${header}`);
    const size = Number(m[2]);
    const body = out.subarray(nl + 1, nl + 1 + size);
    pos = nl + 1 + size + 1; // 末尾换行
    const reason = checkPath(path);
    if (reason) { problems.push(reason); continue; }
    const kind = kindForPath(path);
    if (!kind) { problems.push(`${path}:派生不出文件种类 —— 加进 rules.mjs 的 KIND 表或排除项`); continue; }
    if (size > MAX_FILE_BYTES) { problems.push(`${path}:${size} 字节,超过单文件上限 ${MAX_FILE_BYTES}`); continue; }
    if (body.includes(0)) { problems.push(`${path}:含 NUL,不是文本文件 —— 加进 rules.mjs 的排除项`); continue; }
    let text;
    try {
      text = decoder.decode(body);
    } catch {
      problems.push(`${path}:不是合法 UTF-8`);
      continue;
    }
    files.push({ path, kind, content: text, sha256: createHash("sha256").update(body).digest("hex"), bytes: size, lines: countLines(text) });
  }
  if (problems.length > 0) fail(`${problems.length} 个文件不合规:\n  ${problems.join("\n  ")}`);
  return files;
}

function summary(sha, files) {
  const total = files.reduce((a, f) => a + f.bytes, 0);
  const largest = files.reduce((a, f) => (f.bytes > a.bytes ? f : a), files[0]);
  const deepest = files.reduce((a, f) => Math.max(a, f.path.split("/").length), 0);
  return `${sha.slice(0, 7)}:${files.length} 个文件 / ${total} 字节 / 最大 ${largest.path}(${largest.bytes})/ 最深 ${deepest} 层`;
}

// ───────────────────── MCP 客户端(2026-07-28 逐请求契约)─────────────────────

let rpcId = 0;
async function callTool(mcp, token, name, args) {
  const id = ++rpcId;
  const body = {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: {
      name,
      arguments: args,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {},
        "io.modelcontextprotocol/clientInfo": { name: "agent-xray-source-publish", version: "1" },
      },
    },
  };
  const res = await fetch(mcp, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": "tools/call",
      "Mcp-Name": name,
    },
    body: JSON.stringify(body),
    redirect: "manual",
  });
  if (res.status >= 300 && res.status < 400) fail(`${mcp} 回了 ${res.status} 重定向:生产要写规范主机名(www.)`);
  const text = await res.text();
  if (res.status === 401) fail(`认证失败(401):检查环境变量里的 token`);
  if (!res.ok) fail(`${name} HTTP ${res.status}:${text.slice(0, 300)}`);
  let msg;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("text/event-stream")) {
    // legacy 路径回 SSE 帧;正常情况下不会走到这里(带齐 _meta 就是 JSON),留着是为了把错报清楚
    const data = text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).filter(Boolean).pop();
    msg = data ? JSON.parse(data) : null;
  } else {
    msg = JSON.parse(text);
  }
  if (!msg) fail(`${name}:读不到响应`);
  if (msg.error) {
    if (msg.error.code === -32601 || /unknown tool|not found/i.test(String(msg.error.message))) {
      fail(`${name} 不存在(${msg.error.message}):对端 api 还是没有 source_* 工具的旧版 —— compose up 起新版之后再补发`);
    }
    fail(`${name} 失败:${msg.error.code} ${msg.error.message}`);
  }
  const result = msg.result ?? {};
  const first = result.content?.[0]?.text ?? "";
  if (result.isError) fail(`${name} 被拒:${first}`);
  try {
    return JSON.parse(first);
  } catch {
    return first;
  }
}

// ───────────────────── 主流程 ─────────────────────

const opts = parseArgs(process.argv.slice(2));
let sha;
try {
  sha = git(["rev-parse", "--verify", `${opts.sha}^{commit}`]).toString("utf8").trim();
} catch {
  fail(`解析不了 ${opts.sha}`);
}
const files = collect(sha);
console.log(`source-publish: ${summary(sha, files)}`);
if (opts.check) process.exit(0);

const token = process.env[opts.tokenEnv];
if (!token) fail(`环境变量 ${opts.tokenEnv} 为空`);

const manifest = files.map((f) => ({ path: f.path, sha256: f.sha256, bytes: f.bytes, lines: f.lines }));
const begun = await callTool(opts.mcp, token, "source_snapshot_begin", { sha, files: manifest });
if (begun.alreadyCurrent) {
  console.log(`source-publish: ${sha.slice(0, 7)} 已经是 current,无需重发`);
  process.exit(0);
}
console.log(`source-publish: begin → 复用 ${begun.reused} / 待上传 ${begun.missing.length}`);

const byPath = new Map(files.map((f) => [f.path, f]));
let batch = [];
let batchBytes = 0;
let uploaded = 0;
const flush = async () => {
  if (batch.length === 0) return;
  const r = await callTool(opts.mcp, token, "source_files_put", { sha, files: batch.map((f) => ({ path: f.path, content: f.content })) });
  uploaded += batch.length;
  console.log(`source-publish: put ${batch.length} 个(${batchBytes} 字节)→ 还缺 ${r.pending}`);
  batch = [];
  batchBytes = 0;
};
for (const path of begun.missing) {
  const f = byPath.get(path);
  if (!f) fail(`服务端要 ${path},本地清单里没有(manifest 与文件不同源?)`);
  if (batch.length >= MAX_BATCH_FILES || batchBytes + f.bytes > MAX_BATCH_BYTES) await flush();
  batch.push(f);
  batchBytes += f.bytes;
}
await flush();

const done = await callTool(opts.mcp, token, "source_snapshot_commit", { sha });
console.log(
  `source-publish: commit ${done.status} → ${sha.slice(0, 7)} ${done.fileCount} 个文件 / ${done.totalBytes} 字节` +
    `(复用 ${begun.reused},上传 ${uploaded}${done.replaced ? `,换下 ${String(done.replaced).slice(0, 7)}` : ""})`,
);
