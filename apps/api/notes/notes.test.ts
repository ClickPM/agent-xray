// R5 notes 服务测试:查询端点的分组/排序/边界,以及 RSS 文档生成。
// 内容写入不在本服务里(R6 起由 mcp 管理面写),所以这里的夹具直接写库。
// 经 `dev.ps1 test` 运行(CLAUDE.md 规则 2)。
import { beforeEach, describe, expect, it } from "vitest";
import { APIError, ErrCode } from "encore.dev/api";
import { db } from "./db";
import { getChapter, getSeries, listSeries } from "./series";
import { renderFeed } from "./rss";
import type { CategoryRow, FeedRow } from "./store";

const T0 = Date.UTC(2026, 7, 20, 0, 0, 0);
const day = 86_400_000;

beforeEach(async () => {
  // 外键顺序:章节 → 系列 → 分类
  await db.exec`DELETE FROM notes_chapters`;
  await db.exec`DELETE FROM notes_series`;
  await db.exec`DELETE FROM notes_categories`;
});

async function seedCategory(slug: string, name: string, sort: number, dot = "#2563eb") {
  await db.exec`
    INSERT INTO notes_categories (slug, name, dot, sort_order)
    VALUES (${slug}, ${name}, ${dot}, ${sort})`;
}

async function seedSeries(slug: string, category: string, name: string, sort = 1, desc = "") {
  await db.exec`
    INSERT INTO notes_series (slug, category_slug, name, description, sort_order)
    VALUES (${slug}, ${category}, ${name}, ${desc}, ${sort})`;
}

async function seedChapter(opts: {
  series: string;
  slug: string;
  ordinal: number;
  label: string;
  title: string;
  pinned?: boolean;
  words?: number;
  updatedAt?: number;
  sourceUrl?: string | null;
  md?: string;
}) {
  const updated = new Date(opts.updatedAt ?? T0).toISOString();
  await db.exec`
    INSERT INTO notes_chapters
      (series_slug, slug, ordinal, label, pinned, title, summary, content_md, word_count,
       source_url, content_hash, published_at, updated_at)
    VALUES (${opts.series}, ${opts.slug}, ${opts.ordinal}, ${opts.label}, ${opts.pinned ?? false},
            ${opts.title}, ${"摘要"}, ${opts.md ?? "正文"}, ${opts.words ?? 400},
            ${opts.sourceUrl ?? null}, ${`h-${opts.series}-${opts.slug}`},
            NULL, ${updated}::timestamptz)`;
}

/** 端点抛的是 APIError;取它的 code 做断言,避免比对文案 */
async function codeOf(p: Promise<unknown>): Promise<ErrCode | "no-error"> {
  try {
    await p;
    return "no-error";
  } catch (err) {
    if (err instanceof APIError) return err.code;
    throw err;
  }
}

describe("GET /notes/series", () => {
  it("按分类分组、组内按 sort_order,空系列计 0 且 updatedAt 为 null", async () => {
    await seedCategory("pm", "产品经理", 1);
    await seedCategory("deep-dive", "源码拆解", 2, "#16a34a");
    await seedSeries("agent-basics", "pm", "Agent 基础知识", 1);
    await seedSeries("sharing", "pm", "内容分享", 3);
    await seedSeries("pi", "deep-dive", "Pi", 1);
    await seedChapter({ series: "agent-basics", slug: "01", ordinal: 1, label: "01", title: "A", updatedAt: T0 });
    await seedChapter({ series: "pi", slug: "01", ordinal: 1, label: "01", title: "B", updatedAt: T0 + day });

    const res = await listSeries();
    expect(res.categories.map((c) => c.slug)).toEqual(["pm", "deep-dive"]);
    expect(res.categories[0].series.map((s) => s.slug)).toEqual(["agent-basics", "sharing"]);
    expect(res.categories[1].dot).toBe("#16a34a");

    // 内容分享本轮不同步:必须以 0 章 + null 时间出现,页面据此走"整理中"占位态
    const sharing = res.categories[0].series.find((s) => s.slug === "sharing")!;
    expect(sharing.chapterCount).toBe(0);
    expect(sharing.updatedAt).toBeNull();
  });

  it("章节数与系列页同口径:不含置顶的 README(codex review 2026-08-31 P2)", async () => {
    await seedCategory("deep-dive", "源码拆解", 2);
    await seedSeries("pi", "deep-dive", "Pi");
    await seedChapter({ series: "pi", slug: "readme", ordinal: 0, label: "README", title: "总览", pinned: true });
    await seedChapter({ series: "pi", slug: "01", ordinal: 1, label: "01", title: "第1章" });
    await seedChapter({ series: "pi", slug: "02", ordinal: 2, label: "02", title: "第2章" });

    const home = await listSeries();
    const card = home.categories[0].series[0];
    const detail = await getSeries({ slug: "pi" });
    // 两个页面显示同一个系列时给出不同的章数,是最容易被当成"数据坏了"的那种 bug
    expect(card.chapterCount).toBe(detail.chapterCount);
    expect(card.chapterCount).toBe(2);
  });

  it("latest 取最近更新的 3 条,按时间倒序", async () => {
    await seedCategory("pm", "产品经理", 1);
    await seedSeries("agent-basics", "pm", "Agent 基础知识");
    for (let i = 0; i < 4; i++) {
      await seedChapter({
        series: "agent-basics", slug: `0${i + 1}`, ordinal: i + 1, label: `0${i + 1}`,
        title: `第${i + 1}篇`, updatedAt: T0 + i * day,
      });
    }
    const res = await listSeries();
    expect(res.latest.map((l) => l.title)).toEqual(["第4篇", "第3篇", "第2篇"]);
  });
});

