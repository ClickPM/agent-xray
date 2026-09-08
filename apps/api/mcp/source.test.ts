// R-SOURCE 写面测试(mcp/source-store + 五个 source_* tool 的入参 schema):三段式发布的增量 / 幂等 / 原子性。
// 经 `dev.ps1 test` 运行(CLAUDE.md 规则 2)。
//
// 覆盖面按「错了会静默」排序:
//   - commit 的原子性 —— 错了「缺一个文件」会把半成品翻成 current,页面上有的文件 404
//   - 增量复用 —— 错了每次发版都全量上传(功能不坏,但 ship 慢一档);反过来错了(复制到不同哈希的内容)页面显示旧文件
//   - 同 sha 幂等 —— 错了 ship 重跑会把 current 打回 staging
//   - 只保留一份 —— 错了库里越攒越多
import { createHash } from "node:crypto";
import * as z from "zod";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MAX_SOURCE_BATCH_BYTES, MAX_SOURCE_FILE_BYTES } from "../shared/source-pack";
import { db } from "./db";
import * as src from "./source-store";
import { ConflictError, NotFoundError } from "./store";
import { registerTools } from "./tools";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);

interface F {
  path: string;
  content: string;
}
const entry = (f: F) => ({ path: f.path, sha256: sha(f.content), bytes: Buffer.byteLength(f.content, "utf8"), lines: f.content === "" ? 0 : f.content.split("\n").length - (f.content.endsWith("\n") ? 1 : 0) });

const PACK_A: F[] = [
  { path: "README.md", content: "# agent-xray\n\n正文。\n" },
  { path: "apps/api/agent/tools.ts", content: "export const x = 1;\n" },
  { path: "apps/web/app/(site)/notes/[series]/page.tsx", content: "export default function Page() {}\n" },
];

async function clear() {
  await db.exec`DELETE FROM source_files`;
  await db.exec`DELETE FROM source_snapshots`;
}
beforeEach(clear);
afterAll(clear);

/** 走完三段,发布一份 current */
async function publish(shaX: string, files: F[]) {
  const b = await src.beginSnapshot(shaX, files.map(entry));
  const missing = files.filter((f) => b.missing.includes(f.path));
  if (missing.length > 0) await src.putFiles(shaX, missing);
  return src.commitSnapshot(shaX);
}

async function current(): Promise<string | null> {
  const row = await db.rawQueryRow<{ sha: string }>(`SELECT sha FROM source_snapshots WHERE status = 'current'`);
  return row?.sha ?? null;
}

