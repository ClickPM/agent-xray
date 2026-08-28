"use client";

import Link from "next/link";
import { SectionTitle } from "@/components/admin/AdminShell";
import { Badge } from "@/components/ui";
import { mono } from "@/lib/styles";
import { chartPts, ovEvents, ovStats, pv7 } from "@/lib/demo-data";

function QuotaBar({ label, pct, right }: { label: string; pct: number; right: string }) {
  const color = pct >= 100 ? "var(--err-text)" : pct >= 80 ? "#f9c22e" : "var(--accent)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <span style={{ fontSize: 12, color: "var(--text-muted)", width: 60, flex: "none" }}>{label}</span>
      <div style={{ flex: 1, height: 8, borderRadius: 4, background: "var(--bg-hover)", overflow: "hidden" }}>
        <div style={{ width: `${Math.min(100, pct)}%`, height: 8, background: color, borderRadius: 4 }} />
      </div>
      <span style={{ ...mono(11), color: "var(--text-muted)", width: 90, textAlign: "right", flex: "none" }}>{right}</span>
    </div>
  );
}

export default function AdminOverviewPage() {
  const pts = chartPts(pv7, 1040, 160);
  const area = `15,148 ${pts} 1025,148`;
  return (
    <>
      {/* 今日指标 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 16 }}>
        {ovStats.map((st) => (
          <div key={st.label}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontSize: 22, fontWeight: 650, fontVariantNumeric: "tabular-nums" }}>{st.value}</span>
              {st.delta && <span style={{ fontSize: 11, color: st.deltaColor, fontVariantNumeric: "tabular-nums" }}>{st.delta}</span>}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 3 }}>{st.label}</div>
          </div>
        ))}
      </div>

      {/* 今日限额 */}
      <div style={{ marginTop: 32 }}>
        <SectionTitle extra={<Link href="/admin/settings" style={{ fontSize: 12, color: "var(--accent)" }}>调整限额 →</Link>}>今日限额</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14 }}>
          <QuotaBar label="tokens" pct={30} right="148k / 500k" />
          <QuotaBar label="费用" pct={21} right="$0.42 / $2.00" />
        </div>
      </div>

      {/* 近 7 天访问 */}
      <div style={{ marginTop: 32 }}>
        <SectionTitle>近 7 天访问</SectionTitle>
        <svg width="100%" height="160" viewBox="0 0 1040 160" preserveAspectRatio="none" style={{ display: "block", marginTop: 10 }}>
          <polygon points={area} fill="rgba(37,99,235,0.06)" />
          <polyline points={pts} fill="none" stroke="#2563eb" strokeWidth="1.5" />
        </svg>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 6px 0", fontSize: 11, color: "var(--text-dim)" }}>
          <span>周一</span><span>周二</span><span>周三</span><span>周四</span><span>周五</span><span>周六</span><span>周日</span>
        </div>
      </div>

      {/* 最近事件 */}
      <div style={{ marginTop: 32 }}>
        <SectionTitle>最近事件</SectionTitle>
        {ovEvents.map((e, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 4px", borderBottom: "1px solid var(--bg-hover)", fontSize: 12 }}>
            <span style={{ ...mono(11), color: "var(--text-dim)", width: 44, flex: "none", fontVariantNumeric: "tabular-nums" }}>{e.time}</span>
            <Badge color={e.bc}>{e.badge}</Badge>
            <span style={{ flex: 1, color: "var(--text)" }}>{e.text}</span>
            <span style={{ ...mono(11), color: "var(--text-dim)", flex: "none" }}>{e.actor}</span>
          </div>
        ))}
      </div>
    </>
  );
}
