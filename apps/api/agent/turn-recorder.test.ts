// R-TOOLCARDS 验收 #6 / #7 / #8 的用例本体:偏移表、耗时、往返计数、脱敏与截断、
// 帧里没有原始结构 / 配置面、无 end 事件的兜底、payload 白名单投影。
// 纯逻辑,不起 provider;经 `dev.ps1 test` 运行。
import { describe, expect, it } from "vitest";
import { MAX_STRING } from "../shared/redact";
import {
  createTurnRecorder,
  preview,
  resultText,
  turnFromPayload,
  type ToolCallRecord,
  type TurnFrame,
} from "./turn-recorder";

/** 可控时钟:每次 `tick(ms)` 往前拨。 */
function clock(start = 1_000) {
  let t = start;
  return { now: () => t, tick: (ms: number) => (t += ms) };
}

const delta = (text: string) => ({
  type: "message_update",
  assistantMessageEvent: { type: "text_delta", delta: text },
});
const assistantEnd = (stopReason = "stop") => ({
  type: "message_end",
  message: { role: "assistant", stopReason, content: [] },
});
const toolStart = (toolCallId: string, toolName: string, args: unknown) => ({
  type: "tool_execution_start",
  toolCallId,
  toolName,
  args,
});
const toolEnd = (toolCallId: string, toolName: string, result: unknown, isError = false) => ({
  type: "tool_execution_end",
  toolCallId,
  toolName,
  result,
  isError,
});
const textResult = (text: string) => ({ content: [{ type: "text", text }], details: {} });

describe("偏移表(验收 #7)", () => {
  it("文本 → 工具 → 文本 → 工具 → 工具 → 文本:at 是工具开始时已累积的字符串长度,段切分可复原", () => {
    const c = clock();
    const r = createTurnRecorder(c.now);
    const frames: TurnFrame[] = [];
    const feed = (e: unknown) => frames.push(...r.feed(e));

    feed(delta("我先查一下"));
    feed(delta("。"));
    feed(toolStart("c1", "notes_search", { query: "航线" }));
    c.tick(310);
    feed(toolEnd("c1", "notes_search", textResult("找到 3 条")));
    feed(assistantEnd());
    feed(delta("再看一篇"));
    feed(toolStart("c2", "notes_get_chapter", { series: "a", chapter: "b" }));
    c.tick(20);
    feed(toolEnd("c2", "notes_get_chapter", textResult("正文…")));
    feed(toolStart("c3", "session_rename", { title: "低价航线" }));
    c.tick(5);
    feed(toolEnd("c3", "session_rename", textResult("ok")));
    feed(assistantEnd());
    feed(delta("结论如下"));
    feed(assistantEnd());
    c.tick(100);

    const { summary, payload } = r.finish();
    expect(r.text).toBe("我先查一下。再看一篇结论如下");
    expect(summary).toEqual({ modelRoundTrips: 3, turnMs: 435 });
    expect(payload?.v).toBe(1);
    expect(payload?.toolCalls.map((t) => [t.name, t.at, t.durationMs, t.isError])).toEqual([
      ["notes_search", 6, 310, false],
      ["notes_get_chapter", 10, 20, false],
      ["session_rename", 10, 5, false],
    ]);
    // 按 at 切段 = 前端渲染路径;这里断言切出来的段就是喂进去的文本
    const text = r.text;
    const cuts = payload!.toolCalls.map((t) => t.at);
    expect([text.slice(0, cuts[0]), text.slice(cuts[0], cuts[1]), text.slice(cuts[1], cuts[2]), text.slice(cuts[2])]).toEqual([
      "我先查一下。",
      "再看一篇",
      "",
      "结论如下",
    ]);
    // 帧顺序与事件顺序一致:delta / tool_start / tool_end 交错
    expect(frames.map((f) => f.event)).toEqual([
      "delta", "delta", "tool_start", "tool_end", "delta", "tool_start", "tool_end", "tool_start", "tool_end", "delta",
    ]);
  });

  it("一句话没说先调工具:at = 0;以工具收尾:最后一个 at = 全文长度", () => {
    const r = createTurnRecorder(clock().now);
    r.feed(toolStart("c1", "notes_search", {}));
    r.feed(toolEnd("c1", "notes_search", textResult("x")));
    r.feed(delta("中间说一句"));
    r.feed(toolStart("c2", "notes_search", {}));
    r.feed(toolEnd("c2", "notes_search", textResult("y")));
    const { payload } = r.finish();
    expect(payload?.toolCalls.map((t) => t.at)).toEqual([0, 5]);
    expect(r.text).toBe("中间说一句");
  });

  it("工具开始了但没有 end(provider 中途 abort):isError=true、resultPreview 空、durationMs 缺省", () => {
    const c = clock();
    const r = createTurnRecorder(c.now);
    r.feed(toolStart("c1", "web_search", { query: "q" }));
    c.tick(50);
    const { payload } = r.finish();
    const t = payload!.toolCalls[0];
    expect(t.isError).toBe(true);
    expect(t.resultPreview).toBe("");
    expect(t).not.toHaveProperty("durationMs");
  });

  it("没见过 start 的 end 不发帧、不计入;没有工具调用的一轮没有 payload", () => {
    const r = createTurnRecorder(clock().now);
    expect(r.feed(toolEnd("ghost", "x", textResult("?")))).toEqual([]);
    r.feed(delta("你好"));
    r.feed(assistantEnd());
    const { summary, payload } = r.finish();
    expect(payload).toBeUndefined();
    expect(summary.modelRoundTrips).toBe(1);
  });

  it("只数助手的 message_end;不认识的事件与非 text_delta 的 message_update 一律忽略", () => {
    const r = createTurnRecorder(clock().now);
    expect(r.feed({ type: "message_end", message: { role: "user" } })).toEqual([]);
    expect(r.feed({ type: "message_end", message: { role: "toolResult" } })).toEqual([]);
    expect(r.feed({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "…" } })).toEqual([]);
    expect(r.feed({ type: "turn_start", turnIndex: 0 })).toEqual([]);
    expect(r.feed(null)).toEqual([]);
    expect(r.feed("x")).toEqual([]);
    expect(r.finish().summary.modelRoundTrips).toBe(0);
    expect(r.text).toBe("");
  });

  it("isError 只认布尔 true;耗时不会为负", () => {
    let t = 100;
    const r = createTurnRecorder(() => t);
    r.feed(toolStart("c1", "x", {}));
    t = 50; // 时钟倒拨(NTP 校时)也不产出负数
    r.feed(toolEnd("c1", "x", textResult("r"), "yes" as unknown as boolean));
    const { payload, summary } = r.finish();
    expect(payload!.toolCalls[0].isError).toBe(false);
    expect(payload!.toolCalls[0].durationMs).toBe(0);
    expect(summary.turnMs).toBe(0);
  });
});

