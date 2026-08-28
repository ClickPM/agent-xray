// R1 spike:pi SDK in-process 惰性初始化、观测者扩展、会话注册表、内存基线采集。
// 仅验证用,R3/R4 正式 agent/trace 服务落地后整体移除(rounds/round-01/round-01.md)。
import { APIError } from "encore.dev/api";
import { secret } from "encore.dev/config";
import { randomUUID } from "node:crypto";
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
import { appendTraceEvents } from "../agent/store";
import { ALL_EVENTS, EVENT_MODES, sanitizeEvent, type EventMode } from "./events";

const deepSeekApiKey = secret("DeepSeekApiKey");

// pi 的资源发现(extensions/skills/settings/AGENTS.md)全部指向一个空的隔离目录:
// in-process 进程绝不能加载本机 ~/.pi 下的用户扩展/工具(docs/security.md §1)。
const ISOLATED_DIR = join(tmpdir(), "agent-xray-spike-pi");

// —— 内存基线 ——
export interface MemSnapshot {
  stage: string;
  at: number;
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
}

const memLog: MemSnapshot[] = [];

export function snapshotMem(stage: string): MemSnapshot {
  const m = process.memoryUsage();
  const snap: MemSnapshot = {
    stage,
    at: Date.now(),
    rss: m.rss,
    heapUsed: m.heapUsed,
    heapTotal: m.heapTotal,
    external: m.external,
  };
  memLog.push(snap);
  if (memLog.length > 200) memLog.shift();
  return snap;
}

export function getMemLog(): MemSnapshot[] {
  return memLog;
}

snapshotMem("module_load");

// —— pi 惰性加载(动态 import,便于测 import 增量)——
type PiModule = typeof import("@earendil-works/pi-coding-agent");

let piPromise: Promise<PiModule> | undefined;
let piLoaded = false;

export function isPiLoaded(): boolean {
  return piLoaded;
}

export function loadPi(): Promise<PiModule> {
  if (!piPromise) {
    snapshotMem("import_before");
    piPromise = import("@earendil-works/pi-coding-agent").then((mod) => {
      piLoaded = true;
      snapshotMem("import_after");
      return mod;
    });
  }
  return piPromise;
}

// —— ModelRuntime 单例(隔离路径 + secret 注入 key,凭据不落盘)——
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
      await modelRuntime.setRuntimeApiKey("deepseek", deepSeekApiKey());
      return { pi, modelRuntime };
    })();
    runtimePromise.catch(() => {
      runtimePromise = undefined;
    });
  }
  return runtimePromise;
}

// —— 观测者扩展与会话注册表 ——
export interface CapturedEvent {
  seq: number;
  eventType: string;
  mode: EventMode;
  timestamp: number;
  data: unknown;
}

export interface SpikeSessionRecord {
  id: string;
  session: AgentSession;
  createdAt: number;
  disposed: boolean;
  /** 会话行已落库(ask.ts 建行成功后置位);未持久化的会话(如 mem 基线)不触发落库 */
  persisted: boolean;
  seq: number;
  /**
   * 待落库事件队列,与展示数组 events 分离(adversarial review high:
   * 展示数组的容量逐出不得造成落库缺口)。flush 排干本队列,失败整批退回队首重试;
   * 超 PENDING_FLUSH_MAX 丢最旧并显式记日志——丢弃只会发生在这条日志之后,绝不静默。
   */
  pendingFlush: CapturedEvent[];
  /** flush 串行化链:同会话任意时刻只有一个批量写在跑 */
  flushChain: Promise<void>;
  /** 水位触发的 flush 已排队,避免高频事件重复入队 */
  flushQueued: boolean;
  events: CapturedEvent[];
  listeners: Set<(e: CapturedEvent) => void>;
  subscribed: string[];
  subscribeErrors: { name: string; error: string }[];
}

const MAX_EVENTS_PER_SESSION = 2000;
// 待落库队列达到该水位就触发一次增量 flush(codex review P2:长对话轨迹不丢头)
const FLUSH_THRESHOLD = 500;
// 待落库队列硬上限(内存安全,R1 基线同口径):库持续不可用时丢最旧并显式记日志
export const PENDING_FLUSH_MAX = 5000;
const MAX_ACTIVE_SESSIONS = 8;

const registry = new Map<string, SpikeSessionRecord>();

export function getSession(id: string): SpikeSessionRecord | undefined {
  return registry.get(id);
}

export function listSessions(): SpikeSessionRecord[] {
  return [...registry.values()];
}

function capture(rec: SpikeSessionRecord, eventType: string, event: unknown): void {
  const captured: CapturedEvent = {
    seq: rec.seq++,
    eventType,
    mode: EVENT_MODES[eventType],
    timestamp: Date.now(),
    data: sanitizeEvent(eventType, event),
  };
  rec.events.push(captured);
  if (rec.events.length > MAX_EVENTS_PER_SESSION) rec.events.shift();
  queuePendingEvent(rec, captured);
  maybeScheduleFlush(rec);
  for (const listener of rec.listeners) listener(captured);
}

/**
 * 事件入待落库队列(展示数组容量与落库解耦)。队列超硬上限时丢最旧一条并
 * 显式记日志——这是唯一允许丢事件的位置,丢弃必然伴随日志,不存在静默缺口。
 */
export function queuePendingEvent(rec: SpikeSessionRecord, e: CapturedEvent): void {
  rec.pendingFlush.push(e);
  if (rec.pendingFlush.length > PENDING_FLUSH_MAX) {
    const dropped = rec.pendingFlush.shift()!;
    console.error(
      `trace backlog overflow for session ${rec.id}: dropped seq ${dropped.seq} (cap ${PENDING_FLUSH_MAX})`,
    );
  }
}

