// R-SKILLS-2:api ↔ `skill-runner` 执行容器的协议实现(docs/security.md §1 R-SKILLS-2 补记)。
//
// 【本文件是 api 进程里离「代码执行」最近的地方,而它做的事只是发一个 HTTP 请求】
// 规则 9 的三句话在这里的落点:api 进程**不 spawn 任何东西**、不碰文件系统、不做动态 import;
// 执行发生在独立容器(`runner/runner.py`),这里只把「哪个 skill、哪个脚本、什么入参」送过去、把结果收回来。
//
// 【通道只有 unix socket,每个实例一条】默认实例 `skill-runner` 是 `network_mode: none`,没有任何网络;
// R-WEBFETCH 的 egress 实例 `skill-runner-egress` 只在专用 egress 网络里(不在 front / back)。api 经各自命名卷里的
// socket 单向找它们,反向无通道;**按清单里 skill 的 `network` 档次选实例**(`RunnerTargets`),送错档次的请求
// 两边都会拒(这里 `runSkillScript` 先拒一次,runner.py 再按 `RUNNER_NETWORK` 拒一次)。
// Bun 的全局 `fetch` 支持 `unix` 选项(spike 留证:round-skills-2 任务卡「本轮实测」);
// 本机开发时 api 跑在 Windows 宿主上拿不到容器里的 socket,所以每档有一个 TCP 覆盖项 —— 它们是**代码级闭集**
// (`resolveRunnerTarget`):只接受 `unix:` 默认值或 `http://127.0.0.1:<port>`,写别的值这一档就没有运行器
// (none 档没有 → `skill_run` 不注册;egress 档没有 → 该档 skill 不进可用集合)。
// 覆盖项只在注册环节读(tools.ts 的 loadEnabledTools),工具体内不读 `process.env`。
//
// 【错误在构造处不带容器内路径】socket 路径、超时数字、限额数字都不进错误文案:错误对象会被传递、被别处 catch、
// 进 `safeErrorText` 日志 —— 而 `/agent/tools` 与 SSE 原始流里「搜不到 socket 路径 / 超时数字」是本轮验收项。
import { readBodyCapped } from "../shared/http-body";
import { SKILL_NETWORKS, type SkillNetwork } from "../shared/skill-manifest";

/**
 * 生产默认,每档一条 socket:compose 把命名卷 `runner_sock` 挂到 api 与 `skill-runner` 的 /run/runner,
 * 把 `runner_egress_sock` 挂到 `skill-runner-egress` 的 /run/runner 与 api 的 /run/runner-egress(R-WEBFETCH)。
 */
export const DEFAULT_RUNNER_URLS: Readonly<Record<SkillNetwork, string>> = {
  none: "unix:/run/runner/runner.sock",
  egress: "unix:/run/runner-egress/runner.sock",
};
/** 注册环节读的 env 名,每档一个(只在 tools.ts 的 loadEnabledTools 里读一次)。 */
export const RUNNER_URL_ENVS: Readonly<Record<SkillNetwork, string>> = {
  none: "XRAY_SKILL_RUNNER_URL",
  egress: "XRAY_SKILL_RUNNER_EGRESS_URL",
};
/** none 档的两个常量保留原名:既有调用点与日志文案都指它 */
export const DEFAULT_RUNNER_URL = DEFAULT_RUNNER_URLS.none;
export const RUNNER_URL_ENV = RUNNER_URL_ENVS.none;

/** 执行容器回的响应体上限:stdout / stderr 各 256 KiB 再经 JSON 转义,2 MiB 足够且远小于内存预算。 */
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
/** 「运行中 Ns」进度上报的间隔。 */
const PROGRESS_INTERVAL_MS = 5_000;
/** 执行容器自己也有一个总时长(排队 + 运行);api 侧再给 2 s 余量后整体放弃。 */
export const RUNNER_TIMEOUT_MARGIN_MS = 2_000;

export type RunnerTarget =
  | { kind: "unix"; socketPath: string; network: SkillNetwork }
  | { kind: "tcp"; origin: string; network: SkillNetwork };

/**
 * 运行器地址的**代码级闭集**(每档一个)。
 *
 * 只有两种形状能过:`unix:<绝对路径>`(生产默认,缺省值按档次取 `DEFAULT_RUNNER_URLS`)与 `http://127.0.0.1:<port>`
 * (本机开发,dev.ps1 runner / runner egress)。别的 host(哪怕 `localhost`)、别的 scheme、带路径 / query 的写法一律 `null`
 * —— 这个变量存在的意义是「让本机能连到 docker run 出来的 runner」,不是「让 api 能被配置成去打任何地址」
 * (docs/security.md §1 第 4 层)。返回值带 `network`:请求的档次与运行器的档次不等时 `runSkillScript` 不发请求就拒。
 */
