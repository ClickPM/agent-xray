// R5:教程库查询端点(设计稿画板 2a 首页 / 2b 系列目录 / 2c 文章阅读)。
// 正文以标准 markdown 返回,渲染在前端(所有者裁定 2026-08-31 决策 2)。
import { api, APIError } from "encore.dev/api";
import * as store from "./store";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

const toIso = (ms: number) => new Date(ms).toISOString();
const toIsoOrNull = (ms: number | null) => (ms === null ? null : toIso(ms));

function assertSlug(name: string, value: string): void {
  // 参数全部走占位符,这里挡的是"脏 slug 打到库上做无谓查询"与错误信息里的回显
  if (!SLUG_RE.test(value)) throw APIError.invalidArgument(`${name} 不是合法 slug`);
}

// ───────────────────── 首页:分类 × 系列卡 ─────────────────────

export interface SeriesCard {
  slug: string;
  name: string;
  description: string;
  chapterCount: number;
  /** ISO 8601;空系列为 null(前端显示"整理中") */
  updatedAt: string | null;
}

export interface CategoryGroup {
  slug: string;
  name: string;
  /** 分类圆点色,与 design token 一致 */
  dot: string;
  series: SeriesCard[];
}

export interface LatestItem {
  title: string;
  seriesSlug: string;
  chapterSlug: string;
  updatedAt: string;
}

export interface ListSeriesResponse {
  categories: CategoryGroup[];
  /** 首页底部「最新 · …」行 */
  latest: LatestItem[];
}

export const listSeries = api(
  {
    expose: true,
    method: "GET", path: "/notes/series",
    // 【R-VISITOR】访客 cookie 的 Path 是 `/`,浏览器**直接访问这条路径时会把它一并带来**
    // (哪怕本端点根本不看它)。不设 sensitive 的话,一个可冒充身份的凭据会进 trace。
    // 口径见 shared/visitor-cookie.ts 的「Path=/ 的连带义务」与 docs/security.md §6。
    sensitive: true,
  },

  async (): Promise<ListSeriesResponse> => {
    const rows = await store.listSeriesCards();
    const groups: CategoryGroup[] = [];
    for (const r of rows) {
      let g = groups.find((x) => x.slug === r.categorySlug);
      if (!g) groups.push((g = { slug: r.categorySlug, name: r.categoryName, dot: r.dot, series: [] }));
      g.series.push({
        slug: r.slug,
        name: r.name,
        description: r.description,
        chapterCount: r.chapterCount,
        updatedAt: toIsoOrNull(r.updatedAt),
      });
    }
    const latest = await store.listLatest(3);
    return {
      categories: groups,
      latest: latest.map((l) => ({
        title: l.title,
        seriesSlug: l.seriesSlug,
        chapterSlug: l.chapterSlug,
        updatedAt: toIso(l.updatedAt),
      })),
    };
  },
);

// ───────────────────── 系列目录 ─────────────────────

export interface ChapterSummary {
  slug: string;
  label: string;
  title: string;
  /** 置顶行(README) */
  pinned: boolean;
  wordCount: number;
  updatedAt: string;
}

export interface GetSeriesResponse {
  slug: string;
  name: string;
  description: string;
  categorySlug: string;
  categoryName: string;
  chapterCount: number;
  wordCount: number;
  updatedAt: string | null;
  chapters: ChapterSummary[];
}

export const getSeries = api(
  {
    expose: true,
    method: "GET", path: "/notes/series/:slug",
    // 【R-VISITOR】访客 cookie 的 Path 是 `/`,浏览器**直接访问这条路径时会把它一并带来**
    // (哪怕本端点根本不看它)。不设 sensitive 的话,一个可冒充身份的凭据会进 trace。
    // 口径见 shared/visitor-cookie.ts 的「Path=/ 的连带义务」与 docs/security.md §6。
    sensitive: true,
  },

  async ({ slug }: { slug: string }): Promise<GetSeriesResponse> => {
    assertSlug("slug", slug);
    const series = await store.getSeries(slug);
    if (!series) throw APIError.notFound(`系列 ${slug} 不存在`);

    const chapters = await store.listChapters(slug);
    return {
      ...series,
      chapterCount: chapters.filter((c) => !c.pinned).length,
      wordCount: chapters.reduce((a, c) => a + c.wordCount, 0),
      updatedAt: chapters.length ? toIso(Math.max(...chapters.map((c) => c.updatedAt))) : null,
      chapters: chapters.map((c) => ({
        slug: c.slug,
        label: c.label,
        title: c.title,
        pinned: c.pinned,
        wordCount: c.wordCount,
        updatedAt: toIso(c.updatedAt),
      })),
    };
  },
);

// ───────────────────── 文章正文 ─────────────────────

export interface ChapterLink {
  slug: string;
  label: string;
  title: string;
}

export interface GetChapterResponse {
  seriesSlug: string;
  seriesName: string;
  categorySlug: string;
  categoryName: string;
  slug: string;
  label: string;
  title: string;
  /** 标准 markdown(GFM);渲染在前端 */
  contentMd: string;
  wordCount: number;
  /** 第三方文章原链;自有内容为 null */
  sourceUrl: string | null;
  publishedAt: string | null;
  updatedAt: string;
  prev: ChapterLink | null;
  next: ChapterLink | null;
}

export const getChapter = api(
  {
    expose: true,
    method: "GET", path: "/notes/series/:series/chapters/:chapter",
    // 【R-VISITOR】访客 cookie 的 Path 是 `/`,浏览器**直接访问这条路径时会把它一并带来**
    // (哪怕本端点根本不看它)。不设 sensitive 的话,一个可冒充身份的凭据会进 trace。
    // 口径见 shared/visitor-cookie.ts 的「Path=/ 的连带义务」与 docs/security.md §6。
    sensitive: true,
  },

  async ({ series, chapter }: { series: string; chapter: string }): Promise<GetChapterResponse> => {
    assertSlug("series", series);
    assertSlug("chapter", chapter);

    const meta = await store.getSeries(series);
    if (!meta) throw APIError.notFound(`系列 ${series} 不存在`);
    const row = await store.getChapter(series, chapter);
    if (!row) throw APIError.notFound(`章节 ${series}/${chapter} 不存在`);

    const [prev, next] = await Promise.all([
      store.getNeighbor(series, row.ordinal, -1),
      store.getNeighbor(series, row.ordinal, 1),
    ]);

    return {
      seriesSlug: meta.slug,
      seriesName: meta.name,
      categorySlug: meta.categorySlug,
      categoryName: meta.categoryName,
      slug: row.slug,
      label: row.label,
      title: row.title,
      contentMd: row.contentMd,
      wordCount: row.wordCount,
      sourceUrl: row.sourceUrl,
      publishedAt: toIsoOrNull(row.publishedAt),
      updatedAt: toIso(row.updatedAt),
      prev,
      next,
    };
  },
);
