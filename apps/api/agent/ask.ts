// R3 正式对话流:`POST /agent/ask`(`api.raw` SSE ← `session.subscribe()`)。
//
// SSE 帧契约(前端 apps/web/lib/agent-api.ts 消费):
//   event: session  {sessionId}     首帧,新会话由此把 id 交给客户端
//   event: delta    {text}          助手文本增量(逐字渲染)
//   event: done     {sessionId}     本轮正常收尾
//   event: error    {message}       本轮异常收尾,message 是**固定文案**
//   `: hb` 注释帧                    15s 心跳,穿透反代空闲超时
//
// 错误口径(docs/security.md §2,消化 rounds/BACKLOG.md 两条 R2 遗留):
// SSE 只出固定文案,provider / 数据库的原始错误一律只进服务端日志——
// 上游报错常带端点、模型名甚至请求头片段,不允许出服务端。
import { api } from "encore.dev/api";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import {
  acquireSession,
  disposeSession,
  flushTraceEvents,
  SessionCapacityError,
  type RuntimeSession,
} from "./runtime";
import { previewText } from "./events";
import { sse, sseComment, SSE_HEADERS } from "./sse";
import {
  appendMessage,
  createSession as createDbSession,
  getSession as getDbSession,
  upsertMessage,
} from "./store";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 请求体上限:对话请求只有一段文本,64KB 已远超需要。 */
const MAX_BODY_BYTES = 64 * 1024;
/** 单轮提问字符上限。 */
const MAX_PROMPT_CHARS = 4_000;
const HEARTBEAT_MS = 15_000;
/** 助手消息落库重试次数与退避(去重键幂等,重试不会写重复行)。 */
const PERSIST_ATTEMPTS = 3;
const PERSIST_BACKOFF_MS = [100, 400];

const ERR_PROVIDER = "模型调用失败,本轮回复未完成。";
const ERR_NOT_PERSISTED = "本轮回复未能保存,刷新后可能看不到这条消息。";

interface AskBody {
  /** 省略则新建会话 */
  sessionId?: string;
  prompt: string;
}

function fail(resp: ServerResponse, status: number, error: string): void {
  resp.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  resp.end(JSON.stringify({ error }));
}

/** 读取并解析 JSON 请求体;超限直接断开,避免把内存交给调用方决定。 */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new Error("request body too large");
    chunks.push(buf);
  }
  if (size === 0) throw new Error("empty request body");
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** 请求体校验:返回规整后的值,或一句给客户端看的错误。 */
export function parseAskBody(raw: unknown): { body: AskBody } | { error: string } {
  if (typeof raw !== "object" || raw === null) return { error: "body must be a JSON object" };
  const { sessionId, prompt } = raw as Record<string, unknown>;
  if (typeof prompt !== "string") return { error: "prompt is required" };
  const trimmed = prompt.trim();
  if (trimmed === "") return { error: "prompt must not be empty" };
  if (trimmed.length > MAX_PROMPT_CHARS) {
    return { error: `prompt exceeds ${MAX_PROMPT_CHARS} characters` };
  }
  if (sessionId !== undefined) {
    if (typeof sessionId !== "string" || !UUID_RE.test(sessionId)) {
      return { error: "sessionId must be a UUID" };
    }
    return { body: { sessionId, prompt: trimmed } };
  }
  return { body: { prompt: trimmed } };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 助手回复按「turn 级去重键」幂等落库:seq 在用户消息落库时就定死(userSeq+1),
 * 重试写同一个 seq 只会更新内容,不会追加重复消息——覆盖「提交成功但连接断开」
 * 这类不确定路径(rounds/BACKLOG.md R2 遗留)。全部尝试失败才返回 false。
 */
async function persistAssistant(
  sessionId: string,
  seq: number,
  content: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < PERSIST_ATTEMPTS; attempt++) {
    try {
      const row = await upsertMessage(sessionId, seq, "assistant", content);
      if (row) return true;
      // seq 被别的角色占用:重试也不会好转,直接判失败(store.upsertMessage 护栏)
      console.error(
        `persist assistant message conflict: session ${sessionId} seq ${seq} held by another role`,
      );
      return false;
    } catch (err) {
      console.error(
        `persist assistant message failed (attempt ${attempt + 1}/${PERSIST_ATTEMPTS}):`,
        err,
      );
      if (attempt < PERSIST_ATTEMPTS - 1) await sleep(PERSIST_BACKOFF_MS[attempt]);
    }
  }
  return false;
}

