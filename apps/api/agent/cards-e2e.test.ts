// R-CARDS 任务卡「可证伪」段的服务端半边:faux provider 驱动**真实** pi agent loop 吐出一段带八个 ```xray-card
// 围栏(六种合法各一 + 一张写坏的 JSON + 一张超限)的回复,断言**落库的 content 与 provider 给的文本逐字相同** ——
// 服务端不碰围栏:delta 逐片累积(turn-recorder)→ upsertMessage → listMessages,三段都不改写、不转义、不截断。
// 卡画不画得出来是前端 `lib/xray-card.ts` 的事(`bun test lib` 钉),这里只证「原文原样到前端」。
//
// 两个假东西、一个真东西(与 skills-e2e / leak-e2e 同一套路):
//   - 假 LLM:本地 OpenAI chat/completions SSE 服务,把整段回复切成 37 字一片逐片吐(围栏被切在任意位置也要拼得回来);
//   - 库:只改 llm_config(指向假 LLM);tool_config **不碰** —— 别的文件的 afterAll 复原种子时漏掉迁移 016 的三个 source_* 行,
//     会让 source-tools.test.ts 按文件顺序偶发失败(本轮实测),这里不再加一份会漂移的种子副本。工具开着也没关系:假 LLM 从不发 tool call;
//   - 真的:runtime.ts 的 acquireSession → createAgentSession → session.prompt → 事件流,
//     以及 ask.ts 落库用的那套 createTurnRecorder + upsertMessage(这里按 ask.ts 的顺序手工串一遍,不起 HTTP)。
// 顺带钉一条:发给 provider 的系统提示里带着【信息卡片】段(提示词到不了 provider 就白写)。
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encryptSecret } from "../shared/crypto";
import { db } from "./db";
import { acquireSession, disposeSession, flushTraceEvents } from "./runtime";
import { configEncryptionKey } from "./secrets";
import { appendMessage, createSession, listMessages, upsertMessage } from "./store";
import { createTurnRecorder } from "./turn-recorder";

const FENCE = "```";
const card = (o: unknown) => `${FENCE}xray-card\n${JSON.stringify(o, null, 2)}\n${FENCE}`;

/** 六种合法 + 一张坏 JSON(尾逗号)+ 一张超限(21 行);正文夹在卡与卡之间,像模型真会写的样子 */
const REPLY = [
  "两个 SDK 都能把内核嵌进你自己的进程里,先看量级:",
  card({ v: 1, kind: "stat", title: "PI 内核规模", items: [{ label: "内核代码量", value: "4.2k", unit: "行" }, { label: "内核事件", value: "34", unit: "种" }, { label: "常驻进程", value: "0", unit: "个" }] }),
  "接入参数我折起来了,要看点开:",
  card({ v: 1, kind: "kv", title: "接入参数", collapsed: true, rows: [{ k: "最低运行时", v: "Node 20 LTS" }, { k: "凭据", v: "环境变量" }, { k: "回调", v: "6 个" }] }),
  "工具层的约束按入参上限排:",
  card({ v: 1, kind: "table", title: "入参约束", columns: ["工具", "上限", "分组"], rows: [["a_tool", "300 字符", "外呼"], ["b_tool", "64 字符", "纯函数"], ["c_tool", "60 字符", "会话绑定"]], sortable: true }),
  "接入顺序:",
  card({ v: 1, kind: "list", title: "五步", ordered: true, items: [{ text: "建实例", note: "与 service 同寿" }, { text: "写 schema" }, { text: "挂观测者" }] }),
  "摊开对比:",
  card({ v: 1, kind: "compare", title: "对比", columns: ["pi SDK", "Claude Agent SDK"], rows: [{ k: "内核事件", a: "34 种", b: "未公开" }, { k: "嵌入形态", a: "in-process", b: "in-process" }, { k: "源码", a: "可整读", b: "不含" }] }),
  "三种环境:",
  card({ v: 1, kind: "tabs", title: "运行环境", tabs: [{ label: "Node", card: { kind: "kv", rows: [{ k: "最低版本", v: "20.11" }] } }, { label: "Bun", card: { kind: "kv", rows: [{ k: "最低版本", v: "1.2.4" }] } }], links: [{ text: "pi 仓库", href: "https://github.com/x/y" }, { text: "第3章", href: "/notes/pi/agent-loop" }], action: { label: "帮我写一份接入清单", ask: "帮我按这五步写一份接入清单" } }),
  "下面这张我故意写坏(尾逗号):",
  `${FENCE}xray-card\n{ "v": 1, "kind": "compare", "rows": [ { "k": "内核事件", "a": "34 种", }, ] }\n${FENCE}`,
  "这张超限(21 行):",
  card({ v: 1, kind: "kv", rows: Array.from({ length: 21 }, (_, i) => ({ k: `k${i}`, v: `v${i}` })) }),
  "一句话:要看得见内核就选 pi。",
].join("\n\n");

const CHUNK = 37;

function sse(chunks: unknown[]): string {
  return `${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("")}data: [DONE]\n\n`;
}

