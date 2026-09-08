// Source 首页(R-SOURCE,画板 2n):`/source` = 目录树 + 打开仓库根的 README.md。
// 取数、404 门禁在这里;目录树折叠与 copy 在 components/source/SourceBrowser(客户端)。
//
// 【只打一次后端】`GET /source/file` 同时回文件与整份目录树元信息(同一个 REPEATABLE READ 事务),
// 页头 / 正文 / 目录树必然是同一个 sha(codex 首轮 P2)。只有 README.md 不在快照里(闭集改了)才退回
// 「先取目录、再开第一个文件」的两步路。
import { notFound } from "next/navigation";
import { api, notFoundOnBadRoute } from "@/lib/api";
import { ErrCode, isAPIError } from "@/lib/api-client";
import { requireVisibleTab } from "@/lib/tabs-server";
import { MarkdownFile } from "@/components/skills/MarkdownFile";
import { SourceBrowser } from "@/components/source/SourceBrowser";
import { isoDate } from "@/lib/time";
import { safeExternal } from "@/lib/external";
import { sourceLinkHref } from "@/lib/source-links";

// 快照随发版变化,且 docker build 时后端不可达 —— 不允许构建期预渲染
export const dynamic = "force-dynamic";

/** 首页默认打开的文件:仓库根的 README.md */
const DEFAULT_FILE = "README.md";

export default async function SourcePage() {
  // R-TABS:Source tab 被隐藏时,它的地址在站点上不存在(404,不重定向 —— 见 lib/tabs-server.ts)
  await requireVisibleTab("source");

  let file;
  try {
    file = await api.source.getSourceFile({ path: DEFAULT_FILE });
  } catch (err) {
    // 没有 current 快照 → 也是 not_found → 画板 2k-B(首次发版 compose up 之后、source-publish 之前的几分钟);
    // 两者的区分靠下面再取一次目录:目录也 404 才是「没快照」
    if (!(isAPIError(err) && err.code === ErrCode.NotFound)) throw err;
    const index = await api.source.getSource().catch(notFoundOnBadRoute);
    const first = index.files[0]?.path;
    if (!first) notFound();
    file = await api.source.getSourceFile({ path: first }).catch(notFoundOnBadRoute);
  }

  // 【R-PERF 口径】markdown 只在服务端预渲染当前要显示的那一个;代码文件在客户端由 SourceCodeView 渲染
  const mdView = file.kind === "markdown" ? <MarkdownFile content={file.content} linkHref={sourceLinkHref(file.path)} /> : undefined;
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
      files={file.files}
      file={{ path: file.path, kind: file.kind, content: file.content, bytes: file.bytes, lines: file.lines }}
      mdView={mdView}
      isIndex
    />
  );
}