describe("三段式发布(mcp/source-store)", () => {
  it("首次:begin 全缺 → put → commit 翻 current,文件行完整", async () => {
    const b = await src.beginSnapshot(SHA_A, PACK_A.map(entry));
    expect(b.alreadyCurrent).toBe(false);
    expect(b.reused).toBe(0);
    expect(b.missing.sort()).toEqual(PACK_A.map((f) => f.path).sort());
    const p = await src.putFiles(SHA_A, PACK_A);
    expect(p.pending).toBe(0);
    const c = await src.commitSnapshot(SHA_A);
    expect(c.unchanged).toBe(false);
    expect(c.replaced).toBeNull();
    expect(c.fileCount).toBe(3);
    expect(await current()).toBe(SHA_A);
    const row = await db.rawQueryRow<{ content: string; kind: string }>(
      `SELECT content, kind FROM source_files WHERE sha = $1 AND path = $2`,
      SHA_A,
      "apps/web/app/(site)/notes/[series]/page.tsx",
    );
    expect(row?.kind).toBe("typescript");
    expect(row?.content).toBe(PACK_A[2].content);
  });

  it("commit 缺内容 → 拒并点名路径,current 不变(原子性)", async () => {
    await publish(SHA_A, PACK_A);
    const b = await src.beginSnapshot(SHA_B, [...PACK_A.map(entry), entry({ path: "docs/new.md", content: "new\n" })]);
    expect(b.missing).toEqual(["docs/new.md"]);
    await expect(src.commitSnapshot(SHA_B)).rejects.toThrow(/docs\/new\.md/);
    expect(await current()).toBe(SHA_A);
    // 补上再 commit 就成
    await src.putFiles(SHA_B, [{ path: "docs/new.md", content: "new\n" }]);
    const c = await src.commitSnapshot(SHA_B);
    expect(c.replaced).toBe(SHA_A);
    expect(await current()).toBe(SHA_B);
  });

  it("增量:只改一个文件,begin 只缺那一个;未变的文件从 current 复制;commit 后只剩一份", async () => {
    await publish(SHA_A, PACK_A);
    const packB: F[] = [PACK_A[0], { path: PACK_A[1].path, content: "export const x = 2;\n" }, PACK_A[2]];
    const b = await src.beginSnapshot(SHA_B, packB.map(entry));
    expect(b.reused).toBe(2);
    expect(b.missing).toEqual([PACK_A[1].path]);
    // 同名但哈希不同的文件**不能**被复制(内容还是 NULL)
    const pending = await db.rawQueryRow<{ n: number }>(`SELECT COUNT(*)::int AS n FROM source_files WHERE sha = $1 AND content IS NULL`, SHA_B);
    expect(pending?.n).toBe(1);
    await src.putFiles(SHA_B, [packB[1]]);
    await src.commitSnapshot(SHA_B);
    const rows = await db.rawQueryAll<{ sha: string }>(`SELECT sha FROM source_snapshots`);
    expect(rows.map((r) => r.sha)).toEqual([SHA_B]);
    const copied = await db.rawQueryRow<{ content: string }>(`SELECT content FROM source_files WHERE sha = $1 AND path = $2`, SHA_B, "README.md");
    expect(copied?.content).toBe(PACK_A[0].content);
    const changed = await db.rawQueryRow<{ content: string }>(`SELECT content FROM source_files WHERE sha = $1 AND path = $2`, SHA_B, PACK_A[1].path);
    expect(changed?.content).toBe("export const x = 2;\n");
  });

  it("同 sha 重发 = 幂等:begin 回 alreadyCurrent、commit 回 unchanged,published_at 不动", async () => {
    await publish(SHA_A, PACK_A);
    const before = await db.rawQueryRow<{ p: string }>(`SELECT published_at::text AS p FROM source_snapshots WHERE sha = $1`, SHA_A);
    const b = await src.beginSnapshot(SHA_A, PACK_A.map(entry));
    expect(b.alreadyCurrent).toBe(true);
    expect(b.missing).toEqual([]);
    const c = await src.commitSnapshot(SHA_A);
    expect(c.unchanged).toBe(true);
    const after = await db.rawQueryRow<{ p: string }>(`SELECT published_at::text AS p FROM source_snapshots WHERE sha = $1`, SHA_A);
    expect(after?.p).toBe(before?.p);
    expect(await current()).toBe(SHA_A);
  });

  it("同 sha 重 begin(staging)= 清掉上次的残留重来", async () => {
    await src.beginSnapshot(SHA_A, PACK_A.map(entry));
    await src.putFiles(SHA_A, [PACK_A[0]]);
    const b = await src.beginSnapshot(SHA_A, [entry(PACK_A[0])]);
    expect(b.missing).toEqual(["README.md"]);
    const n = await db.rawQueryRow<{ n: number }>(`SELECT COUNT(*)::int AS n FROM source_files WHERE sha = $1`, SHA_A);
    expect(n?.n).toBe(1);
  });

  it("manifest 的 bytes / lines 与内容不符也拒(codex 首轮 P2);commit 后 total_bytes 从实际文件行重算", async () => {
    // sha256 对、bytes 错
    const wrongBytes = PACK_A.map(entry).map((e) => (e.path === "README.md" ? { ...e, bytes: e.bytes + 1 } : e));
    await src.beginSnapshot(SHA_A, wrongBytes);
    await expect(src.putFiles(SHA_A, [PACK_A[0]])).rejects.toThrow(/字节数/);
    // sha256 对、lines 错
    const wrongLines = PACK_A.map(entry).map((e) => (e.path === "README.md" ? { ...e, lines: e.lines + 5 } : e));
    await src.beginSnapshot(SHA_A, wrongLines);
    await expect(src.putFiles(SHA_A, [PACK_A[0]])).rejects.toThrow(/行数/);
    // 正确的 manifest,但 begin 时声明的总量故意多报:commit 后 total_bytes 是实际行的和
    const good = PACK_A.map(entry);
    await src.beginSnapshot(SHA_A, good);
    await db.rawExec(`UPDATE source_snapshots SET total_bytes = 999999 WHERE sha = $1`, SHA_A);
    await src.putFiles(SHA_A, PACK_A);
    const c = await src.commitSnapshot(SHA_A);
    const real = good.reduce((a, e) => a + e.bytes, 0);
    expect(c.totalBytes).toBe(real);
    const row = await db.rawQueryRow<{ t: number }>(`SELECT total_bytes::int AS t FROM source_snapshots WHERE sha = $1`, SHA_A);
    expect(row?.t).toBe(real);
  });

  it("从 current 复用内容时,manifest 的 bytes / lines 也要与库内一致,否则 begin 整个拒(codex 第 2 轮 P2)", async () => {
    await publish(SHA_A, PACK_A);
    const good = PACK_A.map(entry);
    // sha256 对(会命中复用)、bytes 错
    await expect(src.beginSnapshot(SHA_B, good.map((e) => (e.path === "README.md" ? { ...e, bytes: e.bytes + 1 } : e)))).rejects.toThrow(/字节数 \/ 行数/);
    // sha256 对、lines 错
    await expect(src.beginSnapshot(SHA_B, good.map((e) => (e.path === "README.md" ? { ...e, lines: e.lines + 2 } : e)))).rejects.toThrow(/字节数 \/ 行数/);
    // 事务回滚:staging 没留下,current 不变
    const rows = await db.rawQueryAll<{ sha: string; status: string }>(`SELECT sha, status FROM source_snapshots ORDER BY sha`);
    expect(rows).toEqual([{ sha: SHA_A, status: "current" }]);
    // 正确的 manifest 照常复用
    const b = await src.beginSnapshot(SHA_B, good);
    expect(b.reused).toBe(3);
  });

  it("put 的拒绝:不在 manifest / sha256 不符 / 一批超量 / NUL / 快照不存在 / 已是 current", async () => {
    await src.beginSnapshot(SHA_A, PACK_A.map(entry));
    await expect(src.putFiles(SHA_A, [{ path: "not/in/manifest.md", content: "x" }])).rejects.toThrow(/不在 manifest/);
    await expect(src.putFiles(SHA_A, [{ path: "README.md", content: "different\n" }])).rejects.toThrow(/sha256/);
    await expect(src.putFiles(SHA_A, [{ path: "README.md", content: `x${String.fromCharCode(0)}` }])).rejects.toThrow(/NUL/);
    await expect(src.putFiles(SHA_A, [{ path: "README.md", content: "a".repeat(MAX_SOURCE_FILE_BYTES + 1) }])).rejects.toThrow(/单文件上限/);
    // 三个都在单文件上限之内(256K + 256K + 1),合起来正好越过一批 512 KB 的上限 —— 拒的必须是「一批超量」而不是单文件
    const big = "a".repeat(MAX_SOURCE_FILE_BYTES);
    await expect(
      src.putFiles(SHA_A, [
        { path: "README.md", content: big },
        { path: "apps/api/agent/tools.ts", content: big },
        { path: "apps/web/app/(site)/notes/[series]/page.tsx", content: "b" },
      ]),
    ).rejects.toThrow(new RegExp(String(MAX_SOURCE_BATCH_BYTES)));
    await expect(src.putFiles(SHA_C, [{ path: "README.md", content: "x" }])).rejects.toBeInstanceOf(NotFoundError);
    // 拒过之后 staging 还在、一个文件都没写进去(整批回滚)
    const pending = await db.rawQueryRow<{ n: number }>(`SELECT COUNT(*)::int AS n FROM source_files WHERE sha = $1 AND content IS NULL`, SHA_A);
    expect(pending?.n).toBe(3);
    await src.putFiles(SHA_A, PACK_A);
    await src.commitSnapshot(SHA_A);
    await expect(src.putFiles(SHA_A, [PACK_A[0]])).rejects.toThrow(/current/);
  });

  it("begin 的拒绝走 ConflictError(可读的一句话):坏路径 / 无 kind / 坏 sha256", async () => {
    await expect(src.beginSnapshot(SHA_A, [entry({ path: "../x.md", content: "x" })])).rejects.toBeInstanceOf(ConflictError);
    await expect(src.beginSnapshot(SHA_A, [entry({ path: "x.png", content: "x" })])).rejects.toThrow(/派生不出/);
    await expect(src.beginSnapshot(SHA_A, [{ path: "x.md", sha256: "nope", bytes: 1, lines: 1 }])).rejects.toThrow(/sha256/);
    expect(await current()).toBeNull();
  });

  it("commit 不存在的快照 → NotFoundError;文件行数与 manifest 不符 → 拒", async () => {
    await expect(src.commitSnapshot(SHA_C)).rejects.toBeInstanceOf(NotFoundError);
    await src.beginSnapshot(SHA_A, PACK_A.map(entry));
    await src.putFiles(SHA_A, PACK_A);
    await db.rawExec(`DELETE FROM source_files WHERE sha = $1 AND path = 'README.md'`, SHA_A);
    await expect(src.commitSnapshot(SHA_A)).rejects.toThrow(/不符/);
    expect(await current()).toBeNull();
  });

  it("list / delete:current 不能删,staging 能删", async () => {
    await publish(SHA_A, PACK_A);
    await src.beginSnapshot(SHA_B, PACK_A.map(entry));
    const list = await src.listSnapshots();
    expect(list.map((s) => [s.sha, s.status, s.pending])).toEqual([
      [SHA_A, "current", 0],
      [SHA_B, "staging", 0],
    ]);
    await expect(src.deleteSnapshot(SHA_A)).rejects.toThrow(/current/);
    await src.deleteSnapshot(SHA_B);
    await expect(src.deleteSnapshot(SHA_B)).rejects.toBeInstanceOf(NotFoundError);
    expect((await src.listSnapshots()).map((s) => s.sha)).toEqual([SHA_A]);
  });
});

