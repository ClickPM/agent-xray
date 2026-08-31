// 进程内轨迹事件总线(R4):agent 服务的观测者扩展是生产者,trace 服务的
// `GET /trace/stream` 是消费者。放在中立的 `shared/` 而不是任一服务目录里,
// 是为了让两个服务都只依赖这个叶子模块,谁都不 import 对方的内部实现
// (任务卡 D2)。本文件不含任何 Encore 基础设施声明,因此不会被推导成服务。
//
// 为什么需要 buffer:轨迹事件只在水位 500 或每轮收尾时才批量落库
// (`agent/runtime.ts`),单靠库回放会整段漏掉「当前正在进行的这一轮」。
// 每个会话保留一小段最近事件,连接建立时用它补齐库与 live 之间的接缝
// (任务卡 D6)。事件在**采集时**就已脱敏(`agent/events.ts`),
// 总线只搬运、不加工——库里与总线里都不可能存在原文(任务卡 D5)。

/** 与 `agent/runtime.ts` 的 `CapturedEvent` 结构兼容(mode 在那边是更窄的联合类型)。 */
export interface TraceEvent {
  seq: number;
  eventType: string;
  mode: string;
  /** epoch ms */
  timestamp: number;
  data: unknown;
}

export type TraceListener = (event: TraceEvent) => void;

/**
 * 每会话保留的最近事件条数。单事件在 `events.ts` 已被硬限到 8KB,实测典型
 * 事件仅几百字节;并发会话上限 8(`MAX_ACTIVE_SESSIONS`),故最坏情况有界。
 * 取值只需覆盖「两次 flush 之间」的窗口(flush 水位 500),1000 留了一倍余量。
 */
export const MAX_BUFFERED_EVENTS = 1000;

interface SessionEntry {
  buffer: TraceEvent[];
  listeners: Set<TraceListener>;
}

const sessions = new Map<string, SessionEntry>();

function entryFor(sessionId: string): SessionEntry {
  let entry = sessions.get(sessionId);
  if (!entry) {
    entry = { buffer: [], listeners: new Set() };
    sessions.set(sessionId, entry);
  }
  return entry;
}

/** 条目既没有缓冲也没有订阅者时回收,避免 Map 随会话数无限增长。 */
function dropIfEmpty(sessionId: string, entry: SessionEntry): void {
  if (entry.buffer.length === 0 && entry.listeners.size === 0) sessions.delete(sessionId);
}

/**
 * 发布一条事件:进 ring buffer,并同步分发给当前订阅者。
 * 单个订阅者抛错不得影响其他订阅者与生产者——SSE 写出侧已对「连接已结束」
 * 做了保护(`shared/sse.ts`),这里只兜住意料外的异常。
 */
export function publish(sessionId: string, event: TraceEvent): void {
  const entry = entryFor(sessionId);
  entry.buffer.push(event);
  if (entry.buffer.length > MAX_BUFFERED_EVENTS) {
    entry.buffer.splice(0, entry.buffer.length - MAX_BUFFERED_EVENTS);
  }
  // 快照后再分发:订阅者在回调里退订不会打乱本次遍历
  for (const listener of [...entry.listeners]) {
    try {
      listener(event);
    } catch (err) {
      console.error(`trace bus listener failed for session ${sessionId}:`, err instanceof Error ? err.name : typeof err);
    }
  }
}

/** 订阅会话的 live 事件;返回退订函数(重复调用无副作用)。 */
export function subscribe(sessionId: string, listener: TraceListener): () => void {
  const entry = entryFor(sessionId);
  entry.listeners.add(listener);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    entry.listeners.delete(listener);
    dropIfEmpty(sessionId, entry);
  };
}

/** 缓冲区里 seq 大于 afterSeq 的事件(按 seq 升序);会话未知时返回空数组。 */
export function recent(sessionId: string, afterSeq = -1): TraceEvent[] {
  const entry = sessions.get(sessionId);
  if (!entry) return [];
  return entry.buffer.filter((e) => e.seq > afterSeq);
}

/**
 * 会话释放时丢掉缓冲。**调用点必须排在最终 flush 之后**
 * (`agent/runtime.ts` 的 `disposeSession`):否则会出现「库里还没写、
 * buffer 已经清空」的空窗,这期间连上来的客户端会缺一段轨迹(任务卡 D6)。
 * 仍有订阅者时只清缓冲、保留条目,让退订路径负责回收。
 */
export function dropSession(sessionId: string): void {
  const entry = sessions.get(sessionId);
  if (!entry) return;
  entry.buffer.length = 0;
  dropIfEmpty(sessionId, entry);
}

/** 测试用:观察内部规模,不参与业务逻辑。 */
export function bufferedSessionCount(): number {
  return sessions.size;
}
