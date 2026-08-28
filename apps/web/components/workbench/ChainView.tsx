"use client";

import { chainSteps } from "@/lib/demo-data";
import { mono } from "@/lib/styles";

function Arrow() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "4px 0" }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="5" x2="12" y2="19" />
        <polyline points="19 12 12 19 5 12" />
      </svg>
    </div>
  );
}

const card = {
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
  borderRadius: 7,
  padding: "8px 12px",
} as const;

/** 链式传递视图(画板 1c):tool_result 在扩展间的流转 */
export function ChainView() {
  return (
    <div style={{ flex: 1, overflow: "auto", padding: "14px 18px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
        <span style={{ ...mono(12, 600), color: "var(--text)" }}>{chainSteps.event}</span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{chainSteps.subtitle}</span>
      </div>

      <div style={card}>
        <div style={{ ...mono(10, 600), color: "var(--text-dim)", letterSpacing: "0.06em", marginBottom: 4 }}>RAW OUTPUT</div>
        <div style={{ ...mono(11), lineHeight: 1.6, color: "var(--text)" }}>{chainSteps.raw}</div>
      </div>

      {chainSteps.steps.map((step) => (
        <div key={step.name}>
          <Arrow />
          <div style={card}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
              <span style={{ ...mono(11, 600), color: "var(--text)", flex: 1 }}>{step.name}</span>
              <span style={{ ...mono(10, 600), background: step.badgeColor, color: "#fff", borderRadius: 4, padding: "1px 5px" }}>
                {step.badge}
              </span>
            </div>
            {step.lines.map((line, i) => (
              <div key={i} style={{ ...mono(11), lineHeight: 1.6, color: line.muted ? "var(--text-dim)" : "var(--text)" }}>
                {line.text}
                {"highlight" in line && line.highlight && <span style={{ color: "var(--accent)" }}>{line.highlight}</span>}
              </div>
            ))}
          </div>
        </div>
      ))}

      <Arrow />
      <div style={{ textAlign: "center", marginTop: 6, fontSize: 13, fontWeight: 600, color: "var(--accent)" }}>
        最终结果 → Agent Loop
      </div>
    </div>
  );
}