describe("脱敏、截断与帧内容(验收 #6 / #8)", () => {
  it("入参里的 apiKey 与结果里的 Bearer 串都变成 [redacted];帧与 payload 里没有 args / result 原始键", () => {
    const r = createTurnRecorder(clock().now);
    const frames = [
      ...r.feed(toolStart("c1", "web_search", { query: "x", apiKey: "sk-1234567890abcdef" })),
      ...r.feed(
        toolEnd("c1", "web_search", textResult("upstream said: Authorization: Bearer abcdefghijklmnop and sk-zzzzzzzzzzzzzzzz")),
      ),
    ];
    const start = frames[0] as Extract<TurnFrame, { event: "tool_start" }>;
    const end = frames[1] as Extract<TurnFrame, { event: "tool_end" }>;
    expect(start.data.inputPreview).toContain('"apiKey":"[redacted]"');
    expect(start.data.inputPreview).not.toContain("sk-1234567890abcdef");
    expect(end.data.resultPreview).not.toMatch(/Bearer abcdefghijklmnop|sk-zzzz/);
    expect(end.data.resultPreview).toContain("[redacted]");

    const { payload } = r.finish();
    const everything = JSON.stringify({ frames, payload });
    for (const key of ["args", "result", "model", "provider", "baseUrl", "usage", "cost", "tokens"]) {
      expect(everything).not.toContain(`"${key}"`);
    }
    expect(Object.keys(start.data).sort()).toEqual(["at", "inputPreview", "name", "toolCallId"]);
    expect(Object.keys(end.data).sort()).toEqual(["durationMs", "isError", "resultPreview", "toolCallId"]);
    expect(Object.keys(payload!).sort()).toEqual(["modelRoundTrips", "toolCalls", "turnMs", "v"]);
  });

  it("超长入参 / 结果截到 previewText 的上限,截断标记按画板 2m 写成 …(已截断)", () => {
    const r = createTurnRecorder(clock().now);
    const long = "x".repeat(MAX_STRING + 100);
    const [start] = r.feed(toolStart("c1", "notes_search", { query: long })) as Extract<TurnFrame, { event: "tool_start" }>[];
    const [end] = r.feed(toolEnd("c1", "notes_search", textResult(long))) as Extract<TurnFrame, { event: "tool_end" }>[];
    expect(start.data.inputPreview.endsWith("…(已截断)")).toBe(true);
    expect(end.data.resultPreview).toBe("x".repeat(MAX_STRING) + "…(已截断)");
    expect(end.data.resultPreview).not.toMatch(/\[\+\d+ chars\]/);
    // 未截断的不带标记;没有值就是空串
    expect(preview("short")).toBe("short");
    expect(preview(undefined)).toBe("");
  });

  it("工具结果的文本块被拼起来做摘要,不带 {content:[…]} 的壳;没有文本块时整个值原样交给 previewText", () => {
    expect(resultText(textResult("a"))).toBe("a");
    expect(resultText({ content: [{ type: "text", text: "a" }, { type: "image", data: "…" }, { type: "text", text: "b" }] })).toBe(
      "a\nb",
    );
    expect(resultText({ content: [{ type: "image", data: "…" }] })).toEqual({ content: [{ type: "image", data: "…" }] });
    expect(resultText("plain")).toBe("plain");
    expect(resultText(null)).toBeNull();
    const r = createTurnRecorder(clock().now);
    r.feed(toolStart("c1", "x", {}));
    const [end] = r.feed(toolEnd("c1", "x", textResult("找到 3 条"))) as Extract<TurnFrame, { event: "tool_end" }>[];
    expect(end.data.resultPreview).toBe("找到 3 条");
  });
});

