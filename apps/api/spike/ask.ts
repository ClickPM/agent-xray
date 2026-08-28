// R1 spike:GET /spike/ask — Encore 请求内跑真实 LLM 对话(DeepSeek 官方 API),
// 对话流经 session.subscribe() 以 SSE 推出(与 R3 正式 /agent/ask 同构,允许粗糙)。
// 用法:curl -N "http://127.0.0.1:4000/spike/ask?q=你好"
//       curl -N "http://127.0.0.1:4000/spike/ask?q=继续&sessionId=<上一次返回的 id>"
import { api } from "encore.dev/api";
import { createSpikeSession, getSession } from "./runtime";
import { sse, sseComment, SSE_HEADERS } from "./sse";

export const ask = api.raw(
  { expose: true, method: "GET", path: "/spike/ask" },
  async (req, resp) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const q = url.searchParams.get("q");
    const sessionId = url.searchParams.get("sessionId");
    const thinking = url.searchParams.get("thinking") ?? undefined;

    if (!q) {
      resp.writeHead(400, { "Content-Type": "application/json" });
      resp.end(JSON.stringify({ error: "missing query param q" }));
      return;
    }

    let rec = sessionId ? getSession(sessionId) : undefined;
    if (sessionId && (!rec || rec.disposed)) {
      resp.writeHead(404, { "Content-Type": "application/json" });
      resp.end(JSON.stringify({ error: `unknown or disposed session ${sessionId}` }));
      return;
    }

    try {
      rec ??= await createSpikeSession({ thinking });
    } catch (err) {
      resp.writeHead(500, { "Content-Type": "application/json" });
      resp.end(JSON.stringify({ error: `createAgentSession failed: ${String(err)}` }));
      return;
    }

    if (rec.session.isStreaming) {
      resp.writeHead(409, { "Content-Type": "application/json" });
      resp.end(JSON.stringify({ error: "session is already streaming" }));
      return;
    }

    resp.writeHead(200, SSE_HEADERS);
    sse(resp, "session", { sessionId: rec.id });

    const unsubscribe = rec.session.subscribe((event) => {
      if (event.type === "message_update") {
        const e = (
          event as { assistantMessageEvent?: { type?: string; delta?: string } }
        ).assistantMessageEvent;
        if (e?.type === "text_delta" && typeof e.delta === "string") {
          sse(resp, "delta", { text: e.delta });
        } else if (e?.type === "thinking_delta" && typeof e.delta === "string") {
          sse(resp, "thinking", { text: e.delta });
        }
      } else if (event.type === "agent_start" || event.type === "agent_end") {
        sse(resp, "lifecycle", { type: event.type });
      }
    });
    const heartbeat = setInterval(() => sseComment(resp, "hb"), 15_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });

    try {
      await rec.session.prompt(q);
      sse(resp, "done", {
        sessionId: rec.id,
        messageCount: rec.session.messages.length,
        capturedEvents: rec.events.length,
      });
    } catch (err) {
      sse(resp, "error", { message: String(err) });
    } finally {
      clearInterval(heartbeat);
      unsubscribe();
      resp.end();
    }
  },
);
