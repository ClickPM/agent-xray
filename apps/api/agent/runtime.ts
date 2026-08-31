// R3 正式运行时:pi SDK in-process 会话注册表(docs/architecture.md「agent 运行时」决策)。
//
// 与 R1 的 `spike/runtime.ts` 的区别(spike 已随 R4 的 trace 服务落地整体删除):
//   - 运行时会话 id ≡ DB `sessions.id`,不再各自生成
//   - 会话可被**空闲回收**并在下次 `/agent/ask` 时按库内历史重建(注入上下文)
//   - 容量满时先逐出最旧的空闲会话,确实无可逐出才拒绝
//
// 安全:`noTools: 'all'` 起步、资源发现指向空隔离目录(绝不加载本机 ~/.pi 下的
// 用户扩展/工具)、事件进队列前逐字段白名单脱敏——docs/security.md §1/§2。
//
// R6 起 provider / 模型 / key 不再硬编码,全部来自 `llm_config`(经 MCP 管理面维护);
// 引导 secret `DeepSeekApiKey` 已按所有者裁定彻底移除。见 `llm-config.ts`。
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentSession,
  CreateAgentSessionOptions,
  ExtensionAPI,
  InlineExtension,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { dropSession as dropTraceBuffer, publish as publishTrace } from "../shared/trace-bus";
import { ALL_EVENTS, EVENT_MODES, safeErrorText, sanitizeEvent, type EventMode } from "./events";
import { loadActiveLlmConfig, LlmNotConfiguredError, type ActiveLlmConfig } from "./llm-config";
import { appendTraceEvents, listMessages, maxTraceSeq, type MessageRow } from "./store";

/** pi 的资源发现(extensions/skills/settings/AGENTS.md)全部指向这个空目录。 */
const ISOLATED_DIR = join(tmpdir(), "agent-xray-runtime-pi");

const SYSTEM_PROMPT =
  "你是 Agent X-Ray 站点上的演示 agent。访客与你对话的同时,页面右侧会实时展示你的内核事件轨迹。" +
  "请用访客使用的语言简洁作答。你当前没有任何可用工具。";

// —— 容量与回收参数 ——
/** 同时活跃的运行时会话上限(内存基线口径见 rounds/round-01)。 */
export const MAX_ACTIVE_SESSIONS = 8;
/** 空闲多久后回收会话(pi 会话 dispose,历史仍在库里,下次提问重建)。 */
export const IDLE_TIMEOUT_MS = 15 * 60_000;
/** 空闲扫描周期。 */
const SWEEP_INTERVAL_MS = 60_000;
/** 待落库队列达到该水位就触发一次增量 flush(长对话轨迹不丢头)。 */
const FLUSH_THRESHOLD = 500;
/** 待落库队列硬上限:库持续不可用时丢最旧并**显式记日志**,不存在静默缺口。 */
export const PENDING_FLUSH_MAX = 5000;
/** 会话重建时注入的历史转写上限(超出丢最旧的轮次)。 */
export const MAX_HISTORY_CHARS = 8_000;

// —— pi 惰性加载 ——
type PiModule = typeof import("@earendil-works/pi-coding-agent");

let piPromise: Promise<PiModule> | undefined;

function loadPi(): Promise<PiModule> {
  if (!piPromise) piPromise = import("@earendil-works/pi-coding-agent");
  return piPromise;
}

// —— ModelRuntime 单例(隔离路径;凭据不落盘)——
//
// 注意这里**不再注册任何凭据**:R6 起 provider / 模型 / key 全部来自 `llm_config`,
// 由 `applyLlmConfig()` 在每次冷启动会话时按需注册。单例本身不带任何模型偏好。
let runtimePromise: Promise<{ pi: PiModule; modelRuntime: ModelRuntime }> | undefined;

function getPiRuntime() {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const pi = await loadPi();
      mkdirSync(ISOLATED_DIR, { recursive: true });
      const modelRuntime = await pi.ModelRuntime.create({
        authPath: join(ISOLATED_DIR, "auth.json"),
        modelsPath: join(ISOLATED_DIR, "models.json"),
        modelsStorePath: join(ISOLATED_DIR, "models-store.json"),
      });
      return { pi, modelRuntime };
    })();
    // 初始化失败不缓存失败态,下次请求重试
    runtimePromise.catch(() => {
      runtimePromise = undefined;
    });
  }
  return runtimePromise;
}

