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
}

export interface MessageRow {
  seq: number;
  role: MessageRole;
  content: string;
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

const SESSION_COLS = `id, title,
  (extract(epoch FROM created_at) * 1000)::double precision AS "createdAt",
  (extract(epoch FROM last_active_at) * 1000)::double precision AS "lastActiveAt"`;

/** 建会话。传 id 时用调用方的(spike/R3 复用运行时会话 id),否则库内生成。 */
export async function createSession(id?: string): Promise<SessionRow> {
  const row = await db.rawQueryRow<SessionRow>(
    `INSERT INTO sessions (id)
     VALUES (COALESCE($1::uuid, gen_random_uuid()))
     RETURNING ${SESSION_COLS}`,
    id ?? null,
  );
  return row!;
}

export async function getSession(id: string): Promise<SessionRow | null> {
  return db.rawQueryRow<SessionRow>(
    `SELECT ${SESSION_COLS} FROM sessions WHERE id = $1::uuid`,
    id,
  );
}

export async function listSessions(limit = 50): Promise<SessionRow[]> {
  return db.rawQueryAll<SessionRow>(
    `SELECT ${SESSION_COLS} FROM sessions
     ORDER BY last_active_at DESC, id
     LIMIT $1`,
    limit,
  );
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
     RETURNING seq, role, content,
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
    `SELECT seq, role, content,
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
