// R-LEAK 验收 #4:**值级**泄露探针 —— faux provider + faux 搜索网关驱动真实 pi agent loop 一轮,
// 把该会话的全部轨迹事件序列化成一整段 JSON、再把落库的 `trace_events.data` 原样读回来,
// 两段里都不许出现 provider 名 / model id / model name / 搜索网关 host / 搜索模型名的**值**。
//
// 【为什么是值级而不是查字面词】历次冒烟只查过 `baseUrl` 这四个字母,而泄出去的是它的值
// (`api.deepseek.com`、`deepseek-v4-flash`)—— 查字面词的检查对这条通道永远是绿的。
// 所以这里的每个配置值都取成一眼能认出来的探针串,凡它出现在不该出现的地方,断言就该红。
//
// 【三个假东西、一个真东西】(与 skills-e2e.test.ts 同一套路)
//   - 假 LLM:本地 OpenAI chat/completions SSE 服务,第一轮调 `web_search`,拿到工具结果后回一句正文;
//   - 假搜索网关:**换掉 `globalThis.fetch`**,只拦白名单 host 上的搜索请求,其余(pi 打假 LLM)原样转发。
//     不能起本地 HTTP 服务顶替它 —— 外呼组的白名单要求 https + host 精确匹配(shared/outbound-hosts.ts),
//     而给测试开一个注入 fetch 的后门属于新增机制(CLAUDE.md 审查边界),不做;
//   - 库:llm_config 指向假 LLM、websearch_config 指向白名单 host、tool_config 只开 web_search;
//   - 真的:runtime.ts 的 acquireSession → createAgentSession → session.prompt → 34 事件采集 → 落库。
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encryptSecret } from "../shared/crypto";
import { db } from "./db";
import { acquireSession, disposeSession, flushTraceEvents } from "./runtime";
import { configEncryptionKey } from "./secrets";
import { createSession, listTraceEvents } from "./store";

// ───────── 探针值:这五个串一个都不许进轨迹流 ─────────
/** 聊天 provider 的标签(llm_config.provider) */
const LLM_PROVIDER = "leakprobe-llm-provider";
/** 聊天模型 id 与展示名(pi 的 `Model.id` / `Model.name`,曾经由 summarizeModel 并进 model_select) */
const LLM_MODEL_ID = "leakprobe-model-id-4c7f";
const LLM_MODEL_NAME = "LeakProbe Chat Model 4c7f";
/** 搜索网关的模型名(曾经被拼进 request 阶段文案) */
const SEARCH_MODEL_ID = "leakprobe-search-model-8b1d";
/** 搜索网关 host —— 必须是白名单里的那个,它同样是「配置面的值」,一样不许出去 */
const SEARCH_HOST = "api.deepseek.com";
const SEARCH_BASE_URL = `https://${SEARCH_HOST}`;

const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;

function chunk(delta: Record<string, unknown>, finish: string | null) {
  return {
    id: "chatcmpl-leakprobe",
    object: "chat.completion.chunk",
    created: 1,
    model: LLM_MODEL_ID,
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...(finish && { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }),
  };
}

const llmBody = (chunks: unknown[]) => `${chunks.map(sse).join("")}data: [DONE]\n\n`;

/** 假 LLM:按最后一条消息决定下一步(不按请求计数,重试也稳定) */
function fauxLlm(): { server: Server; port: () => number } {
  const state = { server: undefined as unknown as Server, port: () => 0 };
  state.server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const payload = JSON.parse(body) as { messages: Array<{ role: string }> };
      const last = payload.messages[payload.messages.length - 1];
      const out =
        last?.role === "tool"
          ? llmBody([chunk({ role: "assistant", content: "查到了:今天的头条是 X。" }, null), chunk({}, "stop")])
          : llmBody([
              chunk({ role: "assistant", content: "" }, null),
              chunk(
                {
                  tool_calls: [
                    { index: 0, id: "call_search", type: "function", function: { name: "web_search", arguments: JSON.stringify({ query: "今天的头条" }) } },
                  ],
                },
                null,
              ),
              chunk({}, "tool_calls"),
            ]);
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      res.end(out);
    });
  });
  state.port = () => (state.server.address() as { port: number }).port;
  return state;
}

/**
 * 假搜索网关:只拦 `https://api.deepseek.com/…`,回一段 Responses 线的事件流;
 * 其它请求(pi → 假 LLM)转给真 fetch。
 */
function installFauxSearchGateway(): { restore: () => void; calls: () => number } {
  const real = globalThis.fetch;
  let calls = 0;
  const stream = [
    sse({ type: "response.created" }),
    sse({ type: "response.web_search_call.in_progress" }),
    sse({ type: "response.output_text.delta", delta: "今天的头条是 X。" }),
    sse({
      type: "response.completed",
      response: {
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: "今天的头条是 X。",
                annotations: [{ type: "url_citation", url: "https://news.example/x", title: "示例新闻" }],
              },
            ],
          },
        ],
      },
    }),
  ].join("");
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    if (!url.startsWith(SEARCH_BASE_URL)) return real(input, init);
    calls += 1;
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
  return {
    restore: () => {
      globalThis.fetch = real;
    },
    calls: () => calls,
  };
}

