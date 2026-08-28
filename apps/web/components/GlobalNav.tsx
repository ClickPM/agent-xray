"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";

const TABS = [
  { label: "Runtime", href: "/", match: (p: string) => p === "/" },
  { label: "Notes", href: "/notes", match: (p: string) => p.startsWith("/notes") },
  { label: "About", href: "/about", match: (p: string) => p.startsWith("/about") },
];

function ThemeToggle() {
  return (
    <button
      aria-label="切换主题"
      onClick={() => {
        const dark = document.documentElement.classList.toggle("dark");
        try {
          localStorage.setItem("xray-theme", dark ? "dark" : "light");
        } catch {}
      }}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 28, height: 28, color: "var(--text-muted)", borderRadius: 7,
        cursor: "pointer", background: "none", border: "none", padding: 0,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--accent)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-muted)"; }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    </button>
  );
}

export function GlobalNav() {
  const pathname = usePathname() ?? "/";
  return (
    <div
      style={{
        height: 44, flex: "none", display: "flex", alignItems: "center",
        padding: "0 20px", borderBottom: "1px solid var(--border)",
        background: "var(--bg)", boxSizing: "border-box",
      }}
    >
      <div style={{ flex: 1, fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em" }}>Agent X-Ray</div>
      <div
        style={{
          display: "flex", background: "var(--bg-panel)", border: "1px solid var(--border)",
          borderRadius: 7, padding: 2, gap: 2,
        }}
      >
        {TABS.map((t) => {
          const active = t.match(pathname);
          const style: CSSProperties = {
            fontSize: 12, padding: "4px 14px", borderRadius: 5,
            color: active ? "var(--text)" : "var(--text-muted)",
            fontWeight: active ? 600 : 400,
            background: active ? "var(--bg)" : "transparent",
            border: `1px solid ${active ? "var(--border)" : "transparent"}`,
            textDecoration: "none",
          };
          return (
            <Link key={t.label} href={t.href} style={style}>
              {t.label}
            </Link>
          );
        })}
      </div>
      <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
        <ThemeToggle />
      </div>
    </div>
  );
}