// —— llm_config → ModelRuntime 的注册(验收 ⑥「切换默认模型后新会话生效」)——

/** 上次注册进 ModelRuntime 的配置指纹与 provider;指纹没变就不重复注册。 */
let appliedFingerprint: string | undefined;
let appliedProvider: string | undefined;

/**
 * 把库里的当前配置施加到 ModelRuntime 上,返回可用的模型句柄。
 *
 * 每次**冷启动会话**都会调(热路径不调),所以「改了配置何时生效」有确定答案:
 * 下一个新会话。进行中的会话不受影响 —— 中途换模型会让同一轮对话前后半段
 * 出自不同模型,那不是「热生效」,是数据不一致。
 *
 * 换 provider 时先撤掉上一个的运行期 key:进程里不留用不上的凭据。
 */
async function applyLlmConfig(
  modelRuntime: ModelRuntime,
  cfg: ActiveLlmConfig,
): Promise<NonNullable<ReturnType<ModelRuntime["getModel"]>>> {
  if (appliedFingerprint !== cfg.fingerprint) {
    if (appliedProvider && appliedProvider !== cfg.provider) {
      await modelRuntime
        .removeRuntimeApiKey(appliedProvider)
        .catch((err) => console.error(`remove stale provider key failed: ${safeErrorText(err)}`));
    }
    // 中转端点与自定义模型目录是 pi 的「扩展 provider」配置面
    // (ProviderConfigInput);内置 provider 用默认目录时两者都为空,不必注册。
    if (cfg.baseUrl !== null || cfg.models !== null) {
      modelRuntime.registerProvider(cfg.provider, {
        ...(cfg.baseUrl !== null && { baseUrl: cfg.baseUrl }),
        ...(cfg.models !== null && {
          models: cfg.models as Parameters<ModelRuntime["registerProvider"]>[1]["models"],
        }),
      });
    }
    await modelRuntime.setRuntimeApiKey(cfg.provider, cfg.apiKey);
    appliedProvider = cfg.provider;
    appliedFingerprint = cfg.fingerprint;
    console.log(`llm config applied: provider=${cfg.provider} model=${cfg.modelId}`);
  }

  const model = modelRuntime.getModel(cfg.provider, cfg.modelId);
  if (!model) {
    // 指纹已经记成「已施加」,但这份配置其实用不了 —— 清掉,
    // 否则改回一个可用模型之后指纹若恰好没变(不可能,但别赌)会被跳过
    appliedFingerprint = undefined;
    throw new LlmNotConfiguredError(
      `模型 ${cfg.provider}/${cfg.modelId} 不在目录中;` +
        "内置 provider 请核对模型 id,自定义端点请在 llm_provider_upsert 里给出 models",
    );
  }
  return model;
}

// —— 会话注册表 ——
export interface CapturedEvent {
  seq: number;
  eventType: string;
  mode: EventMode;
  /** epoch ms */
  timestamp: number;
  data: unknown;
}

export interface RuntimeSession {
  /** ≡ DB sessions.id */
  id: string;
  session: AgentSession;
  createdAt: number;
  /** 空闲回收判据;每次提问开始/结束都会刷新 */
  lastActiveAt: number;
  /** 本进程内的同会话串行闸:持有期间不回收、不逐出,并发提问返回 409 */
  busy: boolean;
  disposed: boolean;
  /** 下一个待分配的轨迹事件 seq(重建会话时从库内最大值 +1 续接) */
  seq: number;
  /** 待落库事件队列,与 pi 会话生命周期解耦 */
  pendingFlush: CapturedEvent[];
  /** flush 串行化链:同会话任意时刻只有一个批量写在跑 */
  flushChain: Promise<void>;
  /** 水位触发的 flush 已排队,避免高频事件重复入队 */
  flushQueued: boolean;
}

const registry = new Map<string, RuntimeSession>();

/**
 * 正在释放的会话:id → 「最终 flush 已落定」的 promise。
 *
 * 释放不是瞬时的(要先把待落库队列排干),这段窗口里同 id 的重建必须等它结束:
 * 否则新实例的 `maxTraceSeq()` 读到的是旧批次提交**之前**的值,复用了仍在途的
 * seq,两批事件撞上 `ON CONFLICT DO NOTHING` 后会有一批被静默丢掉(复审 P1)。
 */
const disposing = new Map<string, Promise<void>>();