describe("五个 source_* tool 的入参 schema", () => {
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

  it("五个都注册了,总数 51(规则 13:docs/mcp.md 记的数)", () => {
    for (const n of ["source_snapshot_begin", "source_files_put", "source_snapshot_commit", "source_snapshots_list", "source_snapshot_delete"]) {
      expect(registered.map((r) => r.name)).toContain(n);
    }
    expect(registered.length).toBe(51);
  });

  it("sha 必须是 40 位小写十六进制;manifest 条目的形状", () => {
    const begin = schemaOf("source_snapshot_begin");
    const ok = { sha: SHA_A, files: [{ path: "README.md", sha256: sha("x"), bytes: 1, lines: 1 }] };
    expect(begin.safeParse(ok).success).toBe(true);
    for (const bad of ["abc1234", SHA_A.toUpperCase(), "", `${SHA_A}a`]) {
      expect(begin.safeParse({ ...ok, sha: bad }).success, bad).toBe(false);
    }
    expect(begin.safeParse({ ...ok, files: [] }).success).toBe(false);
    expect(begin.safeParse({ ...ok, files: [{ ...ok.files[0], sha256: "zz" }] }).success).toBe(false);
    expect(begin.safeParse({ ...ok, files: [{ ...ok.files[0], bytes: MAX_SOURCE_FILE_BYTES + 1 }] }).success).toBe(false);
    const put = schemaOf("source_files_put");
    expect(put.safeParse({ sha: SHA_A, files: [{ path: "README.md", content: "x" }] }).success).toBe(true);
    expect(put.safeParse({ sha: SHA_A, files: [] }).success).toBe(false);
    expect(schemaOf("source_snapshot_commit").safeParse({ sha: SHA_A }).success).toBe(true);
    expect(schemaOf("source_snapshot_delete").safeParse({ sha: "x" }).success).toBe(false);
  });
});
