// pi SDK 34 种扩展事件 × 四模式清单 + 事件流脱敏(docs/security.md §2 强约束)。
// R1 在 spike/ 建立,R3 随正式采集点(agent/runtime.ts 观测者扩展)迁入 agent 服务:
// spike 被 `dev.ps1 build --services` 排除出生产镜像,正式服务不得依赖 spike 目录。
// 事件名以 @earendil-works/pi-coding-agent@0.84.3 dist/core/extensions/types.d.ts
// 的 34 个 `pi.on()` 重载为准;模式按 handler result 语义划分:
//   veto     = result 可取消/拦截(cancel / block / trust 裁决)
//   chain    = result(或就地改写)沿链传递、影响后续处理
//   takeover = result 可完全接管处理(handled / 替换执行)
//   notify   = 纯通知,无影响流程的 result
// 实测计数 notify 19 / veto 6 / chain 7 / takeover 2 = 34;
// docs/architecture.md 原记 notify 18(合计 33)已按本清单回改(CLAUDE.md 规则:以实测为准)。

export const PI_SDK_VERSION = "0.84.3";

export type EventMode = "notify" | "veto" | "chain" | "takeover";

export const EVENT_MODES: Record<string, EventMode> = {
  // veto(6)
  project_trust: "veto",
  session_before_switch: "veto",
  session_before_fork: "veto",
  session_before_compact: "veto",
  session_before_tree: "veto",
  tool_call: "veto",
  // chain(7)
  resources_discover: "chain",
  context: "chain",
  before_provider_request: "chain",
  before_provider_headers: "chain",
  before_agent_start: "chain",
  message_end: "chain",
  tool_result: "chain",
  // takeover(2)
  input: "takeover",
  user_bash: "takeover",
  // notify(19)
  session_start: "notify",
  session_info_changed: "notify",
  session_compact: "notify",
  session_compact_failed: "notify",
  session_shutdown: "notify",
  session_tree: "notify",
  after_provider_response: "notify",
  agent_start: "notify",
  agent_end: "notify",
  agent_settled: "notify",
  turn_start: "notify",
  turn_end: "notify",
  message_start: "notify",
  message_update: "notify",
  tool_execution_start: "notify",
  tool_execution_update: "notify",
  tool_execution_end: "notify",
  model_select: "notify",
  thinking_level_select: "notify",
};

export const ALL_EVENTS = Object.keys(EVENT_MODES);

export function modeCounts(): Record<EventMode, number> & { total: number } {
  const counts = { notify: 0, veto: 0, chain: 0, takeover: 0, total: 0 };
  for (const mode of Object.values(EVENT_MODES)) {
    counts[mode]++;
    counts.total++;
  }
  return counts;
}

// —— 事件脱敏:逐事件字段白名单(docs/security.md §2 强制)——
// 只有白名单里的顶层字段会被复制,未知字段(含未来 SDK 新增的任何凭据字段)一律丢弃。
// 富对象字段分两类处理(adversarial review 整改):
//   - payload / headers / preparation / 完整 message:永不放行,派生摘要替代;
//   - 工具入参/出参(args/result/input/content/partialResult):不复制结构,压成
//     单条截断文本预览(previewText),序列化时凭据键置 [redacted]、字符串值过
//     凭据模式清洗——未知嵌套字段不可能以结构形式存活。
// 放行的值仍经 sanitizeValue(截断 + 键数上限 + 凭据键/值兜底);单事件序列化超
// MAX_EVENT_BYTES 整体降级为 {type, oversized}。
const DROP_KEY =
  /authorization|api[-_]?key|apikey|token|secret|credential|cookie|passw|private[-_]?key|bearer|headers/i;
// 字符串值内的凭据形态(sk-/rk-/pk-/sess- 前缀串、Bearer 串)
const SECRET_VALUE_PATTERNS = [
  /\b(?:sk|rk|pk|sess)-[A-Za-z0-9_-]{10,}\b/g,
  /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
];
const MAX_STRING = 400;
const MAX_ARRAY = 20;
const MAX_DEPTH = 4;
const MAX_PROPS = 30;
const MAX_EVENT_BYTES = 8_192;

function scrubString(s: string): string {
  let out = s;
  for (const p of SECRET_VALUE_PATTERNS) out = out.replace(p, "[redacted]");
  return out;
}

function truncate(s: string, max = MAX_STRING): string {
  return s.length > max ? s.slice(0, max) + `…[+${s.length - max} chars]` : s;
}

export function sanitizeValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === "string") return truncate(scrubString(value as string));
  if (t === "number" || t === "boolean") return value;
  if (t === "bigint") return String(value);
  if (t === "function") return "[fn]";
  if (depth >= MAX_DEPTH) return "[depth]";
  if (typeof value === "object") {
    if (seen.has(value as object)) return "[circular]";
    seen.add(value as object);
    if (Array.isArray(value)) {
      const out = value.slice(0, MAX_ARRAY).map((v) => sanitizeValue(v, depth + 1, seen));
      if (value.length > MAX_ARRAY) out.push(`…[+${value.length - MAX_ARRAY} items]`);
      return out;
    }
    const out: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>);
    for (const [k, v] of entries.slice(0, MAX_PROPS)) {
      if (DROP_KEY.test(k)) {
        out[k] = "[redacted]";
        continue;
      }
      out[k] = sanitizeValue(v, depth + 1, seen);
    }
    if (entries.length > MAX_PROPS) out["…"] = `[+${entries.length - MAX_PROPS} props]`;
    return out;
  }
  return String(value);
}

