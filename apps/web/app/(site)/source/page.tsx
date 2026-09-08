// Source 首页(R-SOURCE,画板 2n):`/source` = 目录树 + 打开仓库根的 README.md。
// 取数、404 门禁在这里;目录树折叠与 copy 在 components/source/SourceBrowser(客户端)。
import { api, notFoundOnBadRoute } from "@/lib/api";
import { requireVisibleTab } from "@/lib/tabs-server";
import { notFound } from "next/navigation";
import { MarkdownFile } from "@/components/skills/MarkdownFile";
import { SourceBrowser } from "@/components/source/SourceBrowser";
import { isoDate } from "@/lib/time";
import { safeExternal } from "@/lib/external";

// 快照随发版变化,且 docker build 时后端不可达 —— 不允许构建期预渲染
export const dynamic = "force-dynamic";

/** 首页默认打开的文件:仓库根的 README.md;万一快照里没有它(闭集改了)就开第一个文件 */
const DEFAULT_FILE = "README.md";

export default async function SourcePage() {
  // R-TABS:Source tab 被隐藏时,它的地址在站点上不存在(404,不重定向 —— 见 lib/tabs-server.ts)
  await requireVisibleTab("source");

  // 没有 current 快照 → 后端 not_found → 画板 2k-B(首次发版 compose up 之后、source-publish 之前的几分钟)
  const index = await api.source.getSource().catch(notFoundOnBadRoute);
  const initialPath = index.files.some((f) => f.path === DEFAULT_FILE) ? DEFAULT_FILE : index.files[0]?.path;
  if (!initialPath) notFound();
  const file = await api.source.getSourceFile({ path: initialPath }).catch(notFoundOnBadRoute);

  // 【R-PERF 口径】markdown 只在服务端预渲染当前要显示的那一个;代码文件在客户端由 SourceCodeView 渲染
  const mdView = file.kind === "markdown" ? <MarkdownFile content={file.content} /> : undefined;
  // 页头用文件那次响应里的快照:两次请求之间恰好发版时,标题 / GitHub 链接与正文属于同一版
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
        // 服务端常量本就是 https;这里是第二道(与 Skills 的 repoUrl 同一口径),取不到就退回仓库主页
        repoUrl: safeExternal(s.repoUrl) ?? "https://github.com",
      }}
      files={index.files}
      file={{ path: file.path, kind: file.kind, content: file.content, bytes: file.bytes, lines: file.lines }}
      mdView={mdView}
      isIndex
    />
  );
}
