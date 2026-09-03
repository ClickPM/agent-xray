// R-SKILLS-2 验收 ⑦ / ⑧:faux provider 驱动**真实** pi agent loop —— 轨迹形状不是靠假事件拼出来的。
//
// 三个假东西、一个真东西:
//   - 假 LLM:一个本地 OpenAI chat/completions SSE 服务(pi 以 openai-completions 协议打它),按对话进度回
//     ① 调 skill_run 跑 `scripts/rm.py`(不在清单 → 守卫拦)② 调 skill_run 跑 `wordfreq.py`(放行)③ 一句正文;
//   - 假执行容器:本地 HTTP 服务(与 skill-runner.test.ts 同款),回一份 stdout;
//   - 库:llm_config 指向假 LLM、tool_config 开两个工具、skills 表种 text-tools 并打开、env 开双闸与 TCP 运行器地址;
//   - 真的:runtime.ts 的 acquireSession → createAgentSession(三个扩展按序注册)→ session.prompt → 34 事件采集。
//
// 断言的是任务卡「可证伪」段的事件序列:
//   before_agent_start.handlers = [{xray-skills, returned:{systemPromptDelta>0, skills:[text-tools]}}]
//   被拦截:tool_execution_start(skill_run) → tool_call(handlers[0].returned.block===true) → tool_execution_end(isError) 且无 tool_result
//   放行:  tool_call(handlers[0].returned 为空)→ … → tool_execution_end(isError=false) → tool_result
// 经 `dev.ps1 test` 运行;pi 惰性加载,单文件约几秒。
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encryptSecret } from "../shared/crypto";
import { db } from "./db";
import { acquireSession, disposeSession, flushTraceEvents } from "./runtime";
import { configEncryptionKey } from "./secrets";
import { createSession, listTraceEvents } from "./store";

const UNLOCK_ENV = "XRAY_UNLOCK_DANGEROUS_TOOLS";
const RUNNER_ENV = "XRAY_SKILL_RUNNER_URL";

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
function fauxLlm(): { server: Server; port: () => number; requests: number } {
  const state = { server: undefined as unknown as Server, requests: 0, port: () => 0 };
  state.server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      state.requests++;
      const payload = JSON.parse(body) as { messages: Array<{ role: string; content?: unknown }> };
      const last = payload.messages[payload.messages.length - 1];
      const text = typeof last?.content === "string" ? last.content : JSON.stringify(last?.content ?? "");
      let out: string;
      if (last?.role === "tool" && text.includes("exit=0")) {
        out = textResponse("词频统计完成:agent 出现 2 次。");
      } else if (last?.role === "tool") {
        // 上一次被拦截了(错误结果回到模型):改调清单里的脚本
        out = toolCallResponse("call_ok", "skill_run", {
          skill: "text-tools",
          script: "wordfreq.py",
          input: JSON.stringify({ text: "agent loop agent", top: 2 }),
        });
      } else {
        out = toolCallResponse("call_blocked", "skill_run", { skill: "text-tools", script: "scripts/rm.py", input: "{}" });
      }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      res.end(out);
    });
  });
  state.port = () => (state.server.address() as { port: number }).port;
  return state;
}

function fauxRunner(): { server: Server; port: () => number; requests: unknown[] } {
  const state = { server: undefined as unknown as Server, requests: [] as unknown[], port: () => 0 };
  state.server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      state.requests.push(JSON.parse(body));
      const data = JSON.stringify({
        exitCode: 0,
        timedOut: false,
        durationMs: 42,
        stdout: JSON.stringify({ totalTokens: 3, uniqueTokens: 2, top: [{ token: "agent", count: 2 }] }),
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
      });
      res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(data) });
      res.end(data);
    });
  });
  state.port = () => (state.server.address() as { port: number }).port;
  return state;
}

