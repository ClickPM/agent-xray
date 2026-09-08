// Source 文件页(R-SOURCE,画板 2o):`/source/<path>`,path 是仓库根相对路径(Next 已按段解码,`(site)` `[series]` 原样到手)。
// 取数、404 门禁在这里;目录树折叠与 copy 在 components/source/SourceBrowser(客户端)。
import { api, notFoundOnBadRoute } from "@/lib/api";
import { requireVisibleTab } from "@/lib/tabs-server";
import { MarkdownFile } from "@/components/skills/MarkdownFile";
import { SourceBrowser } from "@/components/source/SourceBrowser";
import { isoDate } from "@/lib/time";
import { safeExternal } from "@/lib/external";

export const dynamic = "force-dynamic";

export default async function SourceFilePage({ params }: { params: Promise<{ path: string[] }> }) {
  // R-TABS:Source tab 被隐藏时,它的地址在站点上不存在(404,不重定向 —— 见 lib/tabs-server.ts)
  await requireVisibleTab("source");

  const { path: segments } = await params;
  const path = segments.join("/");

  // 路由参数是访客可控的:形状不合法(后端 invalid_argument)与不存在(not_found)都渲染 404,真故障原样抛出。
  // 目录地址(/source/apps/api)没有对应文件,同样 404 —— 没有目录页(画板只画了首页与文件页)。
  const file = await api.source.getSourceFile({ path }).catch(notFoundOnBadRoute);
  const index = await api.source.getSource().catch(notFoundOnBadRoute);

  const mdView = file.kind === "markdown" ? <MarkdownFile content={file.content} /> : undefined;
  const s = file.snapshot;

  return (
    <SourceBrowser
      snapshot={{
        sha: s.sha,
        shortSha: s.shortSha,
        publishedDate: isoDate(s.publishedAt),
        fileCount: s.fileCount,
        totalBytes: s.totalBytes,
        repo: s.repo,
        repoUrl: safeExternal(s.repoUrl) ?? "https://github.com",
      }}
      files={index.files}
      file={{ path: file.path, kind: file.kind, content: file.content, bytes: file.bytes, lines: file.lines }}
      mdView={mdView}
      isIndex={false}
    />
  );
}
