// notes-sync CLI —— vault `学习分享/` → notes_* 表。
//
// 用法(经 dev.ps1,它会把 encore 的 env 与库连接串备好;多余参数原样直传本文件):
//   .\dev.ps1 notes                     同步进本机 encore Postgres,末尾自检
//   .\dev.ps1 notes --dry-run           只解析+改写,不写库不写图,打报告
//   .\dev.ps1 notes --dry-run --dump-dir <目录>   把改写后的正文落盘,人工抽查
//   .\dev.ps1 notes --emit-sql <文件>    产出可传输 SQL(预发/生产投递用)
//   .\dev.ps1 notes --verify            只对已入库内容跑自检
//
// 操作规程见 .claude/skills/sync-notes/SKILL.md。

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

import { CATEGORIES, DATE_DESC_SERIES, SERIES, type ChapterFile, type SeriesSpec } from "./manifest.ts";
import { emptyReport, rewrite, type LinkTarget, type RewriteContext, type RewriteReport } from "./obsidian.ts";
import { ImagePipeline } from "./images.ts";
import { applyToDatabase, emitSql, type ChapterRow, type Desired, type SeriesRow } from "./db.ts";
import { verify } from "./verify.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DEFAULT_PUBLIC_DIR = join(REPO_ROOT, "apps", "web", "public", "notes");

interface Args {
  vault: string;
  dsn?: string;
  emitSql?: string;
  reportPath?: string;
  publicDir: string;
  dryRun: boolean;
  /** 把改写后的正文按 <系列>/<slug>.md 落盘,供人工抽查改写质量(不参与投递) */
  dumpDir?: string;
  /** 只对已入库内容跑自检,不读 vault、不写任何东西 */
  verifyOnly: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    vault: process.env.NOTES_VAULT ?? "",
    dsn: process.env.NOTES_DSN,
    publicDir: DEFAULT_PUBLIC_DIR,
    dryRun: false,
    verifyOnly: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) die(`${a} 缺少参数值`);
      return v;
    };
    switch (a) {
      case "--vault": args.vault = next(); break;
      case "--dsn": args.dsn = next(); break;
      case "--emit-sql": args.emitSql = next(); break;
      case "--report": args.reportPath = next(); break;
      case "--public-dir": args.publicDir = next(); break;
      case "--dump-dir": args.dumpDir = next(); break;
      case "--dry-run": args.dryRun = true; break;
      case "--verify": args.verifyOnly = true; break;
      default: die(`未知参数 ${a}`);
    }
  }
  if (args.verifyOnly) {
    if (!args.dsn) die("--verify 需要 --dsn:自检读的是已入库内容");
    return args;
  }
  if (!args.vault) die("必须指定 --vault(或设 NOTES_VAULT):指向 vault 里的 学习分享 目录");
  if (!existsSync(args.vault)) die(`vault 目录不存在: ${args.vault}`);
  if (!args.dryRun && !args.dsn && !args.emitSql) {
    die("必须给出 --dsn 或 --emit-sql 之一(只想看报告用 --dry-run)");
  }
  return args;
}

function die(msg: string): never {
  console.error(`错误: ${msg}`);
  process.exit(1);
}

// ───────────────────── vault 读取 ─────────────────────

interface Loaded {
  spec: SeriesSpec;
  file: ChapterFile;
  /** vault 相对路径,用 / 分隔;溯源与链接解析都用它 */
  relPath: string;
  data: Record<string, unknown>;
  body: string;
}

function loadAll(vault: string): Loaded[] {
  const out: Loaded[] = [];
  const seen = new Map<string, string>();
  for (const spec of SERIES) {
    for (const file of spec.collect(vault)) {
      if (!existsSync(file.path)) die(`manifest 指向的文件不存在: ${file.path}(vault 结构变了?先修 manifest)`);
      // slug 是业务唯一键。重复的后果是 upsert 时后者覆盖前者 —— 少一章而不报错,
      // 只能靠数数发现。宁可在这里停下。
      const key = `${spec.slug}/${file.slug}`;
      const dup = seen.get(key);
      if (dup) die(`章节 slug 重复: ${key}\n  ${dup}\n  ${file.path}`);
      seen.set(key, file.path);
      const raw = readFileSync(file.path, "utf8");
      const parsed = matter(raw);
      out.push({
        spec,
        file,
        relPath: relative(vault, file.path).split("\\").join("/"),
        data: parsed.data as Record<string, unknown>,
        body: parsed.content,
      });
    }
  }
  return out;
}

