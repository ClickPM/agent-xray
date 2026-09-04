// 会话/消息/轨迹事件的落库读写路径(R2)。R3 正式 /agent/ask 与 R4 轨迹回放
// 都走这里;时间戳统一以 epoch 毫秒进出,端点层再转 ISO 字符串。
// JSONB 写入一律 `${JSON.stringify(x)}::text::jsonb`(CLAUDE.md 规则 4)。
import { db } from "./db";

export type MessageRole = "user" | "assistant" | "tool";

export interface SessionRow {
  id: string;
  title: string;
  /** epoch ms */
  createdAt: number;
  /** epoch ms */
  lastActiveAt: number;
  /**
   * 会话历史累计 token(R-USAGE)。来源是 provider 报的 `Usage.totalTokens`(含 input /
   * output / cache),与 `daily_quota` 同源、聚合维度不同。**刻意不用 pi 的
   * `getSessionStats()`**:那是当前运行时实例的累计,会话被空闲回收重建后归零。
   */
  totalTokens: number;
}

export interface MessageRow {
  seq: number;
  role: MessageRole;
  content: string;
  /**
   * 结构化附加信息(JSONB,普通文本消息为 null)。R-TOOLCARDS 起助手行在有工具调用时写
   * `turn-recorder.ts` 的 TurnPayload(偏移表);端点层只经 `turnFromPayload` 白名单投影,不透传。
   */
  payload: unknown;
  /** epoch ms */
  createdAt: number;
}

export interface NewTraceEvent {
  seq: number;
  eventType: string;
  mode: string;
  /** epoch ms */
  timestamp: number;
  data: unknown;
}

export interface TraceEventRow {
  seq: number;
  eventType: string;
  mode: string;
  /** epoch ms */
  timestamp: number;
  data: unknown;
}

// `total_tokens` 是 BIGINT,与 quota.ts 同一套写法用 `::double precision` 读回:
// 驱动对 int8 的回传形态在不同运行时下不一致(字符串 / BigInt),而这个计数远在
// 2^53 以内。回字符串时 `totalTokens: number` 会是谎言,前端一做加法就出 "0100"。
const SESSION_COLS = `id, title,
  (extract(epoch FROM created_at) * 1000)::double precision AS "createdAt",
  (extract(epoch FROM last_active_at) * 1000)::double precision AS "lastActiveAt",
  total_tokens::double precision AS "totalTokens"`;

/**
 * 建会话。传 id 时用调用方的(spike/R3 复用运行时会话 id),否则库内生成。
 *
 * `visitorId` 是归属(R-VISITOR):**建会话是唯一会写它的地方**,此后不再变更。
 * 传 null 只在测试里出现 —— 生产路径上会话必然由某个访客创建。
 */
export async function createSession(visitorId: string | null, id?: string): Promise<SessionRow> {
  const row = await db.rawQueryRow<SessionRow>(
    `INSERT INTO sessions (id, visitor_id)
     VALUES (COALESCE($1::uuid, gen_random_uuid()), $2::uuid)
     RETURNING ${SESSION_COLS}`,
    id ?? null,
    visitorId,
  );
  return row!;
}

/**
 * 单查,**按归属过滤**(R-VISITOR)。
 *
 * 【为什么归属不匹配也是「查不到」而不是「无权」】403 等于确认「这个 id 是存在的」,
 * 把会话 id 变成一个可探测的存在性预言机。调用方分不出「不存在」与「不是你的」,
 * 这是刻意的(docs/security.md §6)。
 *
 * 【`= $2` 天然排除存量无归属会话】本轮之前建的会话 `visitor_id` 是 NULL,
 * 而 `NULL = 任何值` 不成立 —— 它们对所有人不可见,不需要额外分支。
 */
export async function getSession(id: string, visitorId: string): Promise<SessionRow | null> {
  return db.rawQueryRow<SessionRow>(
    `SELECT ${SESSION_COLS} FROM sessions WHERE id = $1::uuid AND visitor_id = $2::uuid`,
    id,
    visitorId,
  );
}

/** 归属校验(续接对话 / 轨迹流用)。语义与 getSession 一致,只是不取列。 */
export async function sessionOwnedBy(id: string, visitorId: string): Promise<boolean> {
  const row = await db.rawQueryRow<{ ok: number }>(
    `SELECT 1 AS ok FROM sessions WHERE id = $1::uuid AND visitor_id = $2::uuid`,
    id,
    visitorId,
  );
  return row !== null;
}

/** 会话列表:只有本访客的,按最近活跃倒序(走 idx_sessions_visitor_active)。 */
export async function listSessions(visitorId: string, limit = 50): Promise<SessionRow[]> {
  return db.rawQueryAll<SessionRow>(
    `SELECT ${SESSION_COLS} FROM sessions
     WHERE visitor_id = $1::uuid
     ORDER BY last_active_at DESC, id
     LIMIT $2`,
    visitorId,
    limit,
  );
}

