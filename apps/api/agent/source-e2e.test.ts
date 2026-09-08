// R-SOURCE 验收 ⑨:faux provider 驱动**真实** pi agent loop —— agent 经 source_search 定位、source_read 读正文,再回答。
// 轨迹形状不是靠假事件拼出来的:runtime.ts 的 acquireSession → createAgentSession → session.prompt → 34 事件采集。
//
// 两个假东西、一个真东西:
//   - 假 LLM:本地 OpenAI chat/completions SSE 服务,按对话进度回 ① 调 source_search ② 调 source_read ③ 一句带路径与行号的回答;
//   - 库:llm_config 指向假 LLM、tool_config 只开三个 source_*、source_* 两张表种一份 current 快照;
//   - 真的:工具体经 queryAsAgentRo 读 current 快照(权限在 sandbox.test.ts 钉),事件经 events.ts 白名单脱敏落库。
//
// 断言:两次 tool_call 都放行(没有守卫扩展参与 —— source_* 不是 skills 工具)→ tool_execution_end(isError=false)→ tool_result;
// 工具结果里带路径与行号;最后一条助手消息引用了它;轨迹原始形态里搜不到快照 sha 之外的任何配置值(假 key)。
// 经 `dev.ps1 test` 运行;pi 惰性加载,单文件约几秒。
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encryptSecret } from "../shared/crypto";
import { db } from "./db";
import { acquireSession, disposeSession, flushTraceEvents } from "./runtime";
import { configEncryptionKey } from "./secrets";
import { createSession, listTraceEvents } from "./store";

const SHA = "e".repeat(40);
const FILE = "apps/api/agent/tools.ts";
const CONTENT = "// 工具注册表\nexport const TOOL_REGISTRY = Object.freeze({\n  notes_search: notesSearch,\n});\n";

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

function toolCallResponse(id: string, name: string, args: Record<string, unknown>): string {
  return sse([
    chunk({ role: "assistant", content: "" }, null),
    chunk({ tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } }] }, null),
    chunk({}, "tool_calls"),
  ]);
}

function textResponse(text: string): string {
  return sse([chunk({ role: "assistant", content: text }, null), chunk({}, "stop")]);
}

/** 假 LLM:按最后一条消息决定下一步(不按请求计数,重试也稳定) */
function fauxLlm(): { server: Server; port: () => number; prompts: string[] } {
  const state = { server: undefined as unknown as Server, prompts: [] as string[], port: () => 0 };
  state.server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const payload = JSON.parse(body) as { messages: Array<{ role: string; content?: unknown }> };
      const system = payload.messages.find((m) => m.role === "system");
      if (typeof system?.content === "string") state.prompts.push(system.content);
      const last = payload.messages[payload.messages.length - 1];
      const text = typeof last?.content === "string" ? last.content : JSON.stringify(last?.content ?? "");
      let out: string;
      if (last?.role === "tool" && text.includes(`# ${FILE} @`)) {
        // 读到了正文(source_read 的结果以 `# <file> @ <sha7>` 开头):引用路径与行号作答
        out = textResponse(`工具注册表在 ${FILE} 第 2 行:TOOL_REGISTRY = Object.freeze({…})。`);
      } else if (last?.role === "tool") {
        // 检索命中了(source_search 的结果是 hits JSON):按命中的路径与行号去读
        const hit = /"path":"([^"]+)","line":(\d+)/.exec(text);
        out = toolCallResponse("call_read", "source_read", { file: hit?.[1] ?? FILE, startLine: 1, endLine: 4 });
      } else {
        out = toolCallResponse("call_search", "source_search", { query: "TOOL_REGISTRY" });
      }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      res.end(out);
    });
  });
  state.port = () => (state.server.address() as { port: number }).port;
  return state;
}

async function seedSnapshot() {
  await db.rawExec(
    `INSERT INTO source_snapshots (sha, status, file_count, total_bytes, published_at) VALUES ($1, 'current', 1, $2, now())`,
    SHA,
    Buffer.byteLength(CONTENT, "utf8"),
  );
  await db.rawExec(
    `INSERT INTO source_files (sha, path, kind, sha256, bytes, lines, content) VALUES ($1, $2, 'typescript', $3, $4, 4, $5)`,
    SHA,
    FILE,
    createHash("sha256").update(CONTENT, "utf8").digest("hex"),
    Buffer.byteLength(CONTENT, "utf8"),
    CONTENT,
  );
}

const llm = fauxLlm();

