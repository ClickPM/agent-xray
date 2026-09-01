// trace 服务的**只读**查询层(R4)。
//
// `trace_events` / `sessions` 的建表与迁移归 agent 服务所有,trace 只读不写、
// 不加迁移;跨服务引用走 Encore 官方的 `SQLDatabase.named()`,而不是 import
// `agent/store`(任务卡 D3)。因此这里重复了一小段 SELECT——代价换来的是
// 「schema 只有一个 owner」这条边界不被含糊。
import { SQLDatabase } from "encore.dev/storage/sqldb";

const db = SQLDatabase.named("agent");

export interface TraceEventRow {
  seq: number;
  eventType: string;
  mode: string;
  /** epoch ms */
  timestamp: number;
  data: unknown;
}

/**
 * 这条轨迹能不能给这个访客看(R-VISITOR)。
 *
 * 【为什么判据是「归属」而不是「存在」】本轮之前这里只问「会话存在吗」,于是
 * `/trace/stream?sessionId=<别人的 id>` 会把对方的 prompt 与回复原样流出来 ——
 * 轨迹事件里就是完整对话内容,隔离必须覆盖到这条流,不能只做在 agent 侧
 * (docs/security.md §6)。
 *
 * 【为什么在 SQL 里 join 而不是先解析访客再查会话】trace 对 agent 库**只读**,
 * 不写 `visitors`(滑动续期由 agent 侧的请求承担),这条 SQL 因此不需要
 * `agent/visitor.ts` 的任何东西,服务间「只读、不拥有 schema、不 import 对方目录」
 * 的边界(R4 定下)原样保持。
 *
 * `expires_at > now()` 与 agent 侧认领 cookie 用的是同一个判据:过期的 token
 * 在这里也认不出来,访客看不到自己此前的轨迹。
 */
export async function sessionVisibleTo(sessionId: string, tokenHash: string): Promise<boolean> {
  const row = await db.rawQueryRow<{ ok: number }>(
    `SELECT 1 AS ok
       FROM sessions s
       JOIN visitors v ON v.id = s.visitor_id
      WHERE s.id = $1::uuid AND v.token_hash = $2 AND v.expires_at > now()`,
    sessionId,
    tokenHash,
  );
  return row !== null;
}

/**
 * 会话轨迹回放:seq 大于 afterSeq 的事件,按 seq 升序返回。
 *
 * `limit` 取的是**最新的 N 条**(内层 DESC + LIMIT,外层再升序):长会话累积
 * 上万条事件时,右栏能显示的也只有最近这一段,取最旧的 N 条反而是没用的那段。
 * 截断时调用方能从返回值的首个 seq 看出缺口。
 */
export async function listTraceEvents(
  sessionId: string,
  afterSeq: number,
  limit: number,
): Promise<TraceEventRow[]> {
  return db.rawQueryAll<TraceEventRow>(
    `SELECT seq, "eventType", mode, timestamp, data FROM (
       SELECT seq,
              event_type AS "eventType",
              mode,
              (extract(epoch FROM ts) * 1000)::double precision AS timestamp,
              data
       FROM trace_events
       WHERE session_id = $1::uuid AND seq > $2
       ORDER BY seq DESC
       LIMIT $3
     ) recent
     ORDER BY seq`,
    sessionId,
    afterSeq,
    limit,
  );
}
