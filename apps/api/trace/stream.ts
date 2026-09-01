// R4 正式轨迹流:`GET /trace/stream?sessionId=…&afterSeq=…`(`api.raw` SSE)。
//
// SSE 帧契约(前端 apps/web/lib/trace-api.ts 消费):
//   event: trace  {seq, eventType, mode, timestamp, data}   一条轨迹事件
//   event: ready  {lastSeq}                                  回放结束,此后是 live
//   event: bye    {lastSeq, reason}                          服务端主动收尾,可凭 lastSeq 重连
//   `: hb` 注释帧                                            15s 心跳,穿透反代空闲超时
//
// 【本端口拿不到客户端断开信号 —— 生命周期必须由服务端兜底】
// R3 对 POST 实测过,R4 开工时又用临时探针对 GET 复测(rounds/round-04 前置实测):
// 客户端 kill -9 之后,req/resp/socket 三条路都不触发 close/error,`resp.write()`
// 仍恒返回 true,`destroyed` 恒为 false;resp 的 close 只在本端 `end()` 之后才来。
// 原因是 Encore 网关代理不把外部连接断开传导进 JS 运行时。
// 因此**不要**再写 `req.on("close")` 那套常规收尾——它永远不会触发,只会让被遗弃
// 的连接无限累积(docs/security.md §0 威胁 3)。替代方案是下面三条硬上界。
//
// 脱敏:事件在采集时(agent/runtime.ts → sanitizeEvent)就已按白名单脱敏,库里存的
// 就是脱敏后的数据,本端点只做搬运,不做二次处理(任务卡 D5)。
import { api } from "encore.dev/api";
import type { ServerResponse } from "node:http";
import { safeErrorText } from "../shared/redact";
import { sse, sseComment, SSE_HEADERS } from "../shared/sse";
import { recent, subscribe, type TraceEvent } from "../shared/trace-bus";
import { hashVisitorToken, readVisitorCookie } from "../shared/visitor-cookie";
import { listTraceEvents, sessionVisibleTo } from "./store";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 单条连接的存活上界:到点主动收尾,客户端凭 lastSeq 立刻重连。
 * 这个值同时决定「关掉页面的访客」占着名额多久——断开探测不到,只能靠它到期。
 */
export const MAX_STREAM_MS = 5 * 60_000;
/** 同一会话的并发流上限(按不同观众计);超出返回 429。 */
export const MAX_STREAMS_PER_SESSION = 8;
/** 全站并发流上限;超出直接 429。 */
export const MAX_TOTAL_STREAMS = 64;
/** 单次回放的事件条数上限(取最新 N 条)。 */
export const MAX_REPLAY_EVENTS = 5000;
const HEARTBEAT_MS = 15_000;

export type EndReason = "max-duration" | "superseded";

/** 观众标识:同一浏览器标签页在多次重连之间保持不变(前端存在 sessionStorage)。 */
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// —— 连接名额 ——
//
// 断开探测不到,所以「一条流还活着吗」在服务端是不可知的,只有两种确定信息:
//   1. 到了 MAX_STREAM_MS —— 无论死活都收掉;
//   2. **同一个 clientId 又连上来了** —— 一个标签页不会同时读两条流,
//      那么它此前那条一定已经死了,可以精确让位。
//
// 【别再改回「逐出最旧的一条」】那是本轮最初的设计,实测被自己证伪:真正在看的
// 那条连接恰恰是**最旧**的(访客一进来就连上了),而各种短命的探测/重挂载连接都比它新
// ——按"越老越可能被遗弃"逐出,结果每次都精准掐死唯一活着的观众,页面从此不再更新,
// 而那些真正死掉的连接反而留到 MAX_STREAM_MS。启发式在这里是反的,只有 clientId
// 给的是确定信息。
export interface StreamSlot {
  id: number;
  sessionId: string;
  /** 观众标识;未提供 clientId 的调用方(curl / 调试)每条连接都算独立观众 */
  clientId: string | null;
  startedAt: number;
  /** 已收尾但 handler 的 finally 还没跑到;计名额时必须把它当作已释放 */
  ended: boolean;
  /** 令这条流收尾(幂等) */
  end: (reason: EndReason) => void;
}

