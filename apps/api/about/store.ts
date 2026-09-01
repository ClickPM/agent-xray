// About 页内容的**只读**读取(R8)。
//
// 写面在 mcp 服务的 `about_set`(全权 DB 角色),读面在这里 ——
// 与 notes(读)/ mcp(写)、trace(读)/ agent(写)是同一个分工
// (`docs/security.md` §4「两个面互不触碰」)。本服务不建表、不加迁移、不写库。
import { db } from "./db";

export interface RepoCard {
  name: string;
  lang: string;
  /** 语言圆点色,#RRGGBB */
  dot: string;
  stars: number;
  desc: string;
  /** 最近推送日期的展示文本(画板 2e 右下角) */
  pushed: string;
}

export interface LangSlice {
  name: string;
  /** 语言条占比,0–100 */
  pct: number;
  color: string;
}

export interface AboutRow {
  githubUser: string;
  originUrl: string;
  intro: string;
  buildPoints: string[];
  repos: RepoCard[];
  langBar: LangSlice[];
  /** epoch ms;从未设置过时为 null */
  updatedAt: number | null;
}

const EMPTY: AboutRow = {
  githubUser: "",
  originUrl: "",
  intro: "",
  buildPoints: [],
  repos: [],
  langBar: [],
  updatedAt: null,
};

/** JSONB 列在驱动侧已是 JS 值;不是数组(手工改库改坏了)就当空 —— 不让页面炸。 */
function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/**
 * 单行表,没有行 = 所有者还没经 MCP 写过内容(新环境的正常状态)。
 * 回全空而不是 404:About 页此时渲染成一个「什么都还没填」的空页,
 * 而不是让整个 Tab 变成错误页。
 */
export async function getAbout(): Promise<AboutRow> {
  const row = await db.rawQueryRow<AboutRow>(
    `SELECT github_user AS "githubUser", origin_url AS "originUrl", intro,
            build_points AS "buildPoints", repos, lang_bar AS "langBar",
            (extract(epoch FROM updated_at) * 1000)::double precision AS "updatedAt"
       FROM about_content WHERE id`,
  );
  if (!row) return EMPTY;
  return {
    ...row,
    buildPoints: asArray<string>(row.buildPoints),
    repos: asArray<RepoCard>(row.repos),
    langBar: asArray<LangSlice>(row.langBar),
  };
}