/**
 * 删除本访客的一个会话(R-VISITOR,所有者裁定新增;设计稿没有这个入口)。
 *
 * 硬删:`messages` / `trace_events` 由外键 ON DELETE CASCADE 一并清掉。不做软删——
 * 这是一条隐私功能,「删了但还在库里」不满足访客按下那个按钮时的预期。
 *
 * 返回是否真的删掉了一行:false 覆盖「不存在」与「不是你的」两种情况,调用方一律回 404。
 */
export async function deleteSession(id: string, visitorId: string): Promise<boolean> {
  const row = await db.rawQueryRow<{ id: string }>(
    `DELETE FROM sessions WHERE id = $1::uuid AND visitor_id = $2::uuid RETURNING id`,
    id,
    visitorId,
  );
  return row !== null;
}

/**
 * 这个会话还需要 agent 命名吗?(R-TITLE)
 *
 * 「只命名一次」的第一道闸:已命名的会话在冷启动时**根本不注册** `session_rename`
 * (第二道闸是 `title-db.ts` 里的 `WHERE title_source = 'derived'`)。
 *
 * 【查不到行 = 需要命名】不是容错,是正常路径:`/agent/ask` 新建会话时,
 * `acquireSession()`(会话冷启动、要在这里决定注册哪些工具)跑在 `createDbSession()`
 * **之前** —— 那一刻这行还不存在,而它恰恰是最需要被命名的那个会话。
 *
 * 这里刻意**不**按归属过滤:调用方(runtime 冷启动)拿到的 id 已经过 `ask.ts` 的归属校验,
 * 而这个函数只回答一个布尔值、不返回任何会话内容,不构成越权读取面。
 */
export async function sessionNeedsTitle(id: string): Promise<boolean> {
  const row = await db.rawQueryRow<{ titleSource: string }>(
    `SELECT title_source AS "titleSource" FROM sessions WHERE id = $1::uuid`,
    id,
  );
  return row === null || row.titleSource === "derived";
}

/** 首条用户消息 → 会话标题:取首行、截 40 字符。 */
export function deriveTitle(content: string): string {
  const firstLine = content.trim().split("\n", 1)[0].trim();
  return firstLine.length > 40 ? firstLine.slice(0, 40) + "…" : firstLine;
}

/**
 * 追加一条消息:seq 取会话内 MAX(seq)+1(会话内消息串行追加,R3 对同会话并发
 * prompt 返回 409;万一并发,UNIQUE(session_id, seq) 保证只会失败不会乱序)。
 * 同时刷新 last_active_at;首条用户消息派生会话标题。
 */
export async function appendMessage(
  sessionId: string,
  role: MessageRole,
  content: string,
  payload?: unknown,
): Promise<MessageRow> {
  const payloadJson = payload === undefined ? null : JSON.stringify(payload);
  const row = await db.rawQueryRow<MessageRow>(
    `INSERT INTO messages (session_id, seq, role, content, payload)
     SELECT $1::uuid, COALESCE(MAX(seq) + 1, 0), $2, $3, $4::text::jsonb
     FROM messages WHERE session_id = $1::uuid
     RETURNING seq, role, content, payload,
       (extract(epoch FROM created_at) * 1000)::double precision AS "createdAt"`,
    sessionId,
    role,
    content,
    payloadJson,
  );
  const title = role === "user" ? deriveTitle(content) : "";
  await db.exec`
    UPDATE sessions
    SET last_active_at = now(),
        title = CASE WHEN title = '' AND ${title} <> '' THEN ${title} ELSE title END
    WHERE id = ${sessionId}::uuid
  `;
  return row!;
}

export async function listMessages(sessionId: string): Promise<MessageRow[]> {
  return db.rawQueryAll<MessageRow>(
    `SELECT seq, role, content, payload,
       (extract(epoch FROM created_at) * 1000)::double precision AS "createdAt"
     FROM messages WHERE session_id = $1::uuid
     ORDER BY seq`,
    sessionId,
  );
}

/**
 * 轨迹事件批量落库:整批一条 SQL(逐事件 INSERT 太碎)。整批先
 * `${JSON.stringify(events)}::text::jsonb`(规则 4),再 jsonb_array_elements
 * 展开——`e->'data'` 全程保持 jsonb 类型,不经历二次编码。
 * ON CONFLICT DO NOTHING:重复 flush 幂等(seq 采集侧已保证会话内唯一递增)。
 */
export async function appendTraceEvents(sessionId: string, events: NewTraceEvent[]): Promise<void> {
  if (events.length === 0) return;
  await db.exec`
    INSERT INTO trace_events (session_id, seq, event_type, mode, ts, data)
    SELECT ${sessionId}::uuid,
           (e ->> 'seq')::int,
           e ->> 'eventType',
           e ->> 'mode',
           to_timestamp(((e ->> 'timestamp')::double precision) / 1000.0),
           COALESCE(e -> 'data', '{}'::jsonb)
    FROM jsonb_array_elements(${JSON.stringify(events)}::text::jsonb) AS e
    ON CONFLICT (session_id, seq) DO NOTHING
  `;
}

