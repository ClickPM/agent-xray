"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { suggestions } from "@/lib/demo-data";
import { formatCtx, formatTokens, STAT_PLACEHOLDER } from "@/lib/stats-bar";
import {
  askStream,
  deleteSession,
  getSession,
  listSessions,
  relativeTime,
  AskError,
  type SessionSummary,
  type SessionUsage,
  type TurnSummary,
} from "@/lib/agent-api";
import { openTraceStream } from "@/lib/trace-api";
import { toChainView, toLifecycleNodes, toTimelineTurns } from "@/lib/trace-view";
import { foldLabel, hasFailure, splitTurn, toolDuration, type TurnSegment } from "@/lib/turn-view";
import { readAskParam, sanitizePrefill } from "@/lib/ask-why";
import type { ChatItem, CrossLink, ToolCallView, TraceEvent, TurnView } from "@/lib/types";
import { GhostButton } from "@/components/ui";
import { Markdown } from "@/components/Markdown";
import { ComposerContext } from "@/components/ComposerContext";
import { mono } from "@/lib/styles";
import { useIsMobile } from "@/lib/use-mobile";
import { MobileWorkbench } from "@/components/mobile/MobileWorkbench";
import { MobileChat, MobileEmptyState } from "@/components/mobile/MobileChat";
import { TimelineView } from "./TimelineView";
import { ChainView } from "./ChainView";
import { LifecycleMap } from "./LifecycleMap";
import { ToolsPanel } from "./ToolsPanel";

// 右栏四个 tab(画板 1f/1g 起是四个,R-TOOLS)。前三个是同一条轨迹流的三种投影;
// Tools 是静态目录,与会话无关。
type Panel = "timeline" | "chain" | "lifecycle" | "tools";
const PANEL_TABS = [
  ["timeline", "Timeline"],
  ["chain", "Chain View"],
  ["lifecycle", "Lifecycle Map"],
  ["tools", "Tools"],
] as const satisfies readonly (readonly [Panel, string])[];

/** 前端保留的轨迹事件条数上界,与服务端单次回放上限(MAX_REPLAY_EVENTS)同口径。 */
const MAX_TRACE_EVENTS = 5000;

/** 请求失败时给访客看的固定文案(服务端已把细节挡在日志里,前端只按状态分档)。 */
function askErrorText(err: unknown): string {
  if (err instanceof AskError) {
    // R7 限额:与「并发会话数满」同为 429,靠服务端给的 code 分档
    if (err.code === "daily_tokens" || err.code === "daily_cost") {
      return "今天的对话额度已经用完了,明天再来吧。";
    }
    if (err.code === "turn_limit") return "这个会话的轮数已达上限,新建一个会话继续吧。";
    if (err.status === 409) return "上一轮回复还在进行中,请等它结束再发。";
    if (err.status === 429) return "当前会话数已满,请稍后再试。";
    if (err.status === 404) return "这个会话已不存在,请新建一个会话。";
  }
  return "请求失败了,请稍后再试。";
}

/**
 * 会话列表(画板 1a)。
 *
 * 【与设计稿的唯一差异:每行的删除按钮】R-VISITOR 所有者裁定新增(设计稿 1a–1e
 * 没有删除入口,CLAUDE.md 规则 8)。为把对画板的偏离压到最小:
 *   - 复用全站唯一的按钮语汇 `GhostButton`,不新增任何样式变量与组件(规则 7);
 *   - 绝对定位在行的右上角,**不占布局宽度** —— 不 hover 时这一行与画板一字不差;
 *   - 二次确认用浏览器原生 `confirm`,不自造弹层。
 */
