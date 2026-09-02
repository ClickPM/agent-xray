"use client";

import { useEffect, useRef, useState, Fragment, type CSSProperties } from "react";
import { barWidth } from "@/lib/trace-view";
import type { TraceRow, TraceRowDetail, TraceTurn } from "@/lib/types";
import { mono } from "@/lib/styles";

/**
 * 进行中行的「从左向右」波浪扫光。keyframes 在 app/globals.css(omWaveSweep)。
 *
 * `row.streaming` 由 `toTimelineTurns(events, streaming)` 给出,而那个 streaming
 * 是 Workbench 的整轮状态:从点发送到 askStream 结束(finally)之间恒为 true。
 * 动画本身是 infinite,所以**这一轮没结束之前波浪一直在走**,不会自己停。
 *
 * 两处用同一条 keyframe、同一个周期,行背景与时长条同相位(demo 方案 E)。
 * 时长条的高光取白色而不是品牌蓝:条的底色是事件模式色(notify 灰 / chain 蓝 /
 * veto 红 / takeover 黄),白色高光对四种底色都是「提亮」,蓝色高光会把红黄两种
 * 染脏、在蓝底上又几乎看不见。
 */
const WAVE_PERIOD = "1.8s";

const waveRow: CSSProperties = {
  backgroundColor: "rgba(37,99,235,0.05)",
  backgroundImage:
    "linear-gradient(90deg, rgba(37,99,235,0) 0%, rgba(37,99,235,0.16) 50%, rgba(37,99,235,0) 100%)",
  backgroundSize: "200% 100%",
  backgroundRepeat: "no-repeat",
  animation: `omWaveSweep ${WAVE_PERIOD} linear infinite`,
};

const waveBar: CSSProperties = {
  backgroundImage:
    "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.6) 50%, rgba(255,255,255,0) 100%)",
  backgroundSize: "200% 100%",
  backgroundRepeat: "no-repeat",
  animation: `omWaveSweep ${WAVE_PERIOD} linear infinite`,
};

function DetailCard({ detail }: { detail: TraceRowDetail }) {
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
      <div style={{ ...mono(11), lineHeight: 1.6, color: "var(--text)" }}>{detail.input}</div>
      <div style={{ ...mono(10, 600), color: "var(--text-dim)", letterSpacing: "0.06em", margin: "10px 0 3px" }}>
        EXTENSION RETURNED · <span style={{ color: "var(--accent)" }}>{detail.extension}</span>
      </div>
      <div style={{ ...mono(11), lineHeight: 1.6, color: "var(--text)" }}>{detail.returned}</div>
      <div style={{ ...mono(10, 600), color: "var(--text-dim)", letterSpacing: "0.06em", margin: "10px 0 3px" }}>DIFF</div>
      <div style={{ ...mono(11), lineHeight: 1.6, color: "var(--ok-text)" }}>{detail.diff}</div>
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
          // 底色用 backgroundColor 而不是 background 简写:波浪那几条是 background-*
          // 长写,简写与长写混着用,streaming 翻回 false 时 React 会报
          // 「Removing a style property … when a conflicting property is set」。
          // 尾行每来一个新事件就翻一次,那条警告会一直刷。
          backgroundColor: expanded ? "rgba(37,99,235,0.06)" : "transparent",
          // 进行中的行盖掉上面那句静态底色(同名长写,后者赢)。展开态与进行中
          // 同时成立时以波浪为准:「还在跑」比「已选中」更需要被看见。
          ...(row.streaming ? waveRow : null),
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
          <div
            style={{
              height: 10, borderRadius: 2, maxWidth: "100%", width: barWidth(row.ms),
              backgroundColor: row.color, // 同上:不能写 background 简写
              ...(row.streaming ? waveBar : null),
            }}
          />
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{row.dur}</div>
      </div>
      {row.hasNote && (
        <div style={{ ...mono(11), color: "var(--err-text)", padding: "1px 4px 3px 22px" }}>
          └ permission-gate returned {"{"}block: true{"}"}
        </div>
      )}
      {expanded && row.detail && <DetailCard detail={row.detail} />}
    </>
  );
}

/** DevTools 式事件瀑布(画板 1a/1b),消费 /trace/stream 的真实事件投影 */
export function TimelineView({ turns }: { turns: TraceTurn[] }) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 「贴底跟随」开关。用 ref 不用 state:它每次滚动事件都会重算,进 state 会让整条
  // 瀑布(最多 MAX_TRACE_EVENTS 行)跟着重渲染一次。
  const stuck = useRef(true);

  // 新事件到达就跟到底部 —— **但只在用户本来就贴着底时跟**。不加这个条件的话,
  // 用户往上翻查某一行时会被每一帧新事件一路拽回底部,等于没法看历史事件。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stuck.current) return;
    // 直接赋 scrollTop,不用 scrollTo({behavior:"smooth"}):流式期间事件是逐帧到的,
    // 平滑动画会被下一次调用不断打断,表现是永远追不上底部还一直在抖。
    el.scrollTop = el.scrollHeight;
  }, [turns]);

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        // 24px 容差:行高不是整数,scrollTop 也可能是小数,严格贴底几乎不成立。
        // 用户往上滚一点就脱离跟随,再滚回底部自动恢复跟随。
        stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 24;
      }}
      style={{ flex: 1, overflow: "auto", padding: "10px 14px" }}
    >
      {turns.map((turn) => {
        const rows = turn.rows;
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
              const key = row.key;
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