export function resolveRunnerTarget(raw: string | undefined, network: SkillNetwork = "none"): RunnerTarget | null {
  const value = (raw ?? "").trim() || DEFAULT_RUNNER_URLS[network];
  if (value.startsWith("unix:")) {
    const socketPath = value.slice("unix:".length);
    if (!socketPath.startsWith("/") || socketPath.includes("..") || /\s/.test(socketPath)) return null;
    return { kind: "unix", socketPath, network };
  }
  const m = /^http:\/\/127\.0\.0\.1:(\d{1,5})$/.exec(value);
  if (!m) return null;
  const port = Number(m[1]);
  if (port < 1 || port > 65535) return null;
  return { kind: "tcp", origin: `http://127.0.0.1:${port}`, network };
}

/** 每档一个运行器;`null` = 这一档的地址不合法(env 写了闭集之外的值),该档 skill 本会话不可用。 */
export type RunnerTargets = Readonly<Record<SkillNetwork, RunnerTarget | null>>;

/** 注册环节一次读完两档的 env(只在 tools.ts 的 loadEnabledTools 里调)。 */
export function resolveRunnerTargets(env: Readonly<Record<string, string | undefined>>): RunnerTargets {
  const out = {} as Record<SkillNetwork, RunnerTarget | null>;
  for (const network of SKILL_NETWORKS) out[network] = resolveRunnerTarget(env[RUNNER_URL_ENVS[network]], network);
  return out;
}

/** 有合法运行器的档次集合(`RunnerTargets` → 可用集合的过滤条件)。 */
export function runnableNetworks(runners: RunnerTargets): ReadonlySet<SkillNetwork> {
  return new Set(SKILL_NETWORKS.filter((n) => runners[n] !== null));
}

export interface SkillRunRequest {
  skill: string;
  /** `scripts/` 下的文件名(闭集的键) */
  script: string;
  /** 代码清单里该脚本的 sha256;执行容器按自己的清单与磁盘文件三方核对 */
  sha256: string;
  network: SkillNetwork;
  /** 已过 schema 的入参对象;执行容器把它序列化后写进脚本的 stdin */
  input: Record<string, unknown>;
  /** 总时长上限(含排队),来自 sandbox_config */
  timeoutMs: number;
}

export interface SkillRunOutcome {
  /** null = 被超时 kill */
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export type SkillRunErrorKind =
  /** 连不上执行容器(没起 / socket 不在 / 被 stop) */
  | "unreachable"
  /** 执行容器按清单拒绝(unknown_skill / unknown_script / hash_mismatch / network_mismatch / bad_request …) */
  | "rejected"
  /** 排队等不到并发名额 */
  | "queue_timeout"
  /** api 侧总超时(执行容器没在 timeoutMs + 余量内回话) */
  | "total_timeout"
  /** 非 2xx 且不是上面那些 */
  | "http_error"
  /** 响应体超上限 */
  | "oversize"
  /** 响应体不是约定形状 */
  | "bad_response";

/** 失败的统一类型。`kind` 与 `code` 只进服务端日志,给模型的永远是 tools.ts 里写死的文案。 */
export class SkillRunError extends Error {
  constructor(
    readonly kind: SkillRunErrorKind,
    message: string,
    /** 执行容器回的固定错误码(闭集,不含任何路径) */
    readonly code?: string,
  ) {
    super(message);
    this.name = "SkillRunError";
  }
}

export type SkillRunPhase = "submitted" | "running" | "finished";

export interface SkillRunProgress {
  phase: SkillRunPhase;
  detail: string;
}

export interface RunSkillOptions {
  signal?: AbortSignal;
  onProgress?: (p: SkillRunProgress) => void;
  /** 测试注入;生产就是全局 fetch(Bun,带 `unix` 选项) */
  fetchImpl?: typeof fetch;
  /** 测试注入;生产是 Date.now 驱动的 setInterval */
  now?: () => number;
}

/** 执行容器回的错误码闭集;不在这个集合里的字符串不进日志(免得把上游随便什么东西打进日志)。 */
const RUNNER_ERROR_CODES = new Set([
  "bad_request",
  "unknown_skill",
  "unknown_script",
  "network_mismatch",
  "hash_mismatch",
  "input_too_large",
  "body_too_large",
  "length_required",
  "queue_timeout",
  "run_failed",
  "not_found",
]);

function runnerUrl(target: RunnerTarget, path: string): string {
  // unix 形态下 host 只是占位(Bun 用 `unix` 选项定位 socket,URL 的 host 不参与连接)
  return target.kind === "unix" ? `http://skill-runner${path}` : `${target.origin}${path}`;
}

function runnerInit(target: RunnerTarget, init: RequestInit): RequestInit {
  // Bun 专有选项;类型上不在标准 RequestInit 里,所以整体按扩展形状造
  return target.kind === "unix" ? ({ ...init, unix: target.socketPath } as RequestInit) : init;
}

/**
 * 发一次运行请求,等它跑完。
 *
 * 顺序:上报「已提交」→ POST /run(带总超时 = timeoutMs + 余量)→ 期间每 5 s 上报「运行中 Ns」
 * → 读响应体(带字节上界)→ 校验形状 → 上报「已结束」。
 * 任何失败都抛 `SkillRunError`;fetch 抛出来的原始错误(可能含 socket 路径)**不带进** message,
 * 只保留它的 `code` 属性名(ENOENT / ECONNREFUSED 这类常量)供日志判断。
 */
export async function runSkillScript(
  req: SkillRunRequest,
  target: RunnerTarget,
  opts: RunSkillOptions = {},
): Promise<SkillRunOutcome> {
  if (req.network !== target.network) {
    // 路由错档次不该发生(注册环节已按 network 过滤);发生了就是拒,不发请求
    throw new SkillRunError("rejected", "skill network tier does not match this runner", "network_mismatch");
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const totalMs = req.timeoutMs + RUNNER_TIMEOUT_MARGIN_MS;

  const ac = new AbortController();
  const onAbort = () => ac.abort();
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  if (opts.signal?.aborted) ac.abort();
  const timer = setTimeout(() => ac.abort(), totalMs);

  const started = now();
  opts.onProgress?.({ phase: "submitted", detail: `已提交到执行容器(${req.skill}/${req.script})` });
  const ticker = setInterval(() => {
    opts.onProgress?.({ phase: "running", detail: `运行中 ${Math.round((now() - started) / 1000)}s` });
  }, PROGRESS_INTERVAL_MS);

  try {
    let res: Response;
    try {
      res = await fetchImpl(
        runnerUrl(target, "/run"),
        runnerInit(target, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            skill: req.skill,
            script: req.script,
            sha256: req.sha256,
            input: req.input,
            timeoutMs: req.timeoutMs,
          }),
          signal: ac.signal,
          redirect: "manual",
        }),
      );
    } catch (err) {
      if (ac.signal.aborted) {
        throw new SkillRunError(
          opts.signal?.aborted ? "unreachable" : "total_timeout",
          opts.signal?.aborted ? "run aborted by caller" : "runner did not answer within the total timeout",
        );
      }
      // 原始 message 可能带 socket 路径:只保留错误码常量
      const code = typeof (err as { code?: unknown })?.code === "string" ? (err as { code: string }).code : "";
      throw new SkillRunError("unreachable", `runner unreachable${code ? ` (${code.slice(0, 32)})` : ""}`);
    }

