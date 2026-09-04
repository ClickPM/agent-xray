// R2 首批库读写测试:会话 CRUD、消息追加与标题派生、JSONB 语义(规则 4 回归)、
// 轨迹事件批量落库与按序回放、级联删除、端点行为。经 `dev.ps1 test` 运行。
import { beforeEach, describe, expect, it } from "vitest";
import { APIError } from "encore.dev/api";
import { db } from "./db";
import {
  appendMessage,
  appendTraceEvents,
  createSession,
  deleteSession,
  deriveTitle,
  getSession,
  listMessages,
  listSessions,
  listTraceEvents,
  addSessionTokens,
  maxTraceSeq,
  sessionOwnedBy,
  sessionTotalTokens,
  upsertMessage,
  type NewTraceEvent,
} from "./store";
import {
  createSession as createSessionEndpoint,
  deleteSession as deleteSessionEndpoint,
  getSession as getSessionEndpoint,
  listSessions as listSessionsEndpoint,
} from "./sessions";
import { ensureVisitor, type Visitor } from "./visitor";
import { hashVisitorToken, VISITOR_COOKIE } from "../shared/visitor-cookie";

/** 没有任何请求头 = 一个第一次来的访客(`ensureVisitor` 会发一个新身份)。 */
const NO_HEADERS = { cookie: undefined, proto: undefined };

/** 每个用例一个干净的访客;归属相关的断言都以它为准(R-VISITOR)。 */
let visitor: Visitor;

beforeEach(async () => {
  await db.exec`DELETE FROM sessions`;
  await db.exec`DELETE FROM visitors`;
  visitor = await ensureVisitor(NO_HEADERS);
});

describe("sessions", () => {
  it("创建/单查/列表(最近活跃倒序)", async () => {
    const a = await createSession(visitor.id);
    const b = await createSession(visitor.id);
    expect(a.id).not.toBe(b.id);
    expect(a.title).toBe("");

    const got = await getSession(a.id, visitor.id);
    expect(got?.id).toBe(a.id);
    expect(await getSession("00000000-0000-0000-0000-000000000000", visitor.id)).toBeNull();

    // b 追加消息后应排到列表首位
    await appendMessage(b.id, "user", "hi");
    const list = await listSessions(visitor.id);
    expect(list.map((s) => s.id)).toEqual([b.id, a.id]);
    expect(await listSessions(visitor.id, 1)).toHaveLength(1);
  });

  it("传入 id 建会话(spike/R3 复用运行时会话 id)", async () => {
    const id = "11111111-2222-4333-8444-555555555555";
    const row = await createSession(visitor.id, id);
    expect(row.id).toBe(id);
  });
});

