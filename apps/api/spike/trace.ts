// R1 spike:GET /spike/trace/stream?sessionId= — 轨迹事件 SSE(观测者扩展内存队列
// 回放 + live tail,与 R4 正式 /trace/stream 同构)。事件已在采集时做 spike 级脱敏。
import { api } from "encore.dev/api";
import { getSession, type CapturedEvent } from "./runtime";
import { sse, sseComment, SSE_HEADERS } from "./sse";

export const traceStream = api.raw(
  { expose: true, method: "GET", path: "/spike/trace/stream" },
  async (req, resp) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const sessionId = url.searchParams.get("sessionId");
    const rec = sessionId ? getSession(sessionId) : undefined;

    if (!rec) {
      resp.writeHead(404, { "Content-Type": "application/json" });
      resp.end(JSON.stringify({ error: `unknown session ${sessionId ?? "(none)"}` }));
      return;
    }

    resp.writeHead(200, SSE_HEADERS);

    // 回放已缓冲事件,再挂 live 监听
    for (const e of rec.events) sse(resp, "trace", e);
    const listener = (e: CapturedEvent) => sse(resp, "trace", e);
    rec.listeners.add(listener);
    const heartbeat = setInterval(() => sseComment(resp, "hb"), 15_000);

    await new Promise<void>((resolve) => req.on("close", resolve));

    clearInterval(heartbeat);
    rec.listeners.delete(listener);
    resp.end();
  },
);
