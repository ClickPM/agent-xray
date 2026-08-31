// R4 轨迹流客户端:`GET /api/trace/stream` 的 SSE 消费 + 断线续读。
//
// 【为什么必须自动重连】服务端拿不到客户端断开信号(Encore 网关不传导,R3/R4 两次
// 实测),所以每条流都有 `MAX_STREAM_MS` 硬上界,到点服务端会主动发 `bye` 收尾。
// 也就是说「流被关掉」是**正常路径**而不是异常,客户端凭 `afterSeq` 接着读即可。
import type { EventMode, TraceEvent } from "./types";
import { sseFrames } from "./sse-parse";

const API_BASE = "/api";

export interface TraceStreamHandlers {
  /** 一条轨迹事件(按 seq 严格递增到达) */
  onEvent: (event: TraceEvent) => void;
  /** 回放结束、进入 live;lastSeq 是回放到的位置 */
  onReady?: (lastSeq: number) => void;
}

/**
 * 观众标识:同一标签页在多次重连之间保持不变,服务端据此精确收回本标签页
 * 上一条已死的连接(它探测不到断开,只能靠这个,见 apps/api/trace/stream.ts)。
 *
 * 存 sessionStorage 而不是内存或 localStorage,是因为它的生命周期最接近
 * 「一个标签页」:刷新后还在(重连时能收回自己那条名额),标签页关掉即消失,
 * 同一浏览器的两个标签页各算一个观众。
 *
 * 【已知边界:浏览器「复制标签页」会连 sessionStorage 一起复制】(codex 复审 P2)
 * 那两个标签页会共用同一个 id,于是后开的那个一连上就把先前那个让位掉,先前那个
 * 收到 `superseded` 后不再重连,面板停更(刷新或切会话可恢复)。
 * **权衡后保留现状**:改成"每次页面加载生成一个新 id"确实能避开复制标签页,
 * 但会把代价换成更常见的动作——每刷新一次就漏一个名额到 5 分钟超时,连刷几次
 * 就把本会话的名额吃光。要两头都占住得引入「连接代次」这类协议字段,属机制类
 * 改动,按 CLAUDE.md 不在非阻塞 findings 的整改范围内。已记 rounds/BACKLOG.md。
 */
const CLIENT_ID_KEY = "xray-trace-client";
let memoryClientId: string | null = null;

function clientId(): string {
  if (memoryClientId) return memoryClientId;
  const fresh = `t${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  try {
    const saved = window.sessionStorage.getItem(CLIENT_ID_KEY);
    if (saved) {
      memoryClientId = saved;
      return saved;
    }
    window.sessionStorage.setItem(CLIENT_ID_KEY, fresh);
  } catch {
    // 隐私模式 / 存储被禁:退回进程内 id,只是刷新后拿不回旧名额
  }
  memoryClientId = fresh;
  return fresh;
}

/** 重连退避:立即 → 1s → 2s → 5s → 10s 封顶。 */
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000];
const backoff = (attempt: number) => BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toEvent(raw: unknown): TraceEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.seq !== "number" || typeof e.eventType !== "string") return null;
  return {
    seq: e.seq,
    eventType: e.eventType,
    mode: (e.mode as EventMode) ?? "notify",
    timestamp: typeof e.timestamp === "number" ? e.timestamp : 0,
    data: e.data,
  };
}

/**
 * 订阅某会话的轨迹流,返回关闭函数(幂等)。
 * 先回放该会话已有轨迹(库 + 内存缓冲),再转 live tail。
 */
export function openTraceStream(sessionId: string, handlers: TraceStreamHandlers): () => void {
  const controller = new AbortController();
  const client = clientId();
  let closed = false;
  let afterSeq = -1;
  let attempt = 0;

  const run = async () => {
    while (!closed) {
      let immediate = false;
      try {
        const resp = await fetch(
          `${API_BASE}/trace/stream?sessionId=${encodeURIComponent(sessionId)}` +
            `&afterSeq=${afterSeq}&clientId=${encodeURIComponent(client)}`,
          { signal: controller.signal, headers: { Accept: "text/event-stream" } },
        );

        // 会话不存在或参数不合法:重连不会好转,直接停
        if (resp.status === 404 || resp.status === 400) {
          console.error(`trace stream refused (${resp.status}) for session ${sessionId}`);
          return;
        }
        if (resp.status === 429) {
          // 服务端并发流已满:退避久一点再试,别加剧拥塞
          attempt = Math.max(attempt, 2);
          throw new Error("trace stream at capacity");
        }
        if (!resp.ok || !resp.body) throw new Error(`trace stream failed (${resp.status})`);

        attempt = 0;
        for await (const frame of sseFrames(resp.body)) {
          if (frame.event === "trace") {
            const event = toEvent(JSON.parse(frame.data));
            if (!event) continue;
            afterSeq = event.seq;
            handlers.onEvent(event);
          } else if (frame.event === "ready") {
            handlers.onReady?.((JSON.parse(frame.data) as { lastSeq: number }).lastSeq);
          } else if (frame.event === "bye") {
            const { reason } = JSON.parse(frame.data) as { reason: string };
            // superseded:本标签页已经开了更新的一条(重挂载/刷新),这条是残留,退场
            if (reason === "superseded") return;
            immediate = true; // max-duration 是正常收尾,立刻续上
            break;
          }
        }
      } catch (err) {
        if (closed || controller.signal.aborted) return;
        console.error("trace stream interrupted:", err);
      }
      if (closed) return;
      if (!immediate) await sleep(backoff(attempt++));
    }
  };

  void run();

  return () => {
    if (closed) return;
    closed = true;
    controller.abort();
  };
}
