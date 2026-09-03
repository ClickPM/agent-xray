// 系列目录(设计稿画板 2b)。数据来自 notes 服务;样式与拆分前一致(规则 7)。
import Link from "next/link";
import { api, notFoundOnBadRoute } from "@/lib/api";
import { requireVisibleTab } from "@/lib/tabs-server";
import { GhostButton } from "@/components/ui";
import { mono } from "@/lib/styles";
import { relTime, tenThousand } from "@/lib/time";

// 内容随同步脚本变化,且 docker build 时后端不可达 —— 不允许构建期预渲染。
// (原先的 generateStaticParams 依赖 demo-data 的固定 slug 列表,已随数据源一并移除。)
export const dynamic = "force-dynamic";

export default async function SeriesPage({ params }: { params: Promise<{ series: string }> }) {
  // R-TABS:Notes tab 被隐藏时,它的地址在站点上不存在(404,不重定向 —— 见 lib/tabs-server.ts)
  await requireVisibleTab("notes");

  const { series } = await params;

  // 路由参数是访客可控的:认不出与形状不合法都渲染 404,真故障原样抛出。
  const data = await api.notes.getSeries(series).catch(notFoundOnBadRoute);

  const now = Date.now();
  const pinned = data.chapters.find((c) => c.pinned);
  const rest = data.chapters.filter((c) => !c.pinned);
  const hasChapters = data.chapters.length > 0;
  // 画板 2b 的按钮指向**第 1 章**(不是置顶的 README 行),文案也照抄
  const firstChapter = rest[0];

  const meta = hasChapters
    ? `${data.chapterCount} 章 · 约 ${tenThousand(data.wordCount)} 万字 · 更新于 ${relTime(data.updatedAt, now)}`
    : "";

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "30px 32px 64px" }}>
        {/* 面包屑 */}
        <div style={{ fontSize: 12, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 6 }}>
          <Link href="/notes" style={{ color: "var(--accent)" }}>Notes</Link>
          <span>/</span>
          <Link href="/notes" style={{ color: "var(--accent)" }}>{data.categoryName}</Link>
          <span>/</span>
          <span style={{ color: "var(--text-muted)" }}>{data.name}</span>
        </div>

        <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginTop: 22 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 22, fontWeight: 650 }}>{data.name}</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 6 }}>{data.description}</div>
            <div style={{ ...mono(11), color: "var(--text-dim)", marginTop: 10 }}>{meta}</div>
          </div>
          {firstChapter && (
            <Link href={`/notes/${series}/${firstChapter.slug}`} style={{ textDecoration: "none" }}>
              <GhostButton>从第 1 章开始读</GhostButton>
            </Link>
          )}
        </div>

        {hasChapters ? (
          <div style={{ marginTop: 26, border: "1px solid var(--border)", borderRadius: 7, overflow: "hidden" }}>
            {pinned && (
              <Link
                href={`/notes/${series}/${pinned.slug}`}
                style={{
                  display: "flex", alignItems: "center", gap: 14, padding: "12px 16px",
                  background: "var(--bg-panel)", cursor: "pointer", color: "var(--text)", textDecoration: "none",
                }}
              >
                <span style={{ ...mono(12, 600), color: "var(--text-muted)", width: 52, flex: "none" }}>{pinned.label}</span>
                <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>{pinned.title}</span>
                <span style={{ ...mono(10, 600), color: "var(--text-muted)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4, padding: "1px 6px" }}>置顶</span>
              </Link>
            )}
            {rest.map((ch, i) => (
              <Link
                key={ch.slug}
                href={`/notes/${series}/${ch.slug}`}
                className="chapter-row"
                style={{
                  display: "flex", alignItems: "center", gap: 14, padding: "11px 16px",
                  borderTop: pinned || i > 0 ? "1px solid var(--border)" : "none", cursor: "pointer",
                  color: "var(--text)", textDecoration: "none",
                }}
              >
                <span style={{ ...mono(12), color: "var(--text-dim)", width: 52, flex: "none" }}>{ch.label}</span>
                <span style={{ fontSize: 14, flex: 1 }}>{ch.title}</span>
                <span style={{ fontSize: 11, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
                  {relTime(ch.updatedAt, now)}
                </span>
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
