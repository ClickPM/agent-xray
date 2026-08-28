"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui";

const NAV = [
  { label: "Overview", href: "/admin", icon: <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></> },
  { label: "Traffic", href: "/admin/traffic", icon: <><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></> },
  { label: "Settings", href: "/admin/settings", icon: <><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></> },
  { label: "Tools", href: "/admin/tools", icon: <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /> },
];

/** 演示期认证:sessionStorage 标记;pi 接入轮替换为服务端 session cookie(docs/security.md §4) */
export function useAdminAuthed() {
  const [state, setState] = useState<"checking" | "yes" | "no">("checking");
  useEffect(() => {
    try {
      setState(sessionStorage.getItem("xray-admin") === "1" ? "yes" : "no");
    } catch {
      setState("no");
    }
  }, []);
  return state;
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/admin";
  const router = useRouter();
  const authed = useAdminAuthed();

  useEffect(() => {
    if (authed === "no") router.replace("/admin/login");
  }, [authed, router]);

  if (authed !== "yes") return <div style={{ height: "100dvh", background: "var(--bg)" }} />;

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      {/* 后台顶栏 */}
      <div style={{ height: 44, flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "0 20px", borderBottom: "1px solid var(--border)", boxSizing: "border-box" }}>
        <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em" }}>Agent X-Ray</span>
        <span style={{ marginLeft: 4 }}><Badge color="var(--text-muted)">ADMIN</Badge></span>
        <span style={{ flex: 1 }} />
        <Link href="/" style={{ fontSize: 12, color: "var(--accent)" }}>访问主站 ↗</Link>
        <button
          title="退出登录"
          onClick={() => {
            try { sessionStorage.removeItem("xray-admin"); } catch {}
            router.replace("/admin/login");
          }}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, color: "var(--text-muted)", borderRadius: 7, cursor: "pointer", marginLeft: 6, background: "none", border: "none" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--accent)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-muted)"; }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {/* 左侧栏 */}
        <div style={{ width: 200, flex: "none", background: "var(--bg-panel)", borderRight: "1px solid var(--border)", padding: "8px 0" }}>
          {NAV.map((n) => {
            const active = pathname === n.href;
            return (
              <Link
                key={n.href}
                href={n.href}
                style={{
                  height: 36, display: "flex", alignItems: "center", gap: 10, padding: "0 14px",
                  borderLeft: `2px solid ${active ? "var(--accent)" : "transparent"}`,
                  background: active ? "var(--bg)" : "transparent",
                  color: active ? "var(--text)" : "var(--text-muted)",
                  fontSize: 13, fontWeight: active ? 600 : 400, cursor: "pointer", textDecoration: "none",
                }}
              >
                <span style={{ display: "inline-flex", width: 15 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    {n.icon}
                  </svg>
                </span>
                {n.label}
              </Link>
            );
          })}
        </div>
        {/* 内容区 */}
        <div style={{ flex: 1, minWidth: 0, overflow: "auto" }}>
          <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 32px", boxSizing: "border-box" }}>{children}</div>
        </div>
      </div>
    </div>
  );
}

export function SectionTitle({ children, extra }: { children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", paddingBottom: 8, borderBottom: "1px solid var(--border)" }}>
      <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{children}</span>
      {extra}
    </div>
  );
}
