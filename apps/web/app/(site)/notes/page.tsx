// Notes 首页数据源(R5):真实 API 取代 demo-data,交互部分见 components/notes/NotesIndex。
import { api } from "@/lib/api";
import { rssDisplay, rssHref } from "@/lib/site";
import { relTime } from "@/lib/time";
import { NotesIndex, type IndexCategory } from "@/components/notes/NotesIndex";
import type { RssCat } from "@/components/notes/RssModal";

// 内容随同步脚本变化,且 docker build 时后端不可达 —— 不允许构建期预渲染。
export const dynamic = "force-dynamic";

export default async function NotesPage() {
  const { categories, latest } = await api.notes.listSeries();
  const now = Date.now();

  const cats: IndexCategory[] = categories.map((c) => ({
    slug: c.slug,
    name: c.name,
    dot: c.dot,
    cards: c.series.map((s) => ({
      slug: s.slug,
      name: s.name,
      desc: s.description,
      // 设计稿卡片副标题形如「15 章 · 更新于 3d ago」;空系列只说整理中
      meta: s.chapterCount === 0 ? "整理中" : `${s.chapterCount} 章 · 更新于 ${relTime(s.updatedAt, now)}`,
    })),
  }));

  const latestLine = latest.length ? `最新 · ${latest.map((l) => l.title).join(" · ")}` : "";

  const rssCats: RssCat[] = [
    { name: "全站更新", url: rssDisplay(), href: rssHref(), dot: "#2563eb", main: true },
    ...categories.map((c) => ({
      name: c.name,
      url: rssDisplay(c.slug),
      href: rssHref(c.slug),
      dot: c.dot,
    })),
  ];

  return <NotesIndex categories={cats} latestLine={latestLine} rssCats={rssCats} />;
}
