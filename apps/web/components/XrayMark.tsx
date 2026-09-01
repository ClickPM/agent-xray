"use client";

import { useId } from "react";

/**
 * 站点 logo「Pulse X」(所有者 2026-09-01 定稿,32×32 栅格)。
 *
 * 与 `app/icon.svg` 是同一份图形的两种载体:favicon 必须是独立文件,导航条要的是
 * 内联 JSX。**改图形时两处必须一起改**——路径数据没有共享的余地(favicon 由浏览器
 * 独立渲染,拿不到任何 JS)。
 *
 * 颜色走 currentColor,由调用方给 color;导航条给的是 var(--accent),明暗两套主题
 * 各自落到 #2563eb / #60a5fa,与定稿里两张导航条实测图一致。
 */
export function XrayMark({ size = 20 }: { size?: number }) {
  // mask 的 id 必须每个实例唯一,否则同页多处渲染时后者会引用到前者的 mask。
  // useId 的产物含 React 自己的分隔符(: 或 «»),放进 url(#…) 引用不可靠,剥成
  // 纯 [A-Za-z0-9] 再用。
  const maskId = `xray-cut-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      style={{ display: "block", flex: "none" }}
    >
      <mask id={maskId}>
        <rect width="32" height="32" fill="#fff" />
        <rect y="13.2" width="32" height="5.6" fill="#000" />
      </mask>
      <g stroke="currentColor" strokeWidth="4.6" mask={`url(#${maskId})`}>
        <path d="M5.0 5.0 27.0 27.0" />
        <path d="M27.0 5.0 5.0 27.0" />
      </g>
      <path d="M1 16H31" stroke="currentColor" strokeWidth="1.8" opacity=".3" />
      <path d="M11 16 H13.3 L15 13.4 L17 18.6 L18.7 16 H21" stroke="currentColor" strokeWidth="2.0" fill="none" />
    </svg>
  );
}