describe("GET /notes/series/:slug", () => {
  beforeEach(async () => {
    await seedCategory("deep-dive", "源码拆解", 2);
    await seedSeries("pi", "deep-dive", "Pi", 1, "最小可懂的 agent 内核");
    await seedChapter({ series: "pi", slug: "readme", ordinal: 0, label: "README", title: "总览", pinned: true, words: 100 });
    await seedChapter({ series: "pi", slug: "02", ordinal: 2, label: "02", title: "第2章", words: 1000 });
    await seedChapter({ series: "pi", slug: "01", ordinal: 1, label: "01", title: "第1章", words: 900 });
  });

  it("章节按 ordinal 有序,置顶行不计入章数,字数求和", async () => {
    const res = await getSeries({ slug: "pi" });
    expect(res.chapters.map((c) => c.slug)).toEqual(["readme", "01", "02"]);
    expect(res.chapters[0].pinned).toBe(true);
    // README 是置顶总览,不算"第 N 章"
    expect(res.chapterCount).toBe(2);
    expect(res.wordCount).toBe(2000);
    expect(res.categoryName).toBe("源码拆解");
  });

  it("不存在的系列 404,脏 slug 400", async () => {
    expect(await codeOf(getSeries({ slug: "nope" }))).toBe(ErrCode.NotFound);
    expect(await codeOf(getSeries({ slug: "../etc" }))).toBe(ErrCode.InvalidArgument);
    expect(await codeOf(getSeries({ slug: "" }))).toBe(ErrCode.InvalidArgument);
  });
});

describe("GET /notes/series/:series/chapters/:chapter", () => {
  beforeEach(async () => {
    await seedCategory("deep-dive", "源码拆解", 2);
    await seedSeries("pi", "deep-dive", "Pi");
    await seedChapter({ series: "pi", slug: "readme", ordinal: 0, label: "README", title: "总览", pinned: true });
    await seedChapter({ series: "pi", slug: "01", ordinal: 1, label: "01", title: "第1章" });
    await seedChapter({
      series: "pi", slug: "02", ordinal: 2, label: "02", title: "第2章",
      sourceUrl: "https://example.com/a", md: "# 标题\n\n正文",
    });
  });

  it("返回正文与上下章;首尾两端为 null", async () => {
    const mid = await getChapter({ series: "pi", chapter: "01" });
    expect(mid.prev?.slug).toBe("readme");
    expect(mid.next?.slug).toBe("02");

    const first = await getChapter({ series: "pi", chapter: "readme" });
    expect(first.prev).toBeNull();

    const last = await getChapter({ series: "pi", chapter: "02" });
    expect(last.next).toBeNull();
    expect(last.contentMd).toContain("正文");
    // 所有者裁定 4.2:第三方文章的原链必须随正文一起返回
    expect(last.sourceUrl).toBe("https://example.com/a");
  });

  it("系列存在但章节不存在 → 404;脏参数 → 400", async () => {
    expect(await codeOf(getChapter({ series: "pi", chapter: "99" }))).toBe(ErrCode.NotFound);
    expect(await codeOf(getChapter({ series: "nope", chapter: "01" }))).toBe(ErrCode.NotFound);
    expect(await codeOf(getChapter({ series: "pi", chapter: "a/b" }))).toBe(ErrCode.InvalidArgument);
  });
});

describe("RSS", () => {
  const rows: FeedRow[] = [
    {
      title: "第1章 <A> & \"B\"", summary: "摘要 & 说明", seriesSlug: "pi", seriesName: "Pi",
      chapterSlug: "01", updatedAt: T0 + day,
    },
    {
      title: "AI 技术博客索引", summary: "", seriesSlug: "ai-blog-index", seriesName: "AI 技术博客索引",
      chapterSlug: "01", updatedAt: T0,
    },
  ];

  it("全站源:自链、条目数、XML 转义、lastBuildDate 取最新条目", () => {
    const xml = renderFeed("https://agent-xray.dev", null, rows);
    expect(xml).toContain('<atom:link href="https://agent-xray.dev/rss.xml" rel="self"');
    expect((xml.match(/<item>/g) ?? []).length).toBe(2);
    expect(xml).toContain("&lt;A&gt; &amp; &quot;B&quot;");
    // 未转义的裸 & / < / > 会让阅读器直接判文档非法。
    // 做法:把所有合法实体先摘掉,元素内容里就不该再剩这三个字符。
    const inner = [...xml.matchAll(/<(title|description|link)>([\s\S]*?)<\/\1>/g)]
      .map((m) => m[2].replace(/&(amp|lt|gt|quot|apos);/g, ""))
      .join(" ");
    expect(inner).not.toMatch(/[<>&]/);
    expect(xml).toContain(`<lastBuildDate>${new Date(T0 + day).toUTCString()}</lastBuildDate>`);
    expect(xml).toContain("<link>https://agent-xray.dev/notes/pi/01</link>");
  });

  it("系列名与标题相同的单篇系列不重复拼接", () => {
    const xml = renderFeed("https://agent-xray.dev", null, rows);
    expect(xml).toContain("<title>AI 技术博客索引</title>");
    expect(xml).not.toContain("AI 技术博客索引 · AI 技术博客索引");
  });

  it("分类源:标题带分类名,自链指向分类地址", () => {
    const cat: CategoryRow = { slug: "pm", name: "产品经理" };
    const xml = renderFeed("https://agent-xray.dev", cat, []);
    expect(xml).toContain("<title>Agent X-Ray · 产品经理</title>");
    expect(xml).toContain('href="https://agent-xray.dev/rss/pm.xml"');
    expect(xml).not.toContain("<item>");
  });
});
