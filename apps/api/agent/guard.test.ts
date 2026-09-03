// R-SKILLS-2 验收 ⑥:守卫五条规则逐条 + 异常即拦截 + 计数;验收 ⑦ 的一半(tool_call 事件里的 handlers 形状)。
// 不起 pi:`decideToolCall` 是纯函数,`makeGuard` 用一个只收集 handler 的假 ExtensionAPI 驱动。
// 经 `dev.ps1 test`(encore test)运行,CLAUDE.md 规则 2。
import { describe, expect, it } from "vitest";
import { AGENT_SKILLS } from "../shared/skills.generated";
import {
  decideToolCall,
  GUARD_EXTENSION,
  makeGuard,
  MAX_RUNS_PER_SESSION,
  MAX_RUNS_PER_TURN,
  type GuardContext,
  type GuardCounters,
  type HandlerRecord,
} from "./guard";
import type { AvailableSkills } from "./skills-catalog";
import { SKILL_LOAD_TOOL, SKILL_RUN_TOOL } from "./tool-names";

const textTools = AGENT_SKILLS.find((s) => s.name === "text-tools")!;
const encoreApi = AGENT_SKILLS.find((s) => s.name === "encore-api")!;

const SKILLS: AvailableSkills = { skills: [encoreApi, textTools], fingerprint: "fp", dropped: [] };
const CTX: GuardContext = {
  toolNames: ["notes_search", SKILL_LOAD_TOOL, SKILL_RUN_TOOL],
  skills: SKILLS,
};
const fresh = (): GuardCounters => ({ turnRuns: 0, sessionRuns: 0 });
const goodInput = JSON.stringify({ text: "agent loop agent", top: 3 });

