// R-SOURCE:Source 源码 tab 的查询端点(设计稿画板 2n 首页 / 2o 文件页)。
//
// 快照由发布脚本经 **MCP 管理面**的 `source_*` 工具随发版发布(`apps/api/mcp/`);本服务只读。
// 前端 `apps/web/app/(site)/source/` 是 Server Component,经生成客户端调用这里。
//
// **文件一律当文本返回**(docs/security.md §4 R-SOURCE 补记):这里不解析、不执行、不 import
// 任何文件内容,markdown 也不在服务端渲染 —— 与 skills 同一口径(渲染在前端)。
//
// 【为什么文件页用 query 而不是通配路径】路径段里有 `(site)` `[series]`,不赌路由器对括号的解码边角;
// `?path=` 是一个普通字符串参数,校验落在 `checkSourcePath`。
import { api, APIError, type Query } from "encore.dev/api";
import { checkSourcePath, shortSha, type SourceFileKind } from "../shared/source-pack";
import { SOURCE_REPO, SOURCE_REPO_URL } from "../shared/source-repo";
import * as store from "./store";

const toIso = (ms: number) => new Date(ms).toISOString();

/** 快照头部:页头 meta 行与 `GitHub ↗` 的全部原料 */
export interface SourceSnapshotInfo {
  /** 40 位 git SHA;`GitHub ↗` 拼 `<repoUrl>/tree/<sha>` 与 `<repoUrl>/blob/<sha>/<path>` */
  sha: string;
  /** 前 7 位,页面 meta 行「快照 be6c074」 */
  shortSha: string;
  /** ISO 8601;页面显示日期 */
  publishedAt: string;
  fileCount: number;
  /** 全部文件的 UTF-8 字节数之和 */
  totalBytes: number;
  /** `owner/repo`(代码常量 shared/source-repo.ts) */
  repo: string;
  /** `https://github.com/<owner>/<repo>` */
  repoUrl: string;
}

export interface SourceFileEntry {
  /** 仓库根相对路径,如 `apps/api/agent/tools.ts` */
  path: string;
  /** 由扩展名派生的闭集;前端据此选渲染方式(markdown 渲染 / 代码带行号) */
  kind: SourceFileKind;
  bytes: number;
  lines: number;
}

export interface GetSourceResponse {
  snapshot: SourceSnapshotInfo;
  /** 全部文件元信息(不含内容),按路径码点序;目录树由前端从路径长出来 */
  files: SourceFileEntry[];
}

function info(s: store.SnapshotRow): SourceSnapshotInfo {
  return {
    sha: s.sha,
    shortSha: shortSha(s.sha),
    publishedAt: toIso(s.publishedAt),
    fileCount: s.fileCount,
    totalBytes: s.totalBytes,
    repo: SOURCE_REPO,
    repoUrl: SOURCE_REPO_URL,
  };
}

export const getSource = api(
  {
    expose: true,
    method: "GET", path: "/source",
    // 【R-VISITOR】访客 cookie 的 Path 是 `/`,浏览器**直接访问这条路径时会把它一并带来**
    // (哪怕本端点根本不看它)。不设 sensitive 的话,一个可冒充身份的凭据会进 trace。
    // 口径见 shared/visitor-cookie.ts 的「Path=/ 的连带义务」与 docs/security.md §6。
    sensitive: true,
  },

  async (): Promise<GetSourceResponse> => {
    const snap = await store.indexSnapshot();
    // 没有 current 快照(首次发版 compose up 之后、source-publish 之前的几分钟)→ 404,前端走 2k-B
    if (!snap) throw APIError.notFound("还没有发布过源码快照");
    return { snapshot: info(snap.snapshot), files: snap.files };
  },
);

export interface GetSourceFileRequest {
  /** 仓库根相对路径;形状不合法回 invalid_argument,不存在回 not_found(前端都当 404) */
  path: Query<string>;
}

export interface GetSourceFileResponse {
  snapshot: SourceSnapshotInfo;
  path: string;
  kind: SourceFileKind;
  /** 原文。前端当纯文本处理,永不执行 */
  content: string;
  bytes: number;
  lines: number;
}

export const getSourceFile = api(
  {
    expose: true,
    method: "GET", path: "/source/file",
    // 同上:访客 cookie 会随浏览器直接访问一并带来,不设 sensitive 会进 trace
    sensitive: true,
  },

  async ({ path }: GetSourceFileRequest): Promise<GetSourceFileResponse> => {
    // 参数走占位符,这里挡的是"脏 path 打到库上做无谓查询"与错误信息里的回显
    const reason = checkSourcePath(path);
    if (reason) throw APIError.invalidArgument("path 不合法");
    const snap = await store.fileSnapshot(path);
    if (!snap) throw APIError.notFound("没有这个文件");
    const { snapshot, file } = snap;
    return {
      snapshot: info(snapshot),
      path: file.path,
      kind: file.kind,
      content: file.content,
      bytes: file.bytes,
      lines: file.lines,
    };
  },
);