    let text: string;
    try {
      text = await readBodyCapped(res, {
        maxBytes: MAX_RESPONSE_BYTES,
        oversize: (max) => new SkillRunError("oversize", `runner response exceeded ${max} bytes`),
      });
    } catch (err) {
      if (err instanceof SkillRunError) throw err;
      if (ac.signal.aborted) throw new SkillRunError("total_timeout", "runner response cut off by the total timeout");
      throw new SkillRunError("bad_response", "failed to read runner response");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new SkillRunError(res.ok ? "bad_response" : "http_error", `runner returned non-JSON (status ${res.status})`);
    }

    if (!res.ok) {
      const rawCode = (parsed as { error?: unknown })?.error;
      const code = typeof rawCode === "string" && RUNNER_ERROR_CODES.has(rawCode) ? rawCode : undefined;
      if (code === "queue_timeout") throw new SkillRunError("queue_timeout", "runner queue timed out", code);
      if (res.status >= 400 && res.status < 500 && code) {
        throw new SkillRunError("rejected", `runner rejected the request (${code})`, code);
      }
      throw new SkillRunError("http_error", `runner returned status ${res.status}${code ? ` (${code})` : ""}`, code);
    }

    const outcome = parseOutcome(parsed);
    if (!outcome) throw new SkillRunError("bad_response", "runner response has an unexpected shape");
    opts.onProgress?.({
      phase: "finished",
      detail: outcome.timedOut ? `已结束(超时被终止,${outcome.durationMs}ms)` : `已结束(exit=${outcome.exitCode},${outcome.durationMs}ms)`,
    });
    return outcome;
  } finally {
    clearTimeout(timer);
    clearInterval(ticker);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

/** 响应形状校验:类型对不上就当没收到,不猜。 */
export function parseOutcome(value: unknown): SkillRunOutcome | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const exitCode = v.exitCode;
  if (!(exitCode === null || (typeof exitCode === "number" && Number.isInteger(exitCode)))) return null;
  if (typeof v.timedOut !== "boolean") return null;
  if (typeof v.durationMs !== "number" || !Number.isFinite(v.durationMs) || v.durationMs < 0) return null;
  if (typeof v.stdout !== "string" || typeof v.stderr !== "string") return null;
  return {
    exitCode: exitCode as number | null,
    timedOut: v.timedOut,
    durationMs: Math.round(v.durationMs),
    stdout: v.stdout,
    stderr: v.stderr,
    stdoutTruncated: v.stdoutTruncated === true,
    stderrTruncated: v.stderrTruncated === true,
  };
}