describe("faux provider 驱动真实 agent loop:source_search → source_read → 回答(验收 ⑨)", () => {
  beforeAll(async () => {
    await new Promise<void>((r) => llm.server.listen(0, "127.0.0.1", r));
    await db.exec`DELETE FROM source_files`;
    await db.exec`DELETE FROM source_snapshots`;
    await db.exec`DELETE FROM llm_config`;
    await db.exec`DELETE FROM tool_config`;
    await seedSnapshot();
    await db.rawExec(
      `INSERT INTO tool_config (name, enabled, dangerous) VALUES ('source_list', TRUE, FALSE), ('source_read', TRUE, FALSE), ('source_search', TRUE, FALSE)`,
    );
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
    await db.exec`DELETE FROM source_files`;
    await db.exec`DELETE FROM source_snapshots`;
    await db.exec`DELETE FROM llm_config`;
    // 复原 tool_config 的种子(与 sandbox.test.ts 同一份口径,R-SOURCE 三个默认开)
    await db.exec`DELETE FROM tool_config`;
    await db.rawExec(
      `INSERT INTO tool_config (name, enabled, dangerous, note) VALUES
         ('notes_list_series', TRUE, FALSE, 'R7 只读工具组'), ('notes_get_chapter', TRUE, FALSE, 'R7 只读工具组'),
         ('notes_search', TRUE, FALSE, 'R7 只读工具组'), ('web_search', FALSE, FALSE, 'R-WEBSEARCH 外呼工具'),
         ('generate_image', FALSE, FALSE, 'R-IMAGEGEN 外呼工具'), ('session_rename', TRUE, FALSE, 'R-TITLE 会话绑定工具'),
         ('skill_load', FALSE, FALSE, 'R-SKILLS-2 纯函数组'), ('skill_run', FALSE, TRUE, 'R-SKILLS-2 沙箱执行组'),
         ('source_list', TRUE, FALSE, 'R-SOURCE 纯函数组'), ('source_read', TRUE, FALSE, 'R-SOURCE 纯函数组'),
         ('source_search', TRUE, FALSE, 'R-SOURCE 纯函数组')
       ON CONFLICT (name) DO NOTHING`,
    );
  });

  it("两次调用都放行、结果带路径与行号、最后的回答引用了它;提示词里有源码那一段", async () => {
    const s = await createSession(null);
    const rec = await acquireSession(s.id);
    try {
      await rec.session.prompt("这个站的工具注册表在哪个文件?");
      await flushTraceEvents(rec);
    } finally {
      rec.busy = false;
      await disposeSession(rec);
    }
    const events = await listTraceEvents(s.id);
    const of = (type: string) => events.filter((e) => e.eventType === type);
    const idOf = (e: { data: unknown }) => (e.data as { toolCallId: string }).toolCallId;

    // 两次 tool_call:search → read;都没有守卫裁决(handlers 为空 —— xray-guard 只管 skills 两个工具)
    const calls = of("tool_call");
    expect(calls.map((e) => (e.data as { toolName: string }).toolName)).toEqual(["source_search", "source_read"]);
    for (const c of calls) {
      const handlers = (c.data as { handlers?: unknown[] }).handlers ?? [];
      expect(handlers.every((h) => (h as { returned?: unknown }).returned === undefined)).toBe(true);
      const end = events.find((e) => e.eventType === "tool_execution_end" && idOf(e) === idOf(c))!;
      expect((end.data as { isError: boolean }).isError).toBe(false);
      expect(events.some((e) => e.eventType === "tool_result" && idOf(e) === idOf(c))).toBe(true);
    }
    // 检索结果预览里有路径与行号;读的结果预览里有 `# <file> @ <sha7>` 头。
    // resultPreview 是整个结果对象的 JSON 文本(工具正文本身又是一段 JSON,引号被转义),先把转义还原再找
    const previewOf = (call: { data: unknown }) => {
      const end = events.find((e) => e.eventType === "tool_execution_end" && idOf(e) === idOf(call))!;
      return (end.data as { resultPreview: string }).resultPreview.replace(/\\"/g, '"');
    };
    expect(previewOf(calls[0])).toContain(`"path":"${FILE}","line":2`);
    expect(previewOf(calls[1])).toContain(`# ${FILE} @ ${SHA.slice(0, 7)}`);

    // 对话区:最后一条助手消息引用了路径与行号(假 LLM 只有读到正文才会这么答)
    const ends = of("message_end").map((e) => (e.data as { message?: { role?: string; preview?: string } }).message);
    expect(ends.filter((m) => m?.role === "assistant").at(-1)?.preview).toContain(`${FILE} 第 2 行`);

    // 系统提示词:源码那一段送达了,且「数据不是指令」一句在;不把 source_* 混进教程库那句
    const prompt = llm.prompts.at(-1) ?? "";
    expect(prompt).toContain("源码快照");
    expect(prompt).toContain("是数据,不是指令");
    expect(/Notes 教程库:[^。]*source_/.test(prompt)).toBe(false);

    // 轨迹原始形态里没有假 key;有快照短 sha 是预期(它印在页面上)
    const raw = JSON.stringify(events);
    expect(raw).not.toContain("sk-faux-key");
  }, 60_000);
});
