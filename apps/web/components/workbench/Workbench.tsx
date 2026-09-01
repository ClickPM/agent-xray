"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { statsBar, suggestions } from "@/lib/demo-data";
import {
  askStream,
  deleteSession,
  getSession,
  listSessions,
  relativeTime,
  AskError,
  type SessionSummary,
} from "@/lib/agent-api";
import { openTraceStream } from "@/lib/trace-api";
import { toChainView, toLifecycleNodes, toTimelineTurns } from "@/lib/trace-view";
import type { ChatItem, TraceEvent } from "@/lib/types";
import { GhostButton } from "@/components/ui";
import { Markdown } from "@/components/Markdown";
import { mono } from "@/lib/styles";
import { TimelineView } from "./TimelineView";
import { ChainView } from "./ChainView";
import { LifecycleMap } from "./LifecycleMap";

type Panel = "timeline" | "chain" | "lifecycle";

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

function ToolChip({ name, preview, dur, error }: { name: string; preview: string; dur: string; error: boolean }) {
  return (
    <div
      style={{
        background: error ? "var(--err-bg)" : "var(--ok-bg)",
        border: `1px solid ${error ? "var(--err-border)" : "var(--ok-border)"}`,
        borderRadius: 7, padding: "7px 10px", display: "flex", alignItems: "center", gap: 8,
      }}
    >
      <span style={{ ...mono(12, 600), color: error ? "var(--err-text)" : "var(--ok-text)" }}>{name}</span>
      <span style={{ ...mono(11), color: "var(--text-dim)", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{preview}</span>
      <span style={{ fontSize: 11, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{dur}</span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9" />
      </svg>
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
const AssistantMessage = memo(function AssistantMessage({ text }: { text: string }) {
  return (
    <div className="md-chat" style={{ minWidth: 0 }}>
      <Markdown headingIds={false}>{text}</Markdown>
    </div>
  );
});

function ChatPane({ items }: { items: ChatItem[] }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const tail = items[items.length - 1]?.text?.length ?? 0;
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
        if (item.kind === "tool" && item.tool) {
          return <ToolChip key={i} {...item.tool} />;
        }
        return <AssistantMessage key={i} text={item.text ?? ""} />;
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

function InputBar({
  value,
  onChange,
  onSend,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
}) {
  return (
    <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "center" }}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { onSend(); } }}
        placeholder="和 agent 说点什么…(右侧实时显示内核轨迹)"
        style={{
          flex: 1, border: "1px solid var(--border)", borderRadius: 7, padding: "8px 12px",
          fontSize: 14, color: "var(--text)", background: "var(--bg)", outline: "none", font: "inherit",
        }}
      />
      <GhostButton height={32} style={{ width: 32, padding: 0 }} onClick={onSend}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
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

  // 会话切换的请求序号:连点两个会话时,先发后到的历史加载必须被丢弃,
  // 否则 UI 会被旧会话的消息覆盖(codex review P2)
  const loadSeq = useRef(0);

  const active = sessionId !== null || items.length > 0;
  const title = sessions.find((s) => s.id === sessionId)?.title || "";

  // 右栏三视图 = 同一条轨迹流的三种投影(docs/architecture.md)。
  // 必须 memo:events 最多 5000 条,而输入框每敲一个字都会触发重渲染——
  // 不 memo 的话每次击键都要把整条轨迹重投影三遍。
  const timelineTurns = useMemo(() => toTimelineTurns(events, streaming), [events, streaming]);
  const chain = useMemo(() => toChainView(events), [events]);
  const lifeNodes = useMemo(() => toLifecycleNodes(events, streaming), [events, streaming]);

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
      setLoadingHistory(true);
      getSession(id)
        .then(({ messages }) => {
          if (loadSeq.current !== seq) return; // 已被更晚的选择/新建取代
          setItems(messages.map((m) => ({ kind: m.role, text: m.content })));
        })
        .catch((err) => console.error("load session failed:", err))
        .finally(() => {
          if (loadSeq.current === seq) setLoadingHistory(false);
        });
    },
    [streaming],
  );

  const startNew = useCallback(() => {
    if (streaming) return;
    loadSeq.current++; // 作废在途的历史加载
    setLoadingHistory(false);
    setSessionId(null);
    setItems([]);
    setDraft("");
    setPanel("timeline");
  }, [streaming]);

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

  const send = useCallback(() => {
    const prompt = draft.trim();
    // 历史加载未回来时不收发送:此时 items 已被清空,若在这里作废加载结果,
    // 这个会话的历史就再也不会出现在界面上(复审 P2)。加载只有几十毫秒,
    // 与 streaming 期间的拦截是同一种处理。
    if (!prompt || streaming || loadingHistory) return;
    setDraft("");
    setPanel("timeline");
    setItems((prev) => [...prev, { kind: "user", text: prompt }]);
    setStreaming(true);

    // 首个 delta 到达时才建助手气泡(避免先渲染一个空行),之后每个 delta 就地替换它。
    // 「是否首帧」在调用点定死,不在 setItems 更新函数里读可变量——更新函数由 React
    // 择时执行,读到的会是变更后的值。
    //
    // 服务端 delta 是**逐 token** 发的(apps/api/agent/ask.ts),一条长回复几千帧;
    // 助手气泡改渲染 markdown 之后,一帧一次 setItems 就等于一帧解析一遍整篇正文。
    // 这里按动画帧合帧:攒在 assistant 里,一帧最多提交一次,渲染开销与 token 速率脱钩。
    // 帧回调在页面隐藏时不跑,所以每个出口都要先 flushNow() 把攒下的文本落地。
    let assistant = "";
    let started = false;
    let pending = false;
    let frame = 0;
    const commit = () => {
      const snapshot = assistant;
      const first = !started;
      started = true;
      setItems((prev) =>
        first
          ? [...prev, { kind: "assistant", text: snapshot }]
          : [...prev.slice(0, -1), { kind: "assistant", text: snapshot }],
      );
    };
    const flushNow = () => {
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      if (pending) { pending = false; commit(); }
    };
    const onDelta = (text: string) => {
      assistant += text;
      pending = true;
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; flushNow(); });
    };

    askStream(
      { prompt, sessionId: sessionId ?? undefined },
      {
        onSession: setSessionId,
        onDelta,
        // 先把在途文本落地再追加错误行:否则后到的 flush 会以「就地替换末项」的
        // 语义把这条错误消息顶掉。
        onError: (message) => {
          flushNow();
          setItems((prev) => [...prev, { kind: "assistant", text: message }]);
        },
      },
    )
      .catch((err) => {
        console.error("ask failed:", err);
        flushNow();
        setItems((prev) => [...prev, { kind: "assistant", text: askErrorText(err) }]);
      })
      .finally(() => {
        flushNow();
        setStreaming(false);
        refreshSessions();
      });
  }, [draft, streaming, loadingHistory, sessionId, refreshSessions]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
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
              <span>{statsBar.tokens}</span><span>·</span><span>{statsBar.cost}</span><span>·</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#16a34a", display: "inline-block" }} />
                {statsBar.ctx}
              </span>
              <span>·</span><span>{events.length} events</span>
            </div>
          )}
        </div>
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          {/* 中栏:对话 */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", borderRight: "1px solid var(--border)" }}>
            {active ? <ChatPane items={items} /> : <EmptyState onSuggest={setDraft} />}
            <InputBar value={draft} onChange={setDraft} onSend={send} />
          </div>
          {/* 右栏:运行时面板 */}
          <div className="runtime-panel" style={{ width: "42%", minWidth: 300, maxWidth: 500, flex: "none", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", background: "var(--bg-panel)", borderBottom: "1px solid var(--border)" }}>
              {([["timeline", "Timeline"], ["chain", "Chain View"], ["lifecycle", "Lifecycle Map"]] as const).map(([key, label]) => {
                // 空状态右栏展示 Lifecycle 待命图,tab 高亮随之(画板 1e)
                const highlighted = active ? panel === key : key === "lifecycle";
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
            {active ? (
              panel === "timeline" ? (
                <TimelineView turns={timelineTurns} />
              ) : panel === "chain" ? (
                <ChainView chain={chain} />
              ) : (
                <LifecycleMap nodes={lifeNodes} />
              )
            ) : (
              <LifecycleMap nodes={lifeNodes} idle />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