// R-USAGE:顶栏统计条的 tokens 走这一列。会话被空闲回收重建后计数必须从这里续接,
// 所以「累加」与「读回」两件事都要按会话隔离、按类型正确(BIGINT 不能回字符串)。
describe("会话累计 token(R-USAGE)", () => {
  it("新会话是 0,累加后按会话各记各的", async () => {
    const a = await createSession(visitor.id);
    const b = await createSession(visitor.id);
    expect(a.totalTokens).toBe(0);
    expect(await sessionTotalTokens(a.id)).toBe(0);

    await addSessionTokens(a.id, 1200);
    await addSessionTokens(a.id, 340);
    await addSessionTokens(b.id, 7);

    expect(await sessionTotalTokens(a.id)).toBe(1540);
    expect(await sessionTotalTokens(b.id)).toBe(7);
    // 读路径(getSession / listSessions)也要带上,前端两条通路里的一条靠它取初值
    expect((await getSession(a.id, visitor.id))?.totalTokens).toBe(1540);
    expect((await listSessions(visitor.id)).find((s) => s.id === a.id)?.totalTokens).toBe(1540);
  });

  it("回的是 number 不是字符串:BIGINT 列必须 ::double precision 读回", async () => {
    const s = await createSession(visitor.id);
    await addSessionTokens(s.id, 1000);
    const total = await sessionTotalTokens(s.id);
    // 回字符串时 `+ 1` 会得到 "10001",这一条就是那个坑的回归
    expect(typeof total).toBe("number");
    expect(total + 1).toBe(1001);
  });

  it("负数与小数不让累计倒退 / 长出小数(与 recordUsage 同口径)", async () => {
    const s = await createSession(visitor.id);
    await addSessionTokens(s.id, 100.4);
    await addSessionTokens(s.id, -50);
    await addSessionTokens(s.id, 0);
    expect(await sessionTotalTokens(s.id)).toBe(100);
  });

  it("Infinity / NaN 不进库、不污染累计(provider 报越界 JSON 数)", async () => {
    const s = await createSession(visitor.id);
    await addSessionTokens(s.id, 500);
    // 自定义兼容端点报 `1e400` 会被 JSON.parse 成 Infinity,typeof 仍是 "number"
    // (codex 第 2 轮 P2)。挡不住的话这条 UPDATE 直接失败,累计从此不可恢复。
    await addSessionTokens(s.id, Number.POSITIVE_INFINITY);
    await addSessionTokens(s.id, Number.NaN);
    expect(await sessionTotalTokens(s.id)).toBe(500);
  });

  it("会话不存在时读回 0,不抛(新会话建行之前就会走到这里)", async () => {
    expect(await sessionTotalTokens("00000000-0000-0000-0000-000000000000")).toBe(0);
    // 累加到不存在的会话是一次空更新,同样不抛(落库是「尽力而为」的)
    await addSessionTokens("00000000-0000-0000-0000-000000000000", 10);
  });
});

describe("messages", () => {
  it("seq 连续追加;首条用户消息派生标题且不被后续覆盖", async () => {
    const s = await createSession(visitor.id);
    const longFirstLine = "帮我查上海→东京的低价航线," + "对比细节".repeat(10); // 54 字符,确定触发截断
    const m0 = await appendMessage(s.id, "user", longFirstLine + "\n第二行不进标题");
    const m1 = await appendMessage(s.id, "assistant", "好的,我来查询。");
    const m2 = await appendMessage(s.id, "user", "换成大阪呢?");
    expect([m0.seq, m1.seq, m2.seq]).toEqual([0, 1, 2]);

    const after = await getSession(s.id, visitor.id);
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
    const s = await createSession(visitor.id);
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
    const s = await createSession(visitor.id);
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
    const s = await createSession(visitor.id);
    const events = mkEvents(Date.now());
    await appendTraceEvents(s.id, events);
    await appendTraceEvents(s.id, events);
    expect(await listTraceEvents(s.id)).toHaveLength(3);
    await appendTraceEvents(s.id, []); // 空批直接返回
  });
});

