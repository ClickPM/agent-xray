// 脱敏自测 fixtures 正式测试(R1 建立 → R2 转 encore test → R3 随 events.ts
// 迁入 agent 服务)。fixtures 本体在 events.ts。
import { describe, expect, it } from "vitest";
import { ALL_EVENTS, modeCounts, runSanitizeSelfTests } from "./events";

describe("事件脱敏(docs/security.md §2)", () => {
  it("六组凭据/超大对象 fixtures 全部 PASS", () => {
    const results = runSanitizeSelfTests();
    expect(results).toHaveLength(6);
    for (const r of results) {
      expect(r.pass, `${r.name} — ${r.detail}`).toBe(true);
    }
  });

  it("34 事件 × 四模式计数与 docs/architecture.md 一致", () => {
    expect(ALL_EVENTS).toHaveLength(34);
    expect(modeCounts()).toEqual({ notify: 19, veto: 6, chain: 7, takeover: 2, total: 34 });
  });
});
