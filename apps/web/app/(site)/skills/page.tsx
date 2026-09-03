// Skills 首页数据源(R-SKILLS,画板 2f):真实 API,交互部分见 components/skills/SkillsIndex。
import { api } from "@/lib/api";
import { requireVisibleTab } from "@/lib/tabs-server";
import { relTimeZh } from "@/lib/time";
import { SkillsIndex, type IndexCategory } from "@/components/skills/SkillsIndex";

// 内容随 MCP 发布变化,且 docker build 时后端不可达 —— 不允许构建期预渲染。
export const dynamic = "force-dynamic";

/** 卡片元信息行的出处:自研显示 `@owner`,精选显示 `owner/repo`(画板 2f) */
function origin(sourceType: "own" | "curated", repo: string): string {
  return sourceType === "own" ? `@${repo.split("/")[0]}` : repo;
}

export default async function SkillsPage() {
  // R-TABS:Skills tab 被隐藏时,它的地址在站点上不存在(404,不重定向 —— 见 lib/tabs-server.ts)
  await requireVisibleTab("skills");

  const { categories, total, latest } = await api.skills.listSkills();
  const now = Date.now();

  const cats: IndexCategory[] = categories.map((c) => ({
    slug: c.slug,
    name: c.name,
    dot: c.dot,
    cards: c.skills.map((s) => ({
      name: s.name,
      sourceType: s.sourceType,
      summary: s.summary,
      // 画板 2f:`encoredev/skills · 1 个文件 · 更新于 12 天前`
      meta: `${origin(s.sourceType, s.repo)} · ${s.fileCount} 个文件 · 更新于 ${relTimeZh(s.updatedAt, now)}`,
    })),
  }));

  return (
    <SkillsIndex
      categories={cats}
      total={total}
      latest={latest ? { name: latest.name, rel: relTimeZh(latest.updatedAt, now) } : null}
    />
  );
}
