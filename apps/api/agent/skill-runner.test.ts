// R-SKILLS-2:api ↔ 执行容器协议的测试(假 HTTP 服务):超时 / 排队 / 非零退出 / 超大输出 / 非清单脚本各一;
// 运行器地址的代码级闭集;makeSkillRunTool 端到端(校验 → 占额 → 提交 → 结果有界,验收 ⑤ / ⑪ / ⑫)。
//
// 本机是 Windows,Bun 在这里不支持 unix socket(spike 留证:Linux 容器里 fetch({unix}) 通),所以假服务走 TCP、
// 目标用 `http://127.0.0.1:<port>`(与 dev.ps1 runner 的开发模式同一条路径);unix 路径只在协议层做形状测试。
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AGENT_SKILLS } from "../shared/skills.generated";
import { db } from "./db";
import type { SandboxConfig } from "./sandbox-config";
import {
  DEFAULT_RUNNER_URL,
  parseOutcome,
  resolveRunnerTarget,
  runSkillScript,
  RUNNER_TIMEOUT_MARGIN_MS,
  SkillRunError,
  type RunnerTarget,
  type SkillRunRequest,
} from "./skill-runner";
import type { AvailableSkills } from "./skills-catalog";
import { makeSkillRunTool, MAX_RESULT_CHARS, SKILL_RUN_TOOL } from "./tools";

type Route = (req: IncomingMessage, body: string, res: ServerResponse) => void | Promise<void>;

/** 假执行容器:每个用例设自己的 route */
class FakeRunner {
  server!: Server;
  port = 0;
  route: Route = (_req, _body, res) => res.end("{}");
  requests: Array<{ method: string; url: string; body: unknown; headers: IncomingMessage["headers"] }> = [];

  async start() {
    this.server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        this.requests.push({ method: req.method ?? "", url: req.url ?? "", body: body ? JSON.parse(body) : null, headers: req.headers });
        void this.route(req, body, res);
      });
    });
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", r));
    this.port = (this.server.address() as { port: number }).port;
  }
  stop() {
    return new Promise<void>((r) => this.server.close(() => r()));
  }
  target(): RunnerTarget {
    return resolveRunnerTarget(`http://127.0.0.1:${this.port}`)!;
  }
  json(status: number, obj: unknown): Route {
    return (_req, _body, res) => {
      const data = JSON.stringify(obj);
      res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(data) });
      res.end(data);
    };
  }
}

const textTools = AGENT_SKILLS.find((s) => s.name === "text-tools")!;
const wordfreq = textTools.scripts.find((x) => x.file === "wordfreq.py")!;
const SKILLS: AvailableSkills = { skills: [textTools], fingerprint: "fp", dropped: [] };
const SANDBOX: SandboxConfig = { dailyRunLimit: 0, totalTimeoutMs: 5_000, fingerprint: "sb" };

const okOutcome = (over: Record<string, unknown> = {}) => ({
  exitCode: 0,
  timedOut: false,
  durationMs: 12,
  stdout: JSON.stringify({ totalTokens: 3, top: [{ token: "a", count: 2 }] }),
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
  ...over,
});

const baseReq = (over: Partial<SkillRunRequest> = {}): SkillRunRequest => ({
  skill: "text-tools",
  script: "wordfreq.py",
  sha256: wordfreq.sha256,
  network: "none",
  input: { text: "a a b" },
  timeoutMs: 1_000,
  ...over,
});

describe("运行器地址的代码级闭集(resolveRunnerTarget)", () => {
  it("缺省 = unix 默认值;unix:<绝对路径> 合法", () => {
    expect(resolveRunnerTarget(undefined)).toEqual({ kind: "unix", socketPath: "/run/runner/runner.sock", network: "none" });
    expect(resolveRunnerTarget("")).toEqual(resolveRunnerTarget(DEFAULT_RUNNER_URL));
    expect(resolveRunnerTarget("unix:/tmp/x.sock")).toMatchObject({ kind: "unix", socketPath: "/tmp/x.sock" });
  });

  it("只接受 http://127.0.0.1:<port>;别的 host / scheme / 路径 / query / 相对 socket 一律 null", () => {
    expect(resolveRunnerTarget("http://127.0.0.1:8000")).toEqual({ kind: "tcp", origin: "http://127.0.0.1:8000", network: "none" });
    for (const bad of [
      "http://localhost:8000",
      "http://127.0.0.1:8000/run",
      "http://127.0.0.1:8000/",
      "http://127.0.0.1:8000?x=1",
      "https://127.0.0.1:8000",
      "http://10.0.0.1:8000",
      "http://runner:8000",
      "http://127.0.0.1",
      "http://127.0.0.1:99999",
      "unix:relative.sock",
      "unix:/run/../etc/x.sock",
      "unix:/run/a b.sock",
      "tcp://127.0.0.1:8000",
      "127.0.0.1:8000",
    ]) {
      expect(resolveRunnerTarget(bad), bad).toBeNull();
    }
  });
});