export function getRuntimeSession(id: string): RuntimeSession | undefined {
  const rec = registry.get(id);
  return rec && !rec.disposed ? rec : undefined;
}

export function activeSessions(): RuntimeSession[] {
  return [...registry.values()].filter((r) => !r.disposed);
}

// —— 轨迹事件采集 → 脱敏 → 待落库队列 ——

/**
 * 事件入待落库队列。队列超硬上限时丢最旧一条并**显式记日志**——这是唯一允许
 * 丢事件的位置,丢弃必然伴随日志,不存在静默缺口。
 */
export function queuePendingEvent(rec: RuntimeSession, e: CapturedEvent): void {
  rec.pendingFlush.push(e);
  if (rec.pendingFlush.length > PENDING_FLUSH_MAX) {
    const dropped = rec.pendingFlush.shift()!;
    console.error(
      `trace backlog overflow for session ${rec.id}: dropped seq ${dropped.seq} (cap ${PENDING_FLUSH_MAX})`,
    );
  }
}

/**
 * 写库失败的在途批退回队首,与失败期间新入队的事件合并后重新施加
 * PENDING_FLUSH_MAX——在途批不占独立容量,慢失败循环下总内存有界。
 * 用 concat 而非展开参数,超大批不会 RangeError。会话已 dispose 则不复活在途批。
 */
export function requeueFailedBatch(rec: RuntimeSession, batch: CapturedEvent[]): void {
  if (rec.disposed) {
    console.error(
      `trace flush failed after dispose for session ${rec.id}: dropped in-flight batch of ${batch.length}`,
    );
    return;
  }
  const merged = batch.concat(rec.pendingFlush);
  const overflow = merged.length - PENDING_FLUSH_MAX;
  if (overflow > 0) {
    console.error(
      `trace backlog overflow for session ${rec.id}: dropped ${overflow} oldest events ` +
        `(seq ${merged[0].seq}..${merged[overflow - 1].seq}, cap ${PENDING_FLUSH_MAX})`,
    );
  }
  rec.pendingFlush = overflow > 0 ? merged.slice(overflow) : merged;
}

/**
 * 排干待落库队列,批量写入 Postgres(事件在采集时已脱敏)。经 flushChain 串行化:
 * 水位触发的增量 flush 与请求收尾的最终 flush 不并发。写库失败时在途批经
 * requeueFailedBatch 限容合并回队首,由后续 flush 重试——队列是唯一事实来源;
 * appendTraceEvents 幂等(ON CONFLICT DO NOTHING),重试不会产生重复行。
 */
export function flushTraceEvents(rec: RuntimeSession): Promise<void> {
  const run = async () => {
    if (rec.pendingFlush.length === 0) return;
    const batch = rec.pendingFlush.splice(0, rec.pendingFlush.length);
    try {
      await appendTraceEvents(rec.id, batch);
    } catch (err) {
      requeueFailedBatch(rec, batch);
      throw err;
    }
  };
  rec.flushChain = rec.flushChain.then(run, run);
  return rec.flushChain;
}

function maybeScheduleFlush(rec: RuntimeSession): void {
  if (rec.disposed || rec.flushQueued) return;
  if (rec.pendingFlush.length < FLUSH_THRESHOLD) return;
  rec.flushQueued = true;
  void flushTraceEvents(rec)
    .catch((err) => console.error(`incremental trace flush failed: ${safeErrorText(err)}`))
    .finally(() => {
      rec.flushQueued = false;
    });
}

/**
 * 采集一条事件:脱敏 → 待落库队列 → 进程内总线(R4 的 `/trace/stream` 从总线
 * 拿 live 帧)。**两条去向都在这里,且总线在前一步之后**:落库队列是持久化的
 * 事实来源,总线只是给已连上的观众的即时副本,发布失败不该影响落库。
 */
function capture(rec: RuntimeSession, eventType: string, event: unknown): void {
  const captured: CapturedEvent = {
    seq: rec.seq++,
    eventType,
    mode: EVENT_MODES[eventType],
    timestamp: Date.now(),
    data: sanitizeEvent(eventType, event),
  };
  queuePendingEvent(rec, captured);
  publishTrace(rec.id, captured);
  maybeScheduleFlush(rec);
}

