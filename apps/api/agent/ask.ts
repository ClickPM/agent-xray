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
//
// 非 2xx 的 JSON 体是 `{error, code?}`(R7 加 code):`error` 只供调试,
// 访客文案由前端按 status/code 分档。限额拒绝走 429 + code
// (daily_tokens / daily_cost / turn_limit),见 `quota.ts`。
import { api } from "encore.dev/api";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { LlmNotConfiguredError } from "./llm-config";
import {
  acquireSession,
  disposeSession,
  flushTraceEvents,
  SessionBusyError,
  SessionCapacityError,
  type RuntimeSession,
} from "./runtime";
import { previewText, safeErrorText } from "./events";
import { checkQuota, recordUsage, usdToMicros } from "./quota";
import { sse, sseComment, SSE_HEADERS } from "../shared/sse";
import {
  appendMessage,
  createSession as createDbSession,
  sessionOwnedBy,
  upsertMessage,
} from "./store";
import { ensureVisitor, headersOfRaw, resolveVisitor, type Visitor } from "./visitor";

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

/**
 * 非 2xx 响应。
 *
 * `code` 是给前端**分档文案**用的机器可读标识(R7 新增)。为什么不靠 HTTP 状态分档:
 * 「并发会话数满」与「今日额度用完」都是 429,但对访客是完全不同的两句话
 * (一句是「等会儿再来」,一句是「明天再来」)。`error` 仍然只是给日志/调试看的,
 * 前端不展示它——服务端文案与展示文案的分工是 R3 定下的。
 *
 * `setCookie` 是 R-VISITOR 的滑动续期(docs/security.md §6):已认领到身份的请求即便
 * 被拒,也要把 cookie 带回去 —— 否则一个连着撞限额的访客会因为「拒绝响应不发 cookie」
 * 而在 24h 后莫名其妙丢掉自己的会话。没有身份时(第一次来 / 已过期)不发,
 * 拒绝路径永远不发新身份。
 */
function fail(
  resp: ServerResponse,
  status: number,
  error: string,
  code?: string,
  setCookie?: string,
): void {
  const headers: Record<string, string> = { "Content-Type": "application/json; charset=utf-8" };
  if (setCookie) headers["Set-Cookie"] = setCookie;
  resp.writeHead(status, headers);
  resp.end(JSON.stringify(code ? { error, code } : { error }));
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
        `persist assistant message failed (attempt ${attempt + 1}/${PERSIST_ATTEMPTS}): ` +
          safeErrorText(err),
      );
      if (attempt < PERSIST_ATTEMPTS - 1) await sleep(PERSIST_BACKOFF_MS[attempt]);
    }
  }
  return false;
}