/**
 * 任意值 → 单条截断文本预览:结构在序列化时展平,凭据键在 replacer 层置
 * [redacted](值根本不进入输出),字符串再过凭据模式清洗后截断。
 */
export function previewText(value: unknown, max = MAX_STRING): string {
  let s: string;
  if (typeof value === "string") {
    s = value;
  } else {
    try {
      s =
        JSON.stringify(value, (k, v) =>
          k !== "" && DROP_KEY.test(k) ? "[redacted]" : typeof v === "bigint" ? String(v) : v,
        ) ?? String(value);
    } catch {
      s = "[unserializable]";
    }
  }
  return truncate(scrubString(s), max);
}

/** 每个事件允许透出的顶层字段(值仍经 sanitizeValue)。未列出的事件只透出 type。 */
const EVENT_FIELD_WHITELIST: Record<string, string[]> = {
  project_trust: ["type", "cwd"],
  resources_discover: ["type", "cwd", "reason"],
  session_start: ["type", "reason", "previousSessionFile"],
  session_info_changed: ["type", "name"],
  session_before_switch: ["type", "reason", "targetSessionFile"],
  session_before_fork: ["type", "entryId", "position"],
  session_before_compact: ["type", "reason", "willRetry"],
  session_compact: ["type", "reason", "willRetry", "fromExtension"],
  session_compact_failed: ["type", "reason", "errorMessage", "aborted", "willRetry", "fromExtension"],
  session_shutdown: ["type", "reason"],
  session_before_tree: ["type"],
  session_tree: ["type", "newLeafId", "oldLeafId", "fromExtension"],
  context: ["type"],
  before_provider_request: ["type"], // payload: unknown,永不放行
  before_provider_headers: ["type"], // headers 永不放行
  after_provider_response: ["type", "status"], // headers 永不放行
  before_agent_start: ["type", "prompt"],
  agent_start: ["type"],
  agent_end: ["type"],
  agent_settled: ["type"],
  turn_start: ["type", "turnIndex", "timestamp"],
  turn_end: ["type", "turnIndex"],
  message_start: ["type"],
  message_update: ["type"],
  message_end: ["type"],
  // 工具入参/出参不放行原对象,一律派生为截断文本预览(见 EVENT_DERIVED)
  tool_execution_start: ["type", "toolCallId", "toolName"],
  tool_execution_update: ["type", "toolCallId", "toolName"],
  tool_execution_end: ["type", "toolCallId", "toolName", "isError"],
  model_select: ["type", "source"],
  thinking_level_select: ["type", "level", "previousLevel"],
  tool_call: ["type", "toolCallId", "toolName"],
  tool_result: ["type", "toolCallId", "toolName", "isError"],
  user_bash: ["type", "command", "excludeFromContext", "cwd"],
  input: ["type", "text", "source", "streamingBehavior"],
};

/** 对话消息(AgentMessage)只透出角色 + 文本预览,不复制完整结构。 */
function summarizeMessage(m: unknown): unknown {
  if (typeof m !== "object" || m === null) return undefined;
  const msg = m as { role?: unknown; content?: unknown };
  let preview = "";
  if (typeof msg.content === "string") {
    preview = msg.content;
  } else if (Array.isArray(msg.content)) {
    preview = msg.content
      .map((b) => (typeof b === "object" && b !== null && "text" in b ? String((b as { text: unknown }).text) : ""))
      .join("");
  }
  return {
    role: typeof msg.role === "string" ? msg.role : undefined,
    preview: preview.length > 200 ? preview.slice(0, 200) + "…" : preview,
  };
}

function summarizeModel(m: unknown): unknown {
  if (typeof m !== "object" || m === null) return undefined;
  const model = m as { provider?: unknown; id?: unknown; name?: unknown };
  return { provider: model.provider, id: model.id, name: model.name };
}

/** 流式增量事件只透出 type/contentIndex/delta(delta 过 previewText)。 */
function summarizeAssistantEvent(v: unknown): unknown {
  if (typeof v !== "object" || v === null) return undefined;
  const a = v as { type?: unknown; contentIndex?: unknown; delta?: unknown };
  return {
    type: typeof a.type === "string" ? a.type : undefined,
    contentIndex: typeof a.contentIndex === "number" ? a.contentIndex : undefined,
    delta: a.delta === undefined ? undefined : previewText(a.delta),
  };
}

