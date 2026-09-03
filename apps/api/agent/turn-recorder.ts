// R-TOOLCARDS:一轮对话的「记录员」—— 喂 pi 会话事件,吐对话流帧与落库 payload。
//
// 为什么抽成纯函数模块而不是写在 ask.ts 的订阅回调里:会话区的工具调用卡要做到
// 「实时与回放同源」(任务卡验收 #3),实时帧与落库的 payload 必须出自同一份累积状态;
// 而这份状态的正确性(偏移、耗时、脱敏、无 end 事件的兜底)要能被 `encore test` 直接
// 断言,不起真实 provider。ask.ts 只负责把这里的输出发 SSE 与落库。
//
// 数据形态(所有者裁定 2026-09-03,任务卡「方案 · 数据形态」):一轮仍是**一条**助手消息,
// `content` = 全部助手正文按顺序拼接(语义不变,seq 方案不变);`payload` 里加一张
// **偏移表** —— 每次工具调用记「工具开始执行时 content 已累积的 JS 字符串长度」`at`,
// 前端按 `at` 把正文切段、把卡片插回去。偏移是 UTF-16 code unit 长度:写入方与切分方
// 都是 JS,同一字符串往返 Postgres TEXT 不变,不会错位。没有工具调用的一轮**不写 payload**,
// 与今天的行完全一样(验收 #4)。
//
// 脱敏口径不新造(docs/security.md §2 R-TOOLCARDS 补记):inputPreview / resultPreview
// 一律经 shared/redact.ts 的 previewText,与轨迹流的 argsPreview / resultPreview 是同一个函数、
// 同一个截断上限、同一套凭据键 / 值清洗。帧与 payload 里**只有摘要字符串,永不带 args / result
// 的原始结构**。唯一差别是截断标记:画板 2m 裁定卡片展开体的截断由服务端在切断处接
// `…(已截断)`,所以这里把 previewText 尾部的 `…[+N chars]` 换成这四个字,位置与长度不变。
import { previewText } from "../shared/redact";

/** 一次工具调用在会话区的记录(落库 payload 的元素,也是历史回放端点透出的形状)。 */
export interface ToolCallRecord {
  /** 与轨迹流同一 id,将来可互相定位(本轮不做) */
  toolCallId: string;
  name: string;
  /** 工具开始执行时 content 已累积的 JS 字符串长度 —— 卡片插在这个偏移处 */
  at: number;
  /** previewText(args):单行、截断、凭据脱敏 */
  inputPreview: string;
  /** previewText(result 的文本);无 end 事件(provider 中途 abort)时为空串 */
  resultPreview: string;
  isError: boolean;
  /** 无 end 事件时缺省 —— 前端显示为错误态、耗时留空 */
  durationMs?: number;
}

/** 一轮的处理过程摘要:折叠行(画板 2l)要的四项里的三项,第四项(有无失败)由 toolCalls 派生。 */
export interface TurnRecord {
  /** 本轮助手 message_end 计数(= Timeline 的 Turn 数) */
  modelRoundTrips: number;
  /** 访客消息落库 → 收尾的总耗时 */
  turnMs: number;
  toolCalls: ToolCallRecord[];
}

/** 落库形态(`messages.payload`;只在本轮有工具调用时写)。 */
export interface TurnPayload extends TurnRecord {
  v: 1;
}

/** 收尾帧(done / error)追加的两个数。**不带** model / provider / token / 费用(规则 8 / 9)。 */
export interface TurnSummary {
  modelRoundTrips: number;
  turnMs: number;
}

/** 对话流帧(`ask.ts` 原样发出;契约见 ask.ts 文件头与 apps/api/agent/README.md)。 */
export type TurnFrame =
  | { event: "delta"; data: { text: string } }
  | { event: "tool_start"; data: { toolCallId: string; name: string; at: number; inputPreview: string } }
  | {
      event: "tool_end";
      data: { toolCallId: string; resultPreview: string; isError: boolean; durationMs: number };
    };

export interface TurnRecorder {
  /** 喂一个 pi 会话事件;返回要发给客户端的帧(可能为空)。不认识的事件一律忽略。 */
  feed(event: unknown): TurnFrame[];
  /** 到目前为止累积的助手正文(= 落库的 content) */
  readonly text: string;
  /**
   * 收尾:把没等到 end 的工具调用按错误态兜底,算出总耗时。
   * `payload` 只在有工具调用时存在 —— 没有就是 undefined,落库写 NULL。
   */
  finish(): { summary: TurnSummary; payload?: TurnPayload };
}

/** 画板 2m:截断由服务端在切断处接 `…(已截断)`;previewText 的截断位置与长度照旧。 */
const TRUNCATED_MARK = /…\[\+\d+ chars\]$/;

