import Link from "next/link";
import { articleToc, seriesMeta } from "@/lib/demo-data";
import { GhostButton } from "@/components/ui";
import { mono } from "@/lib/styles";

// 演示文章(画板 H:Pi 第3章)。内容管道接入后由 notes 服务按 slug 提供真实正文。

const inlineCode = {
  font: "400 12px var(--font-mono)",
  background: "var(--bg-subtle)",
  borderRadius: 4,
  padding: "1px 5px",
} as const;

export default async function ArticlePage({ params }: { params: Promise<{ series: string; chapter: string }> }) {
  const { series } = await params;
  const meta = seriesMeta[series] ?? { name: series, cat: "源码拆解" };

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", position: "relative" }}>
      {/* 阅读进度线(静态演示 31%;实现滚动联动属细化项) */}
      <div style={{ position: "sticky", top: 0, left: 0, width: "31%", height: 2, background: "var(--accent)", zIndex: 2 }} />
      <div
        style={{
          maxWidth: 1000, margin: "0 auto", padding: "26px 32px 64px",
          display: "grid", gridTemplateColumns: "minmax(0,720px) 1fr", gap: 56, alignItems: "start",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <Link href="/notes" style={{ color: "var(--accent)" }}>Notes</Link>
            <span>/</span>
            <Link href="/notes" style={{ color: "var(--accent)" }}>{meta.cat}</Link>
            <span>/</span>
            <Link href={`/notes/${series}`} style={{ color: "var(--accent)" }}>{meta.name}</Link>
            <span>/</span>
            <span style={{ color: "var(--text-muted)" }}>第3章</span>
          </div>

          <h1 style={{ fontSize: 22, fontWeight: 650, lineHeight: 1.4, marginTop: 18, marginBottom: 0 }}>
            第3章:Agent Loop — 让模型转动起来的引擎
          </h1>
          <div style={{ ...mono(11), color: "var(--text-dim)", marginTop: 8 }}>约 8 分钟 · 更新于 2026-08-25</div>

          <blockquote
            style={{
              borderLeft: "3px solid #b6bac2", borderRadius: "0 6px 6px 0", background: "var(--bg-subtle)",
              padding: "10px 14px", margin: "22px 0 0", fontSize: 14, lineHeight: 1.7, color: "var(--text-muted)",
            }}
          >
            本章回答一个问题:模型自己不会「连续做事」,是谁在推着它一轮轮转?答案藏在{" "}
            <span style={inlineCode}>agent-loop.ts</span> 的一个 <span style={inlineCode}>while</span> 循环里。
          </blockquote>

          <h2 style={{ fontSize: 16, fontWeight: 650, marginTop: 30, marginBottom: 0 }}>一、循环在哪里</h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, marginTop: 12, marginBottom: 0 }}>
            pi 把整个 agent 内核压缩在一个可读的循环里:只要模型还想调用工具,循环就继续;一旦它给出纯文本回答,循环自然停下。没有调度器、没有状态机——<span style={inlineCode}>while</span> 就是全部的控制流。
          </p>

          <div style={{ border: "1px solid var(--border)", borderRadius: 7, marginTop: 14, overflow: "hidden", boxShadow: "0 1px 0 rgba(0,0,0,0.03)" }}>
            <div style={{ display: "flex", alignItems: "center", padding: "6px 12px", background: "var(--bg-panel)", borderBottom: "1px solid var(--border)" }}>
              <span style={{ ...mono(11, 650), color: "var(--text-muted)", flex: 1 }}>typescript</span>
            </div>
            <pre style={{ margin: 0, padding: "12px 14px", font: "400 12px/1.7 var(--font-mono)", overflow: "auto" }}>
              <span style={{ color: "var(--accent)" }}>while</span> (!stopReason) {"{"}
              {"\n  "}<span style={{ color: "var(--accent)" }}>const</span> response = <span style={{ color: "var(--accent)" }}>await</span> callModel(messages, tools);
              {"\n  "}<span style={{ color: "var(--accent)" }}>if</span> (response.toolCalls.length === 0) <span style={{ color: "var(--accent)" }}>break</span>;
              {"\n  "}messages.push(<span style={{ color: "var(--accent)" }}>await</span> executeTools(response.toolCalls));
              {"\n"}{"}"}
            </pre>
          </div>

          <p style={{ fontSize: 14, lineHeight: 1.7, marginTop: 14, marginBottom: 0 }}>
            你在 Runtime 工作台里看到的每一条 <span style={inlineCode}>before_provider_request</span> 事件,就是这个循环转过一圈的心跳。
          </p>

          <h2 style={{ fontSize: 16, fontWeight: 650, marginTop: 30, marginBottom: 0 }}>二、一个 turn 的解剖</h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, marginTop: 12, marginBottom: 0 }}>
            一个 turn 从用户消息入队开始,依次经过四步:组装上下文 → 调用模型 → 执行工具 → 把结果写回消息队列。每一步都会向观测者扩展广播事件,所以右侧面板里 Timeline 的行序,就是这四步的真实执行序。
          </p>
          <p style={{ fontSize: 14, lineHeight: 1.7, marginTop: 10, marginBottom: 0 }}>
            值得注意的是第四步:工具结果不是直接「返回给模型」,而是作为一条新消息追加进队列——模型在下一圈循环里才会看见它。这个细节决定了 pi 的会话可以在任意一圈被分叉(fork)。
          </p>

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 40 }}>
            <Link href={`/notes/${series}`} style={{ textDecoration: "none" }}>
              <GhostButton>← 第2章 三层架构</GhostButton>
            </Link>
            <Link href={`/notes/${series}`} style={{ textDecoration: "none" }}>
              <GhostButton>第4章 模型调用 →</GhostButton>
            </Link>
          </div>
        </div>

        {/* 悬浮目录 */}
        <div style={{ paddingTop: 60, position: "sticky", top: 0 }}>
          <div style={{ ...mono(11, 600), color: "var(--text-dim)", letterSpacing: "0.05em", marginBottom: 8 }}>本章目录</div>
          {articleToc.map((label, i) => (
            <div
              key={label}
              style={{
                fontSize: 11, padding: "4px 0 4px 10px",
                borderLeft: `2px solid ${i === 1 ? "var(--accent)" : "transparent"}`,
                color: i === 1 ? "var(--accent)" : "var(--text-muted)",
                fontWeight: i === 1 ? 600 : 400, cursor: "pointer",
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
