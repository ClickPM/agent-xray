"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";
import { XrayMark } from "@/components/XrayMark";
import { TABS, type TabKey } from "@/lib/tabs";

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

/**
 * R-TABS:`visible` 是本次渲染要露出来的 tab(由 `(site)/layout.tsx` 服务端取好传进来)。
 *
 * **这是本组件相对画板 1a 的全部改动**(CLAUDE.md 规则 7):tab 组少渲染几个 `<Link>`,
 * 每一格的样式、间距、选中态与外层容器一个字节都没动。全部可见时与画板一字不差。
 */
export function GlobalNav({ visible }: { visible: readonly TabKey[] }) {
  const pathname = usePathname() ?? "/";
  const tabs = TABS.filter((t) => visible.includes(t.key));
  return (
    <div
      style={{
        height: 44, flex: "none", display: "flex", alignItems: "center",
        padding: "0 20px", borderBottom: "1px solid var(--border)",
        background: "var(--bg)", boxSizing: "border-box",
      }}
    >
      {/* logo + 字标。画板 1a 的导航条原本只有字标,所有者 2026-09-01 定稿加 mark
          并给了导航条实测图(44px 高、mark 20px、与字标间距 9px);这里按那张图实现。
          mark 用 var(--accent),字标保持 var(--text) —— 与定稿的明暗两版一致。
          左右两侧仍各占 flex:1,中间的 tab 组因此还在正中,布局没有别的改动。 */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 9 }}>
        <span style={{ color: "var(--accent)", display: "flex" }}>
          <XrayMark size={20} />
        </span>
        <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em" }}>Agent X-Ray</div>
      </div>
      <div
        style={{
          display: "flex", background: "var(--bg-panel)", border: "1px solid var(--border)",
          borderRadius: 7, padding: 2, gap: 2,
        }}
      >
        {tabs.map((t) => {
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
            <Link key={t.key} href={t.href} style={style}>
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
