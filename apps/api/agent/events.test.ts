// 脱敏自测 fixtures 正式测试(R1 建立 → R2 转 encore test → R3 随 events.ts
// 迁入 agent 服务)。fixtures 本体在 events.ts。
import { describe, expect, it } from "vitest";
import { ALL_EVENTS, modeCounts, runSanitizeSelfTests, sanitizeEvent } from "./events";

describe("事件脱敏(docs/security.md §2)", () => {
  it("七组凭据/超大对象 fixtures 全部 PASS", () => {
    const results = runSanitizeSelfTests();
    expect(results).toHaveLength(7);
    for (const r of results) {
      expect(r.pass, `${r.name} — ${r.detail}`).toBe(true);
    }
  });

  it("34 事件 × 四模式计数与 docs/architecture.md 一致", () => {
    expect(ALL_EVENTS).toHaveLength(34);
    expect(modeCounts()).toEqual({ notify: 19, veto: 6, chain: 7, takeover: 2, total: 34 });
  });
});

describe("派生字段 handlers(R-SKILLS-2:谁裁决谁记录)", () => {
  const block = [{ extension: "xray-guard", returned: { block: true, reason: "脚本 rm.py 不在清单里" } }];

  it("tool_call / before_agent_start 透出 handlers 摘要;其它事件即使传了也不透出;不传就没有这个字段", () => {
    const tc = sanitizeEvent("tool_call", { type: "tool_call", toolCallId: "c1", toolName: "skill_run", input: { skill: "x" } }, block) as Record<string, unknown>;
    expect(tc.handlers).toEqual(block);
    expect(tc.inputPreview).toBeDefined();
    const bas = sanitizeEvent(
      "before_agent_start",
      { type: "before_agent_start", prompt: "hi", systemPrompt: "SECRET-SYSTEM-PROMPT-9" },
      [{ extension: "xray-skills", returned: { systemPromptDelta: 12, skills: ["a"] } }],
    ) as Record<string, unknown>;
    expect(bas.handlers).toEqual([{ extension: "xray-skills", returned: { systemPromptDelta: 12, skills: ["a"] } }]);
    expect(JSON.stringify(bas)).not.toContain("SECRET-SYSTEM-PROMPT-9"); // systemPrompt 原文本来就不在白名单
    const other = sanitizeEvent("agent_start", { type: "agent_start" }, block) as Record<string, unknown>;
    expect(other).not.toHaveProperty("handlers");
    const none = sanitizeEvent("tool_call", { type: "tool_call", toolName: "x" }) as Record<string, unknown>;
    expect(none).not.toHaveProperty("handlers");
  });

  it("returned 为 undefined 时不出现 returned 键(放行 / 未注入),扩展名截到 64", () => {
    const tc = sanitizeEvent("tool_call", { type: "tool_call", toolName: "x" }, [{ extension: "e".repeat(100), returned: undefined }]) as {
      handlers: Array<Record<string, unknown>>;
    };
    expect(tc.handlers[0]).toEqual({ extension: "e".repeat(64) });
    expect(tc.handlers[0]).not.toHaveProperty("returned");
  });

  it("returned 仍过 sanitizeValue:凭据键置 [redacted]、长串截断;整体仍受 MAX_EVENT_BYTES", () => {
    const tc = sanitizeEvent("tool_call", { type: "tool_call", toolName: "x" }, [
      { extension: "g", returned: { block: true, reason: "r".repeat(1000), apiKey: "sk-should-not-leak-0123456789" } },
    ]) as { handlers: Array<{ returned: Record<string, unknown> }> };
    expect(tc.handlers[0].returned.apiKey).toBe("[redacted]");
    expect(String(tc.handlers[0].returned.reason).length).toBeLessThan(1000);
    expect(JSON.stringify(tc).length).toBeLessThanOrEqual(8_192);
  });
});
