"use client";

import { useState, type ReactNode } from "react";
import { MobileSessionDrawer } from "@/components/mobile/MobileSessionDrawer";
import { Sheet, SegmentedControl, type Detent } from "@/components/mobile/Sheet";
import { relativeTime, type SessionSummary, type SessionUsage } from "@/lib/agent-api";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";
import { formatCtx, formatTokens, STAT_PLACEHOLDER } from "@/lib/stats-bar";
import { mono } from "@/lib/styles";

/**
 * R-MOBILE Runtime 移动壳(画板 4a–4j)。
 *
 * 【它不持有任何状态】所有状态、取数与两条 SSE 都在 `Workbench.tsx` 的容器里,
 * 桌面壳与移动壳是同一份状态的两种呈现 —— 这是「只挂一份 SSE」的实现方式,
 * 也是为什么这里全是 props。
 *
 * 【三栏 → 一屏的裁定(画板 4e)】左栏会话列表 → 左上按钮打开的 Sheet;
 * 右栏运行时面板 → 底部两档 Sheet。桌面右栏永不遮挡对话,移动端靠 **medium 档只占一半**
 * 换回同一件事:「边看输出边看事件」是这个站的核心体验。
 *
 * 【顶部是功能条不是标题栏】微信导航栏已经显示页面标题(document.title),
 * 再放一次就是两个标题 —— 所以中间放的是会话状态(生成中 / 会话标题),不是站名。
 */
export interface MobileWorkbenchProps {
  sessions: SessionSummary[];
  sessionId: string | null;
  draft: string;
  streaming: boolean;
  active: boolean;
  title: string;
  usage: SessionUsage | null;
  eventCount: number;
  shownPanel: PanelKey;
  onPanel: (p: PanelKey) => void;
  onDraft: (v: string) => void;
  onSend: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
  /**
   * 内核层三视图 + Tools。**用 render prop 而不是把 view model 传进来**:
   * 那三个 view model 的类型是 `toTimelineTurns` / `toChainView` / `toLifecycleNodes`
   * 的返回值,在这里重新声明一遍等于把内核层的类型抄第二份,以后改一处就漏一处。
   * 容器直接把桌面那四个组件原样塞进来 —— 「内核层照搬」在类型上也照搬。
   */
  /**
   * 第二个参数是「请把 Sheet 升到 large」的回调(画板 4f):Timeline 某行展开时,
   * medium 档里详情块只剩两行可见 —— 展开的同时升档。
   */
  renderPanel: (p: PanelKey, onExpand: () => void) => ReactNode;
  /** 会话区:同一份 items,用移动端度量渲染(画板 4b:气泡 r18、正文 15/1.75) */
  renderChat: () => ReactNode;
  /** 空状态的建议句(画板 4a) */
  renderEmpty: () => ReactNode;
}

export type PanelKey = "timeline" | "chain" | "lifecycle" | "tools";

const PANEL_ITEMS = [
  { value: "timeline" as const, label: "Timeline" },
  { value: "chain" as const, label: "Chain" },
  { value: "lifecycle" as const, label: "Lifecycle" },
  { value: "tools" as const, label: "Tools" },
];

/** 输入栏自身高度(8 + 40 + 10)。上下两条栏的**总占位**(含安全区)走 CSS 变量
    `--m-top-inset` / `--m-bottom-inset` —— 别再在这里写裸的 44 / 49:
    Tab Bar 的实际高度是 `49 + safe-bottom`,写死会在带 Home Indicator 的机型上
    与输入栏重叠(本轮 codex 审查的 P1)。 */
const INPUTBAR = 58;

