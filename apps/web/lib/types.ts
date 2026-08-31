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
  streaming?: boolean;
  /** 点击可展开详情(画板 1b 的 context 行) */
  expandable?: boolean;
  detail?: TraceRowDetail;
}

export interface TraceTurn {
  label: string;
  rows: TraceRow[];
}

export interface ChatItem {
  kind: "user" | "assistant" | "tool";
  text?: string;
  tool?: { name: string; preview: string; dur: string; error: boolean };
}

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

export interface SeriesCard {
  slug: string;
  name: string;
  desc: string;
  meta: string;
}

export interface NoteCategory {
  name: string;
  slug: string;
  dot: string;
  cards: SeriesCard[];
}

export interface Chapter {
  num: string;
  title: string;
  time: string;
}

export interface RepoCard {
  name: string;
  lang: string;
  dot: string;
  stars: number;
  desc: string;
  pushed: string;
}

export interface ToolRow {
  name: string;
  src: "内置" | "MCP" | "pi extension";
  risk: "安全" | "外呼" | "高危";
  desc: string;
  state: "on" | "off" | "locked";
}
