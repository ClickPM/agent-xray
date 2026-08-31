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

export async function sessionExists(sessionId: string): Promise<boolean> {
  const row = await db.rawQueryRow<{ ok: number }>(
    `SELECT 1 AS ok FROM sessions WHERE id = $1::uuid`,
    sessionId,
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
