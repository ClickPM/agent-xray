// R2 首批库读写测试:会话 CRUD、消息追加与标题派生、JSONB 语义(规则 4 回归)、
// 轨迹事件批量落库与按序回放、级联删除、端点行为。经 `dev.ps1 test` 运行。
import { beforeEach, describe, expect, it } from "vitest";
import { APIError } from "encore.dev/api";
import { db } from "./db";
import {
  appendMessage,
  appendTraceEvents,
  createSession,
  deriveTitle,
  getSession,
  listMessages,
  listSessions,
  listTraceEvents,
  maxTraceSeq,
  upsertMessage,
  type NewTraceEvent,
} from "./store";
import {
  createSession as createSessionEndpoint,
  getSession as getSessionEndpoint,
  listSessions as listSessionsEndpoint,
} from "./sessions";

beforeEach(async () => {
  await db.exec`DELETE FROM sessions`;
});

describe("sessions", () => {
  it("创建/单查/列表(最近活跃倒序)", async () => {
    const a = await createSession();
    const b = await createSession();
    expect(a.id).not.toBe(b.id);
    expect(a.title).toBe("");

    const got = await getSession(a.id);
    expect(got?.id).toBe(a.id);
    expect(await getSession("00000000-0000-0000-0000-000000000000")).toBeNull();

    // b 追加消息后应排到列表首位
    await appendMessage(b.id, "user", "hi");
    const list = await listSessions();
    expect(list.map((s) => s.id)).toEqual([b.id, a.id]);
    expect(await listSessions(1)).toHaveLength(1);
  });

  it("传入 id 建会话(spike/R3 复用运行时会话 id)", async () => {
    const id = "11111111-2222-4333-8444-555555555555";
    const row = await createSession(id);
    expect(row.id).toBe(id);
  });
});