function chunk(delta: Record<string, unknown>, finish: string | null) {
  return {
    id: "chatcmpl-faux",
    object: "chat.completion.chunk",
    created: 1,
    model: "faux-1",
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...(finish && { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }),
  };
}

/** 逐片吐正文:围栏的三个反引号、JSON 的引号都可能被切在片中间 */
function chunkedTextResponse(text: string): string {
  const parts: unknown[] = [chunk({ role: "assistant", content: "" }, null)];
  for (let i = 0; i < text.length; i += CHUNK) parts.push(chunk({ content: text.slice(i, i + CHUNK) }, null));
  parts.push(chunk({}, "stop"));
  return sse(parts);
}

function fauxLlm(): { server: Server; port: () => number; systemPrompts: string[] } {
  const state = { server: undefined as unknown as Server, systemPrompts: [] as string[], port: () => 0 };
  state.server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const payload = JSON.parse(body) as { messages: Array<{ role: string; content?: unknown }> };
      for (const m of payload.messages) if (m.role === "system" && typeof m.content === "string") state.systemPrompts.push(m.content);
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      res.end(chunkedTextResponse(REPLY));
    });
  });
  state.port = () => (state.server.address() as { port: number }).port;
  return state;
}

const llm = fauxLlm();

describe("faux provider 吐八个 xray-card 围栏:落库 content 与 provider 给的逐字相同(服务端不碰围栏)", () => {
  beforeAll(async () => {
    await new Promise<void>((r) => llm.server.listen(0, "127.0.0.1", r));
    await db.exec`DELETE FROM llm_config`;
    const models = [
      {
        id: "faux-1",
        name: "faux-1",
        api: "openai-completions",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32_000,
        maxTokens: 4_096,
      },
    ];
    await db.rawExec(
      `INSERT INTO llm_config (provider, base_url, api_key_enc, api_key_hint, model_id, models, is_default)
       VALUES ('faux', $1, $2, 'sk-…faux', 'faux-1', $3::text::jsonb, TRUE)`,
      `http://127.0.0.1:${llm.port()}/v1`,
      encryptSecret(configEncryptionKey(), "sk-faux-key-not-used-000000"),
      JSON.stringify(models),
    );
  });

  afterAll(async () => {
    await new Promise<void>((r) => llm.server.close(() => r()));
    await db.exec`DELETE FROM llm_config`;
  });

  it("逐片 delta 拼回原文、落库、读回:三处一字不差;系统提示带着卡片段", async () => {
    const s = await createSession(null);
    const userSeq = (await appendMessage(s.id, "user", "pi SDK 和 Claude Agent SDK 该怎么选?")).seq;
    const rec = await acquireSession(s.id);
    const recorder = createTurnRecorder();
    const deltas: string[] = [];
    const unsubscribe = rec.session.subscribe((event) => {
      for (const frame of recorder.feed(event)) if (frame.event === "delta") deltas.push((frame.data as { text: string }).text);
    });
    try {
      await rec.session.prompt("pi SDK 和 Claude Agent SDK 该怎么选?");
      unsubscribe();
      await flushTraceEvents(rec);
    } finally {
      rec.busy = false;
      await disposeSession(rec);
    }
    const { payload } = recorder.finish();
    expect(payload).toBeUndefined(); // 假 LLM 不发 tool call:没有偏移表,行上只有正文

    // ① 事件流:delta 逐片拼回来正好是 provider 给的整段(切片数 > 1 才算「逐片」)
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.join("")).toBe(REPLY);
    expect(recorder.text).toBe(REPLY);

    // ② 按 ask.ts 的顺序落库、再按 sessions.ts 的读面读回
    await upsertMessage(s.id, userSeq + 1, "assistant", recorder.text, payload);
    const rows = await listMessages(s.id);
    expect(rows.map((r) => r.role)).toEqual(["user", "assistant"]);
    const content = rows[1].content;
    expect(content).toBe(REPLY);
    expect(content.split(`${FENCE}xray-card`)).toHaveLength(9); // 八个围栏一个不少
    expect(content).toContain('"a": "34 种", }, ] }'); // 坏 JSON 原样保留:回不回落是前端的事
    expect(rows[1].payload).toBeNull();

    // ③ 提示词真的到了 provider,且【信息卡片】排在所有工具段落之后(工具开关是什么状态都成立)。
    // 【不能断言「是最后一段」】pi 在 systemPromptOverride 的返回值**之后**还会追加自己的 <project_context>
    // (从 cwd 往上找到的 AGENTS.md + 「Current working directory」一行;本轮实测,记 BACKLOG),所以只看它后面再没有工具段落。
    expect(llm.systemPrompts.length).toBeGreaterThanOrEqual(1);
    for (const p of llm.systemPrompts) {
      expect(p).toContain(`${FENCE}xray-card`);
      expect(p).toContain("\n\n【信息卡片】");
      const after = p.slice(p.indexOf("【信息卡片】"));
      expect(after).not.toMatch(/\n\n(你有|你还有|你还可以|本次会话开始时)/);
    }
  }, 60_000);
});
