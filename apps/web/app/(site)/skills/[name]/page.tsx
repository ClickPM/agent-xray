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

  // 【R-PERF】markdown **只预渲染当前要显示的那一个**。早先这里把整包全部 markdown 都渲染进
  // 载荷,而页面同一时刻只显示一个文件 —— ppt-master 因此是 21 篇各过一遍 remark + rehype-katex,
  // RSC 载荷 1.57 MB、软导航 5–7 秒,HTML 1.92 MB 还偶发水合失败(React #418,整页在客户端重渲)。
  // 其余 markdown 由 SkillDetail 在客户端就地渲染:整包原文本来就已经在客户端(copy 按钮与
  // CodeView 在用 files[].content),所以「切换文件不打后端」的口径不变。
  const initial = data.files.find((f) => f.path === initialPath);
  const mdViews: Record<string, ReactNode> = {};
  if (initial?.kind === "markdown") mdViews[initial.path] = <MarkdownFile content={initial.content} />;

  // 「本页目录」只有 H2 的 id 与文本,整包一次算好也很小,切文件时目录立刻就在。
  // 与渲染侧共用同一套 slug + 同名去重规则(Markdown.tsx 的 rehypeHeadingIds),
  // 两边各自从头计数即可对齐 —— 服务端渲染的那篇与客户端渲染的那几篇一视同仁。
  const tocs: Record<string, TocItem[]> = {};
  for (const f of data.files) {
    if (f.kind !== "markdown") continue;
    tocs[f.path] = extractToc(splitFrontmatter(f.content).body);
  }

  return (
    // key 按 skill 名:客户端在两个详情页之间导航时,选中文件 / copied 这类状态不跨 skill 残留
    <SkillDetail
      key={data.name}
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
