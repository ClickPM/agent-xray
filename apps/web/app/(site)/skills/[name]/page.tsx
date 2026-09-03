// Skill 详情页的服务端壳(R-SKILLS,画板 2g / 2h):取数、按 `?file=` 选初始文件、404 门禁。
// 目录树选中态与两处 copy 在 components/skills/SkillDetail(客户端)。
import type { ReactNode } from "react";
import { api, notFoundOnBadRoute } from "@/lib/api";
import { requireVisibleTab } from "@/lib/tabs-server";
import { safeExternal } from "@/lib/external";
import { splitFrontmatter } from "@/lib/frontmatter";
import { isoDate } from "@/lib/time";
import { extractToc } from "@/components/Markdown";
import { MarkdownFile } from "@/components/skills/MarkdownFile";
import { SkillDetail, type TocItem } from "@/components/skills/SkillDetail";

export const dynamic = "force-dynamic";

export default async function SkillPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ file?: string | string[] }>;
}) {
  // R-TABS:Skills tab 被隐藏时,它的地址在站点上不存在(404,不重定向 —— 见 lib/tabs-server.ts)
  await requireVisibleTab("skills");

  const { name } = await params;
  const { file } = await searchParams;

  // 路由参数是访客可控的:认不出与形状不合法都渲染 404,真故障原样抛出。
  const data = await api.skills.getSkill(name).catch(notFoundOnBadRoute);

  // `?file=` 深链:指向存在的文件就从它打开;不存在(或没给)回落到 SKILL.md —— 一个坏的查询串
  // 不该让整个 skill 变成 404,它只是「打开哪个文件」的提示
  const wanted = Array.isArray(file) ? file[0] : file;
  const initialPath = wanted && data.files.some((f) => f.path === wanted) ? wanted : "SKILL.md";

  // markdown 文件在服务端预渲染(理由见 components/skills/MarkdownFile.tsx),目录用同一份正文算:
  // Markdown 的标题 id 与 extractToc 两边各自从头计数,只要输入同一段 body 就对得上(Notes 文章页同一做法)
  const mdViews: Record<string, ReactNode> = {};
  const tocs: Record<string, TocItem[]> = {};
  for (const f of data.files) {
    if (f.kind !== "markdown") continue;
    mdViews[f.path] = <MarkdownFile content={f.content} />;
    tocs[f.path] = extractToc(splitFrontmatter(f.content).body);
  }

  return (
    <SkillDetail
      skill={{
        name: data.name,
        categoryName: data.categoryName,
        summary: data.summary,
        sourceType: data.sourceType,
        repo: data.repo,
        // 服务端已只收 http(s);这里是第二道(库可以绕过 tool 直接改),与 About 页 originUrl 同一口径
        repoUrl: safeExternal(data.repoUrl),
        version: data.version,
        fileCount: data.fileCount,
        totalBytes: data.totalBytes,
        zipSize: data.zipSize,
        updatedDate: isoDate(data.updatedAt),
      }}
      files={data.files}
      initialPath={initialPath}
      mdViews={mdViews}
      tocs={tocs}
    />
  );
}
