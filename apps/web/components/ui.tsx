"use client";

import type { CSSProperties, ReactNode } from "react";

/** ghost 按钮 — 全站唯一按钮语汇:浅灰底 + 1px 边框 + 灰字,hover 变蓝 */
export function GhostButton({
  children,
  onClick,
  height = 32,
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  height?: number;
  style?: CSSProperties;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
        height, padding: "0 12px", background: "var(--bg-hover)",
        border: "1px solid var(--border)", color: "var(--text-muted)",
        borderRadius: 7, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap",
        boxSizing: "border-box", font: "inherit",
        ...style,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--bg-selected)";
        e.currentTarget.style.color = "var(--accent)";
        e.currentTarget.style.borderColor = "rgba(37,99,235,0.35)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--bg-hover)";
        e.currentTarget.style.color = "var(--text-muted)";
        e.currentTarget.style.borderColor = "var(--border)";
      }}
    >
      {children}
    </button>
  );
}

/** 描边微徽标(来源/风险/ADMIN 等,mono 10px,4px 圆角) */
export function Badge({ color, children, width }: { color: string; children: ReactNode; width?: number }) {
  return (
    <span
      style={{
        font: "600 10px var(--font-mono)", color, border: `1px solid ${color}`,
        borderRadius: 4, padding: "1px 5px", flex: "none", boxSizing: "border-box",
        width, textAlign: width ? "center" : undefined, display: "inline-block",
      }}
    >
      {children}
    </span>
  );
}