export function preview(value: unknown): string {
  return previewText(value).replace(TRUNCATED_MARK, "…(已截断)");
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/**
 * 工具结果 → 用来做摘要的值。pi 的 AgentToolResult 是 `{content: [{type:"text", text}…], details}`,
 * 直接 JSON 化会让卡片上出现 `{"content":[{"type":"text","text":"…` 这种壳;这里先把文本块
 * 拼起来(与 events.ts 的 summarizeMessage 处理消息正文是同一做法),再过 previewText。
 * 没有文本块(纯图片结果等)或形状不认识时,整个值原样交给 previewText —— 不猜结构。
 */
export function resultText(result: unknown): unknown {
  if (isRecord(result) && Array.isArray(result.content)) {
    const parts = result.content
      .filter((b): b is Record<string, unknown> => isRecord(b) && typeof b.text === "string")
      .map((b) => b.text as string);
    if (parts.length > 0) return parts.join("\n");
  }
  return result;
}

export function createTurnRecorder(now: () => number = Date.now): TurnRecorder {
  const startedAt = now();
  let text = "";
  let modelRoundTrips = 0;
  const calls: ToolCallRecord[] = [];
  /** 已 start、未 end 的调用:toolCallId → 下标与开始时刻 */
  const open = new Map<string, { index: number; startedAt: number }>();

  return {
    get text() {
      return text;
    },

    feed(event) {
      if (!isRecord(event) || typeof event.type !== "string") return [];
      switch (event.type) {
        case "message_update": {
          const e = event.assistantMessageEvent;
          if (isRecord(e) && e.type === "text_delta" && typeof e.delta === "string") {
            text += e.delta;
            return [{ event: "delta", data: { text: e.delta } }];
          }
          return [];
        }
        case "message_end": {
          const m = event.message;
          if (isRecord(m) && m.role === "assistant") modelRoundTrips++;
          return [];
        }
        case "tool_execution_start": {
          // pi 总会给 toolCallId;万一没有,用序号兜底 —— 丢一张卡比整轮错位更糟
          const toolCallId =
            typeof event.toolCallId === "string" && event.toolCallId !== ""
              ? event.toolCallId
              : `tool-${calls.length}`;
          const rec: ToolCallRecord = {
            toolCallId,
            name: typeof event.toolName === "string" ? event.toolName : "",
            at: text.length,
            inputPreview: preview(event.args),
            resultPreview: "",
            isError: false,
          };
          open.set(toolCallId, { index: calls.length, startedAt: now() });
          calls.push(rec);
          return [
            {
              event: "tool_start",
              data: { toolCallId, name: rec.name, at: rec.at, inputPreview: rec.inputPreview },
            },
          ];
        }
        case "tool_execution_end": {
          const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : "";
          const o = open.get(toolCallId);
          if (!o) return []; // 没见过 start 的 end:不认识,不发帧
          open.delete(toolCallId);
          const rec = calls[o.index];
          rec.resultPreview = preview(resultText(event.result));
          rec.isError = event.isError === true;
          rec.durationMs = Math.max(0, now() - o.startedAt);
          return [
            {
              event: "tool_end",
              data: {
                toolCallId,
                resultPreview: rec.resultPreview,
                isError: rec.isError,
                durationMs: rec.durationMs,
              },
            },
          ];
        }
        default:
          return [];
      }
    },

    finish() {
      // 工具开始了但没有 end(provider 中途 abort):按错误态落库,耗时留空(任务卡「边界」)
      for (const { index } of open.values()) {
        calls[index].isError = true;
        calls[index].resultPreview = "";
      }
      open.clear();
      const summary: TurnSummary = { modelRoundTrips, turnMs: Math.max(0, now() - startedAt) };
      if (calls.length === 0) return { summary };
      return { summary, payload: { v: 1, ...summary, toolCalls: calls.map((c) => ({ ...c })) } };
    },
  };
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

/**
 * `messages.payload` → 历史回放端点透出的 `turn`(**字段白名单**,不透传整个 JSONB)。
 *
 * 旧行(payload NULL)、以及任何形状不对的 payload 一律回 undefined —— 前端据此只显示正文
 * (任务卡验收 #5「旧行退化正确」)。单个元素缺 name / at 就丢掉那一个元素,不让整轮退化。
 */
export function turnFromPayload(payload: unknown): TurnRecord | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.toolCalls)) return undefined;
  const toolCalls: ToolCallRecord[] = [];
  for (const c of payload.toolCalls) {
    if (!isRecord(c) || typeof c.name !== "string" || typeof c.at !== "number") continue;
    const rec: ToolCallRecord = {
      toolCallId: typeof c.toolCallId === "string" ? c.toolCallId : "",
      name: c.name,
      at: num(c.at),
      inputPreview: typeof c.inputPreview === "string" ? c.inputPreview : "",
      resultPreview: typeof c.resultPreview === "string" ? c.resultPreview : "",
      isError: c.isError === true,
    };
    if (typeof c.durationMs === "number" && Number.isFinite(c.durationMs)) rec.durationMs = c.durationMs;
    toolCalls.push(rec);
  }
  if (toolCalls.length === 0) return undefined;
  return { modelRoundTrips: num(payload.modelRoundTrips), turnMs: num(payload.turnMs), toolCalls };
}
