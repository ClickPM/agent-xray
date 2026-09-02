// R-TITLE 会话命名工具的验收项本身(不是"覆盖率"):
//   ①「写面被 Postgres 限死在 sessions 的 title / title_source 两列」——`agent_title 角色` 段;
//   ②「一个会话只命名一次」——`只命名一次` 段;
//   ③「会话 id 不可由模型指定」——`工具行为` 段的闭包绑定用例;
//   ④ sanitize 口径 —— `sanitizeTitle` 段。
// 经 `dev.ps1 test`(encore test)运行,CLAUDE.md 规则 2。
import { beforeEach, describe, expect, it } from "vitest";
import type { Transaction } from "encore.dev/storage/sqldb";
import { db } from "./db";
import { createSession, sessionNeedsTitle } from "./store";
import { setSessionTitleAsAgent } from "./title-db";
import {
  buildSessionTools,
  sanitizeTitle,
  SESSION_RENAME_TOOL,
  SESSION_TOOL_REGISTRY,
  type EnabledTools,
} from "./tools";

// 每个用例一张干净的 sessions 表。与 store.test.ts 同一口径 —— vitest 配了
// `fileParallelism: false`,文件之间不会互相清表(apps/api/vitest.config.ts)。
beforeEach(async () => {
  await db.exec`DELETE FROM sessions`;
});

/** 直接以 agent_title 身份跑一条语句;不经 title-db.ts,为的是验角色本身的授权面。 */
async function asAgentTitle(fn: (tx: Transaction) => Promise<unknown>): Promise<void> {
  const tx = await db.begin();
  try {
    await tx.rawExec("SET LOCAL ROLE agent_title");
    await fn(tx);
    await tx.commit();
  } catch (err) {
    await tx.rollback().catch(() => undefined);
    throw err;
  }
}

const titleOf = async (id: string) =>
  db.rawQueryRow<{ title: string; titleSource: string }>(
    `SELECT title, title_source AS "titleSource" FROM sessions WHERE id = $1::uuid`,
    id,
  );

/** 只有 `session_rename` 被启用的最小启用集合(不碰库,避免与 sandbox.test 抢 tool_config)。 */
const RENAME_ONLY: EnabledTools = {
  names: [SESSION_RENAME_TOOL],
  definitions: [],
  sessionScoped: [SESSION_RENAME_TOOL],
  fingerprint: SESSION_RENAME_TOOL,
};

const callRename = async (sessionId: string, title: unknown) => {
  const [tool] = buildSessionTools(RENAME_ONLY, { sessionId, needsTitle: true }).definitions;
  const out = await tool.execute("t1", { title } as never, undefined, undefined, {} as never);
  return out.content.map((c) => ("text" in c ? c.text : "")).join("");
};

describe("sanitizeTitle", () => {
  it("取首行、去引号、去尾部标点(半角与全角都要去掉)", () => {
    expect(sanitizeTitle("  「Rust 智能指针答疑」  ")).toBe("Rust 智能指针答疑");
    expect(sanitizeTitle('"部署 130 预发"')).toBe("部署 130 预发");
    expect(sanitizeTitle("标题:排查 SSE 断流")).toBe("排查 SSE 断流");
    expect(sanitizeTitle("排查 SSE 断流。")).toBe("排查 SSE 断流");
    expect(sanitizeTitle("排查 SSE 断流!")).toBe("排查 SSE 断流");
    expect(sanitizeTitle("排查 SSE 断流?")).toBe("排查 SSE 断流");
    expect(sanitizeTitle("第一行\n第二行也别要")).toBe("第一行");
    // faux 探针实测过的形状:引号与句号互相挡住,单趟 replace 会剩一个 」
    expect(sanitizeTitle("「排查 SSE 断流」。")).toBe("排查 SSE 断流");
    expect(sanitizeTitle("“标题:部署 130 预发”。")).toBe("部署 130 预发");
  });

  it("控制字符压成空格,连续空白折叠", () => {
    expect(sanitizeTitle("会话\t命名\u0007工具")).toBe("会话 命名 工具");
  });

  it("超长按 40 字符截断并留省略号(与 deriveTitle 同一上界)", () => {
    const long = "长".repeat(80);
    expect(sanitizeTitle(long)).toHaveLength(41);
    expect(sanitizeTitle(long).endsWith("…")).toBe(true);
  });

  it("空白 / 纯标点 / 纯引号一律回空串,由调用方拒绝", () => {
    // 尾部标点那一小撮之外的形状也必须回空(codex 复审 P2):它们不在字符类里,
    // 靠「去完标点还剩什么」判不出来,判据是「有没有一个字母或数字」
    for (const raw of ["", "   ", "。。。", '""', "\n\n", "::", "——", "……", "()", "（）", "🎉🎉", "- -"]) {
      expect(sanitizeTitle(raw)).toBe("");
    }
  });
});