/** 待落库队列超水位时排队一次增量 flush(fire-and-forget,失败只记日志并留队重试)。 */
function maybeScheduleFlush(rec: SpikeSessionRecord): void {
  if (!rec.persisted || rec.disposed || rec.flushQueued) return;
  if (rec.pendingFlush.length < FLUSH_THRESHOLD) return;
  rec.flushQueued = true;
  void flushTraceEvents(rec)
    .catch((err) => console.error("incremental trace flush failed:", err))
    .finally(() => {
      rec.flushQueued = false;
    });
}

function makeObserver(rec: SpikeSessionRecord): InlineExtension {
  return {
    name: "xray-observer",
    factory: (pi: ExtensionAPI) => {
      // 34 个事件名全量订阅。除 project_trust 外 handler 一律返回 undefined,
      // 不干预 veto/chain/takeover 流程;project_trust 的运行时契约要求必须返回
      // { trusted },观测者返回 "undecided" 表示不做裁决(codex review P2)。
      const on = pi.on.bind(pi) as (name: string, handler: (event: unknown) => unknown) => void;
      for (const name of ALL_EVENTS) {
        try {
          on(name, (event) => {
            capture(rec, name, event);
            return name === "project_trust" ? { trusted: "undecided" } : undefined;
          });
          rec.subscribed.push(name);
        } catch (err) {
          rec.subscribeErrors.push({ name, error: String(err) });
        }
      }
    },
  };
}

export interface CreateSpikeSessionOptions {
  thinking?: string;
  /** false = 不进注册表(内存基线测量用,调用方自行 dispose) */
  track?: boolean;
}

export async function createSpikeSession(
  opts: CreateSpikeSessionOptions = {},
): Promise<SpikeSessionRecord> {
  const active = [...registry.values()].filter((r) => !r.disposed).length;
  if (opts.track !== false && active >= MAX_ACTIVE_SESSIONS) {
    throw APIError.resourceExhausted(`spike session limit (${MAX_ACTIVE_SESSIONS}) reached`);
  }

  const { pi, modelRuntime } = await getPiRuntime();
  const model = modelRuntime.getModel("deepseek", "deepseek-v4-flash");
  if (!model) throw APIError.internal("deepseek/deepseek-v4-flash not in model catalog");

  const rec: SpikeSessionRecord = {
    id: randomUUID(),
    session: undefined as unknown as AgentSession,
    createdAt: Date.now(),
    disposed: false,
    persisted: false,
    seq: 0,
    pendingFlush: [],
    flushChain: Promise.resolve(),
    flushQueued: false,
    events: [],
    listeners: new Set(),
    subscribed: [],
    subscribeErrors: [],
  };

  const settingsManager = pi.SettingsManager.inMemory({ compaction: { enabled: false } });
  const loader = new pi.DefaultResourceLoader({
    cwd: ISOLATED_DIR,
    agentDir: ISOLATED_DIR,
    settingsManager,
    systemPromptOverride: () =>
      "You are the Agent X-Ray runtime spike. Reply concisely in the user's language.",
    extensionFactories: [makeObserver(rec)],
  });
  await loader.reload();

  const thinkingLevel = (opts.thinking ?? "low") as CreateAgentSessionOptions["thinkingLevel"];

  const { session } = await pi.createAgentSession({
    cwd: ISOLATED_DIR,
    agentDir: ISOLATED_DIR,
    modelRuntime,
    model,
    thinkingLevel,
    noTools: "all",
    resourceLoader: loader,
    sessionManager: pi.SessionManager.inMemory(ISOLATED_DIR),
    settingsManager,
  });

  rec.session = session;
  // 实测:bare createAgentSession 不广播 session_start/resources_discover 给扩展,
  // 这两个事件由 bindExtensions()(run 模式层)触发;headless 用 "print" 模式(hasUI=false)。
  await session.bindExtensions({ mode: "print" });
  if (opts.track !== false) registry.set(rec.id, rec);
  return rec;
}

/**
 * 排干待落库队列,批量写入 Postgres(R2;事件在采集时已脱敏)。
 * 经 flushChain 串行化:水位触发的增量 flush 与请求收尾的最终 flush 不并发。
 * 写库失败时整批退回队首,由后续 flush 重试——队列是唯一事实来源,不存在
 * 跨缺口推进游标的问题;appendTraceEvents 幂等(ON CONFLICT DO NOTHING),
 * 「提交成功但连接断开」的重试不会产生重复行。
 */
export function flushTraceEvents(rec: SpikeSessionRecord): Promise<void> {
  const run = async () => {
    if (rec.pendingFlush.length === 0) return;
    const batch = rec.pendingFlush.splice(0, rec.pendingFlush.length);
    try {
      await appendTraceEvents(rec.id, batch);
    } catch (err) {
      rec.pendingFlush.unshift(...batch);
      throw err;
    }
  };
  rec.flushChain = rec.flushChain.then(run, run);
  return rec.flushChain;
}

export function disposeSpikeSession(rec: SpikeSessionRecord): void {
  if (rec.disposed) return;
  rec.session.dispose();
  rec.disposed = true;
  rec.listeners.clear();
  rec.pendingFlush.length = 0;
  // 出注册表:建行失败等错误路径反复触发时不得无界残留(adversarial review medium);
  // track:false 会话本就不在注册表,delete 为 no-op
  registry.delete(rec.id);
}
