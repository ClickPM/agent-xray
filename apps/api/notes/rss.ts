// R5:RSS 生成 —— 全站 `/rss.xml` + 四分类 `/rss/<category>.xml`
// (设计稿画板 2d 的订阅弹层列的就是这 5 条地址)。
//
// 用 api.raw 而不是类型化端点:要出的是 application/rss+xml 原文,不是 JSON。
import { api } from "encore.dev/api";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as store from "./store";

/** 一条源里最多带多少条目;RSS 阅读器普遍只看最近若干条 */
const FEED_LIMIT = 30;

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const siteFeed = api.raw(
  { expose: true, method: "GET", path: "/rss.xml" },
  async (req, resp) => {
    await writeFeed(req, resp, null);
  },
);

export const categoryFeed = api.raw(
  { expose: true, method: "GET", path: "/rss/:file" },
  async (req, resp) => {
    // Encore 的路径参数不能带 `.xml` 后缀(段内混字面量),所以整段拿下来自己剥。
    // 设计稿定的地址就是 /rss/pm.xml,不改成 /rss/pm。
    const url = new URL(req.url ?? "/", "http://localhost");
    const file = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    if (!file.endsWith(".xml")) {
      notFound(resp, "订阅源地址形如 /rss/<category>.xml");
      return;
    }
    const slug = file.slice(0, -4);
    if (!SLUG_RE.test(slug)) {
      notFound(resp, "分类不存在");
      return;
    }
    const category = await store.getCategory(slug);
    if (!category) {
      notFound(resp, `分类 ${slug} 不存在`);
      return;
    }
    await writeFeed(req, resp, category);
  },
);

async function writeFeed(
  req: IncomingMessage,
  resp: ServerResponse,
  category: store.CategoryRow | null,
): Promise<void> {
  const rows = await store.listFeed(category?.slug ?? null, FEED_LIMIT);
  resp.writeHead(200, {
    "Content-Type": "application/rss+xml; charset=utf-8",
    "Cache-Control": "public, max-age=900",
  });
  resp.end(renderFeed(siteOrigin(req), category, rows));
}

/**
 * RSS 2.0 文档生成。做成纯函数是为了可测:raw 端点那层只剩取数与写响应头。
 */
export function renderFeed(
  origin: string,
  category: store.CategoryRow | null,
  rows: store.FeedRow[],
): string {
  const selfPath = category ? `/rss/${category.slug}.xml` : "/rss.xml";
  const title = category ? `Agent X-Ray · ${category.name}` : "Agent X-Ray · 研习笔记";
  const desc = category
    ? `Agent X-Ray Notes ${category.name} 分类更新`
    : "从产品视角到源码拆解的 harness 工程研习库";

  const items = rows
    .map((r) => {
      const link = `${origin}/notes/${r.seriesSlug}/${r.chapterSlug}`;
      // 单篇系列(研究报告 / 索引)的系列名与章节标题是同一句,拼起来会变成
      // 「AI 技术博客索引 · AI 技术博客索引」
      const itemTitle = r.title === r.seriesName ? r.title : `${r.seriesName} · ${r.title}`;
      return [
        "    <item>",
        `      <title>${esc(itemTitle)}</title>`,
        `      <link>${esc(link)}</link>`,
        `      <guid isPermaLink="true">${esc(link)}</guid>`,
        `      <pubDate>${new Date(r.updatedAt).toUTCString()}</pubDate>`,
        `      <description>${esc(r.summary)}</description>`,
        "    </item>",
      ].join("\n");
    })
    .join("\n");

  // lastBuildDate 取最新条目的时间而不是 now():同样内容重复请求应得到同样的文档,
  // 否则每次拉取都像"有更新",阅读器与缓存都会被误导。
  const lastBuild = rows.length ? new Date(rows[0].updatedAt) : new Date(0);

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(title)}</title>
    <link>${esc(`${origin}/notes`)}</link>
    <description>${esc(desc)}</description>
    <language>zh-CN</language>
    <lastBuildDate>${lastBuild.toUTCString()}</lastBuildDate>
    <atom:link href="${esc(origin + selfPath)}" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`;
}

function notFound(resp: ServerResponse, message: string): void {
  resp.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
  resp.end(JSON.stringify({ error: message }));
}

/**
 * 条目链接必须是绝对地址。优先取部署时配置的 SITE_ORIGIN;没配才回落到请求头
 * (本机开发方便),最后兜底设计稿里的域名。
 * 不无条件信任 Host:那样别人换个 Host 头就能让源里的链接指向任意站点。
 */
function siteOrigin(req: IncomingMessage): string {
  const configured = process.env.SITE_ORIGIN?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const host = req.headers.host;
  if (host && /^[A-Za-z0-9.\-:[\]]+$/.test(host)) {
    const proto = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
    return `${proto}://${host}`;
  }
  return "https://agent-xray.dev";
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