async function seedTextTools() {
  const { readFileSync, readdirSync, statSync } = await import("node:fs");
  const { join, relative, resolve, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "runner", "skills", "text-tools");
  const walk = (d: string, base = d): string[] =>
    readdirSync(d).flatMap((n) => {
      const f = join(d, n);
      return statSync(f).isDirectory() ? walk(f, base) : [relative(base, f).split("\\").join("/")];
    });
  await db.rawExec(
    `INSERT INTO skills (name, category_slug, summary, source_type, repo, sort_order, zip, zip_size, content_hash, agent_enabled)
     VALUES ('text-tools', 'framework', '', 'own', 'ClickPM/agent-skills', 0, decode('', 'hex'), 0, 'h', TRUE)`,
  );
  for (const p of walk(dir)) {
    const content = readFileSync(join(dir, p), "utf8");
    await db.rawExec(
      `INSERT INTO skill_files (skill_name, path, kind, content, size_bytes, line_count, sort_order)
       VALUES ('text-tools', $1, 'text', $2, $3, 1, 0)`,
      p,
      content,
      Buffer.byteLength(content, "utf8"),
    );
  }
}

const llm = fauxLlm();
const runner = fauxRunner();
const saved: Record<string, string | undefined> = {};

describe("faux provider 驱动真实 agent loop(验收 ⑦ / ⑧)", () => {
  beforeAll(async () => {
    await new Promise<void>((r) => llm.server.listen(0, "127.0.0.1", r));
    await new Promise<void>((r) => runner.server.listen(0, "127.0.0.1", r));
    for (const k of [UNLOCK_ENV, RUNNER_ENV]) saved[k] = process.env[k];
    process.env[UNLOCK_ENV] = "1";
    process.env[RUNNER_ENV] = `http://127.0.0.1:${runner.port()}`;

    await db.exec`DELETE FROM skill_files`;
    await db.exec`DELETE FROM skills`;
    await db.exec`DELETE FROM llm_config`;
    await db.exec`DELETE FROM tool_config`;
    await db.exec`DELETE FROM daily_quota`;
    await seedTextTools();
    await db.rawExec(
      `INSERT INTO tool_config (name, enabled, dangerous) VALUES ('skill_load', TRUE, FALSE), ('skill_run', TRUE, TRUE), ('notes_search', TRUE, FALSE)`,
    );
    // 假 provider:openai-completions 协议、自定义模型目录(形状同 pi 的 ProviderConfigInput.models)
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
    for (const k of [UNLOCK_ENV, RUNNER_ENV]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await new Promise<void>((r) => llm.server.close(() => r()));
    await new Promise<void>((r) => runner.server.close(() => r()));
    await db.exec`DELETE FROM skill_files`;
    await db.exec`DELETE FROM skills`;
    await db.exec`DELETE FROM llm_config`;
    await db.exec`DELETE FROM daily_quota`;
    // 复原 tool_config 的种子(与 sandbox.test.ts 同一份口径)
    await db.exec`DELETE FROM tool_config`;
    await db.rawExec(
      `INSERT INTO tool_config (name, enabled, dangerous, note) VALUES
         ('notes_list_series', TRUE, FALSE, 'R7 只读工具组'), ('notes_get_chapter', TRUE, FALSE, 'R7 只读工具组'),
         ('notes_search', TRUE, FALSE, 'R7 只读工具组'), ('web_search', FALSE, FALSE, 'R-WEBSEARCH 外呼工具'),
         ('generate_image', FALSE, FALSE, 'R-IMAGEGEN 外呼工具'), ('session_rename', TRUE, FALSE, 'R-TITLE 会话绑定工具'),
         ('skill_load', FALSE, FALSE, 'R-SKILLS-2 纯函数组'), ('skill_run', FALSE, TRUE, 'R-SKILLS-2 沙箱执行组')
       ON CONFLICT (name) DO NOTHING`,
    );
  });

  it("拦截 → 放行 → 回答:三条轨迹在同一轮里都可见,且形状与画板一致", async () => {
    const s = await createSession(null);
    const rec = await acquireSession(s.id);
    try {
      await rec.session.prompt("用 text-tools 统计这段话的词频:agent loop agent");
      await flushTraceEvents(rec);
    } finally {
      rec.busy = false;
      await disposeSession(rec);
    }
    const events = await listTraceEvents(s.id);
    const of = (type: string) => events.filter((e) => e.eventType === type);
    type Handler = { extension: string; returned?: Record<string, unknown> };
    const handlersOf = (e: { data: unknown }) => ((e.data as { handlers?: Handler[] }).handlers ?? []) as Handler[];

    // ⑧ 注入轨迹:每轮的 before_agent_start 都带 xray-skills 与 skills 列表,systemPromptDelta > 0
    const starts = of("before_agent_start");
    expect(starts.length).toBeGreaterThanOrEqual(1);
    for (const e of starts) {
      const [h] = handlersOf(e);
      expect(h.extension).toBe("xray-skills");
      expect(h.returned?.skills).toEqual(["text-tools"]);
      expect(h.returned?.systemPromptDelta as number).toBeGreaterThan(0);
      // 提示词原文不进事件
      expect(JSON.stringify(e.data)).not.toContain("<available_skills>");
    }

    // ⑦ 被拦截的调用:start → call[blocked] → end(isError),无 tool_result
    const calls = of("tool_call");
    expect(calls.length).toBe(2);
    const blocked = calls[0];
    const blockedH = handlersOf(blocked)[0];
    expect(blockedH.extension).toBe("xray-guard");
    expect(blockedH.returned?.block).toBe(true);
    expect(String(blockedH.returned?.reason)).toContain("可运行清单");
    const idOf = (e: { data: unknown }) => (e.data as { toolCallId: string }).toolCallId;
    const blockedId = idOf(blocked);
    const seqOf = (type: string, id: string) => events.find((e) => e.eventType === type && idOf(e) === id)?.seq;
    expect(seqOf("tool_execution_start", blockedId)).toBeLessThan(blocked.seq);
    const blockedEnd = events.find((e) => e.eventType === "tool_execution_end" && idOf(e) === blockedId)!;
    expect(blockedEnd.seq).toBeGreaterThan(blocked.seq);
    expect((blockedEnd.data as { isError: boolean }).isError).toBe(true);
    expect(events.some((e) => e.eventType === "tool_result" && idOf(e) === blockedId)).toBe(false);

    // 放行的调用:handlers[0].returned 为空;执行 → end(isError=false) → tool_result;执行容器收到了清单里的 sha256
    const allowed = calls[1];
    const allowedH = handlersOf(allowed)[0];
    expect(allowedH.extension).toBe("xray-guard");
    expect(allowedH.returned).toBeUndefined();
    const allowedId = idOf(allowed);
    const allowedEnd = events.find((e) => e.eventType === "tool_execution_end" && idOf(e) === allowedId)!;
    expect((allowedEnd.data as { isError: boolean }).isError).toBe(false);
    expect((allowedEnd.data as { resultPreview: string }).resultPreview).toContain("exit=0");
    expect(events.some((e) => e.eventType === "tool_result" && idOf(e) === allowedId)).toBe(true);
    expect(runner.requests).toHaveLength(1);
    expect(runner.requests[0]).toMatchObject({ skill: "text-tools", script: "wordfreq.py", input: { text: "agent loop agent", top: 2 } });
    const updates = events.filter((e) => e.eventType === "tool_execution_update" && idOf(e) === allowedId);
    expect(updates.length).toBeGreaterThanOrEqual(3); // 校验 / 已提交 / 已结束

    // 对话区:最后一条助手消息是脚本算出来的结论(假 LLM 看到 exit=0 才会这么答)
    const ends = of("message_end").map((e) => (e.data as { message?: { role?: string; preview?: string } }).message);
    expect(ends.filter((m) => m?.role === "assistant").at(-1)?.preview).toContain("词频统计完成");

    // 日限额计了一次;SSE 原始形态(与库里的一样)里搜不到 socket 路径 / 运行器地址 / 超时数字
    const q = await db.rawQueryRow<{ n: number }>(`SELECT skill_runs::double precision AS n FROM daily_quota`);
    expect(q?.n).toBe(1);
    const raw = JSON.stringify(events);
    expect(raw).not.toContain("/run/runner");
    expect(raw).not.toContain(`127.0.0.1:${runner.port()}`);
    expect(raw).not.toMatch(/\b30000\b/);
    expect(raw).not.toContain("sk-faux-key");
  }, 60_000);
});