function makeObserver(rec: RuntimeSession): InlineExtension {
  return {
    name: "xray-observer",
    factory: (pi: ExtensionAPI) => {
      // 34 个事件名全量订阅。除 project_trust 外 handler 一律返回 undefined,
      // 不干预 veto/chain/takeover 流程;project_trust 的运行时契约要求必须返回
      // { trusted },观测者返回 "undecided" 表示不做裁决。
      const on = pi.on.bind(pi) as (name: string, handler: (event: unknown) => unknown) => void;
      for (const name of ALL_EVENTS) {
        try {
          on(name, (event) => {
            capture(rec, name, event);
            return name === "project_trust" ? { trusted: "undecided" } : undefined;
          });
        } catch (err) {
          console.error(`xray-observer failed to subscribe ${name}: ${safeErrorText(err)}`);
        }
      }
    },
  };
}

// —— 历史上下文重建 ——

const ROLE_LABEL: Record<string, string> = { user: "访客", assistant: "你", tool: "工具" };

/**
 * 库内历史消息 → 单条注入用转写。会话被空闲回收(或进程重启)后重建时,
 * pi 会话本身是空的,这段转写作为 `role:"custom"` 消息补回上下文。
 * 超长时**丢最旧**的消息,保留最近若干轮——截断点落在消息边界上,不切半句。
 */
export function buildHistoryTranscript(
  messages: MessageRow[],
  maxChars = MAX_HISTORY_CHARS,
): string {
  const lines = messages
    .filter((m) => m.content.trim() !== "")
    .map((m) => `${ROLE_LABEL[m.role] ?? m.role}: ${m.content}`);
  const kept: string[] = [];
  let size = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const cost = lines[i].length + 1;
    if (size + cost > maxChars) break;
    kept.unshift(lines[i]);
    size += cost;
  }
  if (kept.length === 0) return "";
  const omitted = lines.length - kept.length;
  const header =
    omitted > 0
      ? `以下是本会话此前的对话记录(已省略更早的 ${omitted} 条):`
      : "以下是本会话此前的对话记录:";
  return `${header}\n${kept.join("\n")}`;
}

// —— 空闲回收与逐出 ——

/** 可回收的会话:未被请求持有,且空闲超过 IDLE_TIMEOUT_MS。 */
export function selectIdleSessions(
  recs: RuntimeSession[],
  now: number,
  idleMs = IDLE_TIMEOUT_MS,
): RuntimeSession[] {
  return recs.filter((r) => !r.disposed && !r.busy && now - r.lastActiveAt >= idleMs);
}

/** 容量满时的逐出对象:未被请求持有的会话里最久未活跃的那个;都在忙则 undefined。 */
export function selectEvictable(recs: RuntimeSession[]): RuntimeSession | undefined {
  return recs
    .filter((r) => !r.disposed && !r.busy)
    .sort((a, b) => a.lastActiveAt - b.lastActiveAt)[0];
}

/**
 * 释放运行时会话。三处顺序都是被审查逼出来的,改动前请先看清各自防的是什么:
 *
 * 1. **`registry.delete` 同步执行**:此后 `getRuntimeSession` / `selectEvictable` /
 *    sweeper 都看不到它——否则逐出目标在排干队列的 `await` 期间仍可被并发请求认领,
 *    认领方拿到的是一个马上要 dispose 的会话(初审 P1)。
 * 2. **`disposed` 置位放在最终 flush 之后**:置早了,增量 flush 失败时
 *    `requeueFailedBatch` 会判定「会话已释放」直接丢掉在途批次,最终 flush 就没东西
 *    可重试,留下永久轨迹缺口(复审 P1)。释放期间它仍是「活的」,失败批次能回队,
 *    随后链上的最终 flush 会重试。
 * 3. **释放登记进 `disposing`**:重建同 id 会话必须等最终 flush 落定,否则新实例的
 *    `maxTraceSeq()` 会复用在途 seq(复审 P1,见 `disposing` 注释)。
 *
 * 排干失败只能显式记日志(库不可用时无处可写),不静默。
 */
