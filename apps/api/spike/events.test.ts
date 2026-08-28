// R1 脱敏自测 fixtures 转正式测试(rounds/BACKLOG.md 条目,R2 测试基建落地)。
// fixtures 本体仍在 events.ts(/spike/events/audit 也在用);R4 正式 sanitize
// 迁往 trace 服务时本测试随迁。
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
