"use client";

import { useState } from "react";
import { SectionTitle } from "@/components/admin/AdminShell";
import { Badge } from "@/components/ui";
import { mono } from "@/lib/styles";
import { RISK_COLOR, SRC_COLOR, toolLog, toolRows } from "@/lib/demo-data";

export default function AdminToolsPage() {
  // 演示期本地状态;pi 接入轮由 /api/admin/tools 持久化并写审计日志
  const [states, setStates] = useState(() => Object.fromEntries(toolRows.map((t) => [t.name, t.state])));

  const toggle = (name: string) => {
    setStates((cur) => {
      const s = cur[name];
      if (s === "locked") return cur;
      return { ...cur, [name]: s === "on" ? "off" : "on" };
    });
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
        <span style={{ fontSize: 16, fontWeight: 600 }}>Tools</span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          工具的集成与下线随代码发布;此处只做启停,启停即时生效于新会话。
        </span>
      </div>

      <div style={{ marginTop: 18, borderTop: "1px solid var(--border)" }}>
        {toolRows.map((t) => {
          const state = states[t.name];
          const locked = state === "locked";
          const on = state === "on";
          return (
            <div
              key={t.name}
              style={{
                display: "flex", alignItems: "center", gap: 14, height: 48,
                borderBottom: "1px solid var(--bg-hover)", padding: "0 8px", opacity: locked ? 0.65 : 1,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-panel)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span style={{ ...mono(13), width: 180, flex: "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</span>
              <Badge color={SRC_COLOR[t.src]} width={78}>{t.src}</Badge>
              <Badge color={RISK_COLOR[t.risk]}>{t.risk}</Badge>
              <span style={{ fontSize: 12, color: "var(--text-muted)", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.desc}</span>
              {locked && (
                <>
                  <span style={{ fontSize: 11, color: "#b91c1c", opacity: 0.75, whiteSpace: "nowrap" }}>需服务器解锁(XRAY_UNLOCK_DANGEROUS_TOOLS)</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }}>
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </>
              )}
              <button
                onClick={() => toggle(t.name)}
                aria-label={`${t.name} 开关`}
                disabled={locked}
                style={{
                  width: 34, height: 20, borderRadius: 10, border: "none", padding: 0,
                  background: on ? "var(--accent)" : locked ? "#d0d0d0" : "var(--border)",
                  position: "relative", flex: "none", cursor: locked ? "not-allowed" : "pointer",
                }}
              >
                <span
                  style={{
                    position: "absolute", top: 2, left: on ? 16 : 2, width: 16, height: 16,
                    borderRadius: "50%", background: "#fff", border: "1px solid rgba(0,0,0,0.06)",
                    boxSizing: "border-box", transition: "left 0.12s",
                  }}
                />
              </button>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 30 }}>
        <SectionTitle>启停记录</SectionTitle>
        {toolLog.map((lg, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "8px 4px", borderBottom: "1px solid var(--bg-hover)", ...mono(11) }}>
            <span style={{ color: "var(--text-dim)", width: 100, flex: "none", fontVariantNumeric: "tabular-nums" }}>{lg.time}</span>
            <span style={{ color: "var(--text)", width: 130, flex: "none" }}>{lg.tool}</span>
            <span style={{ color: lg.color, flex: 1 }}>{lg.action}</span>
            <span style={{ color: "var(--text-dim)" }}>admin</span>
          </div>
        ))}
      </div>
    </>
  );
}
