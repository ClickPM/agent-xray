// R4 轨迹流的纯逻辑测试:查询参数校验、回放/live 去重合并、名额与逐出判定。
// 不起真实 SSE 连接(端点的实测在任务卡「本轮实测」段),这里只锁住那几处
// 顺序/边界敏感的判定——它们出错时的表现都是「静默少一段轨迹」,肉眼看不出来。
import { describe, expect, it } from "vitest";
import {
  countableSlots,
  mergeEvents,
  parseStreamQuery,
  selectSuperseded,
  sessionSlots,
} from "./stream";
import type { TraceEvent } from "../shared/trace-bus";

const SID = "34a7af6f-4cca-4b69-a77b-f8ec8b050822";

const ev = (seq: number, eventType = "message_update"): TraceEvent => ({
  seq,
  eventType,
  mode: "notify",
  timestamp: 1_700_000_000_000 + seq,
  data: { type: eventType },
});

describe("parseStreamQuery", () => {
  const q = (s: string) => parseStreamQuery(new URLSearchParams(s));

  it("缺 sessionId 或非 UUID 一律拒绝", () => {
    expect(q("")).toEqual({ error: "sessionId must be a UUID" });
    expect(q("sessionId=not-a-uuid")).toEqual({ error: "sessionId must be a UUID" });
    expect(q("sessionId=../../etc/passwd")).toEqual({ error: "sessionId must be a UUID" });
  });

  it("afterSeq 缺省/空串为 -1(从头回放)", () => {
    expect(q(`sessionId=${SID}`)).toEqual({ sessionId: SID, afterSeq: -1, clientId: null });
    expect(q(`sessionId=${SID}&afterSeq=`)).toEqual({ sessionId: SID, afterSeq: -1, clientId: null });
  });

  it("clientId 可缺省,提供时必须是 1-64 位 [A-Za-z0-9_-]", () => {
    expect(q(`sessionId=${SID}&clientId=tab-9f3A_1`)).toEqual({
      sessionId: SID,
      afterSeq: -1,
      clientId: "tab-9f3A_1",
    });
    for (const bad of ["", "has space", "sem;colon", "a".repeat(65), "汉字"]) {
      expect(q(`sessionId=${SID}&clientId=${encodeURIComponent(bad)}`), bad).toEqual({
        error: "clientId must be 1-64 chars of [A-Za-z0-9_-]",
      });
    }
  });

  it("afterSeq 必须是 >= -1 的整数", () => {
    expect(q(`sessionId=${SID}&afterSeq=42`)).toEqual({ sessionId: SID, afterSeq: 42, clientId: null });
    expect(q(`sessionId=${SID}&afterSeq=-1`)).toEqual({ sessionId: SID, afterSeq: -1, clientId: null });
    // 「能转成数但不是十进制整数字面量」的输入一律拒绝,不靠 Number() 的宽容:
    // Number(" ") === 0、Number("1e3") === 1000,静默接受这些会让游标语义变形
    for (const bad of ["-2", "1.5", "abc", "NaN", "Infinity", " ", "1,2", "1e3", "0x10", "9".repeat(20)]) {
      expect(q(`sessionId=${SID}&afterSeq=${bad}`), bad).toEqual({
        error: "afterSeq must be an integer >= -1",
      });
    }
  });
});

