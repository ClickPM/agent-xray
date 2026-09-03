// R-TOOLCARDS 验收 #7 的前端半边:按偏移表切段的渲染路径是纯函数,这里直接断言。
// 经 `dev.ps1 test` → `bun test lib` 运行(node:test 写法,零新增依赖;见 trace-view.test.ts 的说明)。
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { foldLabel, hasFailure, splitTurn, toolDuration } from "./turn-view";
import type { ToolCallView } from "./types";

const call = (at: number, name = "notes_search", extra: Partial<ToolCallView> = {}): ToolCallView => ({
  toolCallId: `c${at}-${name}`,
  name,
  at,
  inputPreview: "{}",
  resultPreview: "ok",
  isError: false,
  durationMs: 12,
  ...extra,
});

describe("splitTurn", () => {
  it("文本 → 工具 → 文本 → 工具 → 工具 → 文本:段按 at 切,同一偏移的两张卡之间没有空段", () => {
    const text = "我先查一下。再看一篇结论如下";
    const { process, final } = splitTurn(text, [call(6, "a"), call(10, "b"), call(10, "c")]);
    assert.deepEqual(
      process.map((s) => (s.kind === "text" ? ["text", s.text] : ["tool", s.call.name, s.index])),
      [
        ["text", "我先查一下。"],
        ["tool", "a", 0],
        ["text", "再看一篇"],
        ["tool", "b", 1],
        ["tool", "c", 2],
      ],
    );
    assert.equal(final, "结论如下");
  });

  it("一句话没说先调工具:没有前导空段;以工具收尾:final 为空", () => {
    const { process, final } = splitTurn("中间说一句", [call(0), call(5)]);
    assert.deepEqual(
      process.map((s) => s.kind),
      ["tool", "text", "tool"],
    );
    assert.equal(final, "");
  });

  it("没有工具调用:process 为空、final = 全文(与改动前的纯正文渲染同一输入)", () => {
    assert.deepEqual(splitTurn("你好", []), { process: [], final: "你好" });
  });

  it("只有空白的段被跳过;at 越界被夹住;乱序的 at 按升序排、同偏移按原顺序", () => {
    const { process, final } = splitTurn("ab\n\ncd", [call(99, "late"), call(4, "y"), call(2, "x")]);
    assert.deepEqual(
      process.map((s) => (s.kind === "text" ? ["text", s.text] : ["tool", s.call.name])),
      [
        ["text", "ab"],
        ["tool", "x"],
        ["tool", "y"], // "\n\n" 是空白段,跳过
        ["text", "cd"],
        ["tool", "late"], // at=99 夹到文末
      ],
    );
    assert.equal(final, "");
    const same = splitTurn("xy", [call(1, "b"), call(1, "a")]);
    assert.deepEqual(
      same.process.map((s) => (s.kind === "tool" ? s.call.name : "text")),
      ["text", "b", "a"],
    );
  });

  it("负偏移当 0 处理", () => {
    const { process } = splitTurn("abc", [call(-3)]);
    assert.equal(process[0].kind, "tool");
    assert.equal(process.length, 1);
  });
});

describe("折叠行与卡片文案(画板 2l / 1a)", () => {
  it("foldLabel 只有往返数 · 工具数 · 总耗时;hasFailure 看 isError;耗时缺省时卡片留空", () => {
    const turn = { modelRoundTrips: 2, turnMs: 435, toolCalls: [call(0), call(3, "bash", { isError: true, durationMs: undefined })] };
    assert.equal(foldLabel(turn), "处理详情 · 2 次模型往返 · 2 次工具调用 · 435ms");
    assert.equal(foldLabel({ ...turn, turnMs: 1234 }), "处理详情 · 2 次模型往返 · 2 次工具调用 · 1.2s");
    assert.equal(hasFailure(turn), true);
    assert.equal(hasFailure({ ...turn, toolCalls: [call(0)] }), false);
    assert.equal(toolDuration(turn.toolCalls[0]), "12ms");
    assert.equal(toolDuration(turn.toolCalls[1]), "");
  });
});