const slots = new Map<number, StreamSlot>();
let nextSlotId = 1;

/** 容量耗尽;调用方据此回 429。 */
export class StreamCapacityError extends Error {
  constructor(limit: number) {
    super(`concurrent trace stream limit (${limit}) reached`);
    this.name = "StreamCapacityError";
  }
}

/** 同会话已有的流,按开始时间升序(最旧在前)。 */
export function sessionSlots<T extends { sessionId: string; startedAt: number }>(
  all: T[],
  sessionId: string,
): T[] {
  return all.filter((s) => s.sessionId === sessionId).sort((a, b) => a.startedAt - b.startedAt);
}

/**
 * 该让位的旧连接:**同 clientId、且比 `beforeId` 更早**的既有流,不限会话。
 * clientId 缺省时不让位(不认识的调用方之间无从判断谁替代谁)。
 *
 * 【不要再加 `sessionId` 条件】(codex 初审 P1)一个标签页任何时刻只读一条轨迹流,
 * 所以同 clientId 的旧连接一定已经死了——**包括它上一个会话那条**。加上同会话限制的话,
 * 访客在左栏点着看历史会话时,每换一个会话就漏掉一个名额(旧的那条既收不到断开、
 * 又不匹配让位条件),直到 MAX_STREAM_MS 才释放;翻几个会话就能把全站名额耗光。
 *
 * 【`beforeId` 是让位方向的定盘星】(codex 复审 P2)槽位 id 按**请求到达顺序**递增,
 * 只让位比自己更早的那些,于是"新请求赢"这件事与各自的库查询谁先返回无关——
 * 快速切会话时,已经没人读的旧请求即便晚一步跑到这里,也不会反过来把新的那条顶掉。
 */
export function selectSuperseded<T extends { id: number; clientId: string | null }>(
  live: T[],
  clientId: string | null,
  beforeId: number,
): T[] {
  if (!clientId) return [];
  return live.filter((s) => s.clientId === clientId && s.id < beforeId);
}

function liveSlots(): StreamSlot[] {
  return [...slots.values()].filter((s) => !s.ended);
}

/**
 * 判容量时该计入的连接:**排除本客户端稍后会让位的那些旧连接**。
 *
 * 【别拿它们占名额】(codex 复审第 3 轮 P2)让位被挪到会话校验之后以后,容量判定就跑在
 * 让位之前了。若把这些"马上就要释放"的旧连接算进去,同一个标签页在名额打满时连自己
 * 那条都换不回来——重挂载 / 切会话 / 到期续连一律 429,而那条没人读的旧连接还要占到
 * `MAX_STREAM_MS`,于是面板一直连不上。
 */
export function countableSlots<T extends { id: number; clientId: string | null }>(
  live: T[],
  clientId: string | null,
  beforeId: number,
): T[] {
  const replaceable = new Set(selectSuperseded(live, clientId, beforeId).map((s) => s.id));
  return live.filter((s) => !replaceable.has(s.id));
}

/**
 * 登记一个名额并判容量。**只登记,不让位**——让位是 `supersedeOlderStreams` 的事,
 * 它必须等会话校验通过之后才做(见那个函数的注释)。
 * 整段没有 await,并发请求不会双双通过;槽位 id 因此就是请求到达的顺序号。
 */
function acquireSlot(
  sessionId: string,
  clientId: string | null,
  onEnd: (reason: EndReason) => void,
): StreamSlot {
  const slot: StreamSlot = {
    id: nextSlotId++,
    sessionId,
    clientId,
    startedAt: Date.now(),
    ended: false,
    end: (reason) => {
      if (slot.ended) return;
      slot.ended = true;
      onEnd(reason);
    },
  };

  const live = countableSlots(liveSlots(), clientId, slot.id);
  if (live.length >= MAX_TOTAL_STREAMS) throw new StreamCapacityError(MAX_TOTAL_STREAMS);
  // 单会话的公平上限:防一个会话把全站名额吃光(名额只有被遗弃的连接才会长期占着)
  if (sessionSlots(live, sessionId).length >= MAX_STREAMS_PER_SESSION) {
    throw new StreamCapacityError(MAX_STREAMS_PER_SESSION);
  }

  slots.set(slot.id, slot);
  return slot;
}

