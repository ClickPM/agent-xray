// R1 spike:GET /spike/ask — Encore 请求内跑真实 LLM 对话(DeepSeek 官方 API),
// 对话流经 session.subscribe() 以 SSE 推出(与 R3 正式 /agent/ask 同构,允许粗糙)。
// 用法:curl -N "http://127.0.0.1:4000/spike/ask?q=你好"
//       curl -N "http://127.0.0.1:4000/spike/ask?q=继续&sessionId=<上一次返回的 id>"
import { api } from "encore.dev/api";
import { appendMessage, createSession as createDbSession } from "../agent/store";
import {
  createSpikeSession,
  disposeSpikeSession,
  flushTraceEvents,
  getSession,
} from "./runtime";
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
      if (!rec) {
        rec = await createSpikeSession({ thinking });
        try {
          // R2:会话落库(与运行时会话同 id);R3 正式 /agent/ask 沿用 store 路径
          await createDbSession(rec.id);
        } catch (err) {
          // 建行失败必须释放已创建的 pi 会话,否则反复失败会占满会话上限(codex review P2)
          disposeSpikeSession(rec);
          throw err;
        }
        rec.persisted = true;
      }
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

    try {
      await appendMessage(rec.id, "user", q);
    } catch (err) {
      resp.writeHead(500, { "Content-Type": "application/json" });
      resp.end(JSON.stringify({ error: `persist user message failed: ${String(err)}` }));
      return;
    }

    resp.writeHead(200, SSE_HEADERS);
    sse(resp, "session", { sessionId: rec.id });

    let assistantText = "";
    const unsubscribe = rec.session.subscribe((event) => {
      if (event.type === "message_update") {
        const e = (
          event as { assistantMessageEvent?: { type?: string; delta?: string } }
        ).assistantMessageEvent;
        if (e?.type === "text_delta" && typeof e.delta === "string") {
          assistantText += e.delta;
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
      let promptError: unknown;
      try {
        await rec.session.prompt(q);
      } catch (err) {
        promptError = err;
      }
      // R2:助手文本落库(思考增量不持久化)。prompt 失败也持久化已流出的部分文本,
      // 保证库内历史与客户端所见一致(codex review P2);持久化失败只记日志。
      if (assistantText) {
        await appendMessage(rec.id, "assistant", assistantText).catch((err) =>
          console.error("persist assistant message failed:", err),
        );
      }
      if (promptError) {
        sse(resp, "error", { message: String(promptError) });
      } else {
        sse(resp, "done", {
          sessionId: rec.id,
          messageCount: rec.session.messages.length,
          capturedEvents: rec.events.length,
        });
      }
    } finally {
      // R2:本轮新增轨迹事件批量落库;落库失败只记日志,不影响流收尾
      await flushTraceEvents(rec).catch((err) =>
        console.error("flushTraceEvents failed:", err),
      );
      clearInterval(heartbeat);
      unsubscribe();
      resp.end();
    }
  },
);
