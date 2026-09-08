// 文章阅读页(设计稿画板 2c)。正文以标准 markdown 从 notes 服务取回,
// 由 components/Markdown 映射到画板既有的排版(规则 7)。
import Link from "next/link";
import { api, notFoundOnBadRoute } from "@/lib/api";
import { requireVisibleTab, visibleTabKeys } from "@/lib/tabs-server";
import { tryInRuntimeHref } from "@/lib/try-in-runtime";
import { GhostButton } from "@/components/ui";
import { MobileChapterBar } from "@/components/mobile/MobileChapterBar";
import { mono } from "@/lib/styles";
import { isoDate, readingMinutes } from "@/lib/time";
import { Markdown, extractToc } from "@/components/Markdown";
import { ReadingProgress } from "@/components/ReadingProgress";

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

  // R-TABS:Notes tab 被隐藏时,它的地址在站点上不存在(404,不重定向 —— 见 lib/tabs-server.ts)
  await requireVisibleTab("notes");

  // 路由参数是访客可控的:认不出与形状不合法都渲染 404,真故障原样抛出。
  const data = await api.notes.getChapter(series, chapter).catch(notFoundOnBadRoute);

  // R-CROSSLINK C3(画板 2r / 4x):「在 Runtime 里聊这一章」。
  // Runtime tab 被隐藏时**整条链接不渲染**(连同前面那个「·」)—— 它是一条通往 `/` 的门,
  // 门后不存在时不该画门;`visibleTabKeys` 与本页开头的门禁是同一次请求内的同一份结果(React cache)。
  const runtimeVisible = (await visibleTabKeys()).includes("runtime");

  const toc = extractToc(data.contentMd);
  const pinned = data.label.toUpperCase() === "README";

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", position: "relative" }}>
      {/* 阅读进度线。画板 2c 里是写死的 31%(静态画板只能定格一帧),这里接真实滚动 */}
      <ReadingProgress />
      {/* R-MOBILE:章节页功能条 + 本章目录 Sheet(画板 4m / 4n)。窄屏才渲染。 */}
      <div
        style={{
          maxWidth: 1000, margin: "0 auto", padding: "26px 32px 64px",
          display: "grid", gridTemplateColumns: "minmax(0,720px) 1fr", gap: 56, alignItems: "start",
        }}
        className="m-page-wrap m-chapter"
      >
        {/* 功能条必须在 `.m-page-wrap` **内部**:它靠 `margin: 0 -16px` 抵消这一层的
            左右内边距把自己顶到屏幕边缘。移动端这层 grid 收成单列,它占第一行。
            中间放的是章序(轻量信息,不是标题 —— 标题是正文里的 h1)。 */}
        <MobileChapterBar
          backHref={`/notes/${data.seriesSlug}`}
          backLabel={data.seriesName}
          order={crumb(data.label, pinned)}
          toc={toc}
        />
        <div style={{ minWidth: 0 }} className="m-chapter-body">
          <div style={{ fontSize: 12, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }} className="m-hide-narrow">
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
          <div style={{ ...mono(11), color: "var(--text-dim)", marginTop: 8 }} className="m-chapter-meta">
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
            {/* R-CROSSLINK C3(画板 2r 方案 A):与「原文」同一语汇的文本链接,接在 meta 行末尾 ——
                它与「原文」是同一类信息(这一章还能去哪),同类同行,读者不用学新位置;
                h1 右侧的 ghost 按钮(方案 B)会形成一个视觉重心,而本页的主动作是读、不是聊。
                点击跳到 `/`,输入框里已写好模板文本,**不自动发送**(边界见 lib/ask-why.ts)。 */}
            {runtimeVisible && (
              <>
                {" · "}
                <Link
                  href={tryInRuntimeHref({
                    seriesName: data.seriesName,
                    title: data.title,
                    seriesSlug: data.seriesSlug,
                    // 用服务端回的 slug 而不是路由参数:那两个 slug 是要交给模型去调
                    // `notes_get_chapter` 的入参,得是库里那份规范值
                    chapterSlug: data.slug,
                  })}
                  style={{ color: "var(--accent)" }}
                >
                  在 Runtime 里聊这一章 ↗
                </Link>
              </>
            )}
          </div>

          <Markdown>{data.contentMd}</Markdown>

          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 40 }} className="m-prevnext">
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
        <div style={{ paddingTop: 60, position: "sticky", top: 0 }} className="m-hide-narrow">
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
