// R-CROSSLINK:「把一句预设文本放进输入框,永不自动发送」这个原语的**纯函数那一半**
// (画板 2q / 2r / 4v / 4x,以及 1b / 4f 的注释面板)。
//
// 两件事在这里:
//   1. `askWhyText` —— Timeline 行 → 一句追问(画板 1b/2q 定的两种形状);
//   2. `sanitizePrefill` / `readAskParam` —— 预填文本的边界,**按钮与 URL 走同一条**。
//
// 【为什么边界是这个文件的事,而不是组件的事】`docs/security.md` §0 第 10 条:
// `/?ask=` 让任何人都能构造一条链接,使访客的输入框里出现任意文本(prompt injection 换了个入口)。
// 兜底是「不自动发送」+ 这三条:读一次即清(在 Workbench 里做,那是 DOM 的事)、
// **长度上限 1000 且超出整段丢弃**、去掉控制字符。放在纯函数里是为了 `bun test lib` 能钉住它们。
//
// 【为什么超出是丢弃而不是截断】截断会产生一句**被改过的话**:访客看到的是半句,
// 发出去的也是半句,而他以为那就是链接想让他问的。整段丢弃 = 输入框空着,访客自己打字。
import type { TraceRow } from "./types";

/** 预填文本长度上限(字符数)。超出整段丢弃,不截断。 */
export const MAX_PREFILL = 1000;

/**
 * 追问句里入参摘要的长度上限。
 *
 * 事件的 `inputPreview` 在服务端已脱敏并压到单行(events.ts 的 previewText,≤400),
 * 这里再收一道:它要进的是**输入框**,访客得能一眼读完再决定发不发。
 */
const INPUT_IN_SENTENCE = 120;

/**
 * 控制字符与格式字符:C0/C1 控制符(含换行、制表)+ 零宽 / 双向覆盖这类不可见字符,
 * **外加 U+2028 / U+2029**(行分隔符 / 段分隔符)。
 *
 * 换行也去掉不是顺手:输入框会随内容增高但五行封顶,换行进去等于把后半句推到框外,
 * 而「访客看得见」正是这个原语的全部兜底(`docs/security.md` §0 第 10 条)。
 * 零宽与 bidi 属同一类问题(藏字)。
 *
 * 【U+2028 / U+2029 要单列】(codex 第 2 轮 P2)它们的 Unicode 类别是 `Zl` / `Zp`,
 * **不在 `Cc` / `Cf` 里**,而浏览器把它们当换行渲染 —— `/?ask=safe%E2%80%A8hidden`
 * 就能在「看起来只有一行」的框里藏下后半句。
 */
const INVISIBLE = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;

/**
 * 预填文本的清洗:去控制字符 → 去首尾空白 → 空串与超长都判为「没有预填」。
 *
 * 长度按**清洗前**的原文算:一段 5000 字的控制字符不该因为清洗后变短就放行。
 */
export function sanitizePrefill(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  if (raw.length > MAX_PREFILL) return null;
  const text = raw.replace(INVISIBLE, "").trim();
  return text === "" ? null : text;
}

/**
 * `?ask=<text>` → 预填文本。入参是 `window.location.search`(含前导 `?`)。
 *
 * 用 `URLSearchParams` 而不是 `useSearchParams`:后者在 Next 15 里要求外面套 Suspense,
 * 否则整页退化成 CSR bailout(任务卡裁定 7)。读取的时机与「读一次即清」都在 Workbench。
 */
export function readAskParam(search: string): string | null {
  let raw: string | null;
  try {
    raw = new URLSearchParams(search).get("ask");
  } catch {
    return null; // 畸形 query 不是错误,只是没有预填
  }
  return sanitizePrefill(raw);
}

/** 单行摘要收到上限内;超出接 `…`(与服务端 previewText 同一个记号) */
function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Timeline 行 → 一句追问(画板 1b / 2q / 4v 的注释面板定的两种形状):
 *
 *   工具行  「在 Turn 2 里你调用了 web_search,入参是 {"query":"encore bun runtime"}。为什么要这么做?」
 *   非工具行「在 Turn 2 里 context 这一步做了什么?为什么需要它?」
 *
 * **只用 Timeline 行上拿得到的字段**:Turn 标签 + 事件名(+ 工具行的工具名与入参摘要)。
 * 没有行号 / 序号(访客与模型都看不到那个号,写进句子等于让模型去猜)、没有模型名、没有 provider 名。
 *
 * 工具行少了 `toolName` 时(理论上不会:`tool_call` 的白名单里就有它)退回非工具形状 ——
 * 编一个工具名比问得笼统更糟。
 */
export function askWhyText(row: TraceRow, turnLabel: string): string {
  const turn = turnLabel.trim() || "这一轮";
  if (row.eventType === "tool_call" && row.toolName) {
    const input = row.inputPreview?.trim();
    const withInput = input ? `,入参是 ${clip(input, INPUT_IN_SENTENCE)}` : "";
    return `在 ${turn} 里你调用了 ${row.toolName}${withInput}。为什么要这么做?`;
  }
  return `在 ${turn} 里 ${row.eventType} 这一步做了什么?为什么需要它?`;
}
