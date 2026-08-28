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
  seq: number;
  events: CapturedEvent[];
  listeners: Set<(e: CapturedEvent) => void>;
  subscribed: string[];
  subscribeErrors: { name: string; error: string }[];
}

const MAX_EVENTS_PER_SESSION = 2000;
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
  for (const listener of rec.listeners) listener(captured);
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
    seq: 0,
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

export function disposeSpikeSession(rec: SpikeSessionRecord): void {
  if (rec.disposed) return;
  rec.session.dispose();
  rec.disposed = true;
  rec.listeners.clear();
}
