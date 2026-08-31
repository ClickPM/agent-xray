"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { statsBar, suggestions } from "@/lib/demo-data";
import {
  askStream,
  getSession,
  listSessions,
  relativeTime,
  AskError,
  type SessionSummary,
} from "@/lib/agent-api";
import type { ChatItem } from "@/lib/types";
import { GhostButton } from "@/components/ui";
import { mono } from "@/lib/styles";
import { TimelineView } from "./TimelineView";
import { ChainView } from "./ChainView";
import { LifecycleMap } from "./LifecycleMap";

type Panel = "timeline" | "chain" | "lifecycle";

/** 请求失败时给访客看的固定文案(服务端已把细节挡在日志里,前端只按状态分档)。 */
function askErrorText(err: unknown): string {
  if (err instanceof AskError) {
    if (err.status === 409) return "上一轮回复还在进行中,请等它结束再发。";
    if (err.status === 429) return "当前会话数已满,请稍后再试。";
    if (err.status === 404) return "这个会话已不存在,请新建一个会话。";
  }
  return "请求失败了,请稍后再试。";
}

/** 演示回放:右栏三视图仍消费 demo-data,R4 接 /trace/stream 后由真实事件流驱动。
 *  (chat 字段在 R3 已由真实对话接管,这里只保留 trace 行数。) */
const PLAYBACK: Array<{ trace: number; delay: number }> = [
  { trace: 0, delay: 300 },
  { trace: 2, delay: 500 },
  { trace: 3, delay: 600 },
  { trace: 4, delay: 400 },
  { trace: 6, delay: 700 },
  { trace: 7, delay: 400 },
  { trace: 9, delay: 500 },
  { trace: 10, delay: 600 },
  { trace: 11, delay: 400 },
  { trace: 13, delay: 500 },
];

function usePlayback(active: boolean) {
  const [step, setStep] = useState(active ? PLAYBACK.length : 0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!active) {
      setStep(0);
      return;
    }
    setStep(0);
    let i = 0;
    const tick = () => {
      if (i >= PLAYBACK.length) return;
      timer.current = setTimeout(() => {
        i += 1;
        setStep(i);
        tick();
      }, PLAYBACK[Math.min(i, PLAYBACK.length - 1)].delay);
    };
    tick();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [active]);
  if (!active) return { trace: 0, done: false };
  if (step === 0) return { trace: 0, done: false };
  const s = PLAYBACK[step - 1];
  return { trace: s.trace, done: step >= PLAYBACK.length };
}

function SessionSidebar({
  sessions,
  selected,
  onSelect,
  onNew,
  onRefresh,
}: {
  sessions: SessionSummary[];
  selected: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRefresh: () => void;
}) {
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
            style={{ padding: "7px 10px", borderRadius: 6, background: selected === s.id ? "var(--bg-selected)" : "transparent", cursor: "pointer" }}
            onMouseEnter={(e) => { if (selected !== s.id) e.currentTarget.style.background = "var(--bg-hover)"; }}
            onMouseLeave={(e) => { if (selected !== s.id) e.currentTarget.style.background = "transparent"; }}
          >
            <div style={{ fontSize: 13, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.title || "新会话"}</div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>{relativeTime(s.lastActiveAt)}</div>
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

function renderInline(text: string) {
  // `code` 片段 → 行内代码样式
  const parts = text.split(/`([^`]+)`/g);
  return parts.map((p, i) =>
    i % 2 === 1 ? (
      <span key={i} style={{ ...mono(12), background: "var(--bg-subtle)", borderRadius: 4, padding: "1px 5px" }}>{p}</span>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

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
        return (
          <div key={i} style={{ fontSize: 14, lineHeight: 1.7 }}>
            {renderInline(item.text ?? "")}
          </div>
        );
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

  // 会话切换的请求序号:连点两个会话时,先发后到的历史加载必须被丢弃,
  // 否则 UI 会被旧会话的消息覆盖(codex review P2)
  const loadSeq = useRef(0);

  const active = sessionId !== null || items.length > 0;
  const { trace } = usePlayback(active);
  const title = sessions.find((s) => s.id === sessionId)?.title || "";

  const refreshSessions = useCallback(() => {
    listSessions()
      .then(setSessions)
      .catch((err) => console.error("load sessions failed:", err));
  }, []);

  useEffect(refreshSessions, [refreshSessions]);

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
    let assistant = "";
    let started = false;
    const onDelta = (text: string) => {
      assistant += text;
      const snapshot = assistant;
      const first = !started;
      started = true;
      setItems((prev) =>
        first
          ? [...prev, { kind: "assistant", text: snapshot }]
          : [...prev.slice(0, -1), { kind: "assistant", text: snapshot }],
      );
    };

    askStream(
      { prompt, sessionId: sessionId ?? undefined },
      {
        onSession: setSessionId,
        onDelta,
        onError: (message) => setItems((prev) => [...prev, { kind: "assistant", text: message }]),
      },
    )
      .catch((err) => {
        console.error("ask failed:", err);
        setItems((prev) => [...prev, { kind: "assistant", text: askErrorText(err) }]);
      })
      .finally(() => {
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
              <span>·</span><span>{statsBar.events}</span>
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
                <TimelineView visibleRows={trace} />
              ) : panel === "chain" ? (
                <ChainView />
              ) : (
                <LifecycleMap />
              )
            ) : (
              <LifecycleMap idle />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
