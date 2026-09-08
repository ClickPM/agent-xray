// Source 文件页(R-SOURCE,画板 2o):`/source/<path>`,path 是仓库根相对路径。
// 取数、404 门禁在这里;目录树折叠与 copy 在 components/source/SourceBrowser(客户端)。
//
// 【只打一次后端】`GET /source/file` 同时回当前文件与整份目录树元信息(同一个 REPEATABLE READ 事务):
// 分两次取的话,恰好夹着一次发布 commit 时页头 / 正文是旧版而目录树是新版(codex 首轮 P2)。
import { api, notFoundOnBadRoute } from "@/lib/api";
import { requireVisibleTab } from "@/lib/tabs-server";
import { MarkdownFile } from "@/components/skills/MarkdownFile";
import { SourceBrowser } from "@/components/source/SourceBrowser";
import { isoDate } from "@/lib/time";
import { safeExternal } from "@/lib/external";
import { rewriteSourceLinks } from "@/lib/source-links";

export const dynamic = "force-dynamic";

export default async function SourceFilePage({ params }: { params: Promise<{ path: string[] }> }) {
  // R-TABS:Source tab 被隐藏时,它的地址在站点上不存在(404,不重定向 —— 见 lib/tabs-server.ts)
  await requireVisibleTab("source");

  const { path: segments } = await params;
  // 【段要先解码】catch-all 的段对 `[series]` `(site)` 这类字符不一定已经解码(2026-09-08 本机实测:
  // `[series]` 到手是 `%5Bseries%5D`,直接拼给后端被 checkSourcePath 当成含 `%` 的非法路径 → 404)。
  // 解不开的(孤立的 `%`)本来也不是合法路径,交给后端按 invalid_argument → 404 处理。
  const path = segments
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    })
    .join("/");

  // 路由参数是访客可控的:形状不合法(后端 invalid_argument)与不存在(not_found)都渲染 404,真故障原样抛出。
  // 目录地址(/source/apps/api)没有对应文件,同样 404 —— 没有目录页(画板只画了首页与文件页)。
  const file = await api.source.getSourceFile({ path }).catch(notFoundOnBadRoute);

  const mdView = file.kind === "markdown" ? <MarkdownFile content={rewriteSourceLinks(file.content, file.path)} /> : undefined;
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
      files={file.files}
      file={{ path: file.path, kind: file.kind, content: file.content, bytes: file.bytes, lines: file.lines }}
      mdView={mdView}
      isIndex={false}
    />
  );
}
