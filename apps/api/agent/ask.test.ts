// R3 `/agent/ask` 入口校验与 SSE 帧编码。不打真实 LLM(provider 调用在
// runtime.ts 的惰性路径里,本文件只覆盖请求解析与写帧两段纯逻辑)。
import { PassThrough } from "node:stream";
import type { ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { parseAskBody } from "./ask";
import { sse, sseComment } from "../shared/sse";

describe("请求体校验", () => {
  it("接受最小合法体,并 trim prompt", () => {
    expect(parseAskBody({ prompt: "  你好  " })).toEqual({ body: { prompt: "你好" } });
  });

  it("接受带 sessionId 的续接请求", () => {
    const id = "0e5f0a1c-2b3d-4e5f-8a9b-0c1d2e3f4a5b";
    expect(parseAskBody({ sessionId: id, prompt: "继续" })).toEqual({
      body: { sessionId: id, prompt: "继续" },
    });
  });

  it("拒绝空/缺失/纯空白 prompt", () => {
    expect(parseAskBody({})).toHaveProperty("error");
    expect(parseAskBody({ prompt: "" })).toHaveProperty("error");
    expect(parseAskBody({ prompt: "   " })).toHaveProperty("error");
    expect(parseAskBody({ prompt: 42 })).toHaveProperty("error");
  });

  it("拒绝超长 prompt", () => {
    expect(parseAskBody({ prompt: "x".repeat(4001) })).toHaveProperty("error");
    expect(parseAskBody({ prompt: "x".repeat(4000) })).toHaveProperty("body");
  });

  it("拒绝非 UUID sessionId 与非对象体", () => {
    expect(parseAskBody({ sessionId: "nope", prompt: "hi" })).toHaveProperty("error");
    expect(parseAskBody({ sessionId: 1, prompt: "hi" })).toHaveProperty("error");
    expect(parseAskBody(null)).toHaveProperty("error");
    expect(parseAskBody("hi")).toHaveProperty("error");
  });
});

/** 收集写入内容的假响应;`writableEnded` 由 PassThrough 自带。 */
function fakeResp() {
  const out = new PassThrough();
  const chunks: string[] = [];
  out.on("data", (c) => chunks.push(String(c)));
  return { resp: out as unknown as ServerResponse, text: () => chunks.join("") };
}

describe("SSE 帧编码", () => {
  it("event/data 各一行、以空行分帧", () => {
    const { resp, text } = fakeResp();
    sse(resp, "delta", { text: "你好" });
    expect(text()).toBe('event: delta\ndata: {"text":"你好"}\n\n');
  });

  it("心跳是注释帧", () => {
    const { resp, text } = fakeResp();
    sseComment(resp, "hb");
    expect(text()).toBe(": hb\n\n");
  });

  it("响应已结束后写帧是 no-op(客户端断开后不抛 write-after-end)", () => {
    const { resp, text } = fakeResp();
    resp.end();
    expect(() => sse(resp, "done", {})).not.toThrow();
    expect(text()).toBe("");
  });
});