describe("守卫五条规则(验收 ⑥)", () => {
  it("1. 不在白名单的工具 → 拦", () => {
    const d = decideToolCall({ toolName: "bash", input: { command: "rm -rf /" } }, CTX, fresh());
    expect(d).toEqual({ block: true, reason: expect.stringContaining("bash") });
    expect(d!.reason).toContain("白名单");
  });

  it("白名单里的非 skill 工具 → 放行(返回 undefined)", () => {
    expect(decideToolCall({ toolName: "notes_search", input: { query: "x" } }, CTX, fresh())).toBeUndefined();
  });

  it("2. skill_load / skill_run 的 skill 不在可用集合 → 拦,reason 列出可用的", () => {
    const a = decideToolCall({ toolName: SKILL_LOAD_TOOL, input: { name: "encore-database" } }, CTX, fresh());
    expect(a?.block).toBe(true);
    expect(a?.reason).toContain("未对 agent 开放");
    expect(a?.reason).toContain("text-tools");
    const b = decideToolCall({ toolName: SKILL_RUN_TOOL, input: { skill: "nope", script: "x.py", input: "{}" } }, CTX, fresh());
    expect(b?.block).toBe(true);
    // 不是字符串的 skill 名也走同一条
    const c = decideToolCall({ toolName: SKILL_RUN_TOOL, input: { skill: { x: 1 }, script: "x.py", input: "{}" } }, CTX, fresh());
    expect(c?.block).toBe(true);
  });

  it("skill_load 可用 skill → 放行", () => {
    expect(decideToolCall({ toolName: SKILL_LOAD_TOOL, input: { name: "encore-api" } }, CTX, fresh())).toBeUndefined();
  });

  it("3. skill_run:script 不在 xray.json → 拦(任务卡可证伪 ③:scripts/rm.py)", () => {
    for (const script of ["rm.py", "scripts/rm.py", "../runner.py", "wordfreq", ""]) {
      const d = decideToolCall({ toolName: SKILL_RUN_TOOL, input: { skill: "text-tools", script, input: goodInput } }, CTX, fresh());
      expect(d?.block, script).toBe(true);
      expect(d?.reason).toContain("可运行清单");
      expect(d?.reason).toContain("wordfreq.py");
    }
    // 注入型 skill 没有脚本:同样拦,理由说清
    const d = decideToolCall({ toolName: SKILL_RUN_TOOL, input: { skill: "encore-api", script: "x.py", input: "{}" } }, CTX, fresh());
    expect(d?.reason).toContain("没有可运行脚本");
  });

  it("3. skill_run:input 不是 JSON 对象 / 不过 schema / 超长 / 含控制字符 → 拦,reason 写清哪一项", () => {
    const run = (input: unknown) =>
      decideToolCall({ toolName: SKILL_RUN_TOOL, input: { skill: "text-tools", script: "wordfreq.py", input } }, CTX, fresh());
    expect(run("not json")?.reason).toContain("不是合法 JSON");
    expect(run("[1,2]")?.reason).toContain("JSON 对象");
    expect(run("42")?.reason).toContain("JSON 对象");
    expect(run(JSON.stringify({ top: 3 }))?.reason).toContain("必填字段 text");
    expect(run(JSON.stringify({ text: "a", top: 999 }))?.reason).toContain("top 不能大于 50");
    expect(run(JSON.stringify({ text: "a", top: 1.5 }))?.reason).toContain("top 必须是整数");
    expect(run(JSON.stringify({ text: 123 }))?.reason).toContain("text 必须是字符串");
    expect(run(JSON.stringify({ text: "a", extra: 1 }))?.reason).toContain("未声明的字段 extra");
    expect(run(JSON.stringify({ text: "x".repeat(4001) }))?.reason).toContain("超过 4000");
    expect(run(`{"text":"${"y".repeat(5000)}"}`)?.reason).toContain("超过 4096 字符");
    expect(run(`{"text":"a${String.fromCharCode(1)}b"}`)?.reason).toContain("控制字符");
    expect(run({ text: "object not string" })?.reason).toContain("JSON 对象文本");
    expect(run(undefined)?.reason).toContain("JSON 对象文本");
  });

  it("reason 里不含内部路径 / socket / 超时数字", () => {
    const reasons: string[] = [];
    const cases: Array<{ toolName: string; input: unknown }> = [
      { toolName: "bash", input: {} },
      { toolName: SKILL_RUN_TOOL, input: { skill: "x", script: "y", input: "{}" } },
      { toolName: SKILL_RUN_TOOL, input: { skill: "text-tools", script: "rm.py", input: "{}" } },
      { toolName: SKILL_RUN_TOOL, input: { skill: "text-tools", script: "wordfreq.py", input: "x" } },
    ];
    for (const c of cases) reasons.push(decideToolCall(c, CTX, fresh())!.reason);
    for (const r of reasons) {
      expect(r).not.toMatch(/\/opt\/|\/run\/|unix:|socket|\.sock|timeout|\b30000\b/i);
    }
  });

  it("4. 会话内计数:每 turn ≤ 3、每会话 ≤ 12;只数通过了前三条的 skill_run;turn_start 归零", () => {
    const counters = fresh();
    const ok = () =>
      decideToolCall({ toolName: SKILL_RUN_TOOL, input: { skill: "text-tools", script: "wordfreq.py", input: goodInput } }, CTX, counters);
    // 被前三条拦的不计数
    decideToolCall({ toolName: SKILL_RUN_TOOL, input: { skill: "text-tools", script: "rm.py", input: goodInput } }, CTX, counters);
    expect(counters).toEqual({ turnRuns: 0, sessionRuns: 0 });
    for (let i = 0; i < MAX_RUNS_PER_TURN; i++) expect(ok()).toBeUndefined();
    const fourth = ok();
    expect(fourth?.block).toBe(true);
    expect(fourth?.reason).toContain("不必重试");
    expect(counters.turnRuns).toBe(MAX_RUNS_PER_TURN);
    // 新 turn:turn 计数归零,会话计数累计
    counters.turnRuns = 0;
    let sessionBlocked: string | undefined;
    for (let turn = 1; turn < 10 && !sessionBlocked; turn++) {
      counters.turnRuns = 0;
      for (let i = 0; i < MAX_RUNS_PER_TURN; i++) {
        const d = ok();
        if (d) {
          sessionBlocked = d.reason;
          break;
        }
      }
    }
    expect(sessionBlocked).toContain(String(MAX_RUNS_PER_SESSION));
    expect(counters.sessionRuns).toBe(MAX_RUNS_PER_SESSION);
    // skill_load 不计数
    decideToolCall({ toolName: SKILL_LOAD_TOOL, input: { name: "text-tools" } }, CTX, counters);
    expect(counters.sessionRuns).toBe(MAX_RUNS_PER_SESSION);
  });
});