describe("mergeEvents(库回放 + 内存缓冲)", () => {
  it("重叠部分只出现一次,结果按 seq 升序", () => {
    // 典型形态:库里是已 flush 的 0..3,缓冲里是尚未落库的 2..5(重叠 2、3)
    const merged = mergeEvents([ev(0), ev(1), ev(2), ev(3)], [ev(2), ev(3), ev(4), ev(5)], -1);
    expect(merged.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("缓冲版本覆盖库版本(同 seq 只留一条)", () => {
    const merged = mergeEvents([ev(1, "context")], [ev(1, "turn_start")], -1);
    expect(merged).toHaveLength(1);
    expect(merged[0].eventType).toBe("turn_start");
  });

  it("afterSeq 之前的一律丢弃(断线重连不重发)", () => {
    const merged = mergeEvents([ev(0), ev(1), ev(2)], [ev(3), ev(4)], 2);
    expect(merged.map((e) => e.seq)).toEqual([3, 4]);
  });

  it("乱序输入也能排好序(库取的是最新 N 条,缓冲另有起点)", () => {
    const merged = mergeEvents([ev(5), ev(3)], [ev(4), ev(1)], -1);
    expect(merged.map((e) => e.seq)).toEqual([1, 3, 4, 5]);
  });

  it("两边都空时返回空数组(新会话首次连接)", () => {
    expect(mergeEvents([], [], -1)).toEqual([]);
  });
});

describe("并发名额", () => {
  const slot = (id: number, sessionId: string, clientId: string | null, startedAt: number) => ({
    id,
    sessionId,
    clientId,
    startedAt,
  });

  it("sessionSlots 只挑本会话的,并按开始时间升序(最旧在前)", () => {
    const all = [
      slot(1, "a", null, 300),
      slot(2, "b", null, 100),
      slot(3, "a", null, 100),
      slot(4, "a", null, 200),
    ];
    expect(sessionSlots(all, "a").map((s) => s.id)).toEqual([3, 4, 1]);
    expect(sessionSlots(all, "b").map((s) => s.id)).toEqual([2]);
    expect(sessionSlots(all, "c")).toEqual([]);
  });

  it("只让同 clientId 的旧连接退场,别的观众一律不动", () => {
    const live = [
      slot(1, "a", "tabA", 100),
      slot(2, "a", "tabB", 200), // 同会话,别的观众 —— 不能动
      slot(3, "a", null, 400), // 匿名调用方 —— 不能动
    ];
    expect(selectSuperseded(live, "tabA", 99).map((s) => s.id)).toEqual([1]);
  });

  it("【回归】换会话时也要收回自己那条 —— 让位不看 sessionId", () => {
    // codex 初审 P1:一个标签页任何时刻只读一条轨迹流,它换会话时旧的那条
    // 既收不到断开、又匹配不上"同会话"条件,就会漏一个名额直到 MAX_STREAM_MS。
    const live = [slot(1, "sessionA", "tabA", 100), slot(2, "sessionB", "tabB", 200)];
    expect(selectSuperseded(live, "tabA", 99).map((s) => s.id)).toEqual([1]);
  });

  it("同一观众的多条残留连接一次全部退场", () => {
    const live = [slot(1, "a", "tabA", 100), slot(2, "b", "tabA", 200), slot(3, "a", "tabB", 300)];
    expect(selectSuperseded(live, "tabA", 99).map((s) => s.id)).toEqual([1, 2]);
  });

  it("【回归】只让位比自己更早的槽位 —— 让位方向不受库查询快慢影响", () => {
    // codex 复审第 1 轮 P2:快速切会话时两个请求会一起卡在会话校验上。
    // 槽位号按到达顺序递增,只让位 id 更小的那些,于是无论谁先校验完,
    // 都只会是"新的顶掉旧的",不会反过来。
    const older = slot(10, "sessionB", "tabA", 100); // 先到:用户已经不看了
    const newer = slot(11, "sessionC", "tabA", 200); // 后到:用户真正要看的
    const live = [older, newer];
    // 新的那条来让位 → 顶掉旧的
    expect(selectSuperseded(live, "tabA", newer.id).map((s) => s.id)).toEqual([10]);
    // 旧的那条即便晚一步跑到让位这步,也顶不掉新的
    expect(selectSuperseded(live, "tabA", older.id)).toEqual([]);
  });

  it("没有 clientId 时谁都不让位(匿名调用方之间无从判断谁替代谁)", () => {
    const live = [slot(1, "a", null, 100), slot(2, "a", "tabA", 200)];
    expect(selectSuperseded(live, null, 99)).toEqual([]);
  });

  it("【回归】判容量时不把「本客户端马上要让位的旧连接」算进去", () => {
    // codex 复审第 3 轮 P2:让位挪到会话校验之后,容量判定就跑在让位之前。
    // 若把那条马上要释放的旧连接算进名额,同一标签页在名额打满时连自己那条都换不回来,
    // 只会一直 429 到 MAX_STREAM_MS。
    const mine = slot(10, "a", "tabA", 100); // 本标签页的旧连接:稍后会被让位
    const others = [slot(11, "a", "tabB", 200), slot(12, "b", "tabC", 300)];
    const live = [mine, ...others];

    // 换我自己那条:名额里不算 mine
    expect(countableSlots(live, "tabA", 99).map((s) => s.id)).toEqual([11, 12]);
    // 别的客户端来占名额:mine 照常算数
    expect(countableSlots(live, "tabZ", 99).map((s) => s.id)).toEqual([10, 11, 12]);
    // 匿名调用方不让位,所以谁都不减
    expect(countableSlots(live, null, 99).map((s) => s.id)).toEqual([10, 11, 12]);
    // 只减比自己早的:比我新的同客户端连接不该被当成「马上要释放」
    expect(countableSlots(live, "tabA", 5).map((s) => s.id)).toEqual([10, 11, 12]);
  });

  it("【回归】不再按「最旧」逐出 —— 真正在看的那条恰恰是最旧的", () => {
    // 实测踩过:访客一进来就连上(最旧),各种短命探测连接都比它新;
    // 按最旧逐出等于每次精准掐死唯一活着的观众。换成 clientId 后,
    // 不同观众之间永远不会互相顶掉。
    const viewer = slot(1, "a", "viewer", 100); // 最旧 = 真正在看的
    const probe = slot(2, "a", "probe", 900); // 最新 = 短命探测
    expect(selectSuperseded([viewer, probe], "probe", 99).map((s) => s.id)).toEqual([2]);
    expect(selectSuperseded([viewer, probe], "viewer", 99).map((s) => s.id)).toEqual([1]);
  });
});
