"use client";

import { useEffect, useRef, useState } from "react";
import { CONTENT_SHEET_HEIGHTS, Sheet, type Detent } from "@/components/mobile/Sheet";
import type { RssCat } from "@/components/notes/RssModal";
import { mono } from "@/lib/styles";

/**
 * R-MOBILE RSS 订阅 Sheet(画板 4n 下半屏)。
 *
 * 【为什么不能直接复用桌面的 `RssModal`】那是 `position: fixed; top: 110px` 的居中模态,
 * 在移动端既没有下滑关闭、也没有 44 的触控尺寸,行高与复制按钮都是桌面尺度
 * (本轮 codex 审查 P2:移动入口点开的仍是桌面弹层)。桌面那份保持不动。
 *
 * 【与本章目录 Sheet 同档】画板 4n:两个从同一入口性质(看目录 / 拿地址)升起的 Sheet
 * 停在同一高度,读者不会觉得每次弹出来的东西大小不一 —— 都用 `CONTENT_SHEET_HEIGHTS`。
 *
 * 【底部那条提示是常态,不是错误态】`navigator.clipboard` 在非安全上下文或权限被拒时
 * 拿不到,所以常驻一条「长按地址可选中复制」。**地址行因此必须允许 user-select**。
 */
export function MobileRssSheet({
  open,
  onClose,
  cats,
}: {
  open: boolean;
  onClose: () => void;
  cats: RssCat[];
}) {
  const [detent, setDetent] = useState<Detent>("medium");
  const [copied, setCopied] = useState<string>("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = async (url: string, href: string) => {
    try {
      await navigator.clipboard.writeText(href);
    } catch {
      // 拿不到剪贴板就不假装成功:不置 copied,底部那条长按提示就是兜底路径
      return;
    }
    setCopied(url);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(""), 1500);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      detent={detent}
      onDetentChange={setDetent}
      heights={CONTENT_SHEET_HEIGHTS}
      label="RSS 订阅"
      header={
        <div style={{ flex: "none", padding: "4px 16px 10px" }}>
          <span style={{ ...mono(11, 600), color: "var(--text-dim)", letterSpacing: "0.05em" }}>RSS 订阅</span>
        </div>
      }
    >
      <div style={{ margin: "0 16px", borderRadius: 16, background: "var(--bg-panel)", overflow: "hidden" }}>
        {cats.map((rc) => (
          <div
            key={rc.url}
            className="m-sep-row"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              minHeight: 56,
              boxSizing: "border-box",
              padding: "10px 16px",
            }}
          >
            <span style={{ width: 9, height: 9, borderRadius: 3, background: rc.dot, flex: "none" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: rc.main ? 600 : 400 }}>{rc.name}</div>
              {/* 地址单行省略;要看全量靠长按选中,所以**不能**设 user-select:none */}
              <div
                style={{
                  ...mono(11),
                  color: "var(--text-dim)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  userSelect: "text",
                  marginTop: 2,
                }}
              >
                {rc.url}
              </div>
            </div>
            <button
              className="m-tap"
              onClick={() => copy(rc.url, rc.href)}
              style={{
                flex: "none",
                height: 32,
                minWidth: 64,
                borderRadius: 16,
                border: "none",
                background: copied === rc.url ? "rgba(34,197,94,0.12)" : "var(--m-fill)",
                color: copied === rc.url ? "var(--ok-text)" : "var(--accent)",
                fontSize: 13,
                fontWeight: 600,
                fontFamily: "inherit",
              }}
            >
              {copied === rc.url ? "已复制" : "复制"}
            </button>
          </div>
        ))}
      </div>
      <div
        style={{
          padding: "12px 16px 20px",
          fontSize: 11,
          lineHeight: 1.7,
          color: "var(--text-dim)",
        }}
      >
        任何 RSS 阅读器均可订阅。复制不可用时长按地址选中再复制。
      </div>
    </Sheet>
  );
}