// ───────────────────── 链接解析索引 ─────────────────────

class LinkIndex {
  private readonly byPath = new Map<string, LinkTarget>();
  private readonly byBaseInSeries = new Map<string, Map<string, LinkTarget>>();
  private readonly byBaseGlobal = new Map<string, LinkTarget[]>();

  constructor(loaded: Loaded[]) {
    for (const l of loaded) {
      const target: LinkTarget = { seriesSlug: l.spec.slug, chapterSlug: l.file.slug };
      const noExt = l.relPath.replace(/\.md$/i, "");
      this.byPath.set(noExt, target);

      const base = noExt.split("/").pop()!;
      let inSeries = this.byBaseInSeries.get(l.spec.slug);
      if (!inSeries) this.byBaseInSeries.set(l.spec.slug, (inSeries = new Map()));
      if (!inSeries.has(base)) inSeries.set(base, target);

      const list = this.byBaseGlobal.get(base);
      if (list) list.push(target);
      else this.byBaseGlobal.set(base, [target]);
    }
  }

  resolve(rawTarget: string, ctx: RewriteContext): LinkTarget | null {
    // 所有者裁定 4.3:原始资料是抓取素材,无授权 —— 任何情况下都不生成指向它的链接
    if (rawTarget.includes("原始资料")) return null;

    const t = rawTarget.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\.md$/i, "");
    // 1) vault 绝对路径(带不带 `学习分享/` 前缀都认)
    const abs = t.replace(/^学习分享\//, "");
    const byAbs = this.byPath.get(abs);
    if (byAbs) return byAbs;

    // 2) 相对当前文件目录
    const rel = normalizeRel(ctx.dir ? `${ctx.dir}/${t}` : t);
    const byRel = this.byPath.get(rel);
    if (byRel) return byRel;

    // 3) 同系列内的短名
    const base = t.split("/").pop()!;
    const inSeries = this.byBaseInSeries.get(ctx.seriesSlug)?.get(base);
    if (inSeries) return inSeries;

    // 4) 全站唯一的短名才认;重名(7 个系列都有 README-教程总览)一律不猜
    const global = this.byBaseGlobal.get(base);
    if (global && global.length === 1) return global[0];
    return null;
  }
}

