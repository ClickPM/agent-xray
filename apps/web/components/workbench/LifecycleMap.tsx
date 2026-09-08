"use client";

import type { LifeNode, LifeState } from "@/lib/types";
import { LIFE_GROUPS } from "@/lib/trace-view";
import { mono } from "@/lib/styles";

const STYLES: Record<LifeState, { icon: string; iconColor: string; color: string; border: string; bg: string; outline?: string; fw?: number; anim?: string }> = {
  fired: { icon: "✓", iconColor: "#16a34a", color: "var(--text)", border: "var(--border)", bg: "var(--bg)" },
  active: { icon: "●", iconColor: "#2563eb", color: "var(--accent)", border: "var(--accent)", bg: "rgba(37,99,235,0.06)", fw: 600, anim: "omPulseBg 1.8s ease-in-out infinite" },
  pending: { icon: "○", iconColor: "#9ca3af", color: "var(--text-dim)", border: "var(--border)", bg: "var(--bg)" },
  llm: { icon: "", iconColor: "#6b7280", color: "var(--text)", border: "#9ca3af", bg: "var(--bg-panel)", outline: "1px solid var(--border)", fw: 600 },
  llmIdle: { icon: "", iconColor: "#9ca3af", color: "var(--text-dim)", border: "var(--border)", bg: "var(--bg)", outline: "1px solid var(--bg-hover)" },
};

function Node({ node, last }: { node: LifeNode; last: boolean }) {
  const s = STYLES[node.state];
  return (
    <div>
      <div
        style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          border: `1px solid ${s.border}`, outline: s.outline ?? "none", outlineOffset: 2,
          borderRadius: 6, padding: "4px 10px", background: s.bg, animation: s.anim ?? "none",
        }}
      >
        <span style={{ fontSize: 11, color: s.iconColor, width: 12, textAlign: "center" }}>{s.icon}</span>
        <span style={{ ...mono(12, s.fw ?? 400), color: s.color }}>{node.name}</span>
        {node.count && <span style={{ ...mono(10), color: "var(--text-dim)" }}>{node.count}</span>}
      </div>
      {!last && <div style={{ width: 1, height: 11, background: "var(--border)", marginLeft: 24 }} />}
    </div>
  );
}

/**
 * R-MOBILE(画板 4h):移动端的节点方块。与桌面 `Node` 的差别只有两处 ——
 * 不画节点间竖线(2 列里画线会指错方向),名字 mono 12 → 11。
 *
 * 11 是内核层数据的下限,不再降:2 列宽只有 ~163,12px 会让
 * `before_provider_request` 省略掉一半。
 */
function CompactNode({ node }: { node: LifeNode }) {
  const s = STYLES[node.state];
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 6, minWidth: 0,
        border: `1px solid ${s.border}`, outline: s.outline ?? "none", outlineOffset: 2,
        borderRadius: 6, padding: "5px 8px", background: s.bg, animation: s.anim ?? "none",
      }}
    >
      <span style={{ fontSize: 10, color: s.iconColor, width: 10, flex: "none", textAlign: "center" }}>{s.icon}</span>
      <span style={{ ...mono(11, s.fw ?? 400), color: s.color, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {node.name}
      </span>
      {node.count && <span style={{ ...mono(10), color: "var(--text-dim)", flex: "none", fontVariantNumeric: "tabular-nums" }}>{node.count}</span>}
    </div>
  );
}

/** 生命周期图(画板 1d/1e;移动端 4h):idle=true 为待命全灰态(节点由调用方按事件流投影) */
export function LifecycleMap({ nodes, idle = false, compact }: { nodes: LifeNode[]; idle?: boolean; compact?: boolean }) {
  if (compact) {
    // 按 `LIFE_GROUPS` 的数量顺序切片。**切片跟着 LIFE_NODES 的顺序走**,
    // 增删节点时两边对不上会在这里被兜住:多出来的节点并进最后一组,一个都不丢。
    const groups: { title: string; items: LifeNode[] }[] = [];
    let at = 0;
    for (const g of LIFE_GROUPS) {
      groups.push({ title: g.title, items: nodes.slice(at, at + g.count) });
      at += g.count;
    }
    if (at < nodes.length && groups.length > 0) groups[groups.length - 1].items.push(...nodes.slice(at));

    return (
      <div style={{ flex: 1, overflow: "auto", padding: "14px 16px", display: "flex", flexDirection: "column" }}>
        {idle && <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 12 }}>对话开始后,这里会亮起来</div>}
        <div style={{ flex: 1 }}>
          {groups.map((g, gi) => (
            <div key={g.title}>
              {/* 组标题用**内核层的小标题语汇**(与 INPUT / RESULT 同族),不是 iOS 分组卡标题
                  —— 它标的是内核阶段,不是 iOS 列表分组(画板 4h 裁定) */}
              <div style={{ ...mono(10, 600), color: "var(--text-dim)", letterSpacing: "0.08em", marginBottom: 6 }}>{g.title}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 6 }}>
                {g.items.map((n) => (
                  <CompactNode key={n.name} node={n} />
                ))}
              </div>
              {/* 组间一个 ↓ 承接桌面那条竖线的语义;组内不画线(2 列里会指错方向) */}
              {gi < groups.length - 1 && (
                <div style={{ textAlign: "center", color: "#d4d4d4", fontSize: 10, lineHeight: 1, padding: "8px 0" }}>↓</div>
              )}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 16, borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 12, fontSize: 11, color: "var(--text-muted)" }}>
          <span><span style={{ color: "#16a34a" }}>✓</span> fired</span>
          <span><span style={{ color: "#2563eb" }}>●</span> active</span>
          <span><span style={{ color: "#9ca3af" }}>○</span> pending</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "14px 18px", display: "flex", flexDirection: "column" }}>
      {idle && <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 12 }}>对话开始后,这里会亮起来</div>}
      <div style={{ flex: 1 }}>
        {nodes.map((n, i) => (
          <Node key={n.name} node={n} last={i === nodes.length - 1} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 16, borderTop: "1px solid var(--border)", paddingTop: 8, fontSize: 11, color: "var(--text-muted)" }}>
        <span><span style={{ color: "#16a34a" }}>✓</span> fired</span>
        <span><span style={{ color: "#2563eb" }}>●</span> active</span>
        <span><span style={{ color: "#9ca3af" }}>○</span> pending</span>
      </div>
    </div>
  );
}
