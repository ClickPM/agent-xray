// R-SKILLS-2 验收 ⑧:注入轨迹 —— before_agent_start 的 handlers 含 xray-skills 与 skills 列表,systemPromptDelta > 0;
// 可用集合为空时不注入且 handlers 记 returned: undefined。不起 pi,用假 ExtensionAPI 驱动。
import { describe, expect, it } from "vitest";
import { AGENT_SKILLS } from "../shared/skills.generated";
import type { HandlerRecord } from "./guard";
import { makeSkillInjector, renderAvailableSkills, SKILLS_EXTENSION } from "./skill-injector";
import { emptySkills, type AvailableSkills } from "./skills-catalog";

const textTools = AGENT_SKILLS.find((s) => s.name === "text-tools")!;
const encoreApi = AGENT_SKILLS.find((s) => s.name === "encore-api")!;
const SKILLS: AvailableSkills = { skills: [encoreApi, textTools], fingerprint: "fp", dropped: [] };

function fakePi() {
  const handlers = new Map<string, (event: unknown) => unknown>();
  return {
    api: { on: (name: string, h: (event: unknown) => unknown) => handlers.set(name, h) },
    call: (name: string, event: unknown) => handlers.get(name)!(event),
    names: () => [...handlers.keys()],
  };
}

describe("<available_skills> 目录文本(纯函数)", () => {
  it("列出名字与描述;canRun 时列脚本;只有名字 / 描述 / 脚本名,没有正文", () => {
    const text = renderAvailableSkills(SKILLS.skills, { canLoad: true, canRun: true });
    expect(text.startsWith("<available_skills>")).toBe(true);
    expect(text.endsWith("</available_skills>")).toBe(true);
    expect(text).toContain("- encore-api: ");
    expect(text).toContain("- text-tools: ");
    expect(text).toContain("script wordfreq.py");
    expect(text).toContain("skill_load(name)");
    // 正文不进目录(几千字的 SKILL.md 不该每轮都占 token)
    expect(text).not.toContain("## Instructions");
    expect(text.length).toBeLessThan(1500);
  });

  it("不能运行时不列脚本,并说明本会话不能运行脚本", () => {
    const text = renderAvailableSkills(SKILLS.skills, { canLoad: true, canRun: false });
    expect(text).not.toContain("script wordfreq.py");
    expect(text).toContain("不能运行脚本");
  });

  it("空集合、或两个工具都没注册 → 空串(不注入)", () => {
    expect(renderAvailableSkills([], { canLoad: true, canRun: true })).toBe("");
    expect(renderAvailableSkills(SKILLS.skills, { canLoad: false, canRun: false })).toBe("");
  });
});

describe("注入扩展(makeSkillInjector)", () => {
  it("只订阅 before_agent_start;返回追加后的 systemPrompt;handlers 记 systemPromptDelta 与 skills(验收 ⑧)", () => {
    const captured: Array<{ eventType: string; handlers: HandlerRecord[] }> = [];
    const pi = fakePi();
    makeSkillInjector({ skills: SKILLS, canLoad: true, canRun: true }, (eventType, _e, handlers) =>
      captured.push({ eventType, handlers }),
    ).factory(pi.api as never);
    expect(pi.names()).toEqual(["before_agent_start"]);

    const base = "BASE PROMPT";
    const result = pi.call("before_agent_start", { type: "before_agent_start", prompt: "hi", systemPrompt: base }) as {
      systemPrompt: string;
    };
    expect(result.systemPrompt.startsWith(base)).toBe(true);
    expect(result.systemPrompt).toContain("<available_skills>");
    expect(captured).toHaveLength(1);
    expect(captured[0].eventType).toBe("before_agent_start");
    const [h] = captured[0].handlers;
    expect(h.extension).toBe(SKILLS_EXTENSION);
    const returned = h.returned as { systemPromptDelta: number; skills: string[] };
    expect(returned.systemPromptDelta).toBeGreaterThan(0);
    expect(returned.systemPromptDelta).toBe(result.systemPrompt.length - base.length);
    expect(returned.skills).toEqual(["encore-api", "text-tools"]);
    // 摘要里没有提示词原文
    expect(JSON.stringify(returned)).not.toContain("<available_skills>");
  });

  it("每轮幂等:两次调用各自基于本轮的 base 追加,不累积", () => {
    const pi = fakePi();
    makeSkillInjector({ skills: SKILLS, canLoad: true, canRun: false }, () => {}).factory(pi.api as never);
    const a = pi.call("before_agent_start", { type: "before_agent_start", prompt: "1", systemPrompt: "B" }) as { systemPrompt: string };
    const b = pi.call("before_agent_start", { type: "before_agent_start", prompt: "2", systemPrompt: "B" }) as { systemPrompt: string };
    expect(a.systemPrompt).toBe(b.systemPrompt);
    expect(a.systemPrompt.split("<available_skills>")).toHaveLength(2);
  });

  it("可用集合为空:返回 undefined(不改提示词),handlers 记 returned: undefined", () => {
    const captured: HandlerRecord[][] = [];
    const pi = fakePi();
    makeSkillInjector({ skills: emptySkills(), canLoad: true, canRun: true }, (_t, _e, handlers) => captured.push(handlers)).factory(
      pi.api as never,
    );
    expect(pi.call("before_agent_start", { type: "before_agent_start", prompt: "x", systemPrompt: "B" })).toBeUndefined();
    expect(captured[0]).toEqual([{ extension: SKILLS_EXTENSION, returned: undefined }]);
  });
});
