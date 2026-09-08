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

describe("R-LEAK · model_select 不带 provider / model(docs/security.md §2 R-LEAK 补记)", () => {
  // 值级断言:泄的从来不是 `provider` 这个键名,而是它的**值**。
  // 这里给一个比 pi 的 `Model` 更「胖」的对象(多带 baseUrl / apiKey),白名单之外一个都不许出去。
  const model = {
    provider: "LEAK-PROVIDER-1",
    id: "LEAK-MODEL-ID-2",
    name: "LEAK-MODEL-NAME-3",
    baseUrl: "https://LEAK-HOST-4.example",
    apiKey: "sk-LEAK-KEY-5-0123456789",
  };

  it("键集合恰为 {type, source};四个配置值深度都找不到", () => {
    const out = sanitizeEvent("model_select", {
      type: "model_select",
      model,
      previousModel: { ...model, id: "LEAK-PREV-ID-6" },
      source: "set",
    }) as Record<string, unknown>;

    expect(Object.keys(out).sort()).toEqual(["source", "type"]);
    expect(out.source).toBe("set");
    const s = JSON.stringify(out);
    for (const leaked of [...Object.values(model), "LEAK-PREV-ID-6"]) {
      expect(s, `泄了 ${leaked}`).not.toContain(leaked);
    }
  });

  it("source 是闭集(set / cycle / restore),仍照原样透出 —— 事件行本身没被删掉", () => {
    for (const source of ["set", "cycle", "restore"]) {
      const out = sanitizeEvent("model_select", { type: "model_select", model, source }) as Record<string, unknown>;
      expect(out).toEqual({ type: "model_select", source });
    }
  });
});
