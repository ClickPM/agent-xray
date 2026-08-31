// 文章阅读页(设计稿画板 2c)。正文以标准 markdown 从 notes 服务取回,
// 由 components/notes/Markdown 映射到画板既有的排版(规则 7)。
import Link from "next/link";
import { api, notFoundOnBadRoute } from "@/lib/api";
import { GhostButton } from "@/components/ui";
import { mono } from "@/lib/styles";
import { isoDate, readingMinutes } from "@/lib/time";
import { Markdown, extractToc } from "@/components/notes/Markdown";

export const dynamic = "force-dynamic";

/** 面包屑末段:置顶行显示 README,数字章节显示「第N章」 */
function crumb(label: string, pinned: boolean): string {
  if (pinned) return label;
  const n = Number(label);
  return Number.isFinite(n) && label.trim() !== "" ? `第${n}章` : label;
}

/** 上一章 / 下一章按钮里的长标题要收住,否则 68 字的章节名会把按钮拉穿整行 */
const navLabel = {
  display: "inline-block", maxWidth: 300, overflow: "hidden",
  textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom",
} as const;

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ series: string; chapter: string }>;
}) {
  const { series, chapter } = await params;

  // 路由参数是访客可控的:认不出与形状不合法都渲染 404,真故障原样抛出。
  const data = await api.notes.getChapter(series, chapter).catch(notFoundOnBadRoute);

  const toc = extractToc(data.contentMd);
  const pinned = data.label.toUpperCase() === "README";

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", position: "relative" }}>
      {/* 阅读进度线(设计稿为静态演示;滚动联动属细化项,未做) */}
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
            <Link href="/notes" style={{ color: "var(--accent)" }}>{data.categoryName}</Link>
            <span>/</span>
            <Link href={`/notes/${data.seriesSlug}`} style={{ color: "var(--accent)" }}>{data.seriesName}</Link>
            <span>/</span>
            <span style={{ color: "var(--text-muted)" }}>{crumb(data.label, pinned)}</span>
          </div>

          <h1 style={{ fontSize: 22, fontWeight: 650, lineHeight: 1.4, marginTop: 18, marginBottom: 0 }}>
            {data.title}
          </h1>
          <div style={{ ...mono(11), color: "var(--text-dim)", marginTop: 8 }}>
            约 {readingMinutes(data.wordCount)} 分钟 · 更新于 {isoDate(data.updatedAt)}
            {/* 所有者裁定 4.2:第三方文章只收中译,原文链接必须保留 */}
            {data.sourceUrl && (
              <>
                {" · "}
                <a href={data.sourceUrl} target="_blank" rel="noreferrer noopener" style={{ color: "var(--accent)" }}>
                  原文
                </a>
              </>
            )}
          </div>

          <Markdown>{data.contentMd}</Markdown>

          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 40 }}>
            {data.prev ? (
              <Link href={`/notes/${data.seriesSlug}/${data.prev.slug}`} style={{ textDecoration: "none" }}>
                <GhostButton><span style={navLabel}>← {data.prev.title}</span></GhostButton>
              </Link>
            ) : (
              <span />
            )}
            {data.next ? (
              <Link href={`/notes/${data.seriesSlug}/${data.next.slug}`} style={{ textDecoration: "none" }}>
                <GhostButton><span style={navLabel}>{data.next.title} →</span></GhostButton>
              </Link>
            ) : (
              <span />
            )}
          </div>
        </div>

        {/* 悬浮目录 */}
        <div style={{ paddingTop: 60, position: "sticky", top: 0 }}>
          <div style={{ ...mono(11, 600), color: "var(--text-dim)", letterSpacing: "0.05em", marginBottom: 8 }}>本章目录</div>
          {toc.map((h) => (
            <a
              key={h.id}
              href={`#${h.id}`}
              style={{
                display: "block", fontSize: 11, padding: "4px 0 4px 10px",
                borderLeft: "2px solid transparent",
                color: "var(--text-muted)", fontWeight: 400, cursor: "pointer", textDecoration: "none",
              }}
            >
              {h.text}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
