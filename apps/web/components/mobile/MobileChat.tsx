"use client";

import { useEffect, useRef } from "react";
import { AssistantMessage, AssistantTurn } from "@/components/workbench/Workbench";
import { suggestions } from "@/lib/demo-data";
import type { ChatItem, CrossLink } from "@/lib/types";

/**
 * R-MOBILE 会话区(画板 4b–4d)。
 *
 * 【为什么不直接复用桌面的 ChatPane】会话区的**气泡与正文是外壳层**,画板给了不同度量:
 * 用户气泡 r12 → 18、内边距 8/12 → 9/14、**无描边**;正文 14/1.7 → 15/1.75
 * (15 是禁缩放之后的正文下限)。而**工具调用卡、折叠行是内核层,照搬** ——
 * 所以这里 import 的 `AssistantTurn` / `AssistantMessage` 就是桌面那两个组件本身,
 * 一个像素没改,只是装在不同的容器里。这就是「两层语言」在代码上的样子。
 *
 * 【自动滚到底的判据与桌面一致】末项「长度」= 正文长度 + 工具卡数:
 * 卡片到达而正文没变的那一帧也要跟着滚(与桌面 ChatPane 同一个坑)。
 */
export function MobileChat({
  items,
  rowLink,
  locate,
  onAsk,
}: {
  items: ChatItem[];
  /** R-CROSSLINK C2(画板 4w):卡片展开体底部那条「在 Timeline 里查看 ↗」——
      与桌面同一个组件、同一条链接,移动端只在 globals.css 里补 44 命中区 */
  rowLink?: CrossLink;
  /** R-CROSSLINK C2 行 → 卡:详情块底部的「查看卡片」要求定位到某个 toolCallId */
  locate?: { toolCallId: string; nonce: number } | null;
  /** R-CARDS(画板 4y):信息卡片动作胶囊 → 输入框(预填,不发送);与桌面同一个 prefill。
      R-CARDS-2(画板 5a)可回传卡的直接发送走 ComposerContext,与桌面同一个 sendFromCard,不经这里 */
  onAsk?: (text: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const last = items[items.length - 1];
  const tail =
    (last?.text.length ?? 0) +
    (last?.kind === "assistant" ? (last.turn?.toolCalls.length ?? 0) : 0);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [items.length, tail]);

  return (
    <div
      ref={scrollRef}
      className="m-chat"
      style={{
        flex: 1,
        overflow: "auto",
        // 左右 16 是移动端统一内边距;上方 8 让首条不贴着功能条
        padding: "8px 16px 0",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      {items.map((item, i) => {
        if (item.kind === "user") {
          return (
            <div key={i} style={{ display: "flex", justifyContent: "flex-end" }}>
              <div
                style={{
                  maxWidth: "85%",
                  background: "var(--user-bg)",
                  borderRadius: 18,
                  padding: "9px 14px",
                  fontSize: 15,
                  lineHeight: 1.75,
                }}
              >
                {item.text}
              </div>
            </div>
          );
        }
        // 内核层原样复用:有工具调用的一轮走 AssistantTurn(折叠行 + 工具卡),
        // 没有的走 AssistantMessage —— 与桌面同一条渲染路径。
        if (item.turn) return <AssistantTurn key={i} text={item.text} turn={item.turn} done={item.done} rowLink={rowLink} locate={locate} onAsk={onAsk} />;
        return <AssistantMessage key={i} text={item.text} streaming={!item.done} onAsk={onAsk} />;
      })}
    </div>
  );
}

/**
 * 空状态(画板 4a)。桌面的 36 高 ghost 方角建议行换成 48 高全圆胶囊行
 * (整行可点、≥44 命中区);建议句本身与桌面同一份 `suggestions`,不另写文案。
 */
export function MobileEmptyState({ onSuggest }: { onSuggest: (text: string) => void }) {
  const ICONS: Record<string, React.ReactNode> = {
    shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
    // key 必须与 `lib/demo-data.ts` 的 `suggestions[].icon` 一致(是 `chat` 不是 `message`);
    // 对不上的表现是那一行图标空着,不报错
    chat: <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />,
    slash: (
      <>
        <circle cx="12" cy="12" r="10" />
        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
      </>
    ),
  };

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflow: "auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        padding: "16px 16px 24px",
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em" }}>Agent X-Ray</div>
      <div
        style={{
          fontSize: 15,
          lineHeight: 1.75,
          color: "var(--text-muted)",
          textAlign: "center",
          maxWidth: 300,
          marginBottom: 8,
        }}
      >
        和 agent 说点什么 — 同时看见它的内核如何运转
      </div>
      <div style={{ width: "100%", maxWidth: 340, display: "flex", flexDirection: "column", gap: 10 }}>
        {suggestions.map((s) => (
          <button
            key={s.text}
            className="m-tap m-tap-fill"
            onClick={() => onSuggest(s.text)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              minHeight: 48,
              borderRadius: 24,
              background: "var(--m-fill-soft)",
              border: "none",
              padding: "8px 18px",
              // 建议句超长时换行而不是省略 —— 它是可点的整句,截断会读不懂(画板 4a 裁定)
              fontSize: 15,
              lineHeight: 1.5,
              color: "var(--text)",
              fontFamily: "inherit",
              textAlign: "left",
            }}
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flex: "none" }}
            >
              {ICONS[s.icon]}
            </svg>
            {s.text}
          </button>
        ))}
      </div>
    </div>
  );
}