/** 富对象字段的派生摘要(替代原值,不复制未知结构)。 */
const EVENT_DERIVED: Record<string, (e: Record<string, unknown>) => Record<string, unknown>> = {
  context: (e) => ({ messageCount: Array.isArray(e.messages) ? e.messages.length : 0 }),
  agent_end: (e) => ({ messageCount: Array.isArray(e.messages) ? e.messages.length : 0 }),
  turn_end: (e) => ({
    message: summarizeMessage(e.message),
    toolResultCount: Array.isArray(e.toolResults) ? e.toolResults.length : 0,
  }),
  message_start: (e) => ({ message: summarizeMessage(e.message) }),
  message_end: (e) => ({ message: summarizeMessage(e.message) }),
  message_update: (e) => ({ assistantMessageEvent: summarizeAssistantEvent(e.assistantMessageEvent) }),
  model_select: (e) => ({ model: summarizeModel(e.model), previousModel: summarizeModel(e.previousModel) }),
  tool_execution_start: (e) => ({ argsPreview: previewText(e.args) }),
  tool_execution_update: (e) => ({ partialResultPreview: previewText(e.partialResult) }),
  tool_execution_end: (e) => ({ resultPreview: previewText(e.result) }),
  tool_call: (e) => ({ inputPreview: previewText(e.input) }),
  tool_result: (e) => ({ contentPreview: previewText(e.content) }),
};

export function sanitizeEvent(eventType: string, event: unknown): unknown {
  if (typeof event !== "object" || event === null) return { type: eventType };
  const src = event as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const field of EVENT_FIELD_WHITELIST[eventType] ?? ["type"]) {
    if (field in src) out[field] = sanitizeValue(src[field]);
  }
  const derive = EVENT_DERIVED[eventType];
  if (derive) Object.assign(out, derive(src));
  // 单事件总量上限:进内存队列 / SSE 前的最终断言(adversarial review 整改)
  try {
    if (JSON.stringify(out).length > MAX_EVENT_BYTES) return { type: eventType, oversized: true };
  } catch {
    return { type: eventType, unserializable: true };
  }
  return out;
}

// —— 脱敏自测 fixtures(agent/events.test.ts 断言;/spike/events/audit 也在用)——
export interface SanitizeSelfTest {
  name: string;
  pass: boolean;
  detail: string;
}

export function runSanitizeSelfTests(): SanitizeSelfTest[] {
  const results: SanitizeSelfTest[] = [];
  const leakCheck = (name: string, eventType: string, event: unknown, secrets: string[]) => {
    const s = JSON.stringify(sanitizeEvent(eventType, event));
    const leaked = secrets.filter((x) => s.includes(x));
    results.push({
      name,
      pass: leaked.length === 0,
      detail: leaked.length === 0 ? `clean, ${s.length}B` : `LEAKED: ${leaked.join(",")}`,
    });
  };

  leakCheck(
    "tool_result 凭据键变体",
    "tool_execution_end",
    {
      type: "tool_execution_end",
      toolCallId: "t1",
      toolName: "demo",
      isError: false,
      result: {
        access_token: "SECRET-AT-1",
        refreshToken: "SECRET-RT-2",
        client_secret: "SECRET-CS-3",
        password: "SECRET-PW-4",
        private_key: "SECRET-PK-5",
      },
    },
    ["SECRET-AT-1", "SECRET-RT-2", "SECRET-CS-3", "SECRET-PW-4", "SECRET-PK-5"],
  );
  leakCheck(
    "tool_args 深层嵌套凭据键",
    "tool_execution_start",
    { type: "tool_execution_start", toolCallId: "t2", toolName: "demo", args: { cfg: { nested: { apiKey: "SECRET-NESTED-6" } } } },
    ["SECRET-NESTED-6"],
  );
  leakCheck(
    "字符串值内 Bearer/sk- 串",
    "tool_execution_start",
    {
      type: "tool_execution_start",
      toolCallId: "t3",
      toolName: "demo",
      args: { cmd: "curl -H 'Authorization: Bearer abcdef1234567890' https://x", note: "key=sk-abcdefghij0123456789" },
    },
    ["abcdef1234567890", "sk-abcdefghij0123456789"],
  );
  leakCheck(
    "provider headers 不透出",
    "before_provider_headers",
    { type: "before_provider_headers", headers: { Authorization: "SECRET-AUTH-7" } },
    ["SECRET-AUTH-7"],
  );
  leakCheck(
    "未知顶层字段丢弃",
    "agent_start",
    { type: "agent_start", futureCredentialField: "SECRET-FUT-8" },
    ["SECRET-FUT-8"],
  );

  const big: Record<string, string> = {};
  for (let i = 0; i < 2000; i++) big[`k${i}`] = "x".repeat(40);
  const bigOut = JSON.stringify(sanitizeEvent("tool_execution_end", { type: "tool_execution_end", toolCallId: "t4", toolName: "demo", isError: false, result: big }));
  results.push({
    name: "超大对象受限于 MAX_EVENT_BYTES",
    pass: bigOut.length <= MAX_EVENT_BYTES,
    detail: `${bigOut.length}B (cap ${MAX_EVENT_BYTES}B)`,
  });

  return results;
}
