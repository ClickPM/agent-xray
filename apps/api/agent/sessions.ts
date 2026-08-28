// R2:会话创建 / 续接 / 列表端点(ROUNDS.md R2 明文范围)。
// 对话流本身(POST /agent/ask SSE)是 R3,本文件不涉及。
import { api, APIError, Query } from "encore.dev/api";
import * as store from "./store";

export interface SessionSummary {
  id: string;
  title: string;
  /** ISO 8601 */
  createdAt: string;
  /** ISO 8601 */
  lastActiveAt: string;
}

export interface ChatMessage {
  seq: number;
  role: "user" | "assistant" | "tool";
  content: string;
  /** ISO 8601 */
  createdAt: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toIso = (ms: number) => new Date(ms).toISOString();

function toSummary(row: store.SessionRow): SessionSummary {
  return {
    id: row.id,
    title: row.title,
    createdAt: toIso(row.createdAt),
    lastActiveAt: toIso(row.lastActiveAt),
  };
}

/** 创建会话(标题留空,由首条用户消息派生)。 */
export const createSession = api(
  { expose: true, method: "POST", path: "/agent/sessions" },
  async (): Promise<SessionSummary> => {
    return toSummary(await store.createSession());
  },
);

interface ListSessionsRequest {
  /** 默认 50,上限 200 */
  limit?: Query<number>;
}

interface ListSessionsResponse {
  sessions: SessionSummary[];
}

/** 会话列表,按最近活跃倒序(工作台左栏)。 */
export const listSessions = api(
  { expose: true, method: "GET", path: "/agent/sessions" },
  async (req: ListSessionsRequest): Promise<ListSessionsResponse> => {
    const limit = Math.min(Math.max(req.limit ?? 50, 1), 200);
    const rows = await store.listSessions(limit);
    return { sessions: rows.map(toSummary) };
  },
);

interface GetSessionRequest {
  id: string;
}

interface GetSessionResponse {
  session: SessionSummary;
  /** 会话内历史消息,按 seq 有序(刷新后恢复对话) */
  messages: ChatMessage[];
}

/** 续接:单会话 + 历史消息回放。 */
export const getSession = api(
  { expose: true, method: "GET", path: "/agent/sessions/:id" },
  async (req: GetSessionRequest): Promise<GetSessionResponse> => {
    if (!UUID_RE.test(req.id)) {
      throw APIError.invalidArgument("id must be a UUID");
    }
    const row = await store.getSession(req.id);
    if (!row) throw APIError.notFound(`session ${req.id} not found`);
    const messages = await store.listMessages(req.id);
    return {
      session: toSummary(row),
      messages: messages.map((m) => ({
        seq: m.seq,
        role: m.role,
        content: m.content,
        createdAt: toIso(m.createdAt),
      })),
    };
  },
);
