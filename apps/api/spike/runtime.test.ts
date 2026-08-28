// R2 adversarial review 整改回归:待落库队列(pendingFlush)与展示数组解耦后的
// flush 语义——排干入库 / 失败整批退回重试 / 硬上限显式丢弃。不触碰 pi SDK
// (fake record,runtime.ts 对 pi 仅 type import + 惰性动态 import)。
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSession, listTraceEvents } from "../agent/store";
import {
  flushTraceEvents,
  queuePendingEvent,
  PENDING_FLUSH_MAX,
  type CapturedEvent,
  type SpikeSessionRecord,
} from "./runtime";

function fakeRec(id: string): SpikeSessionRecord {
  return {
    id,
    session: undefined as unknown as SpikeSessionRecord["session"],
    createdAt: Date.now(),
    disposed: false,
    persisted: false, // 不触发水位自动 flush;测试显式调 flushTraceEvents
    seq: 0,
    pendingFlush: [],
    flushChain: Promise.resolve(),
    flushQueued: false,
    events: [],
    listeners: new Set(),
    subscribed: [],
    subscribeErrors: [],
  };
}

const ev = (seq: number): CapturedEvent => ({
  seq,
  eventType: "agent_start",
  mode: "notify",
  timestamp: Date.now(),
  data: { type: "agent_start" },
});

describe("轨迹待落库队列(adversarial review 整改)", () => {
  it("flush 排干队列并入库,按 seq 有序", async () => {
    const s = await createSession();
    const rec = fakeRec(s.id);
    rec.pendingFlush.push(ev(0), ev(1), ev(2));

    await flushTraceEvents(rec);

    expect(rec.pendingFlush).toHaveLength(0);
    expect((await listTraceEvents(s.id)).map((e) => e.seq)).toEqual([0, 1, 2]);
  });

  it("写库失败整批退回队首,恢复后重试成功且不重复", async () => {
    const rec = fakeRec(randomUUID()); // 无会话行 → 外键失败
    rec.pendingFlush.push(ev(0), ev(1), ev(2));

    await expect(flushTraceEvents(rec)).rejects.toThrow();
    expect(rec.pendingFlush.map((e) => e.seq)).toEqual([0, 1, 2]); // 不丢

    await createSession(rec.id); // 「库恢复」
    rec.pendingFlush.push(ev(3)); // 故障期间继续产生的事件排在退回批之后
    await flushTraceEvents(rec);

    expect(rec.pendingFlush).toHaveLength(0);
    expect((await listTraceEvents(rec.id)).map((e) => e.seq)).toEqual([0, 1, 2, 3]);
  });

  it("队列硬上限:超限丢最旧,长度有界", () => {
    const rec = fakeRec(randomUUID());
    const overflow = 10;
    for (let i = 0; i < PENDING_FLUSH_MAX + overflow; i++) queuePendingEvent(rec, ev(i));

    expect(rec.pendingFlush).toHaveLength(PENDING_FLUSH_MAX);
    expect(rec.pendingFlush[0].seq).toBe(overflow); // 最旧的 overflow 条被显式丢弃
    expect(rec.pendingFlush[rec.pendingFlush.length - 1].seq).toBe(PENDING_FLUSH_MAX + overflow - 1);
  });
});
