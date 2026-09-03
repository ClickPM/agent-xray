// R-TOOLCARDS:会话区一轮的**唯一**渲染路径 —— (正文, 偏移表) → 段列表。
//
// 实时(SSE 帧逐步填出 `TurnView`)与回放(`GET /agent/sessions/:id` 从 payload 派生的 `turn`)
// 都经这里切段,不各写一份;任务卡验收 #3「F5 之后会话区 DOM 逐字节相同」靠的就是这个。
// 纯函数、不碰 React,由 `turn-view.test.ts` 直接断言(`dev.ps1 test` → `bun test lib`)。
import { formatDuration } from "./trace-view";
import type { ToolCallView, TurnView } from "./types";

export type TurnSegment =
  | { kind: "text"; text: string }
  | { kind: "tool"; index: number; call: ToolCallView };

/**
 * 按 `at` 升序把正文切段、把卡片插回去。
 *
 * - `process` = 最终回答之前的一切(中间说的话 + 全部卡片),画板 2l/2m 里进折叠行的部分;
 * - `final` = 最后一个工具之后的正文 = 最终回答;为空时调用方不渲染(画板 2l 规则 3)。
 * - 空白段跳过:两个工具之间只有换行时不该多出一个空的 markdown 块把 gap 撑开。
 * - `at` 越界(理论上不会:写入方与切分方是同一份 JS 字符串)按夹到 [cursor, length] 处理,
 *   不让一条坏数据把整轮画崩;同一偏移上的多张卡按原顺序排。
 */
export function splitTurn(
  text: string,
  toolCalls: ToolCallView[],
): { process: TurnSegment[]; final: string } {
  const order = toolCalls
    .map((call, index) => ({ call, index }))
    .sort((a, b) => a.call.at - b.call.at || a.index - b.index);
  const process: TurnSegment[] = [];
  let cursor = 0;
  for (const { call, index } of order) {
    const at = Math.min(Math.max(call.at, cursor), text.length);
    const chunk = text.slice(cursor, at);
    if (chunk.trim() !== "") process.push({ kind: "text", text: chunk });
    process.push({ kind: "tool", index, call });
    cursor = at;
  }
  return { process, final: text.slice(cursor) };
}

/** 折叠行行尾的红点(画板 2l):里面有一次工具调用出错或被拦截。 */
export const hasFailure = (turn: TurnView): boolean => turn.toolCalls.some((c) => c.isError);

/** 折叠行文案(画板 2l):只放拿得到的四项里的三项,第四项是红点。 */
export function foldLabel(turn: TurnView): string {
  return `处理详情 · ${turn.modelRoundTrips} 次模型往返 · ${turn.toolCalls.length} 次工具调用 · ${formatDuration(turn.turnMs)}`;
}

/** 卡片右侧的耗时:与 Timeline 同一个格式(`12ms` / `1.2s`);没等到 end 的留空。 */
export const toolDuration = (call: ToolCallView): string =>
  call.durationMs === undefined ? "" : formatDuration(call.durationMs);