export function MobileWorkbench(props: MobileWorkbenchProps) {
  const {
    sessions, sessionId, active, title, usage, eventCount, streaming, draft,
    shownPanel, onPanel, onDraft, onSend, onSelect, onNew, onDelete, onRefresh,
    renderPanel, renderChat, renderEmpty,
  } = props;

  // 键盘占掉的高度。iOS 只缩 visualViewport、不改布局视口 —— 不跟这个值走的话
  // 输入栏会被键盘整条盖住(审查 P1)。
  const keyboard = useKeyboardInset();
  const [runtimeOpen, setRuntimeOpen] = useState(false);
  const [runtimeDetent, setRuntimeDetent] = useState<Detent>("medium");
  const [sessionsOpen, setSessionsOpen] = useState(false);

  return (
    <div
      className="m-shell"
      style={{ flex: 1, minHeight: 0, position: "relative", display: "flex", flexDirection: "column", background: "var(--bg)" }}
    >
      {/* ── 内容区。上下各留出玻璃条的高度,内容从玻璃底下穿过去 ───────────── */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          paddingTop: "var(--m-top-inset)",
          // 键盘弹起时 Tab Bar 让位(见 globals.css 的 `body.m-keyboard`),
          // 这时底部只需让开「输入栏 + 键盘」;否则让开「输入栏 + Tab Bar + 安全区」
          paddingBottom: keyboard > 0 ? INPUTBAR + keyboard : `calc(${INPUTBAR}px + var(--m-bottom-inset))`,
        }}
      >
        {active ? renderChat() : renderEmpty()}
      </div>

      {/* ── 顶部功能条(玻璃)────────────────────────────────────────────── */}
      <div
        className="m-glass-top"
        style={{
          position: "absolute", top: 0, left: 0, right: 0, zIndex: 4,
          // ⚠️ 高度与**顶部**内边距由 `.m-glass-top` 按 `--safe-top` 给。
          // 这里只能写左右内边距 —— 写 `padding: "0 6px"` 简写会把
          // `.m-glass-top` 的 `padding-top: var(--safe-top)` 一起冲掉,
          // standalone 下功能条落到刘海底下(codex 第 2 轮 P1)。
          display: "flex", alignItems: "center", gap: 4,
          paddingLeft: 6, paddingRight: 6,
        }}
      >
        <button
          className="m-tap"
          aria-label="会话列表"
          onClick={() => setSessionsOpen(true)}
          style={{
            width: 44, height: 44, flex: "none", display: "flex", alignItems: "center",
            justifyContent: "center", color: "var(--accent)", background: "none", border: "none", padding: 0,
          }}
        >
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
        </button>
        {/* 中间不放站名(微信导航栏已显示 document.title),放会话状态 */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span
            style={{
              fontSize: 12, color: "var(--text-muted)",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}
          >
            {streaming ? "生成中" : active ? title || "新会话" : ""}
          </span>
        </div>
        {/* 「运行时」按钮。事件数徽标是移动端替代「右栏一直在动」的信号(画板 4e) */}
        <button
          className="m-tap"
          onClick={() => setRuntimeOpen(true)}
          aria-label={`运行时面板,${eventCount} 个事件`}
          style={{
            minHeight: 44, flex: "none", display: "flex", alignItems: "center",
            padding: "0 4px", background: "none", border: "none",
          }}
        >
          <span
            style={{
              display: "flex", alignItems: "center", gap: 6, height: 30, borderRadius: 15,
              background: runtimeOpen ? "var(--accent)" : "var(--m-fill)",
              color: runtimeOpen ? "#ffffff" : "var(--accent)",
              padding: eventCount > 0 ? "0 8px 0 12px" : "0 12px",
              fontSize: 13, fontWeight: 600,
            }}
          >
            运行时
            {eventCount > 0 && (
              <span
                style={{
                  ...mono(10, 600),
                  color: runtimeOpen ? "var(--accent)" : "#ffffff",
                  background: runtimeOpen ? "#ffffff" : "var(--accent)",
                  borderRadius: 9, padding: "2px 6px", fontVariantNumeric: "tabular-nums",
                }}
              >
                {eventCount}
              </span>
            )}
          </span>
        </button>
      </div>

      {/* ── 输入栏(玻璃)。贴在 Tab Bar 之上 ──────────────────────────────── */}
      <div
        className="m-glass-bottom"
        style={{
          position: "absolute", left: 0, right: 0, zIndex: 4,
          // 常态贴在整条 Tab Bar 之上(**含安全区**,不是裸 49);
          // 键盘弹起时 Tab Bar 让位,输入栏直接贴键盘上沿
          bottom: keyboard > 0 ? keyboard : "var(--m-bottom-inset)",
          display: "flex", alignItems: "center", gap: 10, padding: "8px 16px 10px",
        }}
      >
        <input
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder="和 agent 说点什么…"
          style={{
            flex: 1, minWidth: 0, minHeight: 40, borderRadius: 20,
            background: "var(--m-fill)", border: "none", padding: "0 16px",
            // ⚠️ 16 是下限不是审美:小于 16 时 iOS 聚焦会强行放大整页,
            // 而 viewport 的 user-scalable=no 拦不住它。桌面那份仍是 14(规则 7)。
            fontSize: 16,
            color: "var(--text)", outline: "none", fontFamily: "inherit",
          }}
        />
        <button
          className="m-tap"
          onClick={onSend}
          disabled={streaming}
          aria-label={streaming ? "生成中" : "发送"}
          style={{
            width: 40, height: 40, flex: "none", borderRadius: 20,
            background: "var(--accent)", color: "#ffffff", border: "none",
            display: "flex", alignItems: "center", justifyContent: "center",
            opacity: streaming ? 0.6 : 1,
          }}
        >
          {streaming ? (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ animation: "omSpin .8s linear infinite" }}>
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          ) : (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          )}
        </button>
      </div>

      {/* ── 运行时面板 Sheet(画板 4e–4i)────────────────────────────────── */}
      <Sheet
        open={runtimeOpen}
        onClose={() => setRuntimeOpen(false)}
        detent={runtimeDetent}
        onDetentChange={setRuntimeDetent}
        label="运行时面板"
        header={
          <>
            {/* 桌面的会话顶栏统计条收进这里 —— 它是运行时数据,不是会话标题(画板 4e 裁定)。
                费用与分段 token 不出现。 */}
            <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "4px 16px 8px" }}>
              <span style={{ ...mono(11), color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
                {formatTokens(usage?.totalTokens)}
              </span>
              <span style={{ ...mono(11), color: "var(--text-dim)" }}>·</span>
              <span style={{ ...mono(11), color: "var(--text-dim)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#16a34a" }} />
                {formatCtx(usage?.ctxPercent)}
              </span>
              <span style={{ ...mono(11), color: "var(--text-dim)" }}>·</span>
              <span style={{ ...mono(11), color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
                {eventCount} events
              </span>
              <span style={{ ...mono(11), color: "var(--text-dim)" }}>·</span>
              <span style={{ ...mono(11), color: "var(--text-dim)" }}>{STAT_PLACEHOLDER}</span>
            </div>
            <SegmentedControl items={PANEL_ITEMS} value={shownPanel} onChange={onPanel} />
          </>
        }
      >
        {renderPanel(shownPanel, () => setRuntimeDetent("large"))}
      </Sheet>

      {/* ── 会话列表抽屉(画板 4j:左侧滑出、宽 84%、右两角 r20)─────────────── */}
      <MobileSessionDrawer
        open={sessionsOpen}
        onClose={() => setSessionsOpen(false)}
        sessions={sessions}
        selected={sessionId}
        onSelect={(id) => {
          onSelect(id);
          setSessionsOpen(false);
        }}
        onNew={() => {
          onNew();
          setSessionsOpen(false);
        }}
        onDelete={onDelete}
        onRefresh={onRefresh}
      />
    </div>
  );
}
