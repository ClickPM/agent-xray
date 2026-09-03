"use client";

// 「路走不通」的统一版式(设计稿画板 2k):A 页面出错 / B 找不到共用一套。
//
// 画板 2k 的裁定,这里只是把它们写成代码:
//   · 共用版式 = 44px 完整导航条(由 (site)/layout.tsx 给)+ 垂直居中内容区 + 460px 单列:
//     方点/eyebrow → 16px 标题 → 13px 说明 → 主按钮 + 次级链接。**只换文案与出口,不换尺寸**。
//   · 导航条四格都不高亮 —— 出错时当前路由已经无效,高亮任何一格都是假信息;
//     四格保持常态可点,本身就是最快的出口(这条由 GlobalNav 的 usePathname 自然满足:
//     错误页的路径不匹配任何 tab)。
//   · 错误红 `--err-text` 全站只用在 A 的 10px 方点这一处;B 的方点用 `--text-dim`——
//     找不到不是系统故障,不该染成红色。方点尺寸(10px / r4)取自画板 2f 的分类点。
//   · 出口层级:主按钮一枚用品牌色实心 32px / r7;次级出口用 12px 文字链 `--text-muted`。
//     **这是全站第一处实心按钮**(既有语汇只有 ghost),是画板 2k 明确定的层级,不是这里自造的。
//   · 无插画、无吉祥物、无大号 404 数字、无新配色。
import Link from "next/link";
import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { mono } from "@/lib/styles";

const primaryBtn: CSSProperties = {
  display: "flex", alignItems: "center", height: 32, padding: "0 16px",
  background: "var(--accent)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--accent)",
  // 字色取 `--bg` 而不是写死 #ffffff:亮色下 `--bg` 就是 #ffffff、与画板 2k 一字不差;
  // 暗色下 `--accent` 变成浅蓝 #60a5fa,白字压上去只有 ~2:1 的对比度(本机开暗色实测),
  // 取 `--bg`(#1a1a1a)才读得清。画板只画了亮色,这一条是暗色下的必要推导,不改亮色观感。
  color: "var(--bg)", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer",
  whiteSpace: "nowrap", boxSizing: "border-box", fontFamily: "inherit", textDecoration: "none",
};

function primaryEnter(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.background = "var(--accent-hover)";
  e.currentTarget.style.borderColor = "var(--accent-hover)";
}

function primaryLeave(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.background = "var(--accent)";
  e.currentTarget.style.borderColor = "var(--accent)";
}

const secondaryLink: CSSProperties = { fontSize: 12, color: "var(--text-muted)", textDecoration: "none" };

function secondaryEnter(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.color = "var(--accent)";
}

function secondaryLeave(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.color = "var(--text-muted)";
}

export function StatusScreen({
  /** eyebrow 的方点色:出错 `--err-text`,找不到 `--text-dim` */
  dot,
  /** eyebrow 文本,画板上是 `HTTP 500` / `HTTP 404` */
  code,
  title,
  description,
  /** 主出口:给 `onClick` 就是按钮(重试),给 `href` 就是链接(回列表) */
  primary,
  /** 次级出口,画板上固定是「返回首页」;主出口已经是首页时传 null,不并排两个一样的 */
  secondary = { label: "返回首页", href: "/" },
  /** 说明下方那一块:A 是可复制的错误标识,B 是访问的路径回显 */
  footer,
}: {
  dot: string;
  code: string;
  title: string;
  description: string;
  primary: { label: string; onClick: () => void } | { label: string; href: string };
  secondary?: { label: string; href: string } | null;
  footer?: ReactNode;
}) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 32px" }}>
      <div style={{ width: 460, maxWidth: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: 4, background: dot, flex: "none" }} />
          <span style={{ ...mono(10, 600), color: "var(--text-dim)", letterSpacing: "0.08em" }}>{code}</span>
        </div>
        <div style={{ fontSize: 16, fontWeight: 650, marginTop: 12 }}>{title}</div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.7, marginTop: 8, textWrap: "pretty" }}>
          {description}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 20 }}>
          {"onClick" in primary ? (
            <button type="button" onClick={primary.onClick} style={primaryBtn} onMouseEnter={primaryEnter} onMouseLeave={primaryLeave}>
              {primary.label}
            </button>
          ) : (
            <Link href={primary.href} style={primaryBtn} onMouseEnter={primaryEnter} onMouseLeave={primaryLeave}>
              {primary.label}
            </Link>
          )}
          {secondary && (
            <Link href={secondary.href} style={secondaryLink} onMouseEnter={secondaryEnter} onMouseLeave={secondaryLeave}>
              {secondary.label}
            </Link>
          )}
        </div>
        {footer}
      </div>
    </div>
  );
}

/**
 * 可复制的错误标识(画板 2k 只给 A 用)。
 *
 * 裁定理由:这站是 DevTools 调性、访客多半是开发者,一个短标识让他们能把问题带走,
 * 也是服务端日志里唯一能对上这一次请求的钩子。**只给短标识,不展开堆栈** ——
 * 堆栈是给所有者看的,而客户端错误的 message 是原文,可能带上内部路径或字段名。
 */
export function CopyableId({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 10, background: "var(--bg-panel)",
        border: "1px solid var(--border)", borderRadius: 6, padding: "7px 10px", marginTop: 22,
      }}
    >
      <span style={{ ...mono(11), color: "var(--text-dim)", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {text}
      </span>
      <div
        onClick={() => {
          // 非安全上下文 / 权限被拒时 writeText 会同步抛或异步 reject,两条路都吞掉
          // (与 SkillDetail 的 copy 同一处理):按钮态照常翻转
          try {
            navigator.clipboard?.writeText(text).catch(() => {});
          } catch {}
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        style={{
          display: "flex", alignItems: "center", gap: 4, fontSize: 11, cursor: "pointer",
          borderRadius: 5, padding: "2px 6px", color: copied ? "var(--ok-text)" : "var(--text-dim)",
        }}
        onMouseEnter={(e) => { if (!copied) { e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.background = "var(--bg-hover)"; } }}
        onMouseLeave={(e) => { e.currentTarget.style.color = copied ? "var(--ok-text)" : "var(--text-dim)"; e.currentTarget.style.background = "transparent"; }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {copied ? (
            <path d="M20 6L9 17l-5-5" />
          ) : (
            <>
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </>
          )}
        </svg>
        {copied ? "copied" : "copy"}
      </div>
    </div>
  );
}