/** 只收集 handler 的假 ExtensionAPI */
function fakePi() {
  const handlers = new Map<string, (event: unknown) => unknown>();
  return {
    api: { on: (name: string, h: (event: unknown) => unknown) => handlers.set(name, h) },
    call: (name: string, event: unknown) => handlers.get(name)!(event),
    has: (name: string) => handlers.has(name),
  };
}

describe("守卫扩展(makeGuard):只订阅 tool_call / turn_start,裁决进 handlers,异常即拦截", () => {
  it("放行的调用:返回 undefined,capture 到 handlers[0] = {extension: xray-guard} 且 returned 为空(验收 ⑦)", () => {
    const captured: Array<{ eventType: string; handlers: HandlerRecord[] }> = [];
    const pi = fakePi();
    makeGuard(CTX, (eventType, _event, handlers) => captured.push({ eventType, handlers })).factory(pi.api as never);
    expect(pi.has("tool_call")).toBe(true);
    expect(pi.has("turn_start")).toBe(true);
    expect(pi.has("before_agent_start")).toBe(false);
    const result = pi.call("tool_call", { type: "tool_call", toolName: "notes_search", input: { query: "x" } });
    expect(result).toBeUndefined();
    expect(captured).toHaveLength(1);
    expect(captured[0].eventType).toBe("tool_call");
    expect(captured[0].handlers).toEqual([{ extension: GUARD_EXTENSION, returned: undefined }]);
  });

  it("被拦截的调用:返回 {block:true, reason},capture 到 handlers[0].returned.block === true;reason 摘要 ≤ 200", () => {
    const captured: HandlerRecord[][] = [];
    const pi = fakePi();
    makeGuard(CTX, (_t, _e, handlers) => captured.push(handlers)).factory(pi.api as never);
    const result = pi.call("tool_call", {
      type: "tool_call",
      toolName: SKILL_RUN_TOOL,
      input: { skill: "text-tools", script: "scripts/rm.py", input: "{}" },
    }) as { block: boolean; reason: string };
    expect(result.block).toBe(true);
    const returned = captured[0][0].returned as { block: boolean; reason: string };
    expect(captured[0][0].extension).toBe(GUARD_EXTENSION);
    expect(returned.block).toBe(true);
    expect(returned.reason.length).toBeLessThanOrEqual(200);
    expect(returned.reason).toBe(result.reason.slice(0, 200));
  });

  it("5. 守卫自身抛异常 = 拦截(fail closed),reason 是固定文案、不含异常原文", () => {
    const boomCtx: GuardContext = {
      // includes 一调就炸:模拟守卫内部任何一处失败
      toolNames: { includes: () => { throw new Error("secret-internal-detail-xyz"); } } as unknown as string[],
      skills: SKILLS,
    };
    const captured: HandlerRecord[][] = [];
    const pi = fakePi();
    makeGuard(boomCtx, (_t, _e, handlers) => captured.push(handlers)).factory(pi.api as never);
    const result = pi.call("tool_call", { type: "tool_call", toolName: "notes_search", input: {} }) as { block: boolean; reason: string };
    expect(result.block).toBe(true);
    expect(result.reason).not.toContain("secret-internal-detail-xyz");
    expect(result.reason).toContain("守卫检查失败");
    expect((captured[0][0].returned as { block: boolean }).block).toBe(true);
  });

  it("capture 自己抛异常不影响裁决(裁决照常返回)", () => {
    const pi = fakePi();
    makeGuard(CTX, () => { throw new Error("capture down"); }).factory(pi.api as never);
    expect(pi.call("tool_call", { type: "tool_call", toolName: "notes_search", input: {} })).toBeUndefined();
    const blocked = pi.call("tool_call", { type: "tool_call", toolName: "bash", input: {} }) as { block: boolean };
    expect(blocked.block).toBe(true);
  });

  it("turn_start 归零 turn 计数(每 turn 上限在下一 turn 重新可用)", () => {
    const pi = fakePi();
    makeGuard(CTX, () => {}).factory(pi.api as never);
    const run = () =>
      pi.call("tool_call", { type: "tool_call", toolName: SKILL_RUN_TOOL, input: { skill: "text-tools", script: "wordfreq.py", input: goodInput } });
    for (let i = 0; i < MAX_RUNS_PER_TURN; i++) expect(run()).toBeUndefined();
    expect((run() as { block: boolean }).block).toBe(true);
    pi.call("turn_start", { type: "turn_start", turnIndex: 1, timestamp: Date.now() });
    expect(run()).toBeUndefined();
  });
});
