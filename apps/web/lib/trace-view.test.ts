// R-SKILLS-2 验收 ⑨:前端投影 —— 带 `block` 的 tool_call 行 hasBadge && hasNote 且注记扩展名来自 handlers;
// 详情卡 extension 取自 handlers;before_agent_start 的链式步骤从 handlers 生成;**无 handlers 的事件与今天输出逐字段相同(回归)**。
// 纯函数测试,不起 Next。经 `dev.ps1 test` → `bun test lib` 运行(node:test 写法,零新增依赖)。
import { describe, it } from "node:test";
import assert from "node:assert/strict";
// 不带 .ts 后缀:next build 的 tsc 也会扫到本文件(tsconfig 没开 allowImportingTsExtensions);bun test 对无后缀导入照常解析
import { handlersOf, toChainView, toTimelineTurns } from "./trace-view";
import type { TraceEvent } from "./types";

let seq = 0;
const ev = (eventType: string, mode: TraceEvent["mode"], data: Record<string, unknown>, at = 1000 + seq * 10): TraceEvent => ({
  seq: seq++,
  eventType,
  mode,
  timestamp: at,
  data: { type: eventType, ...data },
});

const guardBlock = [{ extension: "xray-guard", returned: { block: true, reason: "脚本 rm.py 不在 text-tools 的可运行清单里" } }];
const guardPass = [{ extension: "xray-guard" }];
const inject = [{ extension: "xray-skills", returned: { systemPromptDelta: 812, skills: ["encore-api", "text-tools"] } }];

describe("handlersOf", () => {
  it("只认 {extension: string} 形状;没有 handlers 回空数组", () => {
    assert.deepEqual(handlersOf({ handlers: guardBlock }), guardBlock);
    assert.deepEqual(handlersOf({ handlers: [{ nope: 1 }, { extension: "x" }] }), [{ extension: "x" }]);
    assert.deepEqual(handlersOf({}), []);
    assert.deepEqual(handlersOf(null), []);
    assert.deepEqual(handlersOf({ handlers: "x" }), []);
  });
});

