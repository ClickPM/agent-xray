"use client";

import Link from "next/link";
import { useState } from "react";
import { latestLine, noteCats } from "@/lib/demo-data";
import { GhostButton } from "@/components/ui";
import { mono } from "@/lib/styles";
import { RssModal } from "@/components/notes/RssModal";

export default function NotesPage() {
  const [rssOpen, setRssOpen] = useState(false);
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "36px 32px 64px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 650 }}>Notes · 研习笔记</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 6 }}>
              从产品视角到源码拆解的 harness 工程研习库,全部内容提供 RSS 订阅。
            </div>
          </div>
          <GhostButton height={32} style={{ width: 32, padding: 0 }} onClick={() => setRssOpen(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 11a9 9 0 0 1 9 9" />
              <path d="M4 4a16 16 0 0 1 16 16" />
              <circle cx="5" cy="19" r="1" />
            </svg>
          </GhostButton>
        </div>

        {noteCats.map((cat) => (
          <div key={cat.slug} style={{ marginTop: 32 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{ width: 10, height: 10, borderRadius: 4, background: cat.dot }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{cat.name}</span>
              <span style={{ ...mono(11), color: "var(--text-dim)" }}>{cat.slug}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
              {cat.cards.map((c) => (
                <Link
                  key={c.slug}
                  href={`/notes/${c.slug}`}
                  style={{
                    background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 7,
                    padding: 14, cursor: "pointer", boxSizing: "border-box", display: "block",
                    color: "var(--text)", textDecoration: "none",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.borderColor = "rgba(37,99,235,0.35)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-panel)"; e.currentTarget.style.borderColor = "var(--border)"; }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6, marginTop: 5, minHeight: 38 }}>{c.desc}</div>
                  <div style={{ ...mono(11), color: "var(--text-dim)", marginTop: 8 }}>{c.meta}</div>
                </Link>
              ))}
            </div>
          </div>
        ))}

        <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 12 }}>{latestLine}</div>
      </div>
      <RssModal open={rssOpen} onClose={() => setRssOpen(false)} />
    </div>
  );
}