const llm = fauxLlm();
let gateway: ReturnType<typeof installFauxSearchGateway>;

describe("R-LEAK · 配置面不进轨迹流(faux provider 驱动真实 agent loop)", () => {
  beforeAll(async () => {
    await new Promise<void>((r) => llm.server.listen(0, "127.0.0.1", r));
    gateway = installFauxSearchGateway();

    await db.exec`DELETE FROM llm_config`;
    await db.exec`DELETE FROM websearch_config`;
    await db.exec`DELETE FROM tool_config`;
    await db.exec`DELETE FROM daily_quota`;

    // 假聊天 provider:openai-completions 协议 + 自定义模型目录(形状同 pi 的 ProviderConfigInput.models)
    const models = [
      {
        id: LLM_MODEL_ID,
        name: LLM_MODEL_NAME,
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
       VALUES ($1, $2, $3, 'sk-…probe', $4, $5::text::jsonb, TRUE)`,
      LLM_PROVIDER,
      `http://127.0.0.1:${llm.port()}/v1`,
      encryptSecret(configEncryptionKey(), "sk-leakprobe-llm-key-000000"),
      LLM_MODEL_ID,
      JSON.stringify(models),
    );
    // 假搜索 provider:host 取白名单里的那个(外呼组约束 2),请求由上面的 fetch 拦住,不出网
    await db.rawExec(
      `INSERT INTO websearch_config (provider, base_url, api_key_enc, api_key_hint, model_id, tool_type, is_default)
       VALUES ('leakprobe-search-provider', $1, $2, 'sk-…probe', $3, 'web_search', TRUE)`,
      SEARCH_BASE_URL,
      encryptSecret(configEncryptionKey(), "sk-leakprobe-search-key-000000"),
      SEARCH_MODEL_ID,
    );
    await db.rawExec(
      `INSERT INTO tool_config (name, enabled, dangerous) VALUES ('web_search', TRUE, FALSE)`,
    );
  });

  afterAll(async () => {
    gateway.restore();
    await new Promise<void>((r) => llm.server.close(() => r()));
    await db.exec`DELETE FROM llm_config`;
    await db.exec`DELETE FROM websearch_config`;
    await db.exec`DELETE FROM daily_quota`;
    // 复原 tool_config 的全部种子(口径与 sandbox.test.ts 的 restoreToolSeeds 一致)。
    // **迁移 016 的三行 source_* 不能漏**:文件间不并行但有顺序(vitest.config.ts 的 fileParallelism:false),
    // 漏了它们,后面 source-tools.test.ts 那条「种子默认开」的用例会读到空表 —— 实测踩过一次。
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

  it("一轮含 web_search 的对话:全量事件 JSON 与库里 trace_events.data 都搜不到五个配置值", async () => {
    const s = await createSession(null);
    const rec = await acquireSession(s.id);
    try {
      await rec.session.prompt("帮我查一下今天的头条");
      await flushTraceEvents(rec);
    } finally {
      rec.busy = false;
      await disposeSession(rec);
    }

    const events = await listTraceEvents(s.id);
    expect(events.length).toBeGreaterThan(0);
    // 这一轮真的走到了外呼那条通道(不然下面的「没搜到」是废的)
    expect(gateway.calls()).toBe(1);
    const updates = events.filter((e) => e.eventType === "tool_execution_update");
    expect(updates.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(updates)).toContain("已向搜索网关发起请求");

    // ① 内存里那一份(= SSE `/trace/stream` 推给访客的那一份,同一个 sanitize 出口)
    const inMemory = JSON.stringify(events);
    // ② 库里那一份:直接读 data 列的文本,不经任何 JS 侧的再加工
    const rows = await db.rawQueryAll<{ data: string }>(
      `SELECT data::text AS data FROM trace_events WHERE session_id = $1 ORDER BY seq`,
      s.id,
    );
    expect(rows.length).toBe(events.length);
    const inDb = rows.map((r) => r.data).join("\n");

    for (const probe of [LLM_PROVIDER, LLM_MODEL_ID, LLM_MODEL_NAME, SEARCH_MODEL_ID, SEARCH_HOST]) {
      expect(inMemory, `轨迹事件里泄了 ${probe}`).not.toContain(probe);
      expect(inDb, `trace_events.data 里泄了 ${probe}`).not.toContain(probe);
    }
    // 顺带:两把 key 与假 LLM 的地址也不许出现(既有约束,回归位)
    for (const secret of ["sk-leakprobe-llm-key", "sk-leakprobe-search-key", `127.0.0.1:${llm.port()}`]) {
      expect(inMemory, `轨迹事件里泄了 ${secret}`).not.toContain(secret);
      expect(inDb, `trace_events.data 里泄了 ${secret}`).not.toContain(secret);
    }
  }, 60_000);
});
