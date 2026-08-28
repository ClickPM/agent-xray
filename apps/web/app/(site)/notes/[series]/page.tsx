import Link from "next/link";
import { cchChapters, seriesMeta } from "@/lib/demo-data";
import { GhostButton } from "@/components/ui";
import { mono } from "@/lib/styles";

// 演示轮次:仅 claude-code-harness 有完整章节数据;其余系列显示占位。
// 教程内容管道(vault 学习分享/ 编译入库)接入后由 notes 服务提供。

export function generateStaticParams() {
  return Object.keys(seriesMeta).map((series) => ({ series }));
}

export default async function SeriesPage({ params }: { params: Promise<{ series: string }> }) {
  const { series } = await params;
  const meta = seriesMeta[series] ?? { name: series, cat: "源码拆解", desc: "", meta: "" };
  const hasChapters = series === "claude-code-harness";
  const firstHref = `/notes/${series}/01`;

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "30px 32px 64px" }}>
        {/* 面包屑 */}
        <div style={{ fontSize: 12, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 6 }}>
          <Link href="/notes" style={{ color: "var(--accent)" }}>Notes</Link>
          <span>/</span>
          <Link href="/notes" style={{ color: "var(--accent)" }}>{meta.cat}</Link>
          <span>/</span>
          <span style={{ color: "var(--text-muted)" }}>{meta.name}</span>
        </div>

        <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginTop: 22 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 22, fontWeight: 650 }}>{meta.name}</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 6 }}>
              {series === "claude-code-harness" ? "从 5.4MB 混淆产物逆向一个闭源 harness 的完整架构" : meta.desc}
            </div>
            <div style={{ ...mono(11), color: "var(--text-dim)", marginTop: 10 }}>
              {series === "claude-code-harness" ? "15 章 · 约 12 万字 · 更新于 3d ago" : meta.meta}
            </div>
          </div>
          {hasChapters && (
            <Link href={firstHref} style={{ textDecoration: "none" }}>
              <GhostButton>从第 1 章开始读</GhostButton>
            </Link>
          )}
        </div>

        {hasChapters ? (
          <div style={{ marginTop: 26, border: "1px solid var(--border)", borderRadius: 7, overflow: "hidden" }}>
            <Link
              href={firstHref}
              style={{
                display: "flex", alignItems: "center", gap: 14, padding: "12px 16px",
                background: "var(--bg-panel)", cursor: "pointer", color: "var(--text)", textDecoration: "none",
              }}
            >
              <span style={{ ...mono(12, 600), color: "var(--text-muted)", width: 52, flex: "none" }}>README</span>
              <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>教程总览与阅读路线</span>
              <span style={{ ...mono(10, 600), color: "var(--text-muted)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4, padding: "1px 6px" }}>置顶</span>
            </Link>
            {cchChapters.map((ch) => (
              <Link
                key={ch.num}
                href={`/notes/${series}/${ch.num}`}
                className="chapter-row"
                style={{
                  display: "flex", alignItems: "center", gap: 14, padding: "11px 16px",
                  borderTop: "1px solid var(--border)", cursor: "pointer",
                  color: "var(--text)", textDecoration: "none",
                }}
              >
                <span style={{ ...mono(12), color: "var(--text-dim)", width: 52, flex: "none" }}>{ch.num}</span>
                <span style={{ fontSize: 14, flex: 1 }}>{ch.title}</span>
                <span style={{ fontSize: 11, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>{ch.time}</span>
              </Link>
            ))}
          </div>
        ) : (
          <div
            style={{
              marginTop: 26, border: "1px dashed var(--border)", borderRadius: 7,
              padding: "36px 16px", textAlign: "center", fontSize: 13, color: "var(--text-dim)",
            }}
          >
            本系列章节整理中 — 内容管道接入后自动上线
          </div>
        )}
      </div>
    </div>
  );
}