export const ask = api.raw(
  { expose: true, method: "POST", path: "/agent/ask" },
  async (req, resp) => {
    let raw: unknown;
    try {
      raw = await readJsonBody(req);
    } catch (err) {
      console.error("read /agent/ask body failed:", err);
      fail(resp, 400, "invalid request body");
      return;
    }

    const parsed = parseAskBody(raw);
    if ("error" in parsed) {
      fail(resp, 400, parsed.error);
      return;
    }
    const { sessionId, prompt } = parsed.body;

    // 续接:DB 行必须存在(运行时会话可能已被回收,但会话本身得是真的)
    if (sessionId) {
      try {
        if (!(await getDbSession(sessionId))) {
          fail(resp, 404, `session ${sessionId} not found`);
          return;
        }
      } catch (err) {
        console.error("lookup session failed:", err);
        fail(resp, 500, "internal error");
        return;
      }
    }

    const isNew = !sessionId;
    const id = sessionId ?? randomUUID();

    let rec: RuntimeSession;
    try {
      rec = await acquireSession(id);
    } catch (err) {
      if (err instanceof SessionCapacityError) {
        console.warn(err.message);
        fail(resp, 429, "server is at capacity, try again shortly");
        return;
      }
      console.error("acquire agent session failed:", err);
      fail(resp, 500, "internal error");
      return;
    }

    // 同会话串行闸。check 与置位之间不得有 await,否则并发请求会双双通过。
    if (rec.busy || rec.session.isStreaming) {
      fail(resp, 409, "session is already streaming");
      return;
    }
    rec.busy = true;

    let userSeq: number;
    try {
      if (isNew) {
        // 会话行建在运行时会话之后:建行失败必须释放 pi 会话,否则它既无 DB 行
        // (轨迹落库会 FK 失败)又长期占着并发名额
        await createDbSession(id);
      }
      userSeq = (await appendMessage(id, "user", prompt)).seq;
    } catch (err) {
      console.error("persist user message failed:", err);
      rec.busy = false;
      if (isNew) await disposeSession(rec);
      fail(resp, 500, "internal error");
      return;
    }

    resp.writeHead(200, SSE_HEADERS);
    sse(resp, "session", { sessionId: id });

    let assistantText = "";
    // pi 把 provider 失败(401/超时/限流)吞在内部:`prompt()` 正常 resolve,
    // 助手消息以 stopReason="error" 收尾且正文为空。**实测**:只靠 try/catch 会把
    // 失败的一轮当成功报 done,访客看到「什么都没发生」。判据取助手 message_end 的
    // stopReason,原文只留服务端日志。
    let turnErrorDetail: string | undefined;
    const unsubscribe = rec.session.subscribe((event) => {
      if (event.type === "message_update") {
        const e = (event as { assistantMessageEvent?: { type?: string; delta?: string } })
          .assistantMessageEvent;
        if (e?.type === "text_delta" && typeof e.delta === "string") {
          assistantText += e.delta;
          sse(resp, "delta", { text: e.delta });
        }
        return;
      }
      if (event.type === "message_end") {
        const m = (event as { message?: { role?: string; stopReason?: string; errorMessage?: string } })
          .message;
        if (m?.role === "assistant" && (m.stopReason === "error" || m.stopReason === "aborted")) {
          turnErrorDetail = m.errorMessage || m.stopReason;
        }
      }
    });

    const heartbeat = setInterval(() => sseComment(resp, "hb"), HEARTBEAT_MS);
    // 客户端断开就中止本轮:继续跑只会白烧 token。已流出的文本仍会落库,
    // 库内历史与访客所见保持一致。
    let clientGone = false;
    req.on("close", () => {
      if (resp.writableEnded) return;
      clientGone = true;
      void rec.session.abort().catch((err) => console.error("abort after client close:", err));
    });

    try {
      let promptFailed = false;
      try {
        await rec.session.prompt(prompt);
      } catch (err) {
        promptFailed = true;
        console.error(`prompt failed for session ${id}:`, err);
      }
      if (turnErrorDetail !== undefined) {
        promptFailed = true;
        // previewText 复用事件流的脱敏口径(截断 + 凭据模式清洗),
        // 避免上游把请求头片段塞进 errorMessage 时进日志(CLAUDE.md 规则 9)
        console.error(`turn ended with error for session ${id}: ${previewText(turnErrorDetail)}`);
      }

      let persistFailed = false;
      if (assistantText) {
        persistFailed = !(await persistAssistant(id, userSeq + 1, assistantText));
      }

      if (clientGone) {
        // 无人收听,不再写帧;落库与 flush 已在上面完成
      } else if (promptFailed || persistFailed) {
        const parts: string[] = [];
        if (promptFailed) parts.push(ERR_PROVIDER);
        if (persistFailed) parts.push(ERR_NOT_PERSISTED);
        sse(resp, "error", { message: parts.join(" ") });
      } else {
        sse(resp, "done", { sessionId: id });
      }
    } finally {
      await flushTraceEvents(rec).catch((err) =>
        console.error(`flushTraceEvents failed for session ${id}:`, err),
      );
      clearInterval(heartbeat);
      unsubscribe();
      rec.lastActiveAt = Date.now();
      rec.busy = false;
      resp.end();
    }
  },
);
