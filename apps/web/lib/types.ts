// 与 design/Agent Runtime Workbench.dc.html 的 dc-script 数据结构一一对应。

export type EventMode = "notify" | "veto" | "chain" | "takeover";

/** 轨迹事件(/trace/stream 的 `event: trace` 帧;data 在服务端采集时已脱敏) */
export interface TraceEvent {
  seq: number;
  eventType: string;
  mode: EventMode;
  /** epoch ms */
  timestamp: number;
  data: unknown;
}

/** 画板 1b 的事件详情卡内容 */
export interface TraceRowDetail {
  input: string;
  extension: string;
  returned: string;
  diff: string;
}

export interface TraceRow {
  /** React key:同一 turn 内行名可能重复(如两次 context),用首个事件 seq 保证唯一 */
  key: string;
  name: string;
  ms: number;
  dur: string;
  color: string;
  hasBadge?: boolean;
  hasNote?: boolean;
  /** 注记「└ <扩展名> returned {block: true}」里的扩展名;由事件的 `handlers` 派生(R-SKILLS-2),hasNote 为真时必有 */
  blockedBy?: string;
  streaming?: boolean;
  /** 点击可展开详情(画板 1b 的 context 行) */
  expandable?: boolean;
  detail?: TraceRowDetail;
}

export interface TraceTurn {
  label: string;
  rows: TraceRow[];
}

/**
 * 会话区里的一次工具调用(画板 1a 的卡 + 2m 的展开体)。形状与后端 `ChatMessage.turn.toolCalls[]`
 * 一致(`turn-recorder.ts` 的 ToolCallRecord),实时时由 SSE 的 tool_start / tool_end 两帧逐步填出。
 * `at` = 工具开始执行时正文已累积的 JS 字符串长度,卡片插在这个偏移处。
 * `durationMs` 缺省 = 还没等到 tool_end(实时)或没等到就结束了(回放,此时 isError 为 true)。
 */
export interface ToolCallView {
  toolCallId: string;
  name: string;
  at: number;
  inputPreview: string;
  resultPreview: string;
  isError: boolean;
  durationMs?: number;
}

/** 一轮的处理过程(R-TOOLCARDS):折叠行(画板 2l)要的数据只有这些。 */
export interface TurnView {
  modelRoundTrips: number;
  turnMs: number;
  toolCalls: ToolCallView[];
}

/**
 * 会话区的一项 = 一轮里的一方。助手项是 turn 级的:`turn` 只在本轮有工具调用时存在
 * (没有就与改动前的纯正文渲染一字不差),`done` = 这一轮已收尾(折叠只在那一刻发生一次,画板 2l 规则 2)。
 * 首版的 `kind: "tool"` 项(独立的一行工具卡)删除:R3 切真实数据源后从未被生产过,
 * 现在卡片的位置由 `turn.toolCalls[].at` 决定,不再是独立的项。
 */
export type ChatItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; turn?: TurnView; done: boolean };

/** Chain View(画板 1c):单个 chain 事件沿扩展链传递的过程 */
export interface ChainStepLine {
  text: string;
  muted?: boolean;
  highlight?: string;
}

export interface ChainStep {
  name: string;
  badge: string;
  badgeColor: string;
  lines: ChainStepLine[];
}

export interface ChainViewModel {
  event: string;
  subtitle: string;
  raw: string;
  steps: ChainStep[];
}

export type LifeState = "fired" | "active" | "pending" | "llm" | "llmIdle";

export interface LifeNode {
  name: string;
  state: LifeState;
  count: string;
}

// SeriesCard / NoteCategory / Chapter 已随 R5 移除:Notes 的数据形状改由
// `encore gen client` 产物(lib/api-client.ts 的 notes 命名空间)给出,
// 不再在前端手写一份(CLAUDE.md 规则 6)。

// RepoCard / LangSlice(About 页画板 2e 的仓库卡与语言条)随 R8 移除:
// 它们的数据形状改由 `encore gen client` 产物(lib/api-client.ts 的 about 命名空间)
// 给出,不再在前端手写一份(CLAUDE.md 规则 6)——与 R5 移除 Notes 那批类型同理。

// ToolRow(/admin 工具页的行模型)随 R6 的 /admin 废弃一并删除:
// 工具启停改由 MCP 的 tool_config_set 维护,没有前端界面。
