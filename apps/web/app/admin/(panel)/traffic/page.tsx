"use client";

import { useState } from "react";
import { SectionTitle } from "@/components/admin/AdminShell";
import { mono } from "@/lib/styles";
import { chartPts, conversion, pageTop, pv30, trafficSources, uv30 } from "@/lib/demo-data";

const RANGES = ["7d", "30d", "90d"] as const;

export default function AdminTrafficPage() {
  const [range, setRange] = useState<(typeof RANGES)[number]>("30d");
  const pvPts = chartPts(pv30, 1040, 220);
  const pvArea = `15,208 ${pvPts} 1025,208`;
  const uvPts = chartPts(uv30.map((v) => v * 3), 1040, 220);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center" }}>
        <span style={{ fontSize: 16, fontWeight: 600, flex: 1 }}>Traffic</span>
        <div style={{ display: "flex", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 7, padding: 2, gap: 2 }}>
          {RANGES.map((r) => (
            <div
              key={r}
              onClick={() => setRange(r)}
              style={{
                fontSize: 12, fontWeight: range === r ? 600 : 400, padding: "3px 12px", borderRadius: 5,
                color: range === r ? "var(--text)" : "var(--text-muted)",
                background: range === r ? "var(--bg)" : "transparent",
                border: `1px solid ${range === r ? "var(--border)" : "transparent"}`,
                cursor: "pointer",
              }}
            >
              {r}
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 20, position: "relative" }}>
        <div style={{ position: "absolute", top: 0, right: 6, display: "flex", gap: 14, fontSize: 11, color: "var(--text-muted)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 14, height: 0, borderTop: "1.5px solid #2563eb", display: "inline-block" }} />PV
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 14, height: 0, borderTop: "1.5px solid rgba(37,99,235,0.4)", display: "inline-block" }} />UV
          </span>
        </div>
        <svg width="100%" height="220" viewBox="0 0 1040 220" preserveAspectRatio="none" style={{ display: "block" }}>
          <polygon points={pvArea} fill="rgba(37,99,235,0.06)" />
          <polyline points={pvPts} fill="none" stroke="#2563eb" strokeWidth="1.5" />
          <polyline points={uvPts} fill="none" stroke="rgba(37,99,235,0.4)" strokeWidth="1" />
        </svg>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 6px 0", fontSize: 11, color: "var(--text-dim)" }}>
          <span>07-30</span><span>08-06</span><span>08-13</span><span>08-20</span><span>08-28</span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 32, marginTop: 32 }}>
        <div>
          <SectionTitle>页面 Top</SectionTitle>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 8px", fontSize: 11, color: "var(--text-dim)" }}>
            <span style={{ flex: 1 }}>path</span>
            <span style={{ width: 48, textAlign: "right" }}>PV</span>
            <span style={{ width: 48, textAlign: "right" }}>UV</span>
          </div>
          {pageTop.map((p, i) => (
            <div key={p.path} style={{ display: "flex", alignItems: "center", gap: 12, padding: 8, background: i % 2 ? "var(--bg-subtle)" : "transparent", borderRadius: 4 }}>
              <span style={{ ...mono(12), color: "var(--text)", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.path}</span>
              <span style={{ fontSize: 12, color: "var(--text)", width: 48, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{p.pv}</span>
              <span style={{ fontSize: 12, color: "var(--text-muted)", width: 48, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{p.uv}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div>
            <SectionTitle>来源</SectionTitle>
            {trafficSources.map((s, i) => (
              <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: 8, background: i % 2 ? "var(--bg-subtle)" : "transparent", borderRadius: 4 }}>
                <span style={{ fontSize: 12, color: "var(--text)", flex: 1 }}>{s.name}</span>
                <span style={{ fontSize: 12, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{s.pct}</span>
              </div>
            ))}
          </div>
          <div>
            <SectionTitle>会话转化</SectionTitle>
            <div style={{ marginTop: 2 }}>
              {conversion.map((c, i) => (
                <div key={c.name} style={{ display: "flex", alignItems: "center", padding: 8, fontSize: 12, background: i % 2 ? "var(--bg-subtle)" : "transparent", borderRadius: 4 }}>
                  <span style={{ color: "var(--text-muted)", flex: 1 }}>{c.name}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{c.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 28 }}>统计自托管,IP 加盐哈希,不存原始 IP</div>
    </>
  );
}