export function disposeSession(rec: RuntimeSession): Promise<void> {
  const inFlight = disposing.get(rec.id);
  if (inFlight) return inFlight;
  if (rec.disposed) return Promise.resolve();

  // 同步退出注册表:此后不可被认领 / 逐出 / 回收
  registry.delete(rec.id);

  const done = (async () => {
    try {
      // 此时 disposed 仍为 false:失败批次可回队,并由本次链上的重试再写一遍
      await flushTraceEvents(rec);
    } catch (err) {
      console.error(
        `flush before dispose failed for session ${rec.id}: dropping ${rec.pendingFlush.length} ` +
          `pending events — ${safeErrorText(err)}`,
      );
    }
    rec.disposed = true;
    rec.pendingFlush.length = 0;
    // 【顺序敏感】丢缓冲必须排在最终 flush **之后**:提前丢会出现「库里还没写、
    // buffer 已经空」的空窗,这期间连上来的 /trace/stream 会缺一段轨迹(任务卡 D6)
    dropTraceBuffer(rec.id);
    try {
      rec.session.dispose();
    } catch (err) {
      console.error(`pi session dispose failed for session ${rec.id}: ${safeErrorText(err)}`);
    }
  })().finally(() => {
    disposing.delete(rec.id);
  });

  disposing.set(rec.id, done);
  return done;
}

export async function sweepIdleSessions(now = Date.now()): Promise<number> {
  const stale = selectIdleSessions([...registry.values()], now);
  for (const rec of stale) {
    console.log(
      `recycling idle agent session ${rec.id} (idle ${Math.round((now - rec.lastActiveAt) / 1000)}s)`,
    );
    await disposeSession(rec);
  }
  return stale.length;
}

let sweeper: ReturnType<typeof setInterval> | undefined;

/** 首个会话创建时才起扫描定时器;unref 让它不拖住进程退出(测试/优雅关停)。 */
function ensureSweeper(): void {
  if (sweeper) return;
  sweeper = setInterval(() => {
    void sweepIdleSessions().catch((err) => console.error(`idle sweep failed: ${safeErrorText(err)}`));
  }, SWEEP_INTERVAL_MS);
  sweeper.unref?.();
}

// —— 会话获取/创建 ——

/** 容量已满且无可逐出会话时抛出;ask.ts 据此回 429。 */
export class SessionCapacityError extends Error {
  constructor(limit: number) {
    super(`active agent session limit (${limit}) reached`);
    this.name = "SessionCapacityError";
  }
}

/** 会话已被另一请求持有(或 pi 侧仍在流式)时抛出;ask.ts 据此回 409。 */
export class SessionBusyError extends Error {
  constructor(sessionId: string) {
    super(`session ${sessionId} is already streaming`);
    this.name = "SessionBusyError";
  }
}

/**
 * 同步认领会话:**检查与置位之间不得有 await**,否则并发请求会双双通过。
 * 认领成功后该会话对逐出与空闲回收都不可见,调用方负责在收尾时 `busy = false`。
 */
export function claim(rec: RuntimeSession): RuntimeSession {
  if (rec.busy || rec.session.isStreaming) throw new SessionBusyError(rec.id);
  rec.busy = true;
  return rec;
}

/**
 * 冷启动串行链(codex review 两条 P1 的共同整改)。
 *
 * 「容量判定 → 逐出 → 建 pi 会话 → 注入历史 → 注册」这一整段必须互斥:
 *   - 不串行时,多个冷请求会**在任何会话注册进 registry 之前**同时通过容量检查,
 *     `MAX_ACTIVE_SESSIONS` 形同虚设;
 *   - 同一 sessionId 的两个冷请求会各建一个 `AgentSession`,`busy` 闸作用在不同
 *     对象上拦不住并发 prompt,后一次 `registry.set` 还会覆盖前一条记录——被覆盖的
 *     会话既回收不掉,又会造成消息 seq 冲突与上下文分叉。
 *
 * 代价是冷启动全局排队(单次约几百毫秒)。热路径(会话已在注册表)不进这条链,
 * 正常对话不受影响;并发冷启动本来就该限速——它同时是 pi 会话构造的闸。
 */
let coldStartChain: Promise<unknown> = Promise.resolve();