/** 按 seq 有序回放;afterSeq 供增量续读(R4 SSE 断线重连)。 */
export async function listTraceEvents(sessionId: string, afterSeq = -1): Promise<TraceEventRow[]> {
  return db.rawQueryAll<TraceEventRow>(
    `SELECT seq, event_type AS "eventType", mode,
       (extract(epoch FROM ts) * 1000)::double precision AS "timestamp",
       data
     FROM trace_events
     WHERE session_id = $1::uuid AND seq > $2
     ORDER BY seq`,
    sessionId,
    afterSeq,
  );
}

/**
 * 按显式 seq 幂等写消息(R3 正式 `/agent/ask` 的「turn 级去重键」)。
 * 去重键复用既有 UNIQUE(session_id, seq):同一 turn 的助手回复 seq 在用户消息
 * 落库时就确定(userSeq + 1),重试写同一 seq 只会更新内容而非追加新行——
 * 覆盖「提交成功但连接断开后重试」这类不确定路径(rounds/BACKLOG.md R2 遗留)。
 * `WHERE messages.role = EXCLUDED.role` 是防串写护栏:seq 被别的角色占用时
 * 不更新、不返回行,由调用方按异常处理,绝不静默改写他人消息。
 */
export async function upsertMessage(
  sessionId: string,
  seq: number,
  role: MessageRole,
  content: string,
  payload?: unknown,
): Promise<MessageRow | null> {
  const payloadJson = payload === undefined ? null : JSON.stringify(payload);
  const row = await db.rawQueryRow<MessageRow>(
    `INSERT INTO messages (session_id, seq, role, content, payload)
     VALUES ($1::uuid, $2, $3, $4, $5::text::jsonb)
     ON CONFLICT (session_id, seq) DO UPDATE
       SET content = EXCLUDED.content, payload = EXCLUDED.payload
       WHERE messages.role = EXCLUDED.role
     RETURNING seq, role, content, payload,
       (extract(epoch FROM created_at) * 1000)::double precision AS "createdAt"`,
    sessionId,
    seq,
    role,
    content,
    payloadJson,
  );
  if (row) {
    await db.exec`UPDATE sessions SET last_active_at = now() WHERE id = ${sessionId}::uuid`;
  }
  return row ?? null;
}

/**
 * 会话内已落库轨迹事件的最大 seq(无事件返回 -1)。
 * 运行时会话被空闲回收/进程重启后重建时,采集游标必须从这里续接——
 * 否则新事件的 seq 会与库内既有行撞上,被 `ON CONFLICT DO NOTHING` 静默丢弃。
 */
export async function maxTraceSeq(sessionId: string): Promise<number> {
  const row = await db.rawQueryRow<{ maxSeq: number | null }>(
    `SELECT MAX(seq) AS "maxSeq" FROM trace_events WHERE session_id = $1::uuid`,
    sessionId,
  );
  return row?.maxSeq ?? -1;
}

/**
 * 会话历史累计 token(R-USAGE)。运行时会话重建时读回初值 —— 与 `maxTraceSeq` 同一个
 * 理由:pi 实例内的计数随实例生灭,库里这一列才是会话尺度的事实。
 *
 * 归属**不在这里过滤**:调用方是运行时(`createRuntimeSession`),那条路径上会话归属
 * 已经在 `/agent/ask` 入口验过;这里再要一次 visitorId 只会把参数往运行时层里穿。
 * 会话不存在时回 0(新会话建行之前就会走到这里)。
 */
export async function sessionTotalTokens(sessionId: string): Promise<number> {
  const row = await db.rawQueryRow<{ totalTokens: number }>(
    `SELECT total_tokens::double precision AS "totalTokens" FROM sessions WHERE id = $1::uuid`,
    sessionId,
  );
  return row?.totalTokens ?? 0;
}

/**
 * 本轮 token 累加进会话(R-USAGE)。与 `recordUsage` 并列在 `/agent/ask` 的 `finally` 里,
 * 同一套「尽力而为的资源闸,不是账单」口径:失败只记日志,不把已完成的一轮报成失败。
 *
 * 负数、非整数与**非有限数**在这里挡掉(与 `recordUsage` 一致):provider 报什么记什么,
 * 但报回一个负数不该让累计倒退,而 `Infinity` / `NaN`(自定义兼容端点报越界 JSON 数时会出现,
 * codex 第 2 轮 P2)会让这条 UPDATE 直接失败。调用方已经拦过一道,这里是公共函数自己的边界。
 */
export async function addSessionTokens(sessionId: string, delta: number): Promise<void> {
  if (!Number.isFinite(delta)) return;
  const n = Math.max(0, Math.round(delta));
  if (n === 0) return;
  await db.rawExec(
    `UPDATE sessions SET total_tokens = total_tokens + $2 WHERE id = $1::uuid`,
    sessionId,
    n,
  );
}