describe("响应形状(parseOutcome)", () => {
  it("形状对得上才收;exitCode 可为 null(超时);类型不对回 null", () => {
    expect(parseOutcome(okOutcome())).toMatchObject({ exitCode: 0, stdout: expect.any(String) });
    expect(parseOutcome(okOutcome({ exitCode: null, timedOut: true }))?.timedOut).toBe(true);
    expect(parseOutcome({ ...okOutcome(), exitCode: "0" })).toBeNull();
    expect(parseOutcome({ ...okOutcome(), stdout: 1 })).toBeNull();
    expect(parseOutcome({ ...okOutcome(), durationMs: -1 })).toBeNull();
    expect(parseOutcome("x")).toBeNull();
    expect(parseOutcome(null)).toBeNull();
  });
});

describe("协议(runSkillScript × 假执行容器)", () => {
  const fake = new FakeRunner();
  beforeAll(() => fake.start());
  afterAll(() => fake.stop());
  beforeEach(() => {
    fake.requests.length = 0;
  });

  it("成功:请求体只有 skill / script / sha256 / input / timeoutMs;进度上报 submitted → finished", async () => {
    fake.route = fake.json(200, okOutcome());
    const phases: string[] = [];
    const out = await runSkillScript(baseReq(), fake.target(), { onProgress: (p) => phases.push(p.phase) });
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain("totalTokens");
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0].url).toBe("/run");
    expect(Object.keys(fake.requests[0].body as object).sort()).toEqual(["input", "script", "sha256", "skill", "timeoutMs"]);
    expect(fake.requests[0].body).toMatchObject({ skill: "text-tools", script: "wordfreq.py", sha256: wordfreq.sha256, input: { text: "a a b" } });
    expect(phases).toEqual(["submitted", "finished"]);
  });

  it("非清单脚本:执行容器 404 unknown_script → SkillRunError(rejected, code),message 不含路径", async () => {
    fake.route = fake.json(404, { error: "unknown_script" });
    const err = await runSkillScript(baseReq({ script: "rm.py" }), fake.target()).catch((e) => e);
    expect(err).toBeInstanceOf(SkillRunError);
    expect(err.kind).toBe("rejected");
    expect(err.code).toBe("unknown_script");
    expect(err.message).not.toMatch(/\/opt|\/run\//);
  });

  it("排队超时:503 queue_timeout → kind queue_timeout", async () => {
    fake.route = fake.json(503, { error: "queue_timeout" });
    const err = await runSkillScript(baseReq(), fake.target()).catch((e) => e);
    expect(err.kind).toBe("queue_timeout");
  });

  it("不认识的错误码不进 code(只认闭集);5xx 是 http_error", async () => {
    fake.route = fake.json(500, { error: "/etc/passwd leaked here" });
    const err = await runSkillScript(baseReq(), fake.target()).catch((e) => e);
    expect(err.kind).toBe("http_error");
    expect(err.code).toBeUndefined();
    expect(err.message).not.toContain("/etc/passwd");
  });

  it("非零退出照常回 outcome(由工具决定怎么说);超时 kill 回 timedOut", async () => {
    fake.route = fake.json(200, okOutcome({ exitCode: 2, stdout: '{"error":"invalid_json"}' }));
    expect((await runSkillScript(baseReq(), fake.target())).exitCode).toBe(2);
    fake.route = fake.json(200, okOutcome({ exitCode: null, timedOut: true, durationMs: 3000 }));
    expect((await runSkillScript(baseReq(), fake.target())).timedOut).toBe(true);
  });

  it("响应体超上限 → oversize(不把几 MB 读进内存再说)", async () => {
    fake.route = (_req, _body, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(okOutcome({ stdout: "x".repeat(3 * 1024 * 1024) })));
    };
    const err = await runSkillScript(baseReq(), fake.target()).catch((e) => e);
    expect(err.kind).toBe("oversize");
  });

  it("api 侧总超时 = timeoutMs + 余量:执行容器不回话就放弃 → total_timeout;进度里有「运行中」", async () => {
    fake.route = (_req, _body, res) => {
      setTimeout(() => res.end("{}"), 5_000).unref();
    };
    const t0 = Date.now();
    const err = await runSkillScript(baseReq({ timeoutMs: 300 }), fake.target()).catch((e) => e);
    expect(err.kind).toBe("total_timeout");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(300 + RUNNER_TIMEOUT_MARGIN_MS - 50);
    expect(Date.now() - t0).toBeLessThan(4_500);
  });

  it("响应不是 JSON / 形状不对 → bad_response", async () => {
    fake.route = (_req, _body, res) => res.end("not json");
    expect((await runSkillScript(baseReq(), fake.target()).catch((e) => e)).kind).toBe("bad_response");
    fake.route = fake.json(200, { exitCode: "zero" });
    expect((await runSkillScript(baseReq(), fake.target()).catch((e) => e)).kind).toBe("bad_response");
  });

  it("档次不符(egress skill 送到 none 运行器)→ 不发请求就拒", async () => {
    fake.route = fake.json(200, okOutcome());
    const err = await runSkillScript(baseReq({ network: "egress" }), fake.target()).catch((e) => e);
    expect(err.kind).toBe("rejected");
    expect(err.code).toBe("network_mismatch");
    expect(fake.requests).toHaveLength(0);
  });

  it("连不上(容器被 stop)→ unreachable,message 只带错误码常量", async () => {
    const dead = resolveRunnerTarget("http://127.0.0.1:1")!;
    const err = await runSkillScript(baseReq(), dead).catch((e) => e);
    expect(err.kind).toBe("unreachable");
    expect(err.message).toMatch(/^runner unreachable/);
  });

  it("调用方 signal 中止 → 请求结束,不挂住", async () => {
    fake.route = (_req, _body, res) => {
      setTimeout(() => res.end("{}"), 5_000).unref();
    };
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 50);
    const err = await runSkillScript(baseReq(), fake.target(), { signal: ac.signal }).catch((e) => e);
    expect(err).toBeInstanceOf(SkillRunError);
  });
});

