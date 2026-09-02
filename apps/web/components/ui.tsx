"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * ghost 按钮 — 全站唯一按钮语汇:浅灰底 + 1px 边框 + 灰字,hover 变蓝。
 *
 * `disabled` 的三条颜色必须显式写进 style 对象、不能只靠 `:disabled` 或只改
 * cursor:hover 态是 onMouseEnter 直接改 DOM 的,React 并不知道自己被改过。
 * 鼠标停在按钮上的那一刻变成 disabled,浏览器就不再派发 mouseleave,残留的
 * 蓝色会一直挂着。把颜色写进 style 对象,disabled 翻转时 style 内容变了,
 * React 会把这三个属性重新写一遍,正好把残留冲掉。
 */
export function GhostButton({
  children,
  onClick,
  height = 32,
  style,
  disabled = false,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  height?: number;
  style?: CSSProperties;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
        height, padding: "0 12px", background: "var(--bg-hover)",
        // 边框写长写不写简写:disabled 分支要覆盖 borderColor,与 `border` 简写混用
        // 会让 React 在重渲染时报「Removing a style property … conflicting property」。
        borderWidth: 1, borderStyle: "solid", borderColor: "var(--border)",
        color: "var(--text-muted)",
        borderRadius: 7, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap",
        boxSizing: "border-box", font: "inherit",
        ...style,
        ...(disabled
          ? { background: "var(--bg-hover)", color: "var(--text-dim)", borderColor: "var(--border)", cursor: "default" }
          : null),
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = "var(--bg-selected)";
        e.currentTarget.style.color = "var(--accent)";
        e.currentTarget.style.borderColor = "rgba(37,99,235,0.35)";
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
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