describe("agent_title 角色 · 写面由 Postgres 限死", () => {
  let sessionId: string;

  beforeEach(async () => {
    sessionId = (await createSession(null)).id;
  });

  it("能改 title / title_source —— 这是它存在的全部理由", async () => {
    await expect(
      asAgentTitle((tx) =>
        tx.rawExec(
          `UPDATE sessions SET title = 'ok', title_source = 'agent' WHERE id = $1::uuid`,
          sessionId,
        ),
      ),
    ).resolves.toBeUndefined();
    expect((await titleOf(sessionId))?.title).toBe("ok");
  });

  it("改 sessions 的别的列失败(列级授权,不是表级)", async () => {
    // last_active_at:能改就能让会话躲开 3 天保留期清理
    await expect(
      asAgentTitle((tx) =>
        tx.rawExec(`UPDATE sessions SET last_active_at = now() WHERE id = $1::uuid`, sessionId),
      ),
    ).rejects.toThrow(/permission denied/i);
    // visitor_id:能改就能把别人的会话过继给自己(R-VISITOR 的归属过滤全靠这一列)
    await expect(
      asAgentTitle((tx) =>
        tx.rawExec(`UPDATE sessions SET visitor_id = NULL WHERE id = $1::uuid`, sessionId),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("删会话 / 写消息 / 读配置表全部失败", async () => {
    await expect(
      asAgentTitle((tx) => tx.rawExec(`DELETE FROM sessions WHERE id = $1::uuid`, sessionId)),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asAgentTitle((tx) =>
        tx.rawExec(
          `INSERT INTO messages (session_id, seq, role, content) VALUES ($1::uuid, 0, 'user', 'x')`,
          sessionId,
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asAgentTitle((tx) => tx.rawQueryRow(`SELECT provider FROM llm_config LIMIT 1`)),
    ).rejects.toThrow(/permission denied/i);
    // notes 是 agent_ro 的授权面,与本角色无关 —— 两个角色不互相继承
    await expect(
      asAgentTitle((tx) => tx.rawQueryRow(`SELECT slug FROM notes_chapters LIMIT 1`)),
    ).rejects.toThrow(/permission denied/i);
  });

  it("读 sessions 只有三列可见,别的列连 SELECT 都不给", async () => {
    await expect(
      asAgentTitle((tx) => tx.rawQueryRow(`SELECT created_at FROM sessions LIMIT 1`)),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("只命名一次", () => {
  let sessionId: string;

  beforeEach(async () => {
    sessionId = (await createSession(null)).id;
  });

  it("第一次写进去,第二次不改(WHERE title_source = 'derived')", async () => {
    expect(await setSessionTitleAsAgent(sessionId, "第一个标题")).toBe(true);
    expect(await titleOf(sessionId)).toEqual({ title: "第一个标题", titleSource: "agent" });

    expect(await setSessionTitleAsAgent(sessionId, "第二个标题")).toBe(false);
    expect((await titleOf(sessionId))?.title).toBe("第一个标题");
  });

  it("会话不存在时回 false,不抛错(访客可能刚在另一个标签页删掉它)", async () => {
    expect(await setSessionTitleAsAgent("00000000-0000-4000-8000-000000000000", "x")).toBe(false);
  });

  it("sessionNeedsTitle:未建行的新会话要命名,已命名的不要", async () => {
    // 冷启动早于建行:`/agent/ask` 的 acquireSession 跑在 createDbSession 之前
    expect(await sessionNeedsTitle("00000000-0000-4000-8000-000000000001")).toBe(true);
    expect(await sessionNeedsTitle(sessionId)).toBe(true);
    await setSessionTitleAsAgent(sessionId, "已命名");
    expect(await sessionNeedsTitle(sessionId)).toBe(false);
  });

  it("已命名的会话根本不注册这个工具(第一道闸)", () => {
    expect(buildSessionTools(RENAME_ONLY, { sessionId, needsTitle: false })).toEqual({
      names: [],
      definitions: [],
    });
    const built = buildSessionTools(RENAME_ONLY, { sessionId, needsTitle: true });
    expect(built.names).toEqual([SESSION_RENAME_TOOL]);
    // 白名单与实现必须成对:名字对不上的那一半会静默失效
    expect(built.definitions.map((d) => d.name)).toEqual(built.names);
  });
});

describe("工具行为", () => {
  let a: string;
  let b: string;

  beforeEach(async () => {
    a = (await createSession(null)).id;
    b = (await createSession(null)).id;
  });

  it("入参只有 title,会话 id 是闭包绑定的 —— 改不到另一个会话", async () => {
    const def = SESSION_TOOL_REGISTRY[SESSION_RENAME_TOOL]({ sessionId: a, needsTitle: true });
    const schema = def.parameters as { properties: Record<string, unknown>; additionalProperties: boolean };
    expect(Object.keys(schema.properties)).toEqual(["title"]);
    expect(schema.additionalProperties).toBe(false);

    // 即便模型硬塞一个 sessionId 字段(pi 的校验器会先拦下,这里模拟拦不住的情形),
    // 实现也只会去改闭包里的那个会话
    await def.execute("t1", { title: "只改 A", sessionId: b } as never, undefined, undefined, {} as never);
    expect((await titleOf(a))?.title).toBe("只改 A");
    expect((await titleOf(b))?.title).toBe("");
  });

  it("成功与「已设置过」都是正常结果,不走错误路径", async () => {
    expect(await callRename(a, "排查 SSE 断流")).toContain("排查 SSE 断流");
    expect(await callRename(a, "再来一个")).toContain("已经设置过");
    expect((await titleOf(a))?.title).toBe("排查 SSE 断流");
  });

  it("空标题抛出(pi 据此置 isError),文案本身就是改正方法", async () => {
    await expect(callRename(a, "。。。")).rejects.toThrow(/请给出一个/);
    await expect(callRename(a, 42)).rejects.toThrow(/请给出一个/);
    // 抛出的是给模型看的固定文案,不含任何内部细节
    await expect(callRename(a, "")).rejects.not.toThrow(/sessions|postgres|update/i);
  });

  it("落库的是 sanitize 之后的标题,不是模型原样给的那串", async () => {
    await callRename(a, '  "带引号的标题。"  ');
    expect((await titleOf(a))?.title).toBe("带引号的标题");
  });
});
