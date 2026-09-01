// R3 前端数据层:工作台的会话列表 / 历史回放 / 对话流。
//
// 类型化 RPC 走 `encore gen client` 生成的 api-client.ts(docs/architecture.md
// 「前后端协议」决策);对话流是 `api.raw` SSE,生成客户端不覆盖,这里用 fetch +
// ReadableStream 自己解帧。两者共用同一个 `/api` 前缀:dev 由 next.config.ts 的
// rewrite 转发到 encore :4000,生产由 Caddy 截走(deploy/Caddyfile)。
import Client from "./api-client";

const API_BASE = "/api";

const client = new Client(API_BASE);

export type SessionSummary = Awaited<ReturnType<typeof client.agent.createSession>>;
export type ChatMessage = Awaited<ReturnType<typeof client.agent.getSession>>["messages"][number];

export async function listSessions(limit = 50): Promise<SessionSummary[]> {
  return (await client.agent.listSessions({ limit })).sessions;
}

export async function getSession(
  id: string,
): Promise<{ session: SessionSummary; messages: ChatMessage[] }> {
  return client.agent.getSession(id);
}

/**
 * `/agent/ask` 的非 2xx 响应(409 并发 / 429 容量或限额 / 400 校验 / 5xx)。
 *
 * `code` 是服务端给的机器可读标识(R7):同为 429,「并发会话数满」与「今日额度用完」
 * 对访客是两句不同的话。`message` 只用于调试,展示文案一律由前端按 status/code 决定。
 */
export class AskError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "AskError";
    this.status = status;
    this.code = code;
  }
}

export interface AskHandlers {
  /** 首帧:服务端确定的会话 id(新会话由此得到 id) */
  onSession?: (sessionId: string) => void;
  /** 助手文本增量 */
  onDelta?: (text: string) => void;
  /** 服务端以固定文案收尾的异常(内容已脱敏,可直接展示) */
  onError?: (message: string) => void;
}

interface SseFrame {
  event: string;
  data: string;
}

/** 把 SSE 文本切成帧;注释帧(`: hb` 心跳)与无 event 的帧直接丢弃。 */
function parseFrames(block: string): SseFrame | null {
  let event = "";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trim());
  }
  return event ? { event, data: data.join("\n") } : null;
}

/**
 * 发起一轮对话并消费 SSE 直到服务端收尾。
 * 正常结束(`done`)时 resolve;服务端异常经 `onError` 回调后同样 resolve
 * ——异常已被服务端翻译成固定文案,调用方按普通结果展示即可。
 * 非 2xx 与网络中断抛 `AskError` / 原始错误。
 */
export async function askStream(
  params: { prompt: string; sessionId?: string; signal?: AbortSignal },
  handlers: AskHandlers = {},
): Promise<void> {
  const resp = await fetch(`${API_BASE}/agent/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: params.prompt, sessionId: params.sessionId }),
    signal: params.signal,
  });

  if (!resp.ok || !resp.body) {
    let detail = `request failed (${resp.status})`;
    let code: string | undefined;
    try {
      const body = (await resp.json()) as { error?: string; code?: string };
      if (body?.error) detail = body.error;
      if (typeof body?.code === "string") code = body.code;
    } catch {
      /* 非 JSON 响应体,用默认文案 */
    }
    throw new AskError(resp.status, detail, code);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = parseFrames(buffer.slice(0, sep));
      buffer = buffer.slice(sep + 2);
      if (!frame) continue;
      switch (frame.event) {
        case "session":
          handlers.onSession?.((JSON.parse(frame.data) as { sessionId: string }).sessionId);
          break;
        case "delta":
          handlers.onDelta?.((JSON.parse(frame.data) as { text: string }).text);
          break;
        case "error":
          handlers.onError?.((JSON.parse(frame.data) as { message: string }).message);
          break;
        case "done":
          return;
      }
    }
  }
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 会话列表的相对时间,词汇与 design 画板 1a 的会话列表一致。 */
export function relativeTime(iso: string, now = Date.now()): string {
  const delta = now - new Date(iso).getTime();
  if (!Number.isFinite(delta) || delta < MINUTE) return "刚刚";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
  const days = Math.floor(delta / DAY);
  if (days === 1) return "昨天";
  if (days < 7) return `${days}d ago`;
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