/**
 * 让同一标签页更早的那些连接退场。
 *
 * 【必须排在会话校验成功之后】(codex 复审第 2 轮 P2)让位是不可逆的:客户端收到
 * `bye{superseded}` 就不再重连。若在校验之前让位,一个 sessionId 已失效(或恰好赶上
 * 库查询失败)的请求会先掐掉那条**健康的**流,自己又建不起来,观众两头落空。
 * 放到校验之后,失败的请求什么都不动,旧流照常活着。
 *
 * 让位只针对 `slot.id` 之前的连接,所以"新请求赢"与库查询谁先返回无关(见
 * `selectSuperseded`);`end()` 同步置 `ended`,名额统计立即生效(handler 的 finally 是异步的)。
 */
function supersedeOlderStreams(slot: StreamSlot): void {
  for (const stale of selectSuperseded(liveSlots(), slot.clientId, slot.id)) {
    console.log(
      `superseding stale trace stream for client ${slot.clientId} ` +
        `(slot ${stale.id}, session ${stale.sessionId})`,
    );
    stale.end("superseded");
  }
}

// —— 回放合并 ——

/**
 * 库内回放与内存缓冲的合并:按 seq 升序、去重、只保留 seq > afterSeq。
 * 两个来源天然重叠(缓冲里的事件可能已经落库),重叠部分必须只发一次。
 */
