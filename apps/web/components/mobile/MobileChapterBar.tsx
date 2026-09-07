"use client";

import { useState } from "react";
import { MobileBarButton, MobilePageBar } from "@/components/mobile/MobilePageBar";
import { CONTENT_SHEET_HEIGHTS, Sheet, type Detent } from "@/components/mobile/Sheet";
import { mono } from "@/lib/styles";

export interface TocItem {
  id: string;
  text: string;
}

/**
 * R-MOBILE 章节页的功能条 + 本章目录 Sheet(画板 4m / 4n)。
 *
 * 【为什么目录从常驻一栏变成 Sheet】桌面是 720 正文 + 右侧悬浮目录的双栏;
 * 移动端 358 的正文宽里塞不下第二列,而且读长文时目录是「偶尔要用」的东西,
 * 不该常占一栏(画板 4m 裁定)。
 *
 * 【当前章节的高亮换了语汇】桌面用 2px 品牌色左边线;在 iOS 分组卡里左边线会与
 * 卡圆角打架,所以换成整行淡底 + 品牌色 600 字,**语义不变**(画板 4n 裁定)。
 * 这里没有「当前小节」的实时判定(桌面也没有),只做锚点跳转。
 */
export function MobileChapterBar({
  backHref,
  backLabel,
  order,
  toc,
}: {
  backHref: string;
  backLabel: string;
  /** 功能条中间的章序,如 `3 / 13`。轻量信息,不是标题(画板 4m)。 */
  order: string;
  toc: TocItem[];
}) {
  const [open, setOpen] = useState(false);
  // 目录与 RSS 两个 Sheet 停在同一档(画板 4n:同一入口性质的 Sheet 高度一致,
  // 读者不会觉得每次弹出来的东西大小不一)—— 内容类档位 61%,由
  // `CONTENT_SHEET_HEIGHTS` 覆盖,**不复用 Runtime 的 50% medium**。
  const [detent, setDetent] = useState<Detent>("medium");

  return (
    <>
      <MobilePageBar
        backHref={backHref}
        backLabel={backLabel}
        center={<span style={{ ...mono(11), color: "var(--text-dim)" }}>{order}</span>}
        right={
          toc.length > 0 ? (
            <MobileBarButton label="本章目录" onClick={() => setOpen(true)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
            </MobileBarButton>
          ) : null
        }
      />
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        detent={detent}
        onDetentChange={setDetent}
        label="本章目录"
        heights={CONTENT_SHEET_HEIGHTS}
        header={
          <div style={{ flex: "none", padding: "4px 16px 10px" }}>
            <span style={{ ...mono(11, 600), color: "var(--text-dim)", letterSpacing: "0.05em" }}>本章目录</span>
          </div>
        }
      >
        <div style={{ margin: "0 16px 16px", borderRadius: 16, background: "var(--bg-panel)", overflow: "hidden" }}>
          {toc.map((h) => (
            <a
              key={h.id}
              href={`#${h.id}`}
              className="m-tap m-sep-row"
              onClick={() => setOpen(false)}
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                minHeight: 56,
                boxSizing: "border-box",
                padding: "12px 16px",
                // 行透明,分组卡的 --bg-panel 才是可见底色(画板 4k/4n)
                color: "var(--text)",
                fontSize: 15,
                lineHeight: 1.5,
                textDecoration: "none",
                // 组内分隔线由 `.m-sep-row` 的伪元素画,从左内边距 16 起(iOS inset grouped)
              }}
            >
              {h.text}
            </a>
          ))}
        </div>
      </Sheet>
    </>
  );
}
