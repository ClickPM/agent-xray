// R1 spike:pi SDK 34 种扩展事件 × 四模式清单。
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
// 只有白名单里的顶层字段会被复制,未知字段(含未来 SDK 新增的任何凭据字段)一律丢弃;
// 富对象字段(payload / headers / preparation / 完整 message 等)不放行,必要信息以
// 派生摘要替代。放行的值仍经 sanitizeValue 截断 + 凭据键黑名单,作第二层纵深防御。
const DROP_KEY = /^(authorization|api[-_]?key|apikey|x-api-key|key|token|secret|credential|cookie|headers)$/i;
const MAX_STRING = 400;
const MAX_ARRAY = 20;
const MAX_DEPTH = 4;

export function sanitizeValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === "string") {
    const s = value as string;
    return s.length > MAX_STRING ? s.slice(0, MAX_STRING) + `…[+${s.length - MAX_STRING} chars]` : s;
  }
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
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (DROP_KEY.test(k)) {
        out[k] = "[redacted]";
        continue;
      }
      out[k] = sanitizeValue(v, depth + 1, seen);
    }
    return out;
  }
  return String(value);
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
  message_update: ["type", "assistantMessageEvent"],
  message_end: ["type"],
  tool_execution_start: ["type", "toolCallId", "toolName", "args"],
  tool_execution_update: ["type", "toolCallId", "toolName", "partialResult"],
  tool_execution_end: ["type", "toolCallId", "toolName", "result", "isError"],
  model_select: ["type", "source"],
  thinking_level_select: ["type", "level", "previousLevel"],
  tool_call: ["type", "toolCallId", "toolName", "input"],
  tool_result: ["type", "toolCallId", "toolName", "content", "isError"],
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
  model_select: (e) => ({ model: summarizeModel(e.model), previousModel: summarizeModel(e.previousModel) }),
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
  return out;
}