describe("payload → turn 白名单投影(验收 #5)", () => {
  const good: ToolCallRecord = {
    toolCallId: "c1",
    name: "notes_search",
    at: 6,
    inputPreview: "{}",
    resultPreview: "r",
    isError: false,
    durationMs: 12,
  };

  it("NULL / 非对象 / 没有 toolCalls / toolCalls 为空 → undefined(旧行只显示正文)", () => {
    expect(turnFromPayload(null)).toBeUndefined();
    expect(turnFromPayload(undefined)).toBeUndefined();
    expect(turnFromPayload("x")).toBeUndefined();
    expect(turnFromPayload({})).toBeUndefined();
    expect(turnFromPayload({ toolCalls: "nope" })).toBeUndefined();
    expect(turnFromPayload({ toolCalls: [] })).toBeUndefined();
    expect(turnFromPayload({ toolCalls: [{ junk: 1 }] })).toBeUndefined();
  });

  it("只透出白名单字段;缺 name / at 的元素丢掉;多余键不透传;非法数字归零、durationMs 缺省就不出现", () => {
    const turn = turnFromPayload({
      v: 1,
      modelRoundTrips: 2,
      turnMs: -5,
      secret: "should not leak",
      toolCalls: [
        { ...good, extra: "no" },
        { name: "no-at" },
        { at: 3 },
        { name: "abort", at: 9, isError: "true" },
      ],
    })!;
    expect(turn).toEqual({
      modelRoundTrips: 2,
      turnMs: 0,
      toolCalls: [
        good,
        { toolCallId: "", name: "abort", at: 9, inputPreview: "", resultPreview: "", isError: false },
      ],
    });
    expect(turn.toolCalls[1]).not.toHaveProperty("durationMs");
    expect(JSON.stringify(turn)).not.toContain("secret");
    expect(JSON.stringify(turn)).not.toContain("extra");
  });

  it("recorder 落的 payload 经投影后与自身一致(实时与回放同源)", () => {
    const c = clock();
    const r = createTurnRecorder(c.now);
    r.feed(delta("先"));
    r.feed(toolStart("c1", "notes_search", { q: 1 }));
    c.tick(7);
    r.feed(toolEnd("c1", "notes_search", textResult("ok")));
    r.feed(assistantEnd());
    r.feed(delta("后"));
    const { payload } = r.finish();
    // JSON 往返模拟 JSONB 落库再读回
    const turn = turnFromPayload(JSON.parse(JSON.stringify(payload)));
    expect(turn).toEqual({ modelRoundTrips: 1, turnMs: 7, toolCalls: payload!.toolCalls });
  });
});