describe("skill_run 工具端到端(makeSkillRunTool × 假执行容器)", () => {
  const fake = new FakeRunner();
  beforeAll(() => fake.start());
  afterAll(async () => {
    await fake.stop();
    await db.exec`DELETE FROM daily_quota`;
  });
  beforeEach(async () => {
    fake.requests.length = 0;
    await db.exec`DELETE FROM daily_quota`;
  });

  const tool = () => makeSkillRunTool(SKILLS, SANDBOX, fake.target());
  const call = async (params: unknown, onUpdate?: (u: unknown) => void) => {
    const out = await tool().execute("t1", params as never, undefined, onUpdate as never, {} as never);
    return out.content.map((c) => ("text" in c ? c.text : "")).join("");
  };

  it("入参闭集(验收 ⑤):schema 只有 skill / script / input 三个 string", () => {
    const def = tool();
    const p = def.parameters as unknown as { properties: Record<string, { type: string }>; required: string[]; additionalProperties: boolean };
    expect(Object.keys(p.properties)).toEqual(["skill", "script", "input"]);
    expect(Object.values(p.properties).map((x) => x.type)).toEqual(["string", "string", "string"]);
    expect(p.required).toEqual(["skill", "script", "input"]);
    expect(p.additionalProperties).toBe(false);
    for (const k of ["code", "path", "argv", "interpreter", "env", "command"]) expect(p.properties).not.toHaveProperty(k);
    expect(def.name).toBe(SKILL_RUN_TOOL);
  });

  it("成功:结果首行 exit=0 · Nms,其后 stdout;details 里没有路径;进度四段", async () => {
    fake.route = fake.json(200, okOutcome({ stderr: "warn: x" }));
    const phases: string[] = [];
    const text = await call({ skill: "text-tools", script: "wordfreq.py", input: '{"text":"a a b","top":2}' }, (u) =>
      phases.push((u as { details: { phase: string } }).details.phase),
    );
    expect(text).toMatch(/^exit=0 · \d+ms\n/);
    expect(text).toContain("totalTokens");
    expect(text).toContain("[stderr 尾部]\nwarn: x");
    expect(phases).toEqual(["validated", "submitted", "finished"]);
    // 送给执行容器的是**已过 schema 的对象**,不是原文
    expect(fake.requests[0].body).toMatchObject({ input: { text: "a a b", top: 2 }, timeoutMs: SANDBOX.totalTimeoutMs });
  });

  it("未开放的 skill / 非清单脚本 / 非法 input:抛出可改正的文案,不发请求、不占额", async () => {
    fake.route = fake.json(200, okOutcome());
    await expect(call({ skill: "encore-api", script: "x.py", input: "{}" })).rejects.toThrow("未对 agent 开放");
    await expect(call({ skill: "text-tools", script: "scripts/rm.py", input: "{}" })).rejects.toThrow("可运行清单");
    await expect(call({ skill: "text-tools", script: "wordfreq.py", input: "{}" })).rejects.toThrow("缺少必填字段 text");
    await expect(call({ skill: "text-tools", script: "wordfreq.py", input: '{"text":"a","code":"import os"}' })).rejects.toThrow("未声明的字段 code");
    expect(fake.requests).toHaveLength(0);
    const q = await db.rawQueryRow<{ n: number }>(`SELECT COALESCE(SUM(skill_runs),0)::double precision AS n FROM daily_quota`);
    expect(q?.n).toBe(0);
  });

  it("非零退出 / 超时 / 排队超时 / 连不上:固定文案,isError 走 throw;stderr 与 traceback 不进结果", async () => {
    const good = { skill: "text-tools", script: "wordfreq.py", input: '{"text":"a"}' };
    fake.route = fake.json(200, okOutcome({ exitCode: 1, stderr: 'Traceback /opt/skills/text-tools/scripts/wordfreq.py line 9' }));
    await expect(call(good)).rejects.toThrow("脚本运行失败");
    await expect(call(good)).rejects.not.toThrow(/\/opt\/skills/);
    fake.route = fake.json(200, okOutcome({ exitCode: null, timedOut: true }));
    await expect(call(good)).rejects.toThrow("超时");
    fake.route = fake.json(503, { error: "queue_timeout" });
    await expect(call(good)).rejects.toThrow("排队超时");
    const deadTool = makeSkillRunTool(SKILLS, SANDBOX, resolveRunnerTarget("http://127.0.0.1:1")!);
    await expect(deadTool.execute("t", good as never, undefined, undefined, {} as never)).rejects.toThrow("执行容器当前不可用");
  });

  it("输出有界(验收 ⑫):执行容器已截到 256 KiB 的 stdout → 工具结果正文 ≤ 8000 + 截断标注", async () => {
    fake.route = fake.json(200, okOutcome({ stdout: "x".repeat(256 * 1024), stdoutTruncated: true }));
    const text = await call({ skill: "text-tools", script: "wordfreq.py", input: '{"text":"a"}' });
    expect(text.length).toBeLessThan(MAX_RESULT_CHARS + 200);
    expect(text).toContain("已截断");
    expect(text).toContain("stdout 已在容器内截断");
  });

  it("每日次数闸(验收 ⑪):dailyRunLimit=1 → 第二次固定文案,且不发请求", async () => {
    fake.route = fake.json(200, okOutcome());
    const limited = makeSkillRunTool(SKILLS, { ...SANDBOX, dailyRunLimit: 1 }, fake.target());
    const params = { skill: "text-tools", script: "wordfreq.py", input: '{"text":"a"}' } as never;
    await limited.execute("t1", params, undefined, undefined, {} as never);
    await expect(limited.execute("t2", params, undefined, undefined, {} as never)).rejects.toThrow("今日脚本运行次数已用完");
    expect(fake.requests).toHaveLength(1);
  });

  it("定义对象上找不到 socket 路径 / 超时 / 限额(它们只活在闭包里)", () => {
    const def = makeSkillRunTool(SKILLS, { dailyRunLimit: 7_777, totalTimeoutMs: 66_666, fingerprint: "fp-x" }, {
      kind: "unix",
      socketPath: "/run/fake-runner-zzq/runner.sock",
      network: "none",
    });
    const text = JSON.stringify(def);
    expect(text).not.toContain("fake-runner-zzq");
    expect(text).not.toContain("7777");
    expect(text).not.toContain("66666");
  });
});