/** 折叠 `a/b/../c` 与 `./`;越过根目录返回原样(必然解析失败,落到短名分支) */
function normalizeRel(p: string): string {
  const parts: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

// ───────────────────── 元数据抽取 ─────────────────────

/**
 * 正文首个 H1 既是标题来源,也要从正文里摘掉:文章页的 <h1> 由 title 字段单独渲染,
 * 留着会出现两行一样的大标题。
 *
 * 必须避开代码围栏:bash / toml 片段里的 `# 注释` 会被当成 H1(TypeScript 与 Rust
 * 教程里以围栏开篇的章节不止一处),那样标题会变成一句注释。
 */
function takeTitle(body: string, fallback: string, fm: Record<string, unknown>): { title: string; body: string } {
  const fmTitle = typeof fm.title === "string" ? fm.title.trim() : "";
  const lines = body.split(/\r?\n/);
  let offset = 0;
  for (const line of lines) {
    if (/^\s{0,3}(`{3,}|~{3,})/.test(line)) break; // 撞到围栏就不再往下找
    const m = /^\s{0,3}#\s+(.+?)\s*$/.exec(line);
    if (m) {
      const before = body.slice(0, offset).trim();
      const rest = before === "" ? body.slice(offset + line.length) : body;
      return { title: fmTitle || m[1].trim(), body: rest };
    }
    offset += line.length + 1;
  }
  return { title: fmTitle || fallback, body };
}

/**
 * 摘要 = 正文里第一个"像正文"的段落,压成 ≤120 字。RSS 的 description 用它。
 *
 * 挑段落要跳过的东西比想象中多:标题、引用、表格、图片,以及**分隔线** ——
 * 教程正文普遍以 `> 导语` + `---` 开头,只跳过引用的话摘要会变成一根 `---`
 * (实测 RSS 里整片 description 都是 `---`)。
 */
function makeSummary(md: string): string {
  const blocks = md.replace(/```[\s\S]*?```/g, "").split(/\n{2,}/);
  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;
    if (/^(#|>|\||!\[)/.test(block)) continue;
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(block)) continue;
    // 列表项可以当摘要,但要先把项目符号去掉
    const text = stripMarkdown(block.replace(/^\s*([-*+]|\d+\.)\s+/gm, ""))
      .replace(/\s+/g, " ")
      .trim();
    if (text.length < 8) continue;
    return text.length > 120 ? `${text.slice(0, 119)}…` : text;
  }
  return "";
}

function stripMarkdown(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/[*_~]{1,3}/g, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "");
}

/** 中文按字计、西文按词计;文章页「约 N 分钟」由前端按 400 字/分钟换算 */
function countWords(md: string): number {
  const text = stripMarkdown(md);
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z0-9]+/g) ?? []).length;
  return cjk + latin;
}

function frontmatterDate(fm: Record<string, unknown>): string | null {
  const v = fm.date ?? fm.created ?? fm.published;
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function frontmatterSource(fm: Record<string, unknown>): string | null {
  const v = fm.source;
  return typeof v === "string" && /^https?:\/\//i.test(v.trim()) ? v.trim() : null;
}

/**
 * 每个文件在 vault git 里的最近提交时间。一次 git log 建全表,
 * 逐文件调 git 是 293 次进程启动(Windows 上要几十秒)。
 *
 * **工作区里有未提交改动的文件不进这张表**(codex review 2026-08-31 P2):
 * 所有者的 vault 是「vault backup」式批量提交,平时工作区常年带着改动
 * (首次同步时实测就有 3 个文件是 M 状态)。若这类文件仍取上一次的提交时间,
 * 同步会写进新正文却配一个旧 updatedAt —— 首页「最新」行与 RSS 都不会浮出这次更新,
 * 要等 vault 提交后再同步一次才出现。这类文件回落到 mtime。
 */
function gitTimes(vault: string): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const root = execFileSync("git", ["-C", vault, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    // 先拿脏文件集合。--porcelain 的路径含 vault 之外的改动也无妨,只用于排除
    const dirty = new Set<string>();
    const status = execFileSync(
      "git",
      ["-c", "core.quotepath=false", "-C", vault, "status", "--porcelain", "--", "."],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
    );
    for (const line of status.split("\n")) {
      // 格式:XY <path> 或 XY <old> -> <new>(重命名)
      const p = line.slice(3).trim();
      if (!p) continue;
      const target = p.includes(" -> ") ? p.slice(p.indexOf(" -> ") + 4) : p;
      dirty.add(resolve(root, target.replace(/^"|"$/g, "")));
    }
    const out = execFileSync(
      "git",
      ["-c", "core.quotepath=false", "-C", vault, "log", "--format=%x01%cI", "--name-only", "--", "."],
      { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
    );
    let cur = "";
    for (const line of out.split("\n")) {
      if (line.startsWith("\u0001")) {
        cur = line.slice(1).trim();
        continue;
      }
      const p = line.trim();
      if (!p || !cur) continue;
      const abs = resolve(root, p);
      if (dirty.has(abs)) continue; // 有未提交改动 -> 交给 mtime
      if (!map.has(abs)) map.set(abs, new Date(cur).toISOString()); // log 从新到旧,首次即最近
    }
  } catch {
    // vault 不是 git 仓库或没装 git:回落到 mtime,不阻断同步
  }
  return map;
}

// ───────────────────── 主流程 ─────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.verifyOnly) {
    const ok = await verify(args.dsn!);
    if (!ok) die("自检未通过(见上面 FAIL 行)");
    return;
  }

  const vault = resolve(args.vault);

  console.log(`vault  : ${vault}`);
  const loaded = loadAll(vault);
  console.log(`发现   : ${loaded.length} 篇正文 / ${SERIES.length} 个系列`);

  const index = new LinkIndex(loaded);
  const images = new ImagePipeline(args.publicDir, vault);
  const times = gitTimes(vault);
  const report = emptyReport();

  const chapters: ChapterRow[] = [];
  for (const l of loaded) {
    const ctx: RewriteContext = {
      seriesSlug: l.spec.slug,
      dir: l.relPath.split("/").slice(0, -1).join("/"),
      resolveLink: (t, c) => index.resolve(t, c),
      resolveImage: (rel) =>
        rel.startsWith("data:")
          ? images.resolveInline(rel, l.spec.slug)
          : images.resolve(l.file.path, rel, l.spec.slug),
    };

    const fallbackTitle = (l.relPath.split("/").pop() ?? "").replace(/\.md$/i, "");
    const { title, body } = takeTitle(l.body, fallbackTitle, l.data);
    const md = rewrite(body, ctx, report);

    const updatedAt = times.get(resolve(l.file.path)) ?? statSync(l.file.path).mtime.toISOString();
    chapters.push({
      seriesSlug: l.spec.slug,
      slug: l.file.slug,
      ordinal: 0, // 排序在下面统一定
      label: l.file.label,
      pinned: l.file.pinned === true,
      title,
      summary: makeSummary(md),
      contentMd: md,
      wordCount: countWords(md),
      sourceUrl: frontmatterSource(l.data),
      sourcePath: l.relPath,
      contentHash: "",
      publishedAt: frontmatterDate(l.data),
      updatedAt,
    });
  }

  orderChapters(chapters);
  for (const ch of chapters) ch.contentHash = hashChapter(ch);

  const desired: Desired = {
    categories: CATEGORIES,
    series: SERIES.map<SeriesRow>((s) => ({
      slug: s.slug,
      categorySlug: s.category,
      name: s.name,
      description: s.description,
      sortOrder: s.sortOrder,
    })),
    chapters,
  };

  printRewriteReport(report, chapters);

  if (args.dumpDir) {
    for (const ch of chapters) {
      const out = join(resolve(args.dumpDir), ch.seriesSlug, `${ch.slug}.md`);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, `# ${ch.title}

${ch.contentMd}`, "utf8");
    }
    console.log(`抽查   : ${resolve(args.dumpDir)}(${chapters.length} 篇改写后正文)`);
  }

  if (args.dryRun) {
    console.log("\n--dry-run:未写库、未写图片");
  } else {
    // 先写图后写库:库里的正文一旦发布,它引用的图必须已经在磁盘上。
    // 反方向的清理(删旧图)要等库写成功,见下面的 cleanupOrphans。
    const img = await images.flush();
    console.log(
      `\n图片   : 引用 ${img.referenced} · 新写 ${img.written} · 复用 ${img.reused} · ` +
        `${mb(img.bytesIn)} → ${mb(img.bytesOut)}`,
    );
    if (img.missing.length) {
      console.log(`  ⚠ 源图缺失 ${img.missing.length} 张(正文里已丢弃该引用):`);
      for (const m of img.missing.slice(0, 8)) console.log(`      ${m}`);
    }

    if (args.emitSql) {
      mkdirSync(dirname(resolve(args.emitSql)), { recursive: true });
      writeFileSync(args.emitSql, emitSql(desired), "utf8");
      console.log(`SQL    : ${resolve(args.emitSql)}`);
    }
    if (args.dsn) {
      const w = await applyToDatabase(args.dsn, desired);
      console.log(`入库   : 新增 ${w.inserted} · 更新 ${w.updated} · 未变 ${w.unchanged} · 删除 ${w.deleted}`);
      if (w.seriesRemoved || w.categoriesRemoved) {
        console.log(`         下线系列 ${w.seriesRemoved} · 下线分类 ${w.categoriesRemoved}`);
      }
    }

    // 持久化成功之后才清理孤儿图:中途失败时旧图还在,现网页面不会变破图
    const removed = images.cleanupOrphans();
    if (removed) console.log(`清理   : 移除不再被引用的图片 ${removed} 张`);

    if (args.dsn) {
      // 入库后立刻自检:改写规则的回归靠它兜,不指望人每次去读长报告
      if (!(await verify(args.dsn))) die("同步已写入,但自检未通过 —— 按 FAIL 行定位后修改写规则再同步");
    }
  }

  if (args.reportPath) {
    mkdirSync(dirname(resolve(args.reportPath)), { recursive: true });
    writeFileSync(
      args.reportPath,
      JSON.stringify(
        {
          chapters: chapters.length,
          resolvedLinks: report.resolvedLinks,
          unresolvedLinks: Object.fromEntries(report.unresolvedLinks),
          droppedImages: report.droppedImages,
          residualHtml: [...new Set(report.residualHtml)],
        },
        null,
        2,
      ),
      "utf8",
    );
    console.log(`报告   : ${resolve(args.reportPath)}`);
  }
}

/**
 * 章节排序:置顶 README 恒为 0;档案类按发布日期倒序并重排展示序号,
 * 教程类保持 manifest 给的教学顺序。
 * 注意重排的只是 label(展示),slug(URL)在 manifest 里就定死了 —— 档案新增文章时
 * 老文章的链接不能跟着漂。
 */
function orderChapters(chapters: ChapterRow[]): void {
  const bySeries = new Map<string, ChapterRow[]>();
  for (const ch of chapters) {
    const list = bySeries.get(ch.seriesSlug);
    if (list) list.push(ch);
    else bySeries.set(ch.seriesSlug, [ch]);
  }
  for (const [slug, list] of bySeries) {
    const pinned = list.filter((c) => c.pinned);
    let rest = list.filter((c) => !c.pinned);
    if (DATE_DESC_SERIES.has(slug)) {
      rest = rest.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
      rest.forEach((c, i) => (c.label = String(i + 1).padStart(2, "0")));
    }
    pinned.forEach((c) => (c.ordinal = 0));
    rest.forEach((c, i) => (c.ordinal = i + 1));
  }
}

/** 覆盖正文 + 全部参与展示的元数据:任一变化都应触发一次更新 */
function hashChapter(ch: ChapterRow): string {
  const h = createHash("sha256");
  h.update(
    [
      ch.seriesSlug, ch.slug, ch.ordinal, ch.label, ch.pinned, ch.title, ch.summary,
      ch.wordCount, ch.sourceUrl ?? "", ch.sourcePath, ch.publishedAt ?? "", ch.updatedAt,
    ].join("\u0000"),
  );
  h.update("\u0000");
  h.update(ch.contentMd);
  return h.digest("hex");
}

function printRewriteReport(report: RewriteReport, chapters: ChapterRow[]): void {
  const words = chapters.reduce((a, c) => a + c.wordCount, 0);
  console.log(`改写   : 链接命中 ${report.resolvedLinks} · callout ${report.callouts} · 高亮 ${report.highlights}`);
  console.log(`正文   : ${chapters.length} 章 · 约 ${(words / 10000).toFixed(1)} 万字`);
  console.log("分系列 :");
  for (const s of SERIES) {
    const n = chapters.filter((c) => c.seriesSlug === s.slug).length;
    console.log(`    ${String(n).padStart(3)} 章  ${s.slug.padEnd(20)} ${n === 0 ? "(本轮不同步)" : ""}`);
  }

  const unresolved = [...report.unresolvedLinks.entries()].sort((a, b) => b[1] - a[1]);
  if (unresolved.length) {
    const total = unresolved.reduce((a, [, n]) => a + n, 0);
    console.log(`\n⚠ ${unresolved.length} 个链接目标不在站内,已降级为纯文本(共 ${total} 处),前 12 个:`);
    for (const [t, n] of unresolved.slice(0, 12)) console.log(`    ${String(n).padStart(3)}×  ${t}`);
    console.log("  这些多是 vault 里的工作笔记与未收录素材;若其中有该发布的内容,补进 manifest 再同步。");
  }
  if (report.remoteImages.length) {
    const hosts = new Map<string, number>();
    for (const u of report.remoteImages) {
      let h = "(无法解析)";
      try {
        h = new URL(u).host;
      } catch {
        // 保持默认
      }
      hosts.set(h, (hosts.get(h) ?? 0) + 1);
    }
    const brief = [...hosts].sort((a, b) => b[1] - a[1]).map(([h, n]) => `${h}×${n}`).join(" · ");
    console.log(`
远程图 : ${report.remoteImages.length} 张仍指向第三方(${brief})`);
    console.log("  它们不经本地图片管线:依赖第三方可用性,且会把访客请求暴露给对方。");
    console.log("  所有者裁定 2026-08-31:在 vault 侧改存本地 PNG 从源头消除,管线不做降级。");
  }

  const residual = [...new Set(report.residualHtml)];
  if (residual.length) {
    console.log(`\n⚠ 围栏外残留 ${residual.length} 种裸 HTML(渲染时会被转义成字面量): ${residual.slice(0, 8).join(" ")}`);
  }
}

function mb(n: number): string {
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