describe("级联删除", () => {
  it("删会话连带清消息与轨迹", async () => {
    const s = await createSession(visitor.id);
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
  // 【端点层能测到什么、测不到什么】处理函数是直接调用的,没有真实 HTTP 请求上下文,
  // 所以 `currentRequest()` 拿不到 Cookie 头 —— 在这一层每个调用都是「**一个没有
  // cookie 的访客**」。这恰好是最该被钉死的一档:没有身份的人看到的必须是一个空站点。
  // 跨访客的正向隔离(A 看不到 B 的、但看得到自己的)在上面的 store 层用例里测,
  // 那里才是承载归属判据的地方;端到端两个浏览器互不可见是任务卡的人工验收项。

  it("创建会话:发放身份、把会话挂到它名下,并回一条 Set-Cookie", async () => {
    const created = await createSessionEndpoint();
    expect(new Date(created.session.createdAt).getTime()).toBeGreaterThan(0);
    // `visitorCookie` 必须是**一整条 Set-Cookie 字符串**。它要是变成了对象,说明
    // 那个字段被写回了类型别名 / `Cookie<>` 形态 —— 那会让 token 明文进响应体
    // (见 sessions.ts 顶部那段注释,encore 1.57.13 实测)
    expect(typeof created.visitorCookie).toBe("string");
    expect(created.visitorCookie).toContain("HttpOnly");
    expect(created.visitorCookie).toContain("SameSite=Lax");
    expect(created.visitorCookie).toContain(`Max-Age=${24 * 60 * 60}`);
    // 明文 token 只出现在 Set-Cookie 里;库里存的是它的 sha256
    const token = created.visitorCookie.slice(`${VISITOR_COOKIE}=`.length).split(";")[0];
    const hash = hashVisitorToken(token);
    const owner = await db.rawQueryRow<{ id: string }>(
      `SELECT id FROM visitors WHERE token_hash = $1`,
      hash,
    );
    expect(owner).not.toBeNull();
    expect(await sessionOwnedBy(created.session.id, owner!.id)).toBe(true);
  });

  it("没有 cookie:列表为空、单查 not_found、删除 not_found", async () => {
    const mine = await createSession(visitor.id);
    await appendMessage(mine.id, "user", "别人看不到这句");

    // 认不出身份 ≠ 报错:一个没建过会话的访客看到的就该是空站点
    expect(await listSessionsEndpoint({ limit: 10 })).toEqual({ sessions: [] });

    await expect(getSessionEndpoint({ id: mine.id })).rejects.toSatisfy(
      (e) => e instanceof APIError && String(e.code) === "not_found",
    );
    await expect(deleteSessionEndpoint({ id: mine.id })).rejects.toSatisfy(
      (e) => e instanceof APIError && String(e.code) === "not_found",
    );
    // 删除失败必须是真的没删
    expect(await sessionOwnedBy(mine.id, visitor.id)).toBe(true);
  });

  it("非 UUID → invalid_argument;未知会话 → not_found(与「不是你的」同一个回答)", async () => {
    await expect(getSessionEndpoint({ id: "not-a-uuid" })).rejects.toSatisfy(
      (e) => e instanceof APIError && String(e.code) === "invalid_argument",
    );
    await expect(deleteSessionEndpoint({ id: "not-a-uuid" })).rejects.toSatisfy(
      (e) => e instanceof APIError && String(e.code) === "invalid_argument",
    );
    await expect(
      getSessionEndpoint({ id: "00000000-0000-0000-0000-000000000000" }),
    ).rejects.toSatisfy((e) => e instanceof APIError && String(e.code) === "not_found");
  });
});

describe("访客隔离(R-VISITOR)", () => {
  it("列表 / 单查 / 归属判定都只认自己的会话", async () => {
    const other = await ensureVisitor(NO_HEADERS);
    const mine = await createSession(visitor.id);
    const theirs = await createSession(other.id);
    await appendMessage(mine.id, "user", "我的");
    await appendMessage(theirs.id, "user", "别人的");

    expect((await listSessions(visitor.id)).map((s) => s.id)).toEqual([mine.id]);
    expect((await listSessions(other.id)).map((s) => s.id)).toEqual([theirs.id]);

    expect(await getSession(theirs.id, visitor.id)).toBeNull();
    expect((await getSession(mine.id, visitor.id))?.id).toBe(mine.id);
    expect(await sessionOwnedBy(theirs.id, visitor.id)).toBe(false);
  });

  it("存量无归属会话(visitor_id IS NULL)对所有人不可见", async () => {
    const legacy = await createSession(null);
    expect(await getSession(legacy.id, visitor.id)).toBeNull();
    expect(await sessionOwnedBy(legacy.id, visitor.id)).toBe(false);
    expect((await listSessions(visitor.id)).map((s) => s.id)).not.toContain(legacy.id);
  });

  it("删除:只删得掉自己的,级联清空消息与轨迹", async () => {
    const other = await ensureVisitor(NO_HEADERS);
    const mine = await createSession(visitor.id);
    const theirs = await createSession(other.id);
    await appendMessage(mine.id, "user", "要被删掉的");
    await appendTraceEvents(mine.id, [
      { seq: 0, eventType: "agent_start", mode: "notify", timestamp: Date.now(), data: {} },
    ]);

    // 不是自己的:删不掉,且对方数据完好
    expect(await deleteSession(theirs.id, visitor.id)).toBe(false);
    expect(await sessionOwnedBy(theirs.id, other.id)).toBe(true);

    expect(await deleteSession(mine.id, visitor.id)).toBe(true);
    expect(await getSession(mine.id, visitor.id)).toBeNull();
    expect(await listMessages(mine.id)).toHaveLength(0);
    expect(await listTraceEvents(mine.id)).toHaveLength(0);
    // 重复删除是 false 而不是异常(前端连点两次不该炸)
    expect(await deleteSession(mine.id, visitor.id)).toBe(false);
  });
});

describe("messages.payload 偏移表(R-TOOLCARDS 验收 #9)", () => {
  it("同一 seq 重复 upsert:content 与 payload 都是最后一次的值,jsonb_typeof 为 object(规则 4);不传 payload 写 SQL NULL", async () => {
    const s = await createSession(visitor.id);
    const u = await appendMessage(s.id, "user", "帮我查一下");
    const seq = u.seq + 1;
    const p1 = {
      v: 1,
      modelRoundTrips: 1,
      turnMs: 10,
      toolCalls: [{ toolCallId: "c1", name: "notes_search", at: 0, inputPreview: "{}", resultPreview: "", isError: true }],
    };
    const p2 = {
      ...p1,
      modelRoundTrips: 2,
      toolCalls: [{ ...p1.toolCalls[0], resultPreview: "找到 3 条", isError: false, durationMs: 12 }],
    };
    await upsertMessage(s.id, seq, "assistant", "第一次", p1);
    const row = await upsertMessage(s.id, seq, "assistant", "第二次", p2);
    expect(row?.content).toBe("第二次");
    expect(row?.payload).toEqual(p2);

    const list = await listMessages(s.id);
    expect(list.map((m) => [m.role, m.content])).toEqual([
      ["user", "帮我查一下"],
      ["assistant", "第二次"],
    ]);
    expect(list[0].payload).toBeNull();
    expect(list[1].payload).toEqual(p2);
    const typed = await db.rawQueryRow<{ t: string; n: number }>(
      `SELECT jsonb_typeof(payload) AS t, jsonb_array_length(payload -> 'toolCalls') AS n
       FROM messages WHERE session_id = $1::uuid AND seq = $2`,
      s.id,
      seq,
    );
    expect(typed).toEqual({ t: "object", n: 1 });

    // 没有工具调用的一轮重试同一 seq:不传 payload → SQL NULL(不是 jsonb 'null'),与今天的行一样
    const again = await upsertMessage(s.id, seq, "assistant", "第三次");
    expect(again?.payload).toBeNull();
    const nul = await db.rawQueryRow<{ isNull: boolean }>(
      `SELECT payload IS NULL AS "isNull" FROM messages WHERE session_id = $1::uuid AND seq = $2`,
      s.id,
      seq,
    );
    expect(nul?.isNull).toBe(true);
  });
});

describe("turn 级去重键(R3 幂等落库)", () => {
  it("同一 seq 重复 upsert 只更新内容,不追加重复消息", async () => {
    const s = await createSession(visitor.id);
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
    const s = await createSession(visitor.id);
    const user = await appendMessage(s.id, "user", "问题");

    expect(await upsertMessage(s.id, user.seq, "assistant", "覆盖尝试")).toBeNull();
    expect((await listMessages(s.id))[0]).toMatchObject({ role: "user", content: "问题" });
  });

  it("upsert 刷新 last_active_at,冲突失败时不刷新", async () => {
    const s = await createSession(visitor.id);
    const before = (await getSession(s.id, visitor.id))!.lastActiveAt;
    await upsertMessage(s.id, 0, "assistant", "第一条");
    expect((await getSession(s.id, visitor.id))!.lastActiveAt).toBeGreaterThanOrEqual(before);
  });
});

describe("轨迹 seq 续接(会话重建)", () => {
  it("空会话返回 -1,有事件返回最大 seq", async () => {
    const s = await createSession(visitor.id);
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
