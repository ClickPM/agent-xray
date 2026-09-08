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
  /**
   * 本行首个事件的 seq(`key` 的数值形态)。R-CROSSLINK 起补上,用于排序与定位;
   * **不进任何展示文案**——访客与模型都看不到这个号,写进追问句只会让模型去猜它指什么。
   */
  seq: number;
  /** 事件类型原名(不含 `· 工具名` 与 `×N` 后缀)。追问文案与「这是不是 tool_call 行」都按它判。 */
  eventType: string;
  /**
   * R-CROSSLINK:与会话区那张工具卡的 `ToolCallView.toolCallId` 是同一个值,双向定位靠它对上。
   *
   * **只有单个 `tool_call` 事件的行才有**:同一个 id 还会出现在 `tool_execution_*` / `tool_result`
   * 三种事件上(它们是同一次调用的不同阶段),而定位目标只有 `tool_call` 那一行(画板 2q);
   * 折叠成 `×N` 的行代表多次调用,同样不给 —— 它对不上「那一张卡」。
   */
  toolCallId?: string;
  /** `tool_call` 行的工具名(追问文案用;`name` 里那份带 `· ` 前缀,不适合直接塞进句子) */
  toolName?: string;
  /** `tool_call` 行的入参摘要(服务端已脱敏并压成单行,events.ts 的 previewText) */
  inputPreview?: string;
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
 * R-CROSSLINK C2:一条定位链接的两半(画板 2q / 4w)。两个方向用的是同一个形状 ——
 * Timeline 详情卡的「查看卡片 ↗」拿它去会话区,会话区卡片展开体的「在 Timeline 里查看 ↗」
 * 拿它去右栏。
 *
 * `has` 存在的理由:对不上时**整条链接不渲染**(旧会话没有 `payload`、事件被
 * `MAX_TRACE_EVENTS` 裁掉、`tool_call` 折叠成 `×N`),不画灰掉的禁用态、不弹「定位失败」。
 */
export interface CrossLink {
  has: (toolCallId: string) => boolean;
  go: (toolCallId: string) => void;
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
