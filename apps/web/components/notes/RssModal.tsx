"use client";

import { useRef, useState } from "react";
import { mono } from "@/lib/styles";

export interface RssCat {
  name: string;
  /** 展示地址:设计稿画板 2d 不显示 scheme */
  url: string;
  /** 复制到剪贴板的完整地址(含 scheme 与端口)。不在这里拼 scheme —— 预发是明文 HTTP */
  href: string;
  dot: string;
  main?: boolean;
}

export function RssModal({
  open,
  onClose,
  cats,
}: {
  open: boolean;
  onClose: () => void;
  cats: RssCat[];
}) {
  const [copied, setCopied] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (!open) return null;

  const copy = (url: string, href: string) => {
    try {
      void navigator.clipboard.writeText(href);
    } catch {}
    setCopied(url);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(""), 1500);
  };

  return (
    <>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 50 }} onClick={onClose} />
      <div
        style={{
          position: "fixed", left: "50%", top: 110, transform: "translateX(-50%)", width: 480,
          maxWidth: "calc(100vw - 32px)", background: "var(--bg)", border: "1px solid var(--border)",
          borderRadius: 8, boxShadow: "0 20px 60px rgba(0,0,0,0.4)", overflow: "hidden", zIndex: 51,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 14, fontWeight: 650, flex: 1 }}>订阅更新</div>
          <button
            onClick={onClose}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24,
              color: "var(--text-dim)", borderRadius: 5, cursor: "pointer", fontSize: 14,
              background: "none", border: "none",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-dim)"; }}
          >
            ×
          </button>
        </div>
        <div style={{ padding: 8 }}>
          {cats.map((rc, i) => (
            <div
              key={rc.url}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "9px 8px", borderRadius: 6,
                borderTop: i === 1 ? "1px solid var(--bg-hover)" : "none",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-panel)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span style={{ width: 9, height: 9, borderRadius: 3, background: rc.dot, flex: "none", margin: "0 2px" }} />
              <span style={{ fontSize: 13, fontWeight: rc.main ? 600 : 400, width: 64, flex: "none" }}>{rc.name}</span>
              <span style={{ ...mono(11), color: "var(--text-dim)", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{rc.url}</span>
              <button
                onClick={() => copy(rc.url, rc.href)}
                style={{
                  display: "flex", alignItems: "center", gap: 4, fontSize: 11, cursor: "pointer",
                  borderRadius: 5, padding: "2px 6px", background: "none", border: "none",
                  color: copied === rc.url ? "var(--ok-text)" : "var(--text-dim)",
                }}
                onMouseEnter={(e) => { if (copied !== rc.url) { e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.background = "var(--bg-hover)"; } }}
                onMouseLeave={(e) => { if (copied !== rc.url) { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; } }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                {copied === rc.url ? "copied" : "copy"}
              </button>
            </div>
          ))}
        </div>
        <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6 }}>
          任何 RSS 阅读器(Folo / NetNewsWire / Feedly…)均可订阅,新文章自动推送。
        </div>
      </div>
    </>
  );
}
