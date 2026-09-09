// 围栏代码块(画板 2c 画法):r7 外框 + `--bg-panel` 头部条(mono 11/650 语言标签)+ mono 12/1.7 正文。
// 原先内联在 `Markdown.tsx` 的 `pre` 回调里;R-CARDS-2 把它抽出来,是因为会话区的围栏渲染器(`ChatFence.tsx`)与 Notes 的
// 普通 `pre` 都要画同一块 —— 标记一字不改,Notes 侧的输出与抽出前逐字节相同(任务卡验收 #19)。无 hook、无 "use client":两边都能渲染。
import type { CSSProperties, ReactNode } from "react";
import { mono } from "@/lib/styles";

const shell: CSSProperties = {
  border: "1px solid var(--border)", borderRadius: 7, marginTop: 14,
  overflow: "hidden", boxShadow: "0 1px 0 rgba(0,0,0,0.03)",
};
const head: CSSProperties = {
  display: "flex", alignItems: "center", padding: "6px 12px",
  background: "var(--bg-panel)", borderBottom: "1px solid var(--border)",
};

export function CodeBlock({ lang, children }: { lang: string; children: ReactNode }) {
  return (
    <div style={shell}>
      <div style={head}>
        <span style={{ ...mono(11, 650), color: "var(--text-muted)", flex: 1 }}>{lang}</span>
      </div>
      <pre style={{ margin: 0, padding: "12px 14px", font: "400 12px/1.7 var(--font-mono)", overflow: "auto" }}>
        {children}
      </pre>
    </div>
  );
}

/** 围栏代码的原文:hast 给 `<code>` 的子节点通常是一个字符串,偶尔是字符串数组 */
export function codeText(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.filter((c): c is string => typeof c === "string").join("");
  return "";
}

/** react-markdown 交给 `pre` 的那个子元素(`<code className="language-…">`)的形状;`data-xray-component` 是 remark-component-budget 打的标记 */
export type PreChild = { props?: { className?: string; children?: ReactNode; "data-xray-component"?: string } } | undefined;

/** 语言标签:`language-xray-card` → `xray-card`;没有 info string 的围栏按 `text` */
export function fenceLang(child: PreChild): string {
  return child?.props?.className?.replace(/^language-/, "") ?? "text";
}
