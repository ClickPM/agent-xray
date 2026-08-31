// R4:轨迹事件流 → 右栏三视图的投影(纯函数)。
//
// `docs/architecture.md` 的原话:「前端右栏三视图 = 同一事件流的三种投影」。
// 组件只负责渲染,所有"事件长什么样 → 界面显示什么"的推导都集中在这里,
// 便于单测,也保证三个视图对同一份数据的解读是一致的。
//
// 事件在服务端采集时就已按白名单脱敏(apps/api/agent/events.ts),这里拿到的
// `data` 不可能含凭据字段,故不再做第二遍清洗——脱敏只有一个口径,免得两处漂移。
import type { ChainViewModel, LifeNode, TraceEvent, TraceRow, TraceTurn } from "./types";

/** 事件模式配色,与 design/README.md「事件模式」token 一致。 */
export const EV = {
  chain: "#2563eb",
  notify: "#9ca3af",
  veto: "#ef4444",
  takeover: "#f9c22e",
} as const;

/** Timeline 色条宽度:与设计稿同款算法(design/README.md)。 */
export const barWidth = (ms: number) =>
  Math.min(198, Math.max(4, Math.round(Math.sqrt(ms) * 11)));

const MAX_PREVIEW = 400;

/** 毫秒 → 设计稿口径的时长文本(`12ms` / `1.2s`)。 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * 脱敏后的事件数据 → 单行摘要,排版沿用设计稿 1b 的 `{ k: v, … }` 写法。
 * `type` 字段与行名重复,不再展示。
 */
export function formatEventData(data: unknown): string {
  if (data === null || data === undefined) return "—";
  if (typeof data !== "object") return String(data);
  const entries = Object.entries(data as Record<string, unknown>).filter(([k]) => k !== "type");
  if (entries.length === 0) return "(无附加字段)";
  const body = entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ");
  const text = `{ ${body} }`;
  return text.length > MAX_PREVIEW ? `${text.slice(0, MAX_PREVIEW)}…` : text;
}

/** 事件行名:有工具名时按设计稿 `tool_call · read_file` 的写法补上。 */
function rowName(event: TraceEvent, count: number): string {
  const toolName = (event.data as { toolName?: unknown } | null)?.toolName;
  const base = typeof toolName === "string" ? `${event.eventType} · ${toolName}` : event.eventType;
  return count > 1 ? `${base} ×${count}` : base;
}

/** 除 `type` 外还有内容的事件才值得展开详情。 */
function hasDetail(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  return Object.keys(data as Record<string, unknown>).some((k) => k !== "type");
}

interface EventRun {
  events: TraceEvent[];
}

/**
 * 「新一轮 agent run 开场」的标志事件。`input` 是每次提问的第一个事件;
 * 运行时会话被回收后重建时,`session_start` 会排在 `input` 之前,所以两个都要认。
 * 认漏了不会出错,只是那几个开场事件退回到挂在上一个 Turn 末尾。
 */
const RUN_START_EVENTS = new Set(["session_start", "input"]);

/**
 * 折叠连续的同类型事件。
 *
 * **不折叠就没法看**:实测一轮普通对话里 `message_update` 有 97 条(每个 token 一条),
 * 逐条铺开会把瀑布冲成 97 行一模一样的东西,设计稿 1a 的一行 `message_update` 才是
 * 本意。折叠只合并**相邻**的同类型事件,不打乱时序。
 */
function collapseRuns(events: TraceEvent[]): EventRun[] {
  const runs: EventRun[] = [];
  for (const event of events) {
    const last = runs[runs.length - 1];
    if (last && last.events[0].eventType === event.eventType) last.events.push(event);
    else runs.push({ events: [event] });
  }
  return runs;
}

function toRow(run: EventRun, nextStart: number | undefined, streaming: boolean): TraceRow {
  const first = run.events[0];
  const last = run.events[run.events.length - 1];
  // 行时长 = 本行第一个事件 → 下一行第一个事件。对折叠行就是这段流式的跨度,
  // 对单事件行就是"到下一件事发生"的间隔,两者口径一致。
  const ms = Math.max(0, (nextStart ?? last.timestamp) - first.timestamp);
  return {
    key: `s${first.seq}`,
    name: rowName(first, run.events.length),
    ms,
    dur: streaming ? "…" : formatDuration(ms),
    color: EV[first.mode] ?? EV.notify,
    streaming,
    expandable: hasDetail(first.data),
    detail: {
      input: formatEventData(first.data),
      extension: "xray-observer",
      // 本站只挂了一个观测者扩展,它订阅全部 34 种事件但从不改写任何值
      // (`noTools:'all'` + handler 一律返回 undefined)。如实呈现,不编造链式修改。
      returned: "undefined",
      diff: "(无变更 — 观测者只读)",
    },
  };
}

