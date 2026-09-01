// R8:About 页内容查询端点(设计稿画板 2e)。
//
// 内容由所有者经 **MCP 管理面**的 `about_set` 维护(`apps/api/mcp/`);
// 本服务只读,前端 `apps/web/app/(site)/about/page.tsx` 是 Server Component,
// 经生成客户端调用这里 —— About 页在 R8 之前是 `demo-data.ts` 的硬编码。
import { api } from "encore.dev/api";
import * as store from "./store";
import type { LangSlice, RepoCard } from "./store";

export interface GetAboutResponse {
  /** GitHub 用户名;头像取 https://github.com/<user>.png,空字符串 = 未配置 */
  githubUser: string;
  /** 第二条外链(画板 2e 的 GitHub 按钮旁);空字符串 = 不渲染那个按钮 */
  originUrl: string;
  intro: string;
  /** 「本站如何构建」逐条 */
  buildPoints: string[];
  /** 「公开仓库」卡片 */
  repos: RepoCard[];
  /** 底部语言构成条 */
  langBar: LangSlice[];
  /** ISO 8601;从未设置过时为 null */
  updatedAt: string | null;
}

export const get = api(
  { expose: true, method: "GET", path: "/about" },
  async (): Promise<GetAboutResponse> => {
    const a = await store.getAbout();
    return { ...a, updatedAt: a.updatedAt === null ? null : new Date(a.updatedAt).toISOString() };
  },
);
