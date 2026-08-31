// R4 进程内事件总线的纯逻辑测试:环形缓冲上界、afterSeq 切片、订阅/退订、
// dropSession 的回收语义。总线是「库回放」与「live 推送」之间那道接缝的关键,
// 缓冲丢早了会留下静默的轨迹缺口(任务卡 D6)。
import { describe, expect, it } from "vitest";
import {
  bufferedSessionCount,
  dropSession,
  publish,
  recent,
  subscribe,
  MAX_BUFFERED_EVENTS,
  type TraceEvent,
} from "./trace-bus";

let idCounter = 0;
/** 每个用例独立 sessionId:总线是模块级单例,用例之间不能互相污染。 */
const newId = () => `bus-test-${++idCounter}`;

const ev = (seq: number): TraceEvent => ({
  seq,
  eventType: "message_update",
  mode: "notify",
  timestamp: 1_700_000_000_000 + seq,
  data: { type: "message_update" },
});

describe("trace bus", () => {
  it("recent 只返回 seq 大于 afterSeq 的事件,且按 seq 升序", () => {
    const id = newId();
    for (const s of [0, 1, 2, 3, 4]) publish(id, ev(s));

    expect(recent(id).map((e) => e.seq)).toEqual([0, 1, 2, 3, 4]);
    expect(recent(id, 2).map((e) => e.seq)).toEqual([3, 4]);
    expect(recent(id, 99)).toEqual([]);
    dropSession(id);
  });

  it("未知会话 recent 返回空数组,且不会凭空建条目", () => {
    const before = bufferedSessionCount();
    expect(recent(newId())).toEqual([]);
    expect(bufferedSessionCount()).toBe(before);
  });

  it("缓冲超上界时丢最旧,保留最近 MAX_BUFFERED_EVENTS 条", () => {
    const id = newId();
    const total = MAX_BUFFERED_EVENTS + 50;
    for (let s = 0; s < total; s++) publish(id, ev(s));

    const buffered = recent(id);
    expect(buffered).toHaveLength(MAX_BUFFERED_EVENTS);
    expect(buffered[0].seq).toBe(50);
    expect(buffered[buffered.length - 1].seq).toBe(total - 1);
    dropSession(id);
  });

  it("订阅者收到 publish 之后的事件,退订后不再收到", () => {
    const id = newId();
    const seen: number[] = [];
    const off = subscribe(id, (e) => seen.push(e.seq));

    publish(id, ev(0));
    publish(id, ev(1));
    off();
    publish(id, ev(2));

    expect(seen).toEqual([0, 1]);
    dropSession(id);
  });

  it("多个订阅者各收一份;单个订阅者抛错不影响其他订阅者与生产者", () => {
    const id = newId();
    const good: number[] = [];
    const offBad = subscribe(id, () => {
      throw new Error("listener boom");
    });
    const offGood = subscribe(id, (e) => good.push(e.seq));

    expect(() => publish(id, ev(7))).not.toThrow();
    expect(good).toEqual([7]);
    // 生产者侧照常入缓冲
    expect(recent(id).map((e) => e.seq)).toEqual([7]);

    offBad();
    offGood();
    dropSession(id);
  });

  it("订阅者在回调里退订不会打乱本次分发", () => {
    const id = newId();
    const seen: number[] = [];
    let off2 = () => {};
    const off1 = subscribe(id, (e) => {
      seen.push(e.seq);
      off2(); // 分发途中退订另一个订阅者
    });
    off2 = subscribe(id, (e) => seen.push(e.seq * 100));

    publish(id, ev(1));
    expect(seen).toEqual([1, 100]); // 快照遍历:本次两个都收到

    seen.length = 0;
    publish(id, ev(2));
    expect(seen).toEqual([2]); // 下一次只剩一个

    off1();
    dropSession(id);
  });

  it("dropSession 清空缓冲;没有订阅者时条目被回收", () => {
    const id = newId();
    publish(id, ev(0));
    const withEntry = bufferedSessionCount();

    dropSession(id);
    expect(recent(id)).toEqual([]);
    expect(bufferedSessionCount()).toBe(withEntry - 1);
  });

  it("仍有订阅者时 dropSession 保留条目,退订后才回收", () => {
    const id = newId();
    const off = subscribe(id, () => {});
    publish(id, ev(0));
    const withEntry = bufferedSessionCount();

    dropSession(id);
    expect(bufferedSessionCount()).toBe(withEntry); // 订阅者还在,条目保留
    expect(recent(id)).toEqual([]); // 但缓冲已清

    off();
    expect(bufferedSessionCount()).toBe(withEntry - 1);
  });

  it("重复退订无副作用(不会误删后来者的条目)", () => {
    const id = newId();
    const off = subscribe(id, () => {});
    off();
    const after = bufferedSessionCount();

    const off2 = subscribe(id, () => {});
    off(); // 重复调用旧的退订函数
    expect(bufferedSessionCount()).toBe(after + 1); // 新订阅仍在

    off2();
  });
});
