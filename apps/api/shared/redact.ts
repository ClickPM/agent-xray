// 凭据脱敏原语(`docs/security.md` §2/§3 强约束,CLAUDE.md 规则 9)。
//
// R1 建于 spike/events.ts,R3 随采集点迁入 agent/events.ts,R4 抽到 shared/:
// agent(事件采集、provider 异常)与 trace(库异常)两个服务都要往日志里写外部
// 来的东西,脱敏口径必须是同一份实现,而不是各写一遍——也不该为了一个工具函数
// 让 trace 去 import agent 的内部模块(任务卡 D2)。
//
// 事件级的字段白名单与派生摘要仍留在 `agent/events.ts`:那是采集点的职责。

/** 键名命中即整值置 [redacted](含未来 SDK 新增的任何同形字段)。 */
export const DROP_KEY =
  /authorization|api[-_]?key|apikey|token|secret|credential|cookie|passw|private[-_]?key|bearer|headers/i;

/** 字符串值内的凭据形态(sk-/rk-/pk-/sess- 前缀串、Bearer 串)。 */
const SECRET_VALUE_PATTERNS = [
  /\b(?:sk|rk|pk|sess)-[A-Za-z0-9_-]{10,}\b/g,
  /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
];

export const MAX_STRING = 400;
const MAX_ARRAY = 20;
const MAX_DEPTH = 4;
const MAX_PROPS = 30;

export function scrubString(s: string): string {
  let out = s;
  for (const p of SECRET_VALUE_PATTERNS) out = out.replace(p, "[redacted]");
  return out;
}

/**
 * 上游文本 → 可以安全放进**错误对象**的文本(外呼组工具专用;R-WEBSEARCH 抓到的真泄漏)。
 *
 * 【为什么不能只靠调用点的 `safeErrorText`】那只保证「写进日志的那一行」是干净的,
 * 而一个带着明文 key 的 `Error` 对象本身会被传递、被别处 catch、被将来某个人
 * 直接 `console.error(err)`。凭据不该活到那一步 —— **在构造错误的地方就抹掉**。
 * (单测:上游把我们的 Authorization 头原样回显进 400 的响应体,实测复现过。)
 *
 * 两道叠着用,顺序无所谓:
 *   - `scrubString` —— 通用形态(sk-/rk-/pk-/sess- 前缀串、`Bearer …`),
 *     连"上游回显的是**别人**的 key"也一起打掉;
 *   - 精确替换本次用的 secret —— 形态不符合上面那几个模式的自定义网关 key
 *     (纯十六进制、UUID…)只有这一道能兜住。太短的 secret 不做精确替换:
 *     一个 3 字符的串会把正常文本打成筛子,而那样的 key 本来就不该存在。
 */
export function redactSecret(text: string, secret: string): string {
  const scrubbed = scrubString(text);
  return secret.length >= 8 ? scrubbed.split(secret).join("[redacted]") : scrubbed;
}

export function truncate(s: string, max = MAX_STRING): string {
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

/**
 * 异常 → 一行已脱敏摘要,**服务端日志的唯一入口**(R3 codex review P1)。
 *
 * provider SDK / 数据库驱动抛出的异常常把响应体、甚至请求配置(含 Authorization
 * 头)挂在自定义字段上;`console.error(msg, err)` 会把整个对象打进日志,违反
 * docs/security.md「明文凭据不进日志」。这里先把 Error 的 name/message 取出来
 * (它们不是可枚举属性,直接 JSON.stringify 会得到 `{}`),再过 previewText 的
 * 凭据键屏蔽 + 凭据串清洗 + 截断。**堆栈不进日志**——它对定位帮助有限,却是
 * 最容易把上游内联的凭据字面量带出来的地方。
 */
export function safeErrorText(err: unknown): string {
  if (err instanceof Error) {
    const cause = err.cause === undefined ? "" : ` (cause: ${previewText(err.cause, 200)})`;
    return `${previewText(`${err.name}: ${err.message}`)}${cause}`;
  }
  return previewText(err);
}
