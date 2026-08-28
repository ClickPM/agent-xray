"use client";

import { lifeIdle, lifeNodes } from "@/lib/demo-data";
import type { LifeNode, LifeState } from "@/lib/types";
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

/** 生命周期图(画板 1d/1e):idle=true 为待命全灰态 */
export function LifecycleMap({ idle = false }: { idle?: boolean }) {
  const nodes = idle ? lifeIdle : lifeNodes;
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
