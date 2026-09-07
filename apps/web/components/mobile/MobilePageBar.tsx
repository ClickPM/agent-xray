"use client";

import Link from "next/link";
import type { ReactNode } from "react";

/**
 * R-MOBILE 内容页的顶部功能条(画板 4k–4r)。Notes / Skills / About 三个 tab 共用。
 *
 * 【为什么这里是 sticky,而 Runtime 那边是 absolute】Runtime 的壳自己不滚动
 * (对话在内层滚),功能条钉在壳上用 absolute 正好;而 Notes / Skills / About
 * **整页就是那个滚动容器**,absolute 会跟着内容滚走,需要一个不滚动的定位祖先才行。
 * `sticky` 不需要祖先配合,滚动时自然停在顶端,内容从它底下过 —— 同样的观感,少一层耦合。
 *
 * 【功能条不是标题栏】画板 4k–4r 的一致裁定:一级页(Notes / Skills / About 首页)
 * 左位子空着(没有上一级可返回),右位子放该页的动作(RSS / 目录);
 * 二级页左位子是**带文字的返回**(iOS 惯例:返回带上一级的名字)。
 * 中间只放轻量信息(章序之类),**不放页面标题** —— 标题是页面内容里的大标题。
 */
export function MobilePageBar({
  backHref,
  backLabel,
  center,
  right,
  /** 贴在功能条底缘的进度线(章节页,画板 4m)。0–1。 */
  progress,
}: {
  backHref?: string;
  backLabel?: string;
  center?: ReactNode;
  right?: ReactNode;
  progress?: ReactNode;
}) {
  return (
    <div
      className="m-glass-top m-show-narrow m-pagebar"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 4,
        alignItems: "center",
        gap: 4,
        // ⚠️ **不要在这里写 `height` 或 `padding` 简写** —— 高度与顶部内边距由
        // `.m-glass-top` 按 `--safe-top` 给。写死 `height:44` / `padding:"0 6px"`
        // 会把那两条规则整条盖掉,standalone 下(safe-top 非零)导航控件就落到
        // 状态栏 / 刘海底下(本轮 codex 第 2 轮 P1)。
        // sticky 元素要脱离父级的左右 padding,靠负外边距顶到内容区边缘。
        marginLeft: -16,
        marginRight: -16,
        paddingLeft: 6,
        paddingRight: 6,
      }}
    >
      <div style={{ minWidth: 44, flex: "none", display: "flex", alignItems: "center" }}>
        {backHref && (
          <Link
            href={backHref}
            className="m-tap"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 2,
              minHeight: 44,
              padding: "0 6px 0 2px",
              color: "var(--accent)",
              fontSize: 15,
              textDecoration: "none",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            {backLabel}
          </Link>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {center}
      </div>
      <div style={{ minWidth: 44, flex: "none", display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
        {right}
      </div>
      {progress}
    </div>
  );
}

/**
 * 功能条右侧的圆形动作按钮(RSS / 目录 / 文件…)。44 命中区,视觉 30 圆。
 */
export function MobileBarButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      className="m-tap"
      aria-label={label}
      onClick={onClick}
      style={{
        width: 44,
        height: 44,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "none",
        border: "none",
        padding: 0,
        color: "var(--accent)",
      }}
    >
      <span
        style={{
          width: 30,
          height: 30,
          borderRadius: 15,
          background: "var(--m-fill)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {children}
      </span>
    </button>
  );
}