export function mergeEvents(
  fromDb: TraceEvent[],
  fromBuffer: TraceEvent[],
  afterSeq: number,
): TraceEvent[] {
  const bySeq = new Map<number, TraceEvent>();
  for (const e of fromDb) if (e.seq > afterSeq) bySeq.set(e.seq, e);
  for (const e of fromBuffer) if (e.seq > afterSeq) bySeq.set(e.seq, e);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

// —— 查询参数 ——

export function parseStreamQuery(
  params: URLSearchParams,
): { sessionId: string; afterSeq: number; clientId: string | null } | { error: string } {
  const sessionId = params.get("sessionId");
  if (!sessionId || !UUID_RE.test(sessionId)) return { error: "sessionId must be a UUID" };

  const rawClient = params.get("clientId");
  if (rawClient !== null && !CLIENT_ID_RE.test(rawClient)) {
    return { error: "clientId must be 1-64 chars of [A-Za-z0-9_-]" };
  }
  const clientId = rawClient;

  const raw = params.get("afterSeq");
  if (raw === null || raw === "") return { sessionId, afterSeq: -1, clientId };
  // 走字面量形态而不是 Number():Number(" ") === 0、Number("1e3") === 1000,
  // 这类"能转成数但根本不是十进制整数"的输入不该被静默接受
  if (!/^-?\d+$/.test(raw)) return { error: "afterSeq must be an integer >= -1" };
  const afterSeq = Number(raw);
  if (!Number.isSafeInteger(afterSeq) || afterSeq < -1) {
    return { error: "afterSeq must be an integer >= -1" };
  }
  return { sessionId, afterSeq, clientId };
}

function fail(resp: ServerResponse, status: number, error: string): void {
  resp.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  resp.end(JSON.stringify({ error }));
}

export const stream = api.raw(
  { expose: true, method: "GET", path: "/trace/stream" },
  async (req, resp) => {
    const parsed = parseStreamQuery(new URL(req.url ?? "/", "http://localhost").searchParams);
    if ("error" in parsed) {
      fail(resp, 400, parsed.error);
      return;
    }
    const { sessionId, afterSeq, clientId } = parsed;

    // 收尾闸:唯一能结束这条流的东西(客户端断开探测不到,见文件头注释)
    let endReason: EndReason | null = null;
    let resolveEnd!: () => void;
    const ended = new Promise<void>((resolve) => {
      resolveEnd = resolve;
    });
    const end = (reason: EndReason) => {
      if (endReason) return;
      endReason = reason;
      resolveEnd();
    };

    // 【顺序敏感】登记名额必须排在**第一个 await 之前**(codex 复审第 1 轮 P2)。
    // 放在归属校验之后的话,同一标签页快速切会话(B → C)时两个请求会一起卡在
    // 那次库查询上,谁先返回谁拿到更大的槽位号,让位方向就可能反过来。
    // 提到入口后,槽位号 = 请求到达顺序,让位方向由它定死。
    // 注意这里**只登记不让位**:让位要等会话校验通过(见 supersedeOlderStreams)。
    // 代价:会话不存在时也会先占一下名额,但下面的 finally 立刻释放。
    let slot: StreamSlot;
    try {
      slot = acquireSlot(sessionId, clientId, end);
    } catch (err) {
      if (err instanceof StreamCapacityError) {
        console.warn(err.message);
        fail(resp, 429, "too many open trace streams, try again shortly");
        return;
      }
      throw err;
    }

    // 【顺序敏感】先订阅再读库:反过来的话,两步之间产生的事件既不在库回放里、
    // 也没有被 live 监听接住,会留下一个静默缺口。回放期间 live 事件先压在
    // pending 里,回放发完再放行(任务卡 D6)。
    let lastSeq = afterSeq;
    let replaying = true;
    const pending: TraceEvent[] = [];
    const emit = (e: TraceEvent) => {
      if (e.seq <= lastSeq) return; // 与回放重叠的部分只发一次
      lastSeq = e.seq;
      sse(resp, "trace", e);
    };
    let unsubscribe: (() => void) | undefined;

    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      // 会话必须真实存在**且属于本访客**(运行时会话可能早已回收,历史轨迹仍可回放)。
      // 没带 cookie、cookie 过期、不是本人的会话、以及根本不存在的会话,对调用方
      // 是同一个 404 —— 区分开来等于把会话 id 变成存在性预言机(docs/security.md §6)。
      try {
        const token = readVisitorCookie(req.headers.cookie);
        if (!token || !(await sessionVisibleTo(sessionId, hashVisitorToken(token)))) {
          fail(resp, 404, `session ${sessionId} not found`);
          return;
        }
      } catch (err) {
        console.error(`trace stream session lookup failed: ${safeErrorText(err)}`);
        fail(resp, 500, "internal error");
        return;
      }

      // 会话确实存在,这次连接站得住脚了,才收回本标签页更早的那些连接
      supersedeOlderStreams(slot);

      unsubscribe = subscribe(sessionId, (e) => {
        if (replaying) pending.push(e);
        else emit(e);
      });

      let fromDb: TraceEvent[];
      try {
        fromDb = await listTraceEvents(sessionId, afterSeq, MAX_REPLAY_EVENTS);
      } catch (err) {
        console.error(`trace replay query failed: ${safeErrorText(err)}`);
        fail(resp, 500, "internal error");
        return;
      }

      resp.writeHead(200, SSE_HEADERS);
      for (const e of mergeEvents(fromDb, recent(sessionId, afterSeq), afterSeq)) emit(e);
      sse(resp, "ready", { lastSeq });

      replaying = false;
      for (const e of pending) emit(e);
      pending.length = 0;

      heartbeat = setInterval(() => sseComment(resp, "hb"), HEARTBEAT_MS);
      deadline = setTimeout(() => slot.end("max-duration"), MAX_STREAM_MS);

      await ended;
      sse(resp, "bye", { lastSeq, reason: endReason });
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (deadline) clearTimeout(deadline);
      unsubscribe?.();
      slot.ended = true;
      slots.delete(slot.id);
      // 上面的失败分支已经 fail() 过(writeHead + end),不能再 end 一次
      if (!resp.writableEnded) resp.end();
    }
  },
);