export function serializeColdStart<T>(fn: () => Promise<T>): Promise<T> {
  const run = coldStartChain.then(fn, fn);
  // 链本身不得因为某次失败而断掉
  coldStartChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function createRuntimeSession(sessionId: string): Promise<RuntimeSession> {
  const { pi, modelRuntime } = await getPiRuntime();
  // 配置从库读、逐次施加:所有者经 MCP 换了 provider/模型/key 之后,
  // 下一个新会话就用新配置(验收 ⑥)。未配置时抛 LlmNotConfiguredError → 503。
  const model = await applyLlmConfig(modelRuntime, await loadActiveLlmConfig());

  const now = Date.now();
  const rec: RuntimeSession = {
    id: sessionId,
    session: undefined as unknown as AgentSession,
    createdAt: now,
    lastActiveAt: now,
    busy: false,
    disposed: false,
    // 重建会话时轨迹 seq 必须从库内最大值续接,否则新事件撞既有行被静默丢弃
    seq: (await maxTraceSeq(sessionId)) + 1,
    pendingFlush: [],
    flushChain: Promise.resolve(),
    flushQueued: false,
  };

  const settingsManager = pi.SettingsManager.inMemory({ compaction: { enabled: false } });
  const loader = new pi.DefaultResourceLoader({
    cwd: ISOLATED_DIR,
    agentDir: ISOLATED_DIR,
    settingsManager,
    systemPromptOverride: () => SYSTEM_PROMPT,
    extensionFactories: [makeObserver(rec)],
  });
  await loader.reload();

  const { session } = await pi.createAgentSession({
    cwd: ISOLATED_DIR,
    agentDir: ISOLATED_DIR,
    modelRuntime,
    model,
    thinkingLevel: "low" as CreateAgentSessionOptions["thinkingLevel"],
    noTools: "all",
    resourceLoader: loader,
    sessionManager: pi.SessionManager.inMemory(ISOLATED_DIR),
    settingsManager,
  });

  rec.session = session;
  // R1 实测:bare createAgentSession 不广播 session_start/resources_discover 给扩展,
  // 这两个事件由 bindExtensions()(run 模式层)触发;headless 用 "print" 模式。
  await session.bindExtensions({ mode: "print" });
  return rec;
}

/** 库内历史压成一条 `role:"custom"` 消息注入(display:false,进 LLM 上下文不进 UI)。 */
async function injectHistory(rec: RuntimeSession): Promise<void> {
  const history = buildHistoryTranscript(await listMessages(rec.id));
  if (!history) return;
  try {
    await rec.session.sendCustomMessage(
      { customType: "xray_history", content: history, display: false },
      { triggerTurn: false },
    );
  } catch (err) {
    // 上下文注入失败不阻断提问:访客宁可少上下文,也好过整轮拒绝
    console.error(`history injection failed for session ${rec.id}: ${safeErrorText(err)}`);
  }
}

/**
 * 取回(或按库内历史重建)会话的运行时实例,**并原子地认领它**。
 *
 * 返回即代表调用方持有该会话(`busy === true`),必须在收尾时释放;已被他人持有抛
 * `SessionBusyError`(409),容量耗尽抛 `SessionCapacityError`(429)。认领放在这里
 * 而不是调用方,是因为「拿到会话」与「占住会话」之间一旦有 await,会话就可能被
 * 并发冷启动逐出,调用方随后 prompt 的是一个已 dispose 的 pi 会话。
 *
 * 调用方保证 `sessionId` 对应的 DB 行已存在(新会话由调用方在此之后建行)。
 */
export async function acquireSession(sessionId: string): Promise<RuntimeSession> {
  // 热路径:会话已在注册表 → 同步认领,不进冷启动串行链
  const existing = getRuntimeSession(sessionId);
  if (existing) return claim(existing);

  return serializeColdStart(async () => {
    // 排队期间别的请求可能已经把同一会话建好了
    const again = getRuntimeSession(sessionId);
    if (again) return claim(again);

    // 同 id 的旧实例正在释放:必须等它的最终 flush 落定,否则下面 createRuntimeSession
    // 里的 maxTraceSeq() 会读到旧批次提交前的值,复用在途 seq(复审 P1)
    const pendingDispose = disposing.get(sessionId);
    if (pendingDispose) await pendingDispose;

    if (activeSessions().length >= MAX_ACTIVE_SESSIONS) {
      const victim = selectEvictable(activeSessions());
      if (!victim) throw new SessionCapacityError(MAX_ACTIVE_SESSIONS);
      console.log(`evicting idle agent session ${victim.id} to make room for ${sessionId}`);
      await disposeSession(victim);
    }

    const rec = await createRuntimeSession(sessionId);
    await injectHistory(rec);
    // 注册与认领同步完成:新会话不会在调用方用它之前落入逐出候选
    registry.set(rec.id, rec);
    rec.busy = true;
    ensureSweeper();
    return rec;
  });
}