describe("messages", () => {
  it("seq 连续追加;首条用户消息派生标题且不被后续覆盖", async () => {
    const s = await createSession();
    const longFirstLine = "帮我查上海→东京的低价航线," + "对比细节".repeat(10); // 54 字符,确定触发截断
    const m0 = await appendMessage(s.id, "user", longFirstLine + "\n第二行不进标题");
    const m1 = await appendMessage(s.id, "assistant", "好的,我来查询。");
    const m2 = await appendMessage(s.id, "user", "换成大阪呢?");
    expect([m0.seq, m1.seq, m2.seq]).toEqual([0, 1, 2]);

    const after = await getSession(s.id);
    expect(after?.title).toBe(deriveTitle(longFirstLine));
    expect(after?.title).toHaveLength(41); // 40 字符 + 省略号
    expect(after?.title).not.toContain("第二行");
    expect(after?.title).not.toContain("大阪");
    expect(after!.lastActiveAt).toBeGreaterThanOrEqual(after!.createdAt);

    const history = await listMessages(s.id);
    expect(history.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(history[0].content).toContain("第二行");
  });

  it("payload JSONB 语义:jsonb_typeof 为 object 且 -> 可查(规则 4 回归)", async () => {
    const s = await createSession();
    await appendMessage(s.id, "tool", "", {
      tool: { name: "notes_search", preview: '{"q":"pi"}', error: false },
    });
    await appendMessage(s.id, "user", "无 payload");

    const typed = await db.queryRow<{ t: string; name: string }>`
      SELECT jsonb_typeof(payload) AS t, payload -> 'tool' ->> 'name' AS name
      FROM messages WHERE session_id = ${s.id}::uuid AND seq = 0
    `;
    expect(typed?.t).toBe("object"); // 若被二次编码会是 'string',SQL 侧 -> 全失效
    expect(typed?.name).toBe("notes_search");

    const noPayload = await db.queryRow<{ isNull: boolean }>`
      SELECT (payload IS NULL) AS "isNull"
      FROM messages WHERE session_id = ${s.id}::uuid AND seq = 1
    `;
    expect(noPayload?.isNull).toBe(true); // 缺省 payload 是 SQL NULL,不是 jsonb 'null'
  });
});

describe("trace_events", () => {
  const mkEvents = (base: number): NewTraceEvent[] => [
    { seq: 0, eventType: "agent_start", mode: "notify", timestamp: base, data: { type: "agent_start" } },
    {
      seq: 1,
      eventType: "context",
      mode: "chain",
      timestamp: base + 5,
      data: { type: "context", messageCount: 3, note: "中文数据往返" },
    },
    { seq: 2, eventType: "agent_end", mode: "notify", timestamp: base + 42, data: { type: "agent_end", messageCount: 4 } },
  ];

  it("批量落库、按 seq 回放、jsonb 类型与时间戳往返", async () => {
    const s = await createSession();
    const base = Date.now();
    await appendTraceEvents(s.id, mkEvents(base));

    const replay = await listTraceEvents(s.id);
    expect(replay.map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(replay.map((e) => e.mode)).toEqual(["notify", "chain", "notify"]);
    expect(replay[1].data).toEqual({ type: "context", messageCount: 3, note: "中文数据往返" });
    expect(Math.round(replay[2].timestamp)).toBe(base + 42);

    const typed = await db.queryRow<{ t: string }>`
      SELECT jsonb_typeof(data) AS t FROM trace_events
      WHERE session_id = ${s.id}::uuid AND seq = 1
    `;
    expect(typed?.t).toBe("object");

    // 增量续读(R4 断线重连口径)
    const tail = await listTraceEvents(s.id, 0);
    expect(tail.map((e) => e.seq)).toEqual([1, 2]);
  });

  it("重复 flush 幂等(ON CONFLICT DO NOTHING)", async () => {
    const s = await createSession();
    const events = mkEvents(Date.now());
    await appendTraceEvents(s.id, events);
    await appendTraceEvents(s.id, events);
    expect(await listTraceEvents(s.id)).toHaveLength(3);
    await appendTraceEvents(s.id, []); // 空批直接返回
  });
});

describe("级联删除", () => {
  it("删会话连带清消息与轨迹", async () => {
    const s = await createSession();
    await appendMessage(s.id, "user", "hello");
    await appendTraceEvents(s.id, [
      { seq: 0, eventType: "agent_start", mode: "notify", timestamp: Date.now(), data: { type: "agent_start" } },
    ]);
    await db.exec`DELETE FROM sessions WHERE id = ${s.id}::uuid`;
    expect(await listMessages(s.id)).toHaveLength(0);
    expect(await listTraceEvents(s.id)).toHaveLength(0);
  });
});

describe("端点", () => {
  it("创建 → 列表 → 单查(含历史消息)", async () => {
    const created = await createSessionEndpoint();
    expect(new Date(created.createdAt).getTime()).toBeGreaterThan(0);

    await appendMessage(created.id, "user", "端点回放测试");
    const got = await getSessionEndpoint({ id: created.id });
    expect(got.session.id).toBe(created.id);
    expect(got.session.title).toBe("端点回放测试");
    expect(got.messages).toEqual([
      expect.objectContaining({ seq: 0, role: "user", content: "端点回放测试" }),
    ]);

    const list = await listSessionsEndpoint({ limit: 10 });
    expect(list.sessions.map((s) => s.id)).toContain(created.id);
  });

  it("非 UUID → invalid_argument;未知会话 → not_found", async () => {
    await expect(getSessionEndpoint({ id: "not-a-uuid" })).rejects.toSatisfy(
      (e) => e instanceof APIError && String(e.code) === "invalid_argument",
    );
    await expect(
      getSessionEndpoint({ id: "00000000-0000-0000-0000-000000000000" }),
    ).rejects.toSatisfy((e) => e instanceof APIError && String(e.code) === "not_found");
  });
});

describe("turn 级去重键(R3 幂等落库)", () => {
  it("同一 seq 重复 upsert 只更新内容,不追加重复消息", async () => {
    const s = await createSession();
    const user = await appendMessage(s.id, "user", "问题");

    const first = await upsertMessage(s.id, user.seq + 1, "assistant", "回答");
    const retry = await upsertMessage(s.id, user.seq + 1, "assistant", "回答");

    expect(first?.seq).toBe(user.seq + 1);
    expect(retry?.seq).toBe(user.seq + 1);
    const msgs = await listMessages(s.id);
    expect(msgs.map((m) => [m.role, m.content])).toEqual([
      ["user", "问题"],
      ["assistant", "回答"],
    ]);
  });

  it("seq 被别的角色占用时不改写他人消息,返回 null", async () => {
    const s = await createSession();
    const user = await appendMessage(s.id, "user", "问题");

    expect(await upsertMessage(s.id, user.seq, "assistant", "覆盖尝试")).toBeNull();
    expect((await listMessages(s.id))[0]).toMatchObject({ role: "user", content: "问题" });
  });

  it("upsert 刷新 last_active_at,冲突失败时不刷新", async () => {
    const s = await createSession();
    const before = (await getSession(s.id))!.lastActiveAt;
    await upsertMessage(s.id, 0, "assistant", "第一条");
    expect((await getSession(s.id))!.lastActiveAt).toBeGreaterThanOrEqual(before);
  });
});

describe("轨迹 seq 续接(会话重建)", () => {
  it("空会话返回 -1,有事件返回最大 seq", async () => {
    const s = await createSession();
    expect(await maxTraceSeq(s.id)).toBe(-1);

    const events: NewTraceEvent[] = [3, 7, 5].map((seq) => ({
      seq,
      eventType: "agent_start",
      mode: "notify",
      timestamp: Date.now(),
      data: { type: "agent_start" },
    }));
    await appendTraceEvents(s.id, events);

    expect(await maxTraceSeq(s.id)).toBe(7);
  });
});