export const ask = api.raw(
  {
    expose: true,
    method: "POST", path: "/agent/ask",
    // 访客 cookie 是可冒充身份的凭据,不能进 trace(docs/security.md §6;
    // Encore 默认把请求头/响应头/返回值写进 trace,三处都有明文 token)
    sensitive: true,
  },
  async (req, resp) => {
    // 【客户端断开检测:本环境下拿不到信号,已放弃,勿再按常规写法“修复”】
    //
    // codex review P2 指出原实现监听 `req` 的 close 是错的,属实——实测它在**请求体读完
    // 后 2ms** 就触发,若据此 abort 会把每一轮对话当场掐掉。但改成常规正解
    // `resp.on("close")` + `writableFinished` 之后仍然无效:实测 4 秒掐断客户端,
    // resp 的 close 直到 **t=+9763ms**(即本端 `resp.end()` 之后)才触发,且
    // `writableFinished=true`;`req.socket` / `resp.socket` 全程既不触发 close/error,
    // `destroyed` 也一直是 false。
    //
    // 原因是 Encore 的网关代理:浏览器连的是网关,网关再转发给 JS 运行时,
    // 外部连接断开不会传导到这里拿到的 req/res/socket 上(encore 1.57.13 + bun)。
    // 结论:进程内没有可靠的断开信号,本轮不做 abort——访客关页面后本轮会跑完
    //(数秒的 token),会话随即释放,影响有限。已记 rounds/BACKLOG.md,
    // 待 R9 在 Caddy + 自托管镜像的真实拓扑下复测。
    let raw: unknown;
    try {
      raw = await readJsonBody(req);
    } catch (err) {
      console.error(`read /agent/ask body failed: ${safeErrorText(err)}`);
      fail(resp, 400, "invalid request body");
      return;
    }

    const parsed = parseAskBody(raw);
    if ("error" in parsed) {
      fail(resp, 400, parsed.error);
      return;
    }
    const { sessionId, prompt } = parsed.body;

    // 【R-VISITOR:身份在这里只**认领**,不发放】发放推迟到真的要建会话那一刻
    // (下面的 ensureVisitor)。放在这里的话,一个不带 cookie 的 for 循环即便每次都
    // 撞上限额被拒,也已经先往 visitors 里灌了一行 —— 与 docs/security.md §6
    // 「发放时机 = 会话被创建时」是同一条。
    const reqHeaders = headersOfRaw(req);
    let visitor: Visitor | null;
    try {
      visitor = await resolveVisitor(reqHeaders);
    } catch (err) {
      console.error(`resolve visitor failed: ${safeErrorText(err)}`);
      fail(resp, 500, "internal error");
      return;
    }

    // 续接:会话必须存在**且属于本访客**(运行时会话可能已被回收,但会话本身得是真的)。
    // 没有身份、不是本人的会话、以及根本不存在的会话,对调用方是同一个 404 ——
    // 区分开来等于把会话 id 变成一个存在性预言机(docs/security.md §6)。
    if (sessionId) {
      try {
        if (!visitor || !(await sessionOwnedBy(sessionId, visitor.id))) {
          fail(resp, 404, `session ${sessionId} not found`, undefined, visitor?.setCookie);
          return;
        }
      } catch (err) {
        console.error(`lookup session failed: ${safeErrorText(err)}`);
        fail(resp, 500, "internal error", undefined, visitor?.setCookie);
        return;
      }
    }

    const isNew = !sessionId;
    const id = sessionId ?? randomUUID();

    // 【限额闸排在建会话之前】(docs/security.md §1 第 4 层)超限时不该先把一个 pi 会话
    // 建起来再拒:那既白占一个并发名额,又要在拒绝路径上多一次 dispose。
    //
    // 拒绝体里**只出 code,不出数字**:`daily token limit reached (12345/10000)` 这种
    // 文本会把站点的限额配置告诉每一个撞上它的访客。具体数字只进服务端日志,
    // 访客看到的文案由前端按 code 决定(与 R3 定下的「服务端不供展示文案」一致)。
    //
    // 判定本身失败(库读不到)回 500,不静默放行也不静默拒绝——库都读不到的话
    // 下一步的消息落库同样会失败,500 是诚实的答案。
    try {
      const denial = await checkQuota(id);
      if (denial) {
        console.warn(`quota denied for session ${id}: ${denial.detail}`);
        fail(resp, 429, "quota exceeded", denial.reason, visitor?.setCookie);
        return;
      }
    } catch (err) {
      console.error(`quota check failed: ${safeErrorText(err)}`);
      fail(resp, 500, "internal error", undefined, visitor?.setCookie);
      return;
    }

    // acquireSession 返回即代表本请求**已持有**该会话(busy 在其内部同步置位),
    // 从这里往下的每条路径都必须释放。同会话并发与容量耗尽在其内部判定后抛出。
    let rec: RuntimeSession;
    try {
      rec = await acquireSession(id);
    } catch (err) {
      if (err instanceof SessionBusyError) {
        fail(resp, 409, "session is already streaming", undefined, visitor?.setCookie);
        return;
      }
      if (err instanceof SessionCapacityError) {
        console.warn(err.message);
        fail(resp, 429, "server is at capacity, try again shortly", undefined, visitor?.setCookie);
        return;
      }
      if (err instanceof LlmNotConfiguredError) {
        // R6:LLM 凭据只有 llm_config 一个来源(引导 secret 已移除)。没配就是
        // **配置缺失**,不是内部错误——回 503 而不是 500,让部署方一眼看出该做什么。
        // 原因只进日志:模型名/端点属于服务端配置,不出服务端。
        console.error(`llm not configured: ${safeErrorText(err)}`);
        fail(resp, 503, "对话服务尚未配置模型,请稍后再试", undefined, visitor?.setCookie);
        return;
      }
      console.error(`acquire agent session failed: ${safeErrorText(err)}`);
      fail(resp, 500, "internal error", undefined, visitor?.setCookie);
      return;
    }

    let userSeq: number;
    try {
      if (isNew) {
        // 【R-VISITOR:身份在这里发放】限额与并发都过了、这个会话确定要被建出来,
        // 才给没有 cookie 的访客发一个新身份(docs/security.md §6「发放时机」)。
        visitor = await ensureVisitor(reqHeaders);
        // 会话行建在运行时会话之后:建行失败必须释放 pi 会话,否则它既无 DB 行
        // (轨迹落库会 FK 失败)又长期占着并发名额
        await createDbSession(visitor.id, id);
      }
      userSeq = (await appendMessage(id, "user", prompt)).seq;
    } catch (err) {
      console.error(`persist user message failed: ${safeErrorText(err)}`);
      // 先 dispose 再释放 busy:持有期间不会被 sweeper / 逐出并发触碰。
      //
      // 【为什么续接的会话也要 dispose】(codex 初审 P2)原来只在 `isNew` 时释放,
      // 理由是「续接失败时什么都没建,没东西要清」。R-VISITOR 之后这条不再成立:
      // 落库失败的一个真实原因是**这个会话刚被访客自己在另一个标签页删掉了**
      // (外键指向已不存在的 sessions 行)。那种情况下留着运行时会话 = 一个指向
      // 已删除数据的 pi 会话占着 MAX_ACTIVE_SESSIONS 里的一个名额直到空闲回收
      // (15 分钟),期间它的轨迹 flush 每次都会外键失败。代价只是下一轮冷启动一次。
      await disposeSession(rec);
      rec.busy = false;
      fail(resp, 500, "internal error", undefined, visitor?.setCookie);
      return;
    }

    // 滑动续期:成功路径同样要把 cookie 带回去(visitor 此时必然非 null ——
    // 续接路径在上面认领过,新建路径刚刚发放过)
    resp.writeHead(200, { ...SSE_HEADERS, ...(visitor ? { "Set-Cookie": visitor.setCookie } : {}) });
    sse(resp, "session", { sessionId: id });

    let assistantText = "";
    // pi 把 provider 失败(401/超时/限流)吞在内部:`prompt()` 正常 resolve,
    // 助手消息以 stopReason="error" 收尾且正文为空。**实测**:只靠 try/catch 会把
    // 失败的一轮当成功报 done,访客看到「什么都没发生」。判据取助手 message_end 的
    // stopReason,原文只留服务端日志。
    let turnErrorDetail: string | undefined;
    // 本轮用量(R7 限额计数)。一轮可能有**多条**助手消息——开了工具之后
    // 「助手 → 工具 → 助手」是常态,每一段都各有一次 provider 调用,必须逐条累加。
    let turnTokens = 0;
    let turnCostMicros = 0;
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
        const m = (
          event as {
            message?: {
              role?: string;
              stopReason?: string;
              errorMessage?: string;
              usage?: { totalTokens?: number; cost?: { total?: number } };
            };
          }
        ).message;
        if (m?.role === "assistant" && (m.stopReason === "error" || m.stopReason === "aborted")) {
          turnErrorDetail = m.errorMessage || m.stopReason;
        }
        // provider 不报价(自定义中转端点常见)时 cost 缺失 —— token 照记、费用记 0。
        // 费用限额在那种配置下不起作用,这是配置的性质,不是这里的缺陷。
        if (m?.role === "assistant" && m.usage) {
          if (typeof m.usage.totalTokens === "number") turnTokens += m.usage.totalTokens;
          if (typeof m.usage.cost?.total === "number") {
            turnCostMicros += usdToMicros(m.usage.cost.total);
          }
        }
      }
    });

    const heartbeat = setInterval(() => sseComment(resp, "hb"), HEARTBEAT_MS);

    try {
      let promptFailed = false;
      try {
        await rec.session.prompt(prompt);
      } catch (err) {
        promptFailed = true;
        // provider SDK 的异常常挂着响应体/请求配置(可能含 Authorization),
        // 只记脱敏摘要(docs/security.md §2、CLAUDE.md 规则 9)
        console.error(`prompt failed for session ${id}: ${safeErrorText(err)}`);
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

      if (promptFailed || persistFailed) {
        const parts: string[] = [];
        if (promptFailed) parts.push(ERR_PROVIDER);
        if (persistFailed) parts.push(ERR_NOT_PERSISTED);
        sse(resp, "error", { message: parts.join(" ") });
      } else {
        sse(resp, "done", { sessionId: id });
      }
    } finally {
      // 用量计数是**尽力而为**的资源闸,不是账单:失败只记日志,绝不把已经完成的
      // 一轮报成失败(docs/security.md §1 第 4 层;理由写在 quota.ts 的 recordUsage)。
      await recordUsage(turnTokens, turnCostMicros).catch((err) =>
        console.error(`record usage failed for session ${id}: ${safeErrorText(err)}`),
      );
      await flushTraceEvents(rec).catch((err) =>
        console.error(`flushTraceEvents failed for session ${id}: ${safeErrorText(err)}`),
      );
      clearInterval(heartbeat);
      unsubscribe();
      rec.lastActiveAt = Date.now();
      rec.busy = false;
      resp.end();
    }
  },
);
