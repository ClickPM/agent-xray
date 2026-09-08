"use client";

// Notes 首页(设计稿画板 2a)。从 app/(site)/notes/page.tsx 拆出来的原因只有一个:
// 订阅弹层需要 useState,而数据要在服务端取 —— 页面留在服务端,交互留在这里。
// 样式、布局、className 与拆分前逐字一致(CLAUDE.md 规则 7)。
import Link from "next/link";
import { useState } from "react";
import { GhostButton } from "@/components/ui";
import { mono } from "@/lib/styles";
import { RssModal, type RssCat } from "@/components/notes/RssModal";
import { MobilePageBar, MobileBarButton } from "@/components/mobile/MobilePageBar";
import { MobileRssSheet } from "@/components/mobile/MobileRssSheet";

export interface IndexSeries {
  slug: string;
  name: string;
  desc: string;
  meta: string;
}

export interface IndexCategory {
  slug: string;
  name: string;
  dot: string;
  cards: IndexSeries[];
}

export function NotesIndex({
  categories,
  latestLine,
  rssCats,
}: {
  categories: IndexCategory[];
  latestLine: string;
  rssCats: RssCat[];
}) {
  const [rssOpen, setRssOpen] = useState(false);
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto" }} className="m-page">
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "36px 32px 64px" }} className="m-page-wrap">
        {/* R-MOBILE:一级页没有上一级,左位子空着;RSS 从内联 ghost 按钮移到功能条右位子(画板 4k) */}
        <MobilePageBar
          right={
            <MobileBarButton label="RSS 订阅" onClick={() => setRssOpen(true)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 11a9 9 0 0 1 9 9" />
                <path d="M4 4a16 16 0 0 1 16 16" />
                <circle cx="5" cy="19" r="1" />
              </svg>
            </MobileBarButton>
          }
        />
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }} className="m-page-head">
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 650 }} className="m-h1">Notes · 研习笔记</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 6 }} className="m-sub">
              从产品视角到源码拆解的 harness 工程研习库,全部内容提供 RSS 订阅。
            </div>
          </div>
          <GhostButton height={32} style={{ width: 32, padding: 0 }} className="m-hide-narrow" onClick={() => setRssOpen(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 11a9 9 0 0 1 9 9" />
              <path d="M4 4a16 16 0 0 1 16 16" />
              <circle cx="5" cy="19" r="1" />
            </svg>
          </GhostButton>
        </div>

        {categories.map((cat) => (
          <div key={cat.slug} style={{ marginTop: 32 }} className="m-group">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{ width: 10, height: 10, borderRadius: 4, background: cat.dot }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{cat.name}</span>
              <span style={{ ...mono(11), color: "var(--text-dim)" }}>{cat.slug}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }} className="m-cards">
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
                  <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6, marginTop: 5, minHeight: 38 }} className="m-card-desc">{c.desc}</div>
                  <div style={{ ...mono(11), color: "var(--text-dim)", marginTop: 8 }}>{c.meta}</div>
                </Link>
              ))}
            </div>
          </div>
        ))}

        <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 12 }}>{latestLine}</div>
      </div>
      {/* 桌面居中模态与移动底部 Sheet 是**两份呈现**,共用同一个 `rssOpen`。
          桌面那份一个字节没动;移动端不能复用它 —— 它是 `fixed; top:110px` 的居中弹窗,
          没有下滑关闭、没有 44 触控尺寸(本轮 codex 审查 P2)。
          两份都渲染但各自带 `m-hide-narrow` / 内部 Sheet 只在移动端可达,不会同时出现。 */}
      <div className="m-hide-narrow">
        <RssModal open={rssOpen} onClose={() => setRssOpen(false)} cats={rssCats} />
      </div>
      <div className="m-show-narrow" style={{ flexDirection: "column" }}>
        <MobileRssSheet open={rssOpen} onClose={() => setRssOpen(false)} cats={rssCats} />
      </div>
    </div>
  );
}