function SessionSidebar({
  sessions,
  selected,
  onSelect,
  onNew,
  onRefresh,
  onDelete,
}: {
  sessions: SessionSummary[];
  selected: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRefresh: () => void;
  onDelete: (id: string) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  return (
    <div style={{ width: 260, flex: "none", background: "var(--bg-panel)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 10px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", flex: 1 }}>Sessions</div>
        <GhostButton height={28} onClick={onNew}>+ New</GhostButton>
        <GhostButton height={28} style={{ width: 28, padding: 0 }} onClick={onRefresh}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 4v6h-6" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </GhostButton>
      </div>
      <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 2, overflow: "auto" }}>
        {sessions.map((s) => (
          <div
            key={s.id}
            onClick={() => onSelect(s.id)}
            style={{ position: "relative", padding: "7px 10px", borderRadius: 6, background: selected === s.id ? "var(--bg-selected)" : "transparent", cursor: "pointer" }}
            onMouseEnter={(e) => { setHovered(s.id); if (selected !== s.id) e.currentTarget.style.background = "var(--bg-hover)"; }}
            onMouseLeave={(e) => { setHovered(null); if (selected !== s.id) e.currentTarget.style.background = "transparent"; }}
          >
            <div style={{ fontSize: 13, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.title || "新会话"}</div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>{relativeTime(s.lastActiveAt)}</div>
            {hovered === s.id && (
              <div
                style={{ position: "absolute", top: 6, right: 6 }}
                onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}
              >
                <GhostButton height={20} style={{ width: 20, padding: 0, borderRadius: 5 }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </GhostButton>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 工具调用卡(画板 1a;R-TOOLCARDS 重新接上数据源 —— 首版 `bdc1ca4` 画好之后 R3 切真实数据源时断了来源)。
 *
 * 卡片解剖一字不改:左 工具名 mono 12/600、中 入参摘要 mono 11 弱化色单行省略、右 耗时 11px tabular、末 12px 箭头。
 * 相对首版只多两件事:整卡可点(切换画板 2m 的展开体;箭头只有 12px,整卡才是可用的点击面)与随之的
 * `cursor:pointer`;箭头随 `open` 转向 —— 收起沿用 1a 的 ˅,展开转成 ˄(画板 2m:只转向,不换图标、尺寸、颜色)。
 */
function ToolChip({
  name,
  preview,
  dur,
  error,
  open,
  onToggle,
}: {
  name: string;
  preview: string;
  dur: string;
  error: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      onClick={onToggle}
      style={{
        background: error ? "var(--err-bg)" : "var(--ok-bg)",
        border: `1px solid ${error ? "var(--err-border)" : "var(--ok-border)"}`,
        borderRadius: 7, padding: "7px 10px", display: "flex", alignItems: "center", gap: 8,
        cursor: "pointer",
      }}
    >
      <span style={{ ...mono(12, 600), color: error ? "var(--err-text)" : "var(--ok-text)" }}>{name}</span>
      <span style={{ ...mono(11), color: "var(--text-dim)", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{preview}</span>
      <span style={{ fontSize: 11, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{dur}</span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points={open ? "18 15 12 9 6 15" : "6 9 12 15 18 9"} />
      </svg>
    </div>
  );
}

/**
 * 一张卡 + 它的展开体(画板 2m)。收起时就是裸的 ToolChip(2m 里 read_file 卡的样子);
 * 展开时套一层 div,展开体紧贴卡下 4px、r6 + `--bg-subtle` 底 + 与卡片同色的 1px 描边,
 * INPUT / RESULT 两段各 `max-height:106px`(mono 11 × 1.6 六行)+ `overflow:hidden`,
 * 超出部分的 `…(已截断)` 由服务端在切断处接好(turn-recorder.ts),这里不再截。
 * 不做内部滚动、不放「展开全部」;要看全量去右栏 Timeline 对应的 tool_call / tool_result 事件。
 */
function ToolCard({
  call,
  open,
  onToggle,
  rowLink,
}: {
  call: ToolCallView;
  open: boolean;
  onToggle: () => void;
  /** R-CROSSLINK C2 卡 → 行(画板 2q / 4w):`has` 决定链接渲不渲染,`go` 去右栏定位那一行 */
  rowLink?: CrossLink;
}) {
  const error = call.isError;
  const chip = (
    <ToolChip name={call.name} preview={call.inputPreview} dur={toolDuration(call)} error={error} open={open} onToggle={onToggle} />
  );
  if (!open) return chip;
  const body = { font: "400 11px/1.6 var(--font-mono)", maxHeight: 106, overflow: "hidden", wordBreak: "break-all" } as const;
  const label = { ...mono(10, 600), color: "var(--text-dim)", letterSpacing: "0.08em" } as const;
  return (
    <div>
      {chip}
      <div
        style={{
          background: "var(--bg-subtle)",
          border: `1px solid ${error ? "var(--err-border)" : "var(--ok-border)"}`,
          borderRadius: 6, padding: "10px 12px", marginTop: 4,
        }}
      >
        <div style={{ ...label, marginBottom: 3 }}>INPUT</div>
        <div style={{ ...body, color: "var(--text)" }}>{call.inputPreview}</div>
        <div style={{ ...label, margin: "10px 0 3px" }}>RESULT</div>
        <div style={{ ...body, color: error ? "var(--err-text)" : "var(--text)" }}>{call.resultPreview}</div>
        {/* R-CROSSLINK C2(画板 2q):这条链接在展开体**之内**而不是卡片下面 —— 出了展开体它就成了
            会话区的第四种元素(卡 / 折叠行 / 正文之外),而它讲的正是这一次调用。
            语汇:展开体里通篇是 mono,所以取 mono 11 品牌色、左对齐、与 RESULT 段间距 10,
            `margin-left:-6` 把 padding 撑出的左内边距吃掉,让文字与上面两段左对齐。
            对不上(旧会话没有轨迹、事件被裁掉、tool_call 折叠成 ×N)时整条不渲染。
            移动端的 44 命中区与去掉的上外边距在 globals.css 的 `.m-locate-*`(画板 4w)。 */}
        {rowLink?.has(call.toolCallId) && (
          <div className="m-locate-row" style={{ marginTop: 10 }}>
            <button
              className="m-locate-link"
              onClick={() => rowLink.go(call.toolCallId)}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
              style={{
                ...mono(11), color: "var(--accent)", borderRadius: 5, padding: "2px 6px",
                marginLeft: -6, background: "none", border: "none", cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              在 Timeline 里查看 ↗
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 折叠行(画板 2l):一行导航,不是卡片 —— 13px/1.7 次级色、无底色 / 边框 / 圆角,hover 转品牌色;
 * 行首 12px 箭头(› 收起 / ˅ 展开,与卡片箭头同一图标),行尾 6px 红点 = 里面有一次工具调用出错或被拦截
 * (只提示,不占整行、不写字)。展开 / 收起不做动画(现有三个动效都是「还在跑」的语义)。
 */
function FoldRow({ turn, open, onToggle }: { turn: TurnView; open: boolean; onToggle: () => void }) {
  return (
    <div
      onClick={onToggle}
      style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", cursor: "pointer" }}
      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points={open ? "6 9 12 15 18 9" : "9 6 15 12 9 18"} />
      </svg>
      <span style={{ fontSize: 13, lineHeight: 1.7 }}>{foldLabel(turn)}</span>
      {hasFailure(turn) && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--err-text)", flex: "none" }} />}
    </div>
  );
}

/**
 * 助手回复 = 完整 markdown,不是纯文本。
 *
 * 早先这里只把 `code` 片段换成行内代码样式、其余原样塞进一个 div,于是模型给出的
 * 标题 / 列表 / 表格 / 代码围栏全以源码形式糊成一段——换行也没了(容器没开
 * white-space)。渲染器直接复用 Notes 的 <Markdown>,排版与画板 2c 同一套,
 * 聊天区不另立一份样式(规则 7)。
 *
 * memo 是必需的而不是优化:流式期间每一帧都要重建 items 数组,不 memo 的话
 * **本会话已完成的每一条**助手消息都会跟着重新解析一遍 markdown(O(n²))。
 * text 不变就不重渲染,只有正在流的那条会重新解析。
 *
 * minWidth:0 让代码围栏/宽表在自己的容器里横向滚动,而不是把聊天列撑宽
 * (ChatPane 是 flex column,子项默认 min-width:auto)。
 * md-chat 见 globals.css:只抹掉首个块的上外边距,气泡间距由 ChatPane 的 gap 给。
 */
/**
 * R-CARDS:会话区是**唯一**开信息卡片的地方(`cards`),`streaming` 决定围栏未闭合时画不画骨架,
 * `onAsk` 是卡底动作按钮通往输入框的那条预填通路(容器里的 `prefill`,`useCallback([])` 恒等 —— 换新对象会把这层 memo 废掉)。
 * 三个都不传时与改动前一字不差(任务卡验收 #14)。
 *
 * R-CARDS-2:`components` = 这一段开不开组件(卡 + 帧)。**只有最终回答段开**(任务卡派生取舍 7):`AssistantTurn` 给处理过程段传 false,
 * 那里的围栏一律回落成代码块、随处理过程进折叠行。可回传卡的发送通路与 busy 态**不经这里**(`ComposerContext`,理由见那个文件):
 * 这层 memo 因此在一轮生成前后都不重渲染,卡的「已发送锁定」本地态与帧的 srcdoc 都留在原地。
 */
export const AssistantMessage = memo(function AssistantMessage({
  text,
  streaming = false,
  onAsk,
  components = true,
}: {
  text: string;
  streaming?: boolean;
  onAsk?: (text: string) => void;
  components?: boolean;
}) {
  return (
    <div className="md-chat" style={{ minWidth: 0 }}>
      <Markdown headingIds={false} cards={components} html={components} streaming={streaming} onAsk={onAsk}>{text}</Markdown>
    </div>
  );
});

/**
 * 有工具调用的一轮(R-TOOLCARDS)。两个态、一条渲染路径(`splitTurn`,实时与回放同源):
 *   - 进行中(`!done`):按 `at` 切段内联 —— 话 / 卡 / 话 / 卡 / 话(画板 1a);
 *   - 已收尾(`done`):最终回答之前的一切进折叠行(画板 2l,照 pi-web),点开原位展开(画板 2m),
 *     展开区左侧 1px 竖线 + 左内边距 14 做边界,最终回答留在竖线之外;最终回答为空时只剩折叠行(2l 规则 3)。
 * 折叠状态与每张卡的展开状态各自独立、都只在本组件里(纯前端状态,不产生事件);
 * 从进行中切到已收尾时组件实例不变,所以读者已点开的卡不会被收回去,折叠行则以收起态出现 —— 折叠只发生这一次。
 *
 * 每个文本段各自过 memo 的 `AssistantMessage`:流式期间只有正在长的那一段重新解析 markdown(R9 的 O(n) 性质保住)。
 * 外层 gap 14 与 ChatPane 的 gap 相同,所以内联态的段间距与它们直接躺在会话列里时一样。
 */
export const AssistantTurn = memo(function AssistantTurn({
  text,
  turn,
  done,
  rowLink,
  locate,
  onAsk,
}: {
  text: string;
  turn: TurnView;
  done: boolean;
  /** R-CROSSLINK C2:卡片展开体里那条「在 Timeline 里查看 ↗」(画板 2q) */
  rowLink?: CrossLink;
  /** R-CROSSLINK C2 行 → 卡:右栏要求定位到某个 toolCallId;不在本轮里就什么都不做 */
  locate?: { toolCallId: string; nonce: number } | null;
  /** R-CARDS:信息卡片动作按钮的预填通路,只递给最终回答段(R-CARDS-2 起处理过程段不开组件) */
  onAsk?: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [openCards, setOpenCards] = useState<Record<number, boolean>>({});
  const { process, final } = useMemo(() => splitTurn(text, turn.toolCalls), [text, turn.toolCalls]);
  const toggleCard = (index: number) => setOpenCards((prev) => ({ ...prev, [index]: !prev[index] }));
  const rootRef = useRef<HTMLDivElement | null>(null);

  /**
   * R-CROSSLINK C2(画板 2q / 4w):「定位」= **既有折叠行打开 + 既有卡片展开态 + 滚入视野**,
   * 没有新高亮色、没有「已定位」徽标、滚动不画动效。
   *
   * 【按 nonce 去重】`turn.toolCalls` 在流式期间每帧都是新数组(容器每次提交都深拷贝一份),
   * 不去重的话这个 effect 会跟着每帧重跑,把访客手动收起的卡再打开一次。
   *
   * 【为什么不用 querySelector 拼选择器】`toolCallId` 是 provider 给的不透明串,
   * 拼进属性选择器要考虑转义;遍历 dataset 比较没有这个问题。
   *
   * 【滚动挂 setTimeout(0) 而不是 requestAnimationFrame】折叠行收起时卡片压根不在 DOM 里
   * (`open` 为假就不渲染处理过程),所以滚动必须等 `setOpen(true)` 那次提交之后;
   * 而 rAF 在页面不可见时**不回调**(本机验收实测),定位对可见性没有依赖。
   */
  const appliedNonce = useRef(0);
  useEffect(() => {
    if (!locate || locate.nonce === appliedNonce.current) return;
    const index = turn.toolCalls.findIndex((c) => c.toolCallId === locate.toolCallId);
    if (index < 0) return; // 不是本轮的卡
    appliedNonce.current = locate.nonce;
    setOpen(true);
    setOpenCards((prev) => ({ ...prev, [index]: true }));
    const timer = setTimeout(() => {
      const nodes = rootRef.current?.querySelectorAll<HTMLElement>("[data-tool-call-id]") ?? [];
      for (const node of nodes) {
        if (node.dataset.toolCallId === locate.toolCallId) {
          node.scrollIntoView({ block: "center" });
          return;
        }
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [locate, turn.toolCalls]);

  // R-CARDS:`streaming` 按整轮给 —— 已完成的文本段里不会有未闭合的围栏(围栏未闭合 = 正文后缀,而它们后面还跟着卡),
  // 所以骨架只会出现在正在长的最后一段;闭合了的坏 JSON 在任何一段都直接是代码块。
  // R-CARDS-2:处理过程段**不开组件**(`components={false}`,画板 2u / 2v:组件只在最终回答的首或尾、不进折叠行);
  // 流式期间「最终段」= 最后一次工具调用之后的正文,模型在组件之后又调了工具的话,那些组件会随正文进折叠行并变回代码块(任务卡已认)
  const segment = (seg: TurnSegment, i: number) =>
    seg.kind === "text" ? (
      <AssistantMessage key={i} text={seg.text} streaming={!done} components={false} />
    ) : (
      <div key={i} data-tool-call-id={seg.call.toolCallId}>
        <ToolCard call={seg.call} open={!!openCards[seg.index]} onToggle={() => toggleCard(seg.index)} rowLink={rowLink} />
      </div>
    );
  const finalAnswer = final.trim() !== "" ? <AssistantMessage text={final} streaming={!done} onAsk={onAsk} /> : null;
  if (!done) {
    return (
      <div ref={rootRef} style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        {process.map(segment)}
        {finalAnswer}
      </div>
    );
  }
  return (
    <div ref={rootRef} style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <FoldRow turn={turn} open={open} onToggle={() => setOpen((o) => !o)} />
      {open && (
        <div style={{ borderLeft: "1px solid var(--border)", marginLeft: 5, paddingLeft: 14, display: "flex", flexDirection: "column", gap: 14 }}>
          {process.map(segment)}
        </div>
      )}
      {finalAnswer}
    </div>
  );
});

function ChatPane({
  items,
  rowLink,
  locate,
  onAsk,
}: {
  items: ChatItem[];
  rowLink?: CrossLink;
  locate?: { toolCallId: string; nonce: number } | null;
  /** R-CARDS:信息卡片动作按钮 → 输入框(预填,不发送);可回传卡的发送通路走 ComposerContext(R-CARDS-2) */
  onAsk?: (text: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // 末项的「长度」= 正文长度 + 工具卡数:卡片到达而正文没变的那一帧也要跟着滚到底
  const last = items[items.length - 1];
  const tail = (last?.text.length ?? 0) + (last?.kind === "assistant" ? (last.turn?.toolCalls.length ?? 0) : 0);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [items.length, tail]);
  return (
    <div ref={scrollRef} style={{ flex: 1, overflow: "auto", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
      {items.map((item, i) => {
        if (item.kind === "user") {
          return (
            <div key={i} style={{ display: "flex", justifyContent: "flex-end" }}>
              <div style={{ maxWidth: "85%", background: "var(--user-bg)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 12, padding: "8px 12px", fontSize: 14, lineHeight: 1.7 }}>
                {item.text}
              </div>
            </div>
          );
        }
        // R-TOOLCARDS:有工具调用的一轮走 AssistantTurn;没有的与改动前一字不差(任务卡验收 #4)
        if (item.turn) return <AssistantTurn key={i} text={item.text} turn={item.turn} done={item.done} rowLink={rowLink} locate={locate} onAsk={onAsk} />;
        return <AssistantMessage key={i} text={item.text} streaming={!item.done} onAsk={onAsk} />;
      })}
    </div>
  );
}

function EmptyState({ onSuggest }: { onSuggest: (text: string) => void }) {
  const ICONS: Record<string, React.ReactNode> = {
    shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
    chat: <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />,
    slash: (
      <>
        <circle cx="12" cy="12" r="10" />
        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
      </>
    ),
  };
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, width: 360 }}>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Agent X-Ray</div>
        <div style={{ fontSize: 14, color: "var(--text-muted)", textAlign: "center", marginBottom: 8 }}>
          和 agent 说点什么 — 右侧实时显示它的内核如何运转
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, width: 340 }}>
          {suggestions.map((s) => (
            <GhostButton key={s.text} height={36} onClick={() => onSuggest(s.text)} style={{ fontSize: 13, justifyContent: "flex-start" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                {ICONS[s.icon]}
              </svg>
              {s.text}
            </GhostButton>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * 输入框随内容增高(画板 2q / 4v:「溢出就自然换行、输入框长到两行,不裁不省略」)。
 *
 * 【为什么必须做】R-CROSSLINK 之前输入框里只有访客自己敲的字,一行装得下;
 * 预填进来的是一整句追问,单行 `<input>` 只会横向滚动、把大半句话藏起来 ——
 * 而「访客看得见」正是 `docs/security.md` §0 第 10 条的全部兜底。
 *
 * 【为什么设上限】不封顶的话,`?ask=` 那条链接最多能塞 1000 字,在 390 宽下是五十来行、
 * 整个屏幕都成了输入框。到上限后**框内自己滚**,文本一个字都没少 —— 与「不裁不省略」不冲突。
 */
function useAutoGrow(ref: React.RefObject<HTMLTextAreaElement | null>, value: string) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // clientHeight 含 padding 不含 border,offsetHeight 两者都含 —— 差值就是上下 border。
    // 盒模型是 border-box,直接把 scrollHeight 写进 height 会一次比一次矮 2px。
    const borders = el.offsetHeight - el.clientHeight;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + borders}px`;
  }, [ref, value]);
}

/**
 * 桌面输入框的行高(px)与增高上限(行)。
 *
 * **19 不是审美,是实测**:改动前那只 `<input>`(font 14 / padding 8 / border 1 / border-box)
 * 静息高 37px,行盒正好 19。`<textarea>` 在 `line-height: normal` 下的行盒是 20,
 * 空框会凭空高 1px —— 规则 7 管的就是这种「顺手多出来的一像素」。写死 19 让静息态一字不差,
 * 折行后的行距也随之定下来(画板 2q 那句 `line-height:1.5` 是画布里两行态的写法,
 * 照抄会让空框高 4px,取舍与理由记在任务卡)。
 */
const INPUT_LINE = 19;
const INPUT_MAX_LINES = 5;

/**
 * 输入区(画板 1a)。`busy` = 这一轮回复还在生成中:发送按钮换成转圈并禁用。
 *
 * 输入框**不禁用** —— 生成期间照样可以把下一句先打好;真正的拦截在 `send()`
 * 里(streaming 时直接 return),回车与点击走的是同一个出口。
 *
 * R-CROSSLINK 把 `<input>` 换成 `<textarea>`(画板 2q 的两行态)。**静息高度一字不改**:
 * 行高仍取 `normal`(画板 1a 的空框没写 line-height,2q 那句 `line-height:1.5` 是画布里
 * 两行态的写法;取 1.5 会让空框凭空高 4px,那是规则 7 明确禁止的「动既有页面样式」)。
 * 回车仍是「发送」而不是换行(`preventDefault` 挡住 textarea 的默认行为),
 * 与改动前一字不差;换行只会来自自动折行。
 */
function InputBar({
  value,
  onChange,
  onSend,
  busy,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  busy: boolean;
  /** R-CROSSLINK:预填之后要把光标停在句尾(画板 2q),所以容器要拿得到这个输入框 */
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  useAutoGrow(inputRef, value);
  return (
    // align-items 从 center 改成 flex-end(画板 2q 的输入栏就是 flex-end):
    // 单行时两者一模一样,长到两行时发送按钮跟着底边走,与画板一致
    <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "flex-end" }}>
      <textarea
        ref={inputRef}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSend(); } }}
        placeholder="和 agent 说点什么…(右侧实时显示内核轨迹)"
        style={{
          flex: 1, border: "1px solid var(--border)", borderRadius: 7, padding: "8px 12px",
          fontSize: 14, color: "var(--text)", background: "var(--bg)", outline: "none", font: "inherit",
          resize: "none", overflowY: "auto", display: "block",
          lineHeight: `${INPUT_LINE}px`,
          // 上下 padding 16 + 上下 border 2
          maxHeight: INPUT_MAX_LINES * INPUT_LINE + 18,
        }}
      />
      <GhostButton
        height={32}
        style={{ width: 32, padding: 0 }}
        onClick={onSend}
        disabled={busy}
        title={busy ? "回复生成中…" : "发送"}
      >
        {busy ? (
          // 3/4 圆弧转圈。transformOrigin 显式给 50%:SVG 里它的默认值不是盒中心,
          // 不写会绕着左上角甩。keyframes omSpin 在 app/globals.css。
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.4" strokeLinecap="round"
            style={{ animation: "omSpin 0.8s linear infinite", transformOrigin: "50% 50%" }}
          >
            <path d="M12 3a9 9 0 1 0 9 9" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        )}
      </GhostButton>
    </div>
  );
}

export function Workbench() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [panel, setPanel] = useState<Panel>("timeline");
  const [events, setEvents] = useState<TraceEvent[]>([]);
  /**
   * 顶栏统计条的会话累计(R-USAGE)。两条通路都写它:打开会话时由
   * `GET /agent/sessions/:id` 给初值,每轮结束由 `/agent/ask` 的收尾帧更新。
   * `null` = 还没有值(新会话 / 旧服务端),统计条显示占位。
   */
  const [usage, setUsage] = useState<SessionUsage | null>(null);

  // 会话切换的请求序号:连点两个会话时,先发后到的历史加载必须被丢弃,
  // 否则 UI 会被旧会话的消息覆盖(codex review P2)
  const loadSeq = useRef(0);

  // ── R-CROSSLINK:三条联动共用的那一个原语 + 两个方向的定位 ────────────────
  // 输入框(桌面 InputBar / 移动壳各一份,同一个 ref —— 两套壳同时只挂一套)
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  // 「又预填了一次」的信号:同一句话连点两次时文本不变,靠它把光标重新放到句尾
  const [prefillAt, setPrefillAt] = useState(0);
  // 受控定位:key / toolCallId 相同的连点也要再滚一次,所以带 nonce
  const [locateRow, setLocateRow] = useState<{ key: string; nonce: number } | null>(null);
  const [locateCard, setLocateCard] = useState<{ toolCallId: string; nonce: number } | null>(null);
  // 移动壳的运行时 Sheet:预填时关(画板 4v)、定位时开到 large(画板 4w)。
  // 桌面壳没有 Sheet,这个 state 对它是死的。
  const [sheetRequest, setSheetRequest] = useState<{ action: "open" | "close"; nonce: number } | null>(null);
  const nonce = useRef(0);
  /** 两个方向的定位请求一起作废。切会话、开新会话都要调 —— 它们只在一个会话里有意义。 */
  const clearLocate = useCallback(() => {
    setLocateRow(null);
    setLocateCard(null);
  }, []);

  // R-MOBILE:决定挂哪一套壳。状态、取数与两条 SSE 都在本容器里,
  // 所以无论哪一套壳,**全站只有一份订阅**(这正是不用纯 CSS 分流的原因)。
  const isMobile = useIsMobile();

  const active = sessionId !== null || items.length > 0;
  const title = sessions.find((s) => s.id === sessionId)?.title || "";
  // 右栏实际显示的面板:空状态下前三个 tab 都落到 Lifecycle 待命图(画板 1e),
  // Tools 不受此约束(它不依赖会话)
  const shownPanel: Panel = active || panel === "tools" ? panel : "lifecycle";

  // 右栏三视图 = 同一条轨迹流的三种投影(docs/architecture.md)。
  // 必须 memo:events 最多 5000 条,而输入框每敲一个字都会触发重渲染——
  // 不 memo 的话每次击键都要把整条轨迹重投影三遍。
  const timelineTurns = useMemo(() => toTimelineTurns(events, streaming), [events, streaming]);
  const chain = useMemo(() => toChainView(events), [events]);
  const lifeNodes = useMemo(() => toLifecycleNodes(events, streaming), [events, streaming]);

  /**
   * R-CROSSLINK C1 / C3 的原语:**把一句预设文本放进输入框,永不自动发送**
   * (画板 2q / 2r / 4v / 4x;`docs/security.md` §0 第 10 条)。
   *
   * 三个入口(Ask why 按钮、章节页链接经 `?ask=`、C3 的落地)走同一条边界:
   * `sanitizePrefill` 去控制字符、超 1000 字整段丢弃。发不发永远是访客按按钮。
   *
   * 【focus 必须同步调用】iOS 只在用户手势**那一个任务**里 focus 才会弹键盘,
   * 放进 rAF / setTimeout 就只剩一个光标、键盘不出来(画板 4v 要的是键盘弹起)。
   * 光标落到句尾则要等 value 提交之后,所以拆成下面那个 effect。
   */
  const prefill = useCallback((text: string) => {
    const clean = sanitizePrefill(text);
    if (!clean) return;
    setDraft(clean);
    setPrefillAt((n) => n + 1);
    // 移动端关掉运行时 Sheet(画板 4v:目标是让访客打字,Sheet 留在屏上只会挡键盘)
    setSheetRequest({ action: "close", nonce: ++nonce.current });
    inputRef.current?.focus();
  }, []);

  // 预填之后把光标停在句尾(画板 2q:光标在句尾、发送按钮常态可点)。
  // 只认 prefillAt —— 挂 draft 的话每敲一个字都会把光标弹到末尾。
  useEffect(() => {
    if (prefillAt === 0) return;
    const el = inputRef.current;
    if (!el) return;
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, [prefillAt]);

  /**
   * R-CROSSLINK C3 的落地:`/?ask=<text>` 读一次即清(任务卡裁定 7 / 派生取舍 1)。
   *
   * 【为什么不用 useSearchParams】Next 15 要求它外面套 Suspense,否则整页退化成
   * CSR bailout —— 为一个只读一次的参数把首屏渲染方式换掉不划算。
   *
   * 【为什么先清后填】清掉参数是这条链接的安全兜底之一:刷新不会二次预填、
   * 地址栏里也不会留着那段文本被顺手复制走。**不写 localStorage、不写 cookie**。
   */
  useEffect(() => {
    const url = new URL(window.location.href);
    const text = readAskParam(url.search);
    // 【判「有没有 ask」只能问 URLSearchParams,不能在原始串上找 "ask="】(codex 第 1 轮 P2)
    // `/?%61sk=hello` 里参数名是编码过的:`readAskParam` 经 URLSearchParams 解码后认得它、照常预填,
    // 而字面匹配认不出 → 参数留在地址栏、刷新再预填一次,「读一次即清」当场失效。
    if (url.searchParams.has("ask")) {
      url.searchParams.delete("ask");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
    if (!text) return;
    setDraft(text);
    setPrefillAt((n) => n + 1);
    // 这一次不是用户手势(是刚落地),iOS 大概率不弹键盘;桌面与安卓会聚焦,
    // 与画板 4x「聚焦并弹键盘」尽量对齐,拿不到也不影响文本已经在框里
    inputRef.current?.focus();
  }, []);

  /**
   * 两个方向的定位(画板 2q / 4w)。两张表都随渲染更新、但**回调本身恒等** ——
   * `AssistantTurn` 是 memo 的(流式期间靠它避免每帧重解析全部 markdown),
   * 传一个每帧换新的对象进去等于把那层 memo 废掉。所以数据放 ref、闭包只读 ref。
   *
   * 代价说清楚:`has` 读的是**上一次渲染时**的表。轨迹事件比会话区的卡晚到几毫秒时,
   * 那一瞬间链接可能还不渲染 —— 下一次渲染(流式的下一帧、或访客点开卡片本身)就有了,
   * 而链接只在展开体里出现,展开这个动作本身就会带来一次渲染。
   */
  const cardIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of items) {
      if (item.kind !== "assistant" || !item.turn) continue;
      for (const call of item.turn.toolCalls) ids.add(call.toolCallId);
    }
    return ids;
  }, [items]);
  const rowKeyById = useMemo(() => {
    const map = new Map<string, string>();
    for (const turn of timelineTurns) {
      for (const row of turn.rows) if (row.toolCallId !== undefined) map.set(row.toolCallId, row.key);
    }
    return map;
  }, [timelineTurns]);
  const cardIdsRef = useRef(cardIds);
  const rowKeyRef = useRef(rowKeyById);
  cardIdsRef.current = cardIds;
  rowKeyRef.current = rowKeyById;

  /**
   * Timeline 详情卡的「查看卡片 ↗」:去会话区把那张卡展开并滚进视野。
   *
   * 移动端还要**关掉运行时 Sheet**(codex 第 2 轮 P2):这条链接是在 Sheet 里点的,
   * 而目的地(会话区那张卡)在 Sheet **后面** —— 不关的话卡片确实展开并滚过去了,
   * 访客却只看见一张没动过的 Sheet。反方向(卡 → 行)本来就要把 Sheet 打开,两边正好互为镜像。
   */
  const cardLink = useMemo<CrossLink>(
    () => ({
      has: (id) => cardIdsRef.current.has(id),
      go: (id) => {
        setLocateCard({ toolCallId: id, nonce: ++nonce.current });
        setSheetRequest({ action: "close", nonce: ++nonce.current });
      },
    }),
    [],
  );

  /** 会话区卡片的「在 Timeline 里查看 ↗」:切到 Timeline、展开那一行并滚进视野;移动端顺带把 Sheet 升到 large */
  const rowLink = useMemo<CrossLink>(
    () => ({
      has: (id) => rowKeyRef.current.has(id),
      go: (id) => {
        const key = rowKeyRef.current.get(id);
        if (key === undefined) return;
        setPanel("timeline");
        setLocateRow({ key, nonce: ++nonce.current });
        setSheetRequest({ action: "open", nonce: ++nonce.current });
      },
    }),
    [],
  );

  const refreshSessions = useCallback(() => {
    listSessions()
      .then(setSessions)
      .catch((err) => console.error("load sessions failed:", err));
  }, []);

  useEffect(refreshSessions, [refreshSessions]);

  // 会话确定后订阅轨迹流:先回放该会话已有轨迹,再 live tail。
  // 服务端每条流有存活上界(客户端断开探测不到,见 apps/api/trace/stream.ts),
  // 到点由 trace-api 凭 afterSeq 自动续上,这里不必感知。
  useEffect(() => {
    setEvents([]);
    if (!sessionId) return;
    return openTraceStream(sessionId, {
      onEvent: (event) =>
        setEvents((prev) => {
          // seq 严格递增到达;重连窗口里的重复/乱序帧一律丢弃
          if (prev.length > 0 && event.seq <= prev[prev.length - 1].seq) return prev;
          const next = [...prev, event];
          return next.length > MAX_TRACE_EVENTS ? next.slice(next.length - MAX_TRACE_EVENTS) : next;
        }),
    });
  }, [sessionId]);

  const openSession = useCallback(
    (id: string) => {
      if (streaming) return;
      const seq = ++loadSeq.current;
      setPanel("timeline");
      // 目标会话立刻生效:即便加载还没回来,状态也已经指向**这个**会话
      setSessionId(id);
      setItems([]);
      // 定位请求属于**上一个**会话(codex 第 1 轮 P2):行键是 `s<seq>` 而 seq 每个会话都从 0 起,
      // 留着它的话,下一次 TimelineView 挂载(移动端关掉再打开 Sheet 就是一次)会拿旧请求去展开
      // 新会话里同键的**无关行**,还顺手关掉贴底跟随。卡片那侧同理(toolCallId 不跨会话)。
      clearLocate();
      // 统计条与 items / events 同时作废(codex 第 1 轮 P2):加载期间留着上一个会话的
      // 数字会张冠李戴,加载失败时那个错的数字还会永久留在顶栏
      setUsage(null);
      setLoadingHistory(true);
      getSession(id)
        .then(({ session, messages, ctxPercent }) => {
          if (loadSeq.current !== seq) return; // 已被更晚的选择/新建取代
          // 统计条初值(R-USAGE):tokens 来自库内累计,一定有;ctxPercent 只有该会话
          // 恰好还活在运行时注册表里才有 —— 没有就是没有,显示 `-`,不拿别的数顶替
          setUsage({
            totalTokens: session.totalTokens,
            ...(typeof ctxPercent === "number" ? { ctxPercent } : {}),
          });
          // 回放:`turn` 只在有工具调用的助手行上存在(服务端从 payload 白名单派生),
          // 旧行 / 无工具的一轮没有它,渲染成纯正文 —— 与实时收尾后的形状是同一份(验收 #3 / #5)
          setItems(
            messages.map((m) =>
              m.role === "user"
                ? { kind: "user", text: m.content }
                : { kind: "assistant", text: m.content, turn: m.turn, done: true },
            ),
          );
        })
        .catch((err) => console.error("load session failed:", err))
        .finally(() => {
          if (loadSeq.current === seq) setLoadingHistory(false);
        });
    },
    [streaming, clearLocate],
  );

  const startNew = useCallback(() => {
    if (streaming) return;
    loadSeq.current++; // 作废在途的历史加载
    setLoadingHistory(false);
    setSessionId(null);
    setItems([]);
    setDraft("");
    setPanel("timeline");
    setUsage(null); // 新会话没有累计,统计条回到占位(R-USAGE)
    clearLocate(); // 同 openSession:定位请求不跨会话
  }, [streaming, clearLocate]);

  /**
   * 删除会话(R-VISITOR)。服务端只删得掉本访客自己的,删不到一律 404。
   *
   * 失败不弹错误框,只刷新列表 —— 刷完之后界面显示的就是服务端的真实状态
   * (会话还在 = 真的没删掉),比多一个只能点「确定」的提示框更有用。
   * 流式进行中不收删除:那一轮的助手消息正等着落库,服务端也会回 409。
   *
   * 删的正好是当前打开的那个会话时切回空状态,否则右栏会挂在一个已经不存在的
   * 会话上不断重连轨迹流(而那条流现在只会回 404)。
   *
   * 【切空状态只能放在成功分支,不能放 finally】(codex 初审 P2)放 finally 的话,
   * 断网 / 500 / 服务端并发回 409 时,一个**根本没被删掉**的会话连同已经读出来的
   * 对话内容会从界面上消失,与上面那句「失败只刷新列表」自相矛盾。
   * (404 在 `deleteSession` 里已被当成成功 —— 那种情况它是真的没了。)
   */
  const removeSession = useCallback(
    (id: string) => {
      if (streaming) return;
      const title = sessions.find((s) => s.id === id)?.title || "新会话";
      if (!window.confirm(`删除会话「${title}」?对话内容与轨迹会一并删除,不可恢复。`)) return;
      deleteSession(id)
        .then(() => {
          if (sessionId === id) startNew();
        })
        .catch((err) => console.error("delete session failed:", err))
        .finally(refreshSessions);
    },
    [streaming, sessions, sessionId, startNew, refreshSessions],
  );

  /**
   * R-CARDS-2:发送拆成两层(任务卡派生取舍 4)。`sendText(text)` 是**唯一**的发送函数体 —— 建会话 / busy 守卫 / 错误分档 / 合帧 / 计数
   * 都只在这一处;`send` 只是「读输入框 → sendText → 清空输入框」,卡片的点击即发走 `sendFromCard` → 同一个 `sendText`
   * (`docs/security.md` §0 第 12 条 ③:同一套会话 / 配额 / 上限,服务端看到的是一条普通访客消息)。
   * 回「发没发」:输入框只在真的发出去时才清空(busy 期间点发送不该把打好的字弄丢,与改动前一致)。
   */
  const sendText = useCallback((text: string): boolean => {
    const prompt = text.trim();
    // 历史加载未回来时不收发送:此时 items 已被清空,若在这里作废加载结果,
    // 这个会话的历史就再也不会出现在界面上(复审 P2)。加载只有几十毫秒,
    // 与 streaming 期间的拦截是同一种处理。
    if (!prompt || streaming || loadingHistory) return false;
    setPanel("timeline");
    setItems((prev) => [...prev, { kind: "user", text: prompt }]);
    setStreaming(true);

    // 首个 delta **或首个 tool_start** 到达时才建助手项(避免先渲染一个空行;模型可能一句话没说先调工具),
    // 之后每一帧就地替换它。「是否首帧」在调用点定死,不在 setItems 更新函数里读可变量——
    // 更新函数由 React 择时执行,读到的会是变更后的值。
    //
    // 服务端 delta 是**逐 token** 发的(apps/api/agent/ask.ts),一条长回复几千帧;
    // 助手气泡改渲染 markdown 之后,一帧一次 setItems 就等于一帧解析一遍整篇正文。
    // 这里按动画帧合帧:攒在 assistant / turn 里,一帧最多提交一次,渲染开销与 token 速率脱钩;
    // 工具帧走同一个合帧出口。帧回调在页面隐藏时不跑,所以每个出口都要先 flushNow() 把攒下的落地。
    //
    // R-TOOLCARDS:`turn` 只在第一个 tool_start 到达时建(没有工具调用的一轮不会有它,渲染与改动前一字不差),
    // 卡片按服务端给的 `at` 落位;提交时深拷贝一份给 React,本地这份继续原地累积。
    let assistant = "";
    let turn: TurnView | undefined;
    let started = false;
    let finalized = false;
    let pending = false;
    let frame = 0;
    const snapshot = (done: boolean): ChatItem => ({
      kind: "assistant",
      text: assistant,
      turn: turn ? { ...turn, toolCalls: turn.toolCalls.map((c) => ({ ...c })) } : undefined,
      done,
    });
    const commit = (done = false) => {
      const item = snapshot(done);
      const first = !started;
      started = true;
      setItems((prev) => (first ? [...prev, item] : [...prev.slice(0, -1), item]));
    };
    const flushNow = () => {
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      if (pending) { pending = false; commit(); }
    };
    const schedule = () => {
      pending = true;
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; flushNow(); });
    };
    const onDelta = (text: string) => {
      assistant += text;
      schedule();
    };
    const onToolStart = (call: { toolCallId: string; name: string; at: number; inputPreview: string }) => {
      turn ??= { modelRoundTrips: 0, turnMs: 0, toolCalls: [] };
      turn.toolCalls.push({ ...call, resultPreview: "", isError: false });
      schedule();
    };
    const onToolEnd = (end: { toolCallId: string; resultPreview: string; isError: boolean; durationMs: number }) => {
      const call = turn?.toolCalls.find((c) => c.toolCallId === end.toolCallId);
      if (!call) return;
      call.resultPreview = end.resultPreview;
      call.isError = end.isError;
      call.durationMs = end.durationMs;
      schedule();
    };
    // 收尾(done / error / 网络断开三处都走这里,只生效一次):先把在途帧落地,再把助手项标成 done ——
    // 折叠只在这一刻发生一次(画板 2l 规则 2)。没等到 tool_end 的卡按服务端同一条兜底规则标成错误态、
    // 耗时留空(turn-recorder.ts 的 finish),实时与回放看到的因此是同一份(验收 #3)。
    //
    // 没有收尾帧(连接中途断开、done / error 都没到)就**不折叠**:折叠行要的两个数拿不到,编一行
    // 「0 次模型往返 · 0ms」是撒谎。保持内联态、只把在途的落地 —— 与改动前的行为相同;重新打开会话时
    // 按库里那份(服务端 finish 落的)回放。
    const finalize = (summary?: TurnSummary) => {
      if (finalized) return;
      finalized = true;
      flushNow();
      if (!started) return;
      if (turn) {
        if (!summary) return;
        turn.modelRoundTrips = summary.modelRoundTrips;
        turn.turnMs = summary.turnMs;
        for (const c of turn.toolCalls) {
          if (c.durationMs === undefined) { c.isError = true; c.resultPreview = ""; }
        }
      }
      commit(true);
    };

    askStream(
      { prompt, sessionId: sessionId ?? undefined },
      {
        onSession: setSessionId,
        onDelta,
        onToolStart,
        onToolEnd,
        onDone: finalize,
        // R-USAGE:一轮结束时顶栏当场更新(done 与 error 两种收尾都会给)
        onUsage: setUsage,
        // 先收尾再追加错误行:否则后到的 flush 会以「就地替换末项」的语义把这条错误消息顶掉。
        onError: (message, summary) => {
          finalize(summary);
          setItems((prev) => [...prev, { kind: "assistant", text: message, done: true }]);
        },
      },
    )
      .catch((err) => {
        console.error("ask failed:", err);
        finalize();
        setItems((prev) => [...prev, { kind: "assistant", text: askErrorText(err), done: true }]);
      })
      .finally(() => {
        finalize();
        setStreaming(false);
        refreshSessions();
      });
    return true;
  }, [streaming, loadingHistory, sessionId, refreshSessions]);

  const send = useCallback(() => {
    if (sendText(draft)) setDraft("");
  }, [sendText, draft]);

  /**
   * 卡片的点击即发(画板 2u / 5a;`docs/security.md` §0 第 12 条)。**回调恒等**:`AssistantMessage` 是 memo 的,`sendText` 随 streaming / sessionId
   * 换新,直接传下去会让每一段正文跟着重渲染 —— 所以最新的 `sendText` 放 ref、闭包只读 ref(与 `cardLink` / `rowLink` 同一手法)。
   * 发送前过 `sanitizePrefill`(名字是历史,函数就是「去控制字符 + 长度闸」,与预填走同一条边界);回 null 不发 ——
   * 解析期已按最坏长度卡在 1000 内,这里实际只会去掉控制字符。
   */
  const sendTextRef = useRef(sendText);
  useEffect(() => { sendTextRef.current = sendText; }, [sendText]);
  // 回「发没发出去」:清洗闸丢弃、或 sendText 的守卫拒收,都回 false,卡不锁(codex 第 1 轮 P2)。
  // ref 在 passive effect 里同步:React 在处理下一个离散事件(点击)之前一定先冲掉上一次提交的 passive effect,所以卡点到的永远是最新那份 sendText。
  const sendFromCard = useCallback((text: string): boolean => {
    const clean = sanitizePrefill(text);
    if (!clean) return false;
    return sendTextRef.current(clean);
  }, []);
  // 可回传卡读的那份:值只在一轮开始 / 结束时换,消费者只有卡本身(ComposerContext.tsx)
  const composer = useMemo(() => ({ busy: streaming, onSend: sendFromCard }), [streaming, sendFromCard]);

  // ── R-MOBILE:移动壳 ─────────────────────────────────────────────────
  // 桌面壳一行没动,原样留在下面。这里是**并列的第二种呈现**,不是改造。
  if (isMobile) {
    return (
      <ComposerContext.Provider value={composer}>
      <MobileWorkbench
        sessions={sessions}
        sessionId={sessionId}
        draft={draft}
        streaming={streaming}
        active={active}
        title={title}
        usage={usage}
        eventCount={events.length}
        shownPanel={shownPanel}
        onPanel={setPanel}
        onDraft={setDraft}
        onSend={send}
        onSelect={openSession}
        onNew={startNew}
        onDelete={removeSession}
        onRefresh={refreshSessions}
        // R-CROSSLINK:预填要能聚焦到移动端这只输入框(画板 4v),Sheet 的开关由容器按动作请求
        inputRef={inputRef}
        sheetRequest={sheetRequest}
        renderChat={() => <MobileChat items={items} rowLink={rowLink} locate={locateCard} onAsk={prefill} />}
        renderEmpty={() => <MobileEmptyState onSuggest={setDraft} />}
        // 内核层照搬:Sheet 里装的就是桌面右栏那四个组件本身
        renderPanel={(p, onPanelExpand) =>
          p === "tools" ? (
            <ToolsPanel />
          ) : !active ? (
            <LifecycleMap nodes={lifeNodes} idle compact />
          ) : p === "timeline" ? (
            <TimelineView
              turns={timelineTurns}
              compact
              onExpand={onPanelExpand}
              onAskWhy={prefill}
              cardLink={cardLink}
              locate={locateRow}
            />
          ) : p === "chain" ? (
            <ChainView chain={chain} compact />
          ) : (
            <LifecycleMap nodes={lifeNodes} compact />
          )
        }
      />
      </ComposerContext.Provider>
    );
  }

  return (
    // `m-hide-narrow`:窄屏下桌面壳整块不渲染出来。与上面的 `isMobile` 分支成对 ——
    // JS 保证只挂一份 SSE,CSS 保证水合首帧那一瞬不会把三栏画到 390 宽的屏上
    // (理由见 lib/use-mobile.ts)。桌面上这个类名不产生任何效果。
    // R-CARDS-2:ComposerContext.Provider 不产生 DOM,桌面壳的标记与改动前一字不差
    <ComposerContext.Provider value={composer}>
    <div className="m-hide-narrow" style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <SessionSidebar
        sessions={sessions}
        selected={sessionId}
        onSelect={openSession}
        onNew={startNew}
        onRefresh={refreshSessions}
        onDelete={removeSession}
      />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {/* 会话顶栏 */}
        <div style={{ height: 40, flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "0 14px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 13, fontWeight: active ? 600 : 400, color: active ? "var(--text)" : "var(--text-dim)", flex: 1 }}>
            {active ? title || "新会话" : "未选择会话"}
          </div>
          {active && (
            <div style={{ fontSize: 11, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums", display: "flex", alignItems: "center", gap: 6 }}>
              <span>{formatTokens(usage?.totalTokens)}</span><span>·</span><span>{STAT_PLACEHOLDER}</span><span>·</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#16a34a", display: "inline-block" }} />
                {formatCtx(usage?.ctxPercent)}
              </span>
              <span>·</span><span>{events.length} events</span>
            </div>
          )}
        </div>
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          {/* 中栏:对话 */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", borderRight: "1px solid var(--border)" }}>
            {active ? (
              <ChatPane items={items} rowLink={rowLink} locate={locateCard} onAsk={prefill} />
            ) : (
              <EmptyState onSuggest={setDraft} />
            )}
            <InputBar value={draft} onChange={setDraft} onSend={send} busy={streaming} inputRef={inputRef} />
          </div>
          {/* 右栏:运行时面板 */}
          <div className="runtime-panel" style={{ width: "42%", minWidth: 300, maxWidth: 500, flex: "none", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", background: "var(--bg-panel)", borderBottom: "1px solid var(--border)" }}>
              {PANEL_TABS.map(([key, label]) => {
                // 空状态右栏展示 Lifecycle 待命图,tab 高亮随之(画板 1e);
                // Tools 例外:它不依赖会话,空会话下切过去也有内容(R-TOOLS 验收 #4)
                const highlighted = key === shownPanel;
                return (
                  <div
                    key={key}
                    onClick={() => setPanel(key)}
                    style={{
                      fontSize: 12, fontWeight: highlighted ? 600 : 400, padding: "8px 14px",
                      background: highlighted ? "var(--bg)" : "transparent",
                      color: highlighted ? "var(--text)" : "var(--text-muted)",
                      borderRight: "1px solid var(--border)", cursor: "pointer",
                    }}
                  >
                    {label}
                  </div>
                );
              })}
            </div>
            {shownPanel === "tools" ? (
              <ToolsPanel />
            ) : !active ? (
              <LifecycleMap nodes={lifeNodes} idle />
            ) : shownPanel === "timeline" ? (
              <TimelineView turns={timelineTurns} onAskWhy={prefill} cardLink={cardLink} locate={locateRow} />
            ) : shownPanel === "chain" ? (
              <ChainView chain={chain} />
            ) : (
              <LifecycleMap nodes={lifeNodes} />
            )}
          </div>
        </div>
      </div>
    </div>
    </ComposerContext.Provider>
  );
}
