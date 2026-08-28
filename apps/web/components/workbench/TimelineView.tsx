"use client";

import { useState, Fragment } from "react";
import { barWidth, contextDetail, traceTurns } from "@/lib/demo-data";
import type { TraceRow } from "@/lib/types";
import { mono } from "@/lib/styles";

function DetailCard() {
  return (
    <div
      style={{
        position: "relative", background: "var(--bg-subtle)", border: "1px solid var(--border)",
        borderRadius: 6, padding: "10px 12px", margin: "4px 0 8px 20px",
      }}
    >
      <button
        style={{
          position: "absolute", top: 6, right: 8, color: "var(--accent)", fontSize: 11,
          borderRadius: 5, padding: "2px 6px", cursor: "pointer", background: "none", border: "none",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
        title="问问 agent:这一步为什么这么做?(pi 接入后可用)"
      >
        Ask why ↗
      </button>
      <div style={{ ...mono(10, 600), color: "var(--text-dim)", letterSpacing: "0.06em", marginBottom: 3 }}>INPUT</div>
      <div style={{ ...mono(11), lineHeight: 1.6, color: "var(--text)" }}>{contextDetail.input}</div>
      <div style={{ ...mono(10, 600), color: "var(--text-dim)", letterSpacing: "0.06em", margin: "10px 0 3px" }}>
        EXTENSION RETURNED · <span style={{ color: "var(--accent)" }}>{contextDetail.extension}</span>
      </div>
      <div style={{ ...mono(11), lineHeight: 1.6, color: "var(--text)" }}>{contextDetail.returned}</div>
      <div style={{ ...mono(10, 600), color: "var(--text-dim)", letterSpacing: "0.06em", margin: "10px 0 3px" }}>DIFF</div>
      <div style={{ ...mono(11), lineHeight: 1.6, color: "var(--ok-text)" }}>{contextDetail.diff}</div>
    </div>
  );
}

function Row({ row, expanded, onToggle }: { row: TraceRow; expanded: boolean; onToggle?: () => void }) {
  const selectable = !!row.expandable;
  return (
    <>
      <div
        onClick={selectable ? onToggle : undefined}
        style={{
          display: "grid", gridTemplateColumns: "200px 1fr 52px", alignItems: "center",
          gap: 10, padding: "3px 4px", borderRadius: 4,
          background: expanded ? "rgba(37,99,235,0.06)" : row.streaming ? "rgba(37,99,235,0.06)" : "transparent",
          animation: row.streaming ? "omPulseBg 1.8s ease-in-out infinite" : "none",
          cursor: selectable ? "pointer" : "default",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", overflow: "hidden" }}>
          {selectable && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={expanded ? "var(--accent)" : "var(--text-dim)"} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expanded ? "none" : "rotate(-90deg)", transition: "transform 0.12s", flexShrink: 0 }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          )}
          <span style={{ ...mono(11, expanded ? 600 : 400), color: expanded ? "var(--accent)" : "var(--text)" }}>{row.name}</span>
          {row.hasBadge && (
            <span style={{ ...mono(10, 600), background: "var(--err-text)", color: "#fff", borderRadius: 4, padding: "1px 5px" }}>blocked</span>
          )}
        </div>
        <div style={{ minWidth: 0, overflow: "hidden" }}>
          <div style={{ height: 10, borderRadius: 2, maxWidth: "100%", width: barWidth(row.ms), background: row.color }} />
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{row.dur}</div>
      </div>
      {row.hasNote && (
        <div style={{ ...mono(11), color: "var(--err-text)", padding: "1px 4px 3px 22px" }}>
          └ permission-gate returned {"{"}block: true{"}"}
        </div>
      )}
      {expanded && <DetailCard />}
    </>
  );
}

/** DevTools 式事件瀑布(画板 1a/1b);visibleRows=-1 表示全部可见 */
export function TimelineView({ visibleRows = -1 }: { visibleRows?: number }) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  let shown = 0;
  return (
    <div style={{ flex: 1, overflow: "auto", padding: "10px 14px" }}>
      {traceTurns.map((turn) => {
        const rows = turn.rows.filter(() => {
          shown += 1;
          return visibleRows < 0 || shown <= visibleRows;
        });
        if (rows.length === 0) return null;
        return (
          <Fragment key={turn.label}>
            <div
              style={{
                ...mono(11, 600), color: "var(--text-muted)", letterSpacing: "0.05em",
                padding: "4px 0 6px", borderBottom: "1px solid var(--border)", marginBottom: 6,
                marginTop: turn.label === "Turn 1" ? 0 : 14,
              }}
            >
              {turn.label}
            </div>
            {rows.map((row) => {
              const key = `${turn.label}:${row.name}`;
              return (
                <Row
                  key={key}
                  row={row}
                  expanded={expandedKey === key}
                  onToggle={() => setExpandedKey((cur) => (cur === key ? null : key))}
                />
              );
            })}
          </Fragment>
        );
      })}
    </div>
  );
}
