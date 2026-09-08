"use client";

import type { ChainViewModel } from "@/lib/types";
import { mono } from "@/lib/styles";

function Arrow() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "4px 0" }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="5" x2="12" y2="19" />
        <polyline points="19 12 12 19 5 12" />
      </svg>
    </div>
  );
}

const card = {
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
  borderRadius: 7,
  padding: "8px 12px",
} as const;

/**
 * 链路上的一节。`compact`(R-MOBILE,画板 4g)时不画居中箭头,改成**左侧一条固定的
 * 1px 连接线 + 一个 7px 模式色点**。
 *
 * 为什么换:居中箭头在 358 宽里要么把卡片挤窄、要么让「谁接谁」在滚动中丢失参照。
 * 连接线移到左侧固定一列(9px)之后,滚动时那条线始终在同一个 x 上,链路的连续性
 * 靠一条不动的线维持 —— 与画板 4d 折叠行的竖线是同一个手段(左侧 1px 线 =
 * 「这些属于同一串」)。**节点内容、配色、徽标一字不改。**
 */
function Link({ dot, children, first }: { dot: string; children: React.ReactNode; first?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "stretch" }}>
      <div style={{ width: 9, flex: "none", display: "flex", flexDirection: "column", alignItems: "center" }}>
        {/* 首节点之上不画线:链路从这里开始 */}
        <div style={{ width: 1, flex: first ? "none" : "0 0 10px", height: first ? 0 : 10, background: "var(--border)" }} />
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot, flex: "none" }} />
        <div style={{ width: 1, flex: 1, background: "var(--border)" }} />
      </div>
      <div style={{ flex: 1, minWidth: 0, paddingBottom: 10 }}>{children}</div>
    </div>
  );
}

/** 链式传递视图(画板 1c;移动端 4g):最近一个 chain 模式事件在扩展间的流转 */
export function ChainView({ chain, compact }: { chain: ChainViewModel; compact?: boolean }) {
  if (compact) {
    return (
      <div style={{ flex: 1, overflow: "auto", padding: "14px 16px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
          <span style={{ ...mono(12, 600), color: "var(--text)" }}>{chain.event}</span>
          {/* 桌面 12px 说明文字 → 13(移动端最小非数据字号) */}
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{chain.subtitle}</span>
        </div>

        {/* 色点复用事件模式四色,与 Timeline 行首点同一套语义 —— 读者不用学第二套 */}
        <Link dot="#9ca3af" first>
          <div style={card}>
            <div style={{ ...mono(10, 600), color: "var(--text-dim)", letterSpacing: "0.06em", marginBottom: 4 }}>RAW OUTPUT</div>
            <div style={{ ...mono(11), lineHeight: 1.6, color: "var(--text)", textWrap: "pretty" }}>{chain.raw}</div>
          </div>
        </Link>

        {chain.steps.map((step) => (
          <Link key={step.name} dot={step.badgeColor}>
            <div style={card}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
                <span style={{ ...mono(11, 600), color: "var(--text)", flex: 1, minWidth: 0 }}>{step.name}</span>
                <span style={{ ...mono(10, 600), background: step.badgeColor, color: "#fff", borderRadius: 4, padding: "1px 5px", flex: "none" }}>
                  {step.badge}
                </span>
              </div>
              {step.lines.map((line, i) => (
                <div key={i} style={{ ...mono(11), lineHeight: 1.6, color: line.muted ? "var(--text-dim)" : "var(--text)", textWrap: "pretty" }}>
                  {line.text}
                  {"highlight" in line && line.highlight && <span style={{ color: "var(--accent)" }}>{line.highlight}</span>}
                </div>
              ))}
            </div>
          </Link>
        ))}

        <Link dot="#2563eb">
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)", paddingTop: 2 }}>最终结果 → Agent Loop</div>
        </Link>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "14px 18px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
        <span style={{ ...mono(12, 600), color: "var(--text)" }}>{chain.event}</span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{chain.subtitle}</span>
      </div>

      <div style={card}>
        <div style={{ ...mono(10, 600), color: "var(--text-dim)", letterSpacing: "0.06em", marginBottom: 4 }}>RAW OUTPUT</div>
        <div style={{ ...mono(11), lineHeight: 1.6, color: "var(--text)" }}>{chain.raw}</div>
      </div>

      {chain.steps.map((step) => (
        <div key={step.name}>
          <Arrow />
          <div style={card}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
              <span style={{ ...mono(11, 600), color: "var(--text)", flex: 1 }}>{step.name}</span>
              <span style={{ ...mono(10, 600), background: step.badgeColor, color: "#fff", borderRadius: 4, padding: "1px 5px" }}>
                {step.badge}
              </span>
            </div>
            {step.lines.map((line, i) => (
              <div key={i} style={{ ...mono(11), lineHeight: 1.6, color: line.muted ? "var(--text-dim)" : "var(--text)" }}>
                {line.text}
                {"highlight" in line && line.highlight && <span style={{ color: "var(--accent)" }}>{line.highlight}</span>}
              </div>
            ))}
          </div>
        </div>
      ))}

      <Arrow />
      <div style={{ textAlign: "center", marginTop: 6, fontSize: 13, fontWeight: 600, color: "var(--accent)" }}>
        最终结果 → Agent Loop
      </div>
    </div>
  );
}
