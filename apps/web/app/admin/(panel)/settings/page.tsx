"use client";

import { useState } from "react";
import { SectionTitle } from "@/components/admin/AdminShell";
import { GhostButton } from "@/components/ui";
import { mono } from "@/lib/styles";

const label = { fontSize: 13, color: "var(--text-muted)", width: 140, flex: "none" } as const;
const inputBox = {
  height: 32, display: "flex", alignItems: "center", padding: "0 12px",
  border: "1px solid var(--border)", borderRadius: 7, boxSizing: "border-box",
} as const;

function Row({ name, children, align = "center" }: { name: string; children: React.ReactNode; align?: "center" | "flex-start" }) {
  return (
    <div style={{ display: "flex", alignItems: align, gap: 16 }}>
      <span style={{ ...label, paddingTop: align === "flex-start" ? 8 : 0 }}>{name}</span>
      {children}
    </div>
  );
}

function Select({ value, width = 220, monoFont = false }: { value: string; width?: number; monoFont?: boolean }) {
  return (
    <div style={{ ...inputBox, width, gap: 8, cursor: "pointer", ...(monoFont ? mono(12) : { fontSize: 13 }) }}>
      <span style={{ flex: 1 }}>{value}</span>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>
  );
}

export default function AdminSettingsPage() {
  const [saved, setSaved] = useState(false);
  const [behavior, setBehavior] = useState<"reject" | "readonly">("reject");
  return (
    <>
      <div style={{ fontSize: 16, fontWeight: 600 }}>Settings</div>

      <div style={{ marginTop: 24 }}>
        <SectionTitle>LLM 配置</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 16 }}>
          <Row name="Provider"><Select value="Anthropic" /></Row>
          <Row name="API Key" align="flex-start">
            <div style={{ flex: 1, maxWidth: 480 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ ...inputBox, flex: 1, ...mono(12) }}>sk-ant-…Yk3d</div>
                <GhostButton>更换</GhostButton>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 6 }}>密钥加密存储,只显掩码 · 更新于 2026-08-26</div>
            </div>
          </Row>
          <Row name="中转端点">
            <div style={{ flex: 1, maxWidth: 480, display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ ...inputBox, flex: 1, ...mono(12), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>https://relay.example.dev/v1</div>
              <GhostButton>测试连接</GhostButton>
              <span style={{ fontSize: 12, color: "var(--ok-text)", whiteSpace: "nowrap" }}>✓ 连通 · 312ms</span>
            </div>
          </Row>
          <Row name="默认模型"><Select value="claude-sonnet-5" monoFont /></Row>
        </div>
      </div>

      <div style={{ marginTop: 34 }}>
        <SectionTitle>限额</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 16 }}>
          <Row name="每日 token 上限"><div style={{ ...inputBox, width: 140, justifyContent: "flex-end", ...mono(12), fontVariantNumeric: "tabular-nums" }}>500000</div></Row>
          <Row name="每日费用上限"><div style={{ ...inputBox, width: 140, justifyContent: "flex-end", ...mono(12), fontVariantNumeric: "tabular-nums" }}>$ 2.00</div></Row>
          <Row name="单会话 turn 上限"><div style={{ ...inputBox, width: 140, justifyContent: "flex-end", ...mono(12), fontVariantNumeric: "tabular-nums" }}>20</div></Row>
          <Row name="超限行为" align="flex-start">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {([["reject", "拒绝新会话(默认)"], ["readonly", "降级为只读演示"]] as const).map(([key, text]) => {
                const on = behavior === key;
                return (
                  <span key={key} onClick={() => setBehavior(key)} style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: on ? "var(--text)" : "var(--text-muted)", cursor: "pointer" }}>
                    <span style={{ width: 14, height: 14, borderRadius: "50%", border: `1px solid ${on ? "var(--accent)" : "#d0d0d0"}`, display: "inline-flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box" }}>
                      {on && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)" }} />}
                    </span>
                    {text}
                  </span>
                );
              })}
            </div>
          </Row>
          <Row name=""><span style={{ fontSize: 11, color: "var(--text-dim)" }}>今日已用 148k tokens · $0.42</span></Row>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 14, marginTop: 36, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
        {saved && <span style={{ fontSize: 12, color: "var(--ok-text)" }}>✓ 已保存</span>}
        <button
          onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 2000); }}
          style={{
            display: "flex", alignItems: "center", height: 32, padding: "0 16px",
            background: "var(--bg)", border: "1px solid rgba(37,99,235,0.5)", color: "var(--accent)",
            borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", font: "inherit",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(37,99,235,0.05)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "var(--bg)")}
        >
          保存修改
        </button>
      </div>
    </>
  );
}
