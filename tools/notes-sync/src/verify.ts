// 同步后的自检(`--verify`)。
//
// 为什么不用几条 SQL LIKE 了事:实测那样几乎全是误报 —— Rust 教程里的 `[[bin]]`
// 是 Cargo 的 TOML 语法、bash 的 `[[ -n $X ]]` 是条件测试、讲 HTML 的文章正文里
// 有行内代码 `<table>`,它们都长得像"没改干净的 Obsidian 语法"。判据必须和改写器
// 一致:**只看代码围栏与行内代码之外的部分**。
//
// 误报的代价不是多看两眼,是让这条检查变成狼来了 —— 每轮都红,下次就没人看了。

import { Client } from "pg";

export interface Check {
  name: string;
  detail: string;
  ok: boolean;
}

interface ChapterRow {
  series_slug: string;
  slug: string;
  source_path: string;
  content_md: string;
  source_url: string | null;
}

/** 把正文里的围栏块与行内代码剔掉,只留"会被当成 markdown 语法解析"的部分 */
export function proseOnly(md: string): string {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of md.split(/\r?\n/)) {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (f && line.trimStart().startsWith(fence)) fence = null;
      continue;
    }
    if (f) {
      fence = f[1];
      continue;
    }
    out.push(line.replace(/`+[^`]*`+/g, ""));
  }
  return out.join("\n");
}

export function checkChapters(rows: ChapterRow[]): Check[] {
  const wikilink: string[] = [];
  const callout: string[] = [];
  const comment: string[] = [];
  const rawHtml: string[] = [];
  const rawLinks: string[] = [];
  const frontmatter: string[] = [];

  for (const r of rows) {
    const id = `${r.series_slug}/${r.slug}`;
    const prose = proseOnly(r.content_md);
    if (/\[\[[^\]]*\]\]/.test(prose)) wikilink.push(id);
    if (/^\s*>\s*\[!/m.test(prose)) callout.push(id);
    if (/%%/.test(prose)) comment.push(id);
    if (
      /<\/?(a|div|span|img|table|thead|tbody|tr|td|th|script|style|iframe|form|input|button|section|article|figure|video|audio|object|embed|link|meta|details|summary|br)\b[^<>]*>/i.test(
        prose,
      )
    ) {
      rawHtml.push(id);
    }
    // 所有者裁定 4.3:抓取素材无授权,任何指向 原始资料/ 的**链接**都不许生成
    // (降级后留在正文里的纯文本"原始资料"字样不算)
    if (/\[[^\]]*\]\([^)]*原始资料[^)]*\)/.test(r.content_md)) rawLinks.push(id);
    // frontmatter 应在同步阶段剥掉(裁定 4.1)
    if (/^\s*(---\s*\n)?(title|tags|date|wiki_exclude):/.test(r.content_md)) frontmatter.push(id);
  }

  const list = (xs: string[]) => (xs.length ? `${xs.length} 处: ${xs.slice(0, 5).join(", ")}` : "0");

  return [
    { name: "wikilink 已全部改写", detail: list(wikilink), ok: wikilink.length === 0 },
    { name: "callout 已全部改写", detail: list(callout), ok: callout.length === 0 },
    { name: "Obsidian 注释已清除", detail: list(comment), ok: comment.length === 0 },
    { name: "围栏外无裸 HTML", detail: list(rawHtml), ok: rawHtml.length === 0 },
    { name: "无指向原始资料的链接", detail: list(rawLinks), ok: rawLinks.length === 0 },
    { name: "frontmatter 未入正文", detail: list(frontmatter), ok: frontmatter.length === 0 },
  ];
}

export function checkBoundary(rows: ChapterRow[]): Check[] {
  const sharing = rows.filter((r) => r.series_slug === "sharing");
  const originals = rows.filter(
    (r) => /-Original-/.test(r.source_path) || /原文/.test(r.source_path.split("/").pop() ?? ""),
  );
  const archiveWithSource = rows.filter((r) => r.series_slug === "ai-blog-archive" && r.source_url);
  const archiveTotal = rows.filter((r) => r.series_slug === "ai-blog-archive").length;

  return [
    { name: "内容分享未同步", detail: `${sharing.length} 章`, ok: sharing.length === 0 },
    { name: "英文原文未入库", detail: `${originals.length} 章`, ok: originals.length === 0 },
    {
      name: "档案文章保留 source 原链",
      detail: `${archiveWithSource.length}/${archiveTotal}`,
      // 少数中文原创汇总本就没有 source,所以看覆盖率而不是要求全有
      ok: archiveTotal === 0 || archiveWithSource.length / archiveTotal >= 0.9,
    },
  ];
}

export async function verify(dsn: string): Promise<boolean> {
  const client = new Client({ connectionString: dsn });
  await client.connect();
  try {
    const { rows } = await client.query<ChapterRow>(
      "SELECT series_slug, slug, source_path, content_md, source_url FROM notes_chapters",
    );
    const checks = [...checkChapters(rows), ...checkBoundary(rows)];
    console.log(`\n自检   : ${rows.length} 章`);
    for (const c of checks) {
      console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name.padEnd(24)} ${c.detail}`);
    }
    return checks.every((c) => c.ok);
  } finally {
    await client.end();
  }
}