describe("Timeline 行(画板 1a 第 1043 行的拦截行)", () => {
  it("被拦截的 tool_call:hasBadge && hasNote,blockedBy = 守卫扩展名,详情卡 extension / returned / diff 取自 handlers", () => {
    seq = 0;
    const turns = toTimelineTurns([
      ev("turn_start", "notify", { turnIndex: 0 }),
      ev("tool_execution_start", "notify", { toolCallId: "c1", toolName: "skill_run" }),
      ev("tool_call", "veto", { toolCallId: "c1", toolName: "skill_run", inputPreview: "{…}", handlers: guardBlock }),
      ev("tool_execution_end", "notify", { toolCallId: "c1", toolName: "skill_run", isError: true }),
    ]);
    const row = turns[0].rows.find((r) => r.name === "tool_call · skill_run")!;
    assert.equal(row.hasBadge, true);
    assert.equal(row.hasNote, true);
    assert.equal(row.blockedBy, "xray-guard");
    assert.equal(row.detail?.extension, "xray-guard");
    assert.match(row.detail!.returned, /"block":true/);
    assert.equal(row.detail?.diff, "(已拦截 — 工具未执行)");
    assert.equal(row.color, "#ef4444");
  });

  it("放行的 tool_call:无徽标无注记;详情卡 extension = xray-guard、returned = undefined", () => {
    seq = 0;
    const turns = toTimelineTurns([
      ev("turn_start", "notify", { turnIndex: 0 }),
      ev("tool_call", "veto", { toolCallId: "c1", toolName: "notes_search", handlers: guardPass }),
    ]);
    const row = turns[0].rows[1];
    assert.equal(row.hasBadge, undefined);
    assert.equal(row.hasNote, undefined);
    assert.equal(row.blockedBy, undefined);
    assert.equal(row.detail?.extension, "xray-guard");
    assert.equal(row.detail?.returned, "undefined");
    assert.equal(row.detail?.diff, "(无变更 — 扩展未改写)");
  });

  it("before_agent_start 带注入:详情卡 extension = xray-skills,diff 写出 systemPrompt 增量(画板 1b 的 context-injector 卡)", () => {
    seq = 0;
    const turns = toTimelineTurns([
      ev("before_agent_start", "chain", { prompt: "hi", handlers: inject }),
      ev("turn_start", "notify", { turnIndex: 0 }),
    ]);
    const row = turns[0].rows[0];
    assert.equal(row.detail?.extension, "xray-skills");
    assert.match(row.detail!.returned, /"systemPromptDelta":812/);
    assert.equal(row.detail?.diff, "systemPrompt: +812 chars");
    assert.equal(row.color, "#2563eb");
  });

  it("回归:无 handlers 的事件与今天的输出逐字段相同(观测者文案)", () => {
    seq = 0;
    const events = [
      ev("session_start", "notify", { reason: "new" }),
      ev("before_agent_start", "chain", { prompt: "hi" }),
      ev("turn_start", "notify", { turnIndex: 0 }),
      ev("context", "chain", { messageCount: 2 }),
      ev("tool_call", "veto", { toolCallId: "c1", toolName: "notes_search" }),
      ev("message_update", "notify", {}),
      ev("message_update", "notify", {}),
      ev("turn_end", "notify", { turnIndex: 0 }),
    ];
    const turns = toTimelineTurns(events);
    assert.equal(turns.length, 1);
    for (const row of turns[0].rows) {
      assert.equal(row.hasBadge, undefined);
      assert.equal(row.hasNote, undefined);
      assert.equal(row.blockedBy, undefined);
      if (row.expandable) {
        assert.equal(row.detail?.extension, "xray-observer");
        assert.equal(row.detail?.returned, "undefined");
        assert.equal(row.detail?.diff, "(无变更 — 观测者只读)");
      }
    }
    assert.equal(turns[0].rows.find((r) => r.name === "message_update ×2")?.name, "message_update ×2");
  });
});

describe("Chain View(画板 1c)", () => {
  it("before_agent_start 带注入:步骤 = handlers,徽标「追加」,行里有增量与 skills;副标题按参与数", () => {
    seq = 0;
    const chain = toChainView([ev("before_agent_start", "chain", { prompt: "hi", handlers: inject })]);
    assert.equal(chain.event, "before_agent_start");
    assert.equal(chain.subtitle, "链式传递 · 1 个扩展参与");
    assert.equal(chain.steps.length, 1);
    assert.equal(chain.steps[0].name, "xray-skills");
    assert.equal(chain.steps[0].badge, "追加");
    assert.equal(chain.steps[0].badgeColor, "#f9c22e");
    assert.deepEqual(chain.steps[0].lines.map((l) => l.text), ["systemPrompt += 812 chars", "skills: [encore-api, text-tools]"]);
  });

  it("before_agent_start 未注入(returned undefined):徽标「未修改」", () => {
    seq = 0;
    const chain = toChainView([ev("before_agent_start", "chain", { prompt: "hi", handlers: [{ extension: "xray-skills" }] })]);
    assert.equal(chain.steps[0].badge, "未修改");
    assert.equal(chain.steps[0].name, "xray-skills");
  });

  it("回归:无 handlers 的 chain 事件保留观测者步骤", () => {
    seq = 0;
    const chain = toChainView([ev("context", "chain", { messageCount: 1 })]);
    assert.equal(chain.subtitle, "链式传递 · 1 个扩展参与");
    assert.equal(chain.steps[0].name, "xray-observer");
    assert.equal(chain.steps[0].badge, "未修改");
    assert.equal(chain.steps[0].lines[0].text, "(原样沿链传递 — 观测者只订阅,不改写)");
  });

  it("没有 chain 事件:占位", () => {
    const chain = toChainView([]);
    assert.equal(chain.event, "—");
    assert.deepEqual(chain.steps, []);
  });
});
