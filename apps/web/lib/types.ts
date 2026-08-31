// 与 design/Agent Runtime Workbench.dc.html 的 dc-script 数据结构一一对应。

export type EventMode = "notify" | "veto" | "chain" | "takeover";

export interface TraceRow {
  name: string;
  ms: number;
  dur: string;
  color: string;
  hasBadge?: boolean;
  hasNote?: boolean;
  streaming?: boolean;
  /** 点击可展开详情(画板 1b 的 context 行) */
  expandable?: boolean;
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

export interface SessionInfo {
  title: string;
  time: string;
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