/**
 * 事件流 → Timeline 的 turn 分组。
 *
 * 分组边界取 `turn_start`(pi 的一次 LLM 往返 = 一个 turn,与设计稿 1a 的
 * Turn 1 / Turn 2 同义)。首个 `turn_start` 之前的准备事件(session_start /
 * input / before_agent_start …)并入它所引出的那个 turn;末尾收尾事件
 * (agent_end / agent_settled)留在最后一个 turn。
 */
export function toTimelineTurns(events: TraceEvent[], streaming = false): TraceTurn[] {
  if (events.length === 0) return [];

  // 分组有两个都踩过的坑,改之前先读完(codex 初审 P2 + 复审 P2):
  //   1. 别写成"一路攒着、遇到 turn_start 一起开组"——那样第二个 turn_start 会把
  //      **第一个 turn 的正文**连同自己塞进 Turn 2,每个 turn 整体错位一格
  //      (单 turn 的会话看不出来,所以浏览器实测漏掉过);
  //   2. 也别写成"turn_start 之后的一切都追加到当前组"——下一轮提问的开场事件
  //      (input / before_agent_start / agent_start,会话重建时还带 session_start)
  //      发生在下一个 turn_start **之前**,会被挂到上一个 Turn 的末尾。
  // 正确形状:turn_start 开新组;其后的事件追加到当前组;**一旦遇到下一轮 agent run
  // 的开场事件就重新进入暂存**,等它引出的 turn_start 一起开下一组。
  const groups: TraceEvent[][] = [];
  let prelude: TraceEvent[] = [];
  let buffering = true; // 会话开头本来就在暂存态
  for (const event of events) {
    if (event.eventType === "turn_start") {
      groups.push([...prelude, event]);
      prelude = [];
      buffering = false;
      continue;
    }
    if (RUN_START_EVENTS.has(event.eventType)) buffering = true;
    if (buffering || groups.length === 0) prelude.push(event);
    else groups[groups.length - 1].push(event);
  }
  // 末尾还攒着一批(最后一轮刚开场、turn_start 还没到):自成一组
  if (prelude.length > 0) groups.push(prelude);

  const lastSeq = events[events.length - 1].seq;
  return groups.map((group, i) => {
    const runs = collapseRuns(group);
    return {
      label: `Turn ${i + 1}`,
      rows: runs.map((run, j) => {
        const nextStart = runs[j + 1]?.events[0].timestamp;
        const isTail = run.events[run.events.length - 1].seq === lastSeq;
        return toRow(run, nextStart, streaming && isTail);
      }),
    };
  });
}

/**
 * 事件流 → Chain View(设计稿 1c):取会话内**最近一个 chain 模式事件**,
 * 展示它沿扩展链传递的过程。
 */
export function toChainView(events: TraceEvent[]): ChainViewModel {
  let latest: TraceEvent | undefined;
  for (const event of events) if (event.mode === "chain") latest = event;

  if (!latest) {
    return {
      event: "—",
      subtitle: "等待链式事件…",
      raw: "—",
      steps: [],
    };
  }

  return {
    event: latest.eventType,
    subtitle: "链式传递 · 1 个扩展参与",
    raw: formatEventData(latest.data),
    steps: [
      {
        name: "xray-observer",
        badge: "未修改",
        badgeColor: EV.notify,
        lines: [{ text: "(原样沿链传递 — 观测者只订阅,不改写)", muted: true }],
      },
    ],
  };
}

/**
 * 生命周期图(设计稿 1d/1e)的节点骨架。节点集合是设计终稿定死的,
 * 不随实际事件增删——`tool_*` 三个节点在 `noTools:'all'` 下恒为 pending,
 * 这是本站的实情(没有工具就不会有工具事件),如实显示。
 */
const LIFE_NODES: Array<{ name: string; event?: string }> = [
  { name: "session_start", event: "session_start" },
  { name: "before_agent_start", event: "before_agent_start" },
  { name: "context", event: "context" },
  { name: "before_provider_request", event: "before_provider_request" },
  { name: "LLM" },
  { name: "tool_call", event: "tool_call" },
  { name: "tool_execution", event: "tool_execution_start" },
  { name: "tool_result", event: "tool_result" },
  { name: "message_update", event: "message_update" },
  { name: "turn_end", event: "turn_end" },
  { name: "agent_end", event: "agent_end" },
  { name: "session_shutdown", event: "session_shutdown" },
];

export function toLifecycleNodes(events: TraceEvent[], streaming = false): LifeNode[] {
  const counts = new Map<string, number>();
  for (const event of events) counts.set(event.eventType, (counts.get(event.eventType) ?? 0) + 1);
  const lastType = events[events.length - 1]?.eventType;

  return LIFE_NODES.map(({ name, event }) => {
    if (!event) {
      // LLM 节点没有对应事件:有轨迹就是"接过活的",空会话是待命态
      return { name, state: events.length > 0 ? "llm" : "llmIdle", count: "" };
    }
    if (streaming && event === lastType) return { name, state: "active", count: "" };
    const n = counts.get(event) ?? 0;
    return n > 0
      ? { name, state: "fired", count: `×${n}` }
      : { name, state: "pending", count: "" };
  });
}
