// 系列映射表 —— vault 目录 → 站点 13 张系列卡(design/ 画板 2a)。
//
// 为什么是手写 manifest 而不是约定式自动发现:vault 里 12 个目录有 6 种不同结构
// (第N章教程 / 阶段N目录 / 平铺 / 专题目录 / 单篇报告 / 双语文章库),自动发现只会
// 在每次 vault 结构微调时静默错位。手写表的失效方式是"报错停下",这是想要的。
//
// 内容边界(所有者裁定 2026-08-31,见 rounds/round-05/round-05.md):
//   - 内容分享:不同步(与所有者工作相关);卡片保留,走"章节整理中"占位态
//   - 原始资料/:任何系列都不摄入,正文里指向它的链接降级为纯文本(抓取素材,无授权)
//   - AI 资料:只收中译,英文原文不入库,source 原链保留

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export type CategorySlug = "pm" | "deep-dive" | "engineering" | "frontier";

export interface CategorySpec {
  slug: CategorySlug;
  name: string;
  /** 分类圆点色,取自 design/README.md「设计 token 速查」 */
  dot: string;
  sortOrder: number;
}

export const CATEGORIES: CategorySpec[] = [
  { slug: "pm", name: "产品经理", dot: "#2563eb", sortOrder: 1 },
  { slug: "deep-dive", name: "源码拆解", dot: "#16a34a", sortOrder: 2 },
  { slug: "engineering", name: "代码工程", dot: "#f9c22e", sortOrder: 3 },
  { slug: "frontier", name: "AI 前沿", dot: "#8b5cf6", sortOrder: 4 },
];

export interface ChapterFile {
  /** 绝对路径 */
  path: string;
  /** URL 片段:/notes/<series>/<slug>。必须跨同步稳定,不随新增章节漂移 */
  slug: string;
  /** 章节表左列展示文本(README / 01 / 02 …) */
  label: string;
  /** 置顶行(设计稿系列页的 README 行) */
  pinned?: boolean;
}

export interface SeriesSpec {
  slug: string;
  category: CategorySlug;
  name: string;
  description: string;
  sortOrder: number;
  /** vault 内相对 `学习分享/` 的根目录;仅用于报告与溯源 */
  root: string;
  /** 返回有序章节;空数组表示该系列本轮不同步(卡片仍在,页面走占位态) */
  collect(vaultRoot: string): ChapterFile[];
}

// ───────────────────── 收集辅助 ─────────────────────

/** 目录内的 .md,不递归;永远跳过 `原始资料/` 与点目录 */
function mdFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    throw new Error(`vault 目录不存在: ${dir}`);
  }
  return entries
    .filter((n) => n.endsWith(".md"))
    .map((n) => join(dir, n))
    .filter((p) => statSync(p).isFile())
    .sort();
}

function subDirs(dir: string): string[] {
  return readdirSync(dir)
    .filter((n) => !n.startsWith("."))
    .map((n) => join(dir, n))
    .filter((p) => statSync(p).isDirectory());
}

/** 从 `第12章-xxx.md` 取 12;不匹配返回 null */
function chapterNo(path: string): number | null {
  const m = /第(\d+)章/.exec(path.split(/[\\/]/).pop() ?? "");
  return m ? Number(m[1]) : null;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * 「README + 第N章 + 可选尾部附录」这一套教程结构的通用收集器。
 * CCH / Codex / DeepSeek / Pi / Rust / TypeScript / Encore深度教程 都是这个形状。
 */
function tutorial(dir: string, opts: { readme?: string; trailing?: string[] } = {}): ChapterFile[] {
  const out: ChapterFile[] = [];
  const readmeName = opts.readme ?? "README-教程总览.md";
  const files = mdFiles(dir);

  const readme = files.find((p) => p.endsWith(readmeName));
  if (readme) out.push({ path: readme, slug: "readme", label: "README", pinned: true });

  const numbered = files
    .map((p) => ({ p, no: chapterNo(p) }))
    .filter((x): x is { p: string; no: number } => x.no !== null)
    .sort((a, b) => a.no - b.no);
  if (numbered.length === 0) throw new Error(`${dir} 下没有「第N章」文件,manifest 与 vault 结构已经不一致`);
  for (const { p, no } of numbered) out.push({ path: p, slug: pad(no), label: pad(no) });

  // 尾部附录(研究摘要 / 研究报告 等),接着章节号继续编
  let next = numbered[numbered.length - 1].no + 1;
  for (const name of opts.trailing ?? []) {
    const hit = files.find((p) => p.endsWith(name));
    if (!hit) throw new Error(`${dir} 下找不到附录文件 ${name}`);
    out.push({ path: hit, slug: slugifyAscii(name.replace(/\.md$/, "")) || pad(next), label: pad(next) });
    next++;
  }
  return out;
}

/** 把 ASCII 文件名压成 URL 片段;中文等非 ASCII 一律丢弃(丢空时调用方回落到序号) */
function slugifyAscii(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * AI资料 里**确认只有英文原文、没有中译**的子目录:覆盖校验命中它们时跳过而不是报错。
 *
 * 之前只在报错信息里提到这张表却没实现,等于给了一条走不通的出路 —— 遇到英文-only 的
 * 新目录时同步会永久失败,而按提示又无处可加(codex review 2026-08-31 第 3 轮 P2)。
 * 未知目录仍然默认失败:「宁可漏收也不误发英文原文」的取向不变。
 */
const ARCHIVE_SKIP = new Set<string>([]);

/**
 * AI资料 里**中文**但不带 `-Chinese-` 标记的文章,逐条白名单放行。
 * 默认排除、白名单放行的方向不能反过来:反了以后 vault 新增未知形态的文件时,
 * 失败模式会从「漏收一篇」变成「把第三方英文原文发上公网」。
 */
const ARCHIVE_EXTRA: { file: string; slug: string }[] = [
  { file: "Anthropic官方AI与Agent最佳实践汇总-20260302.md", slug: "anthropic-best-practices-digest" },
  { file: "Harness-Engineering-OpenAI-Codex/Harness-Engineering-总结概要-20260303.md", slug: "harness-engineering-digest" },
  {
    file: "Lessons-from-Building-Claude-Code/Lessons from Building Claude Code - Seeing Like an Agent (Chinese Translation).md",
    slug: "lessons-from-building-claude-code",
  },
];

// ───────────────────── 13 张系列卡 ─────────────────────

export const SERIES: SeriesSpec[] = [
  {
    slug: "agent-basics",
    category: "pm",
    name: "Agent 基础知识",
    description: "从能力盘点到综合项目的学习路线,含术语表与外部权威资料索引",
    sortOrder: 1,
    root: "Agent基础知识",
    collect(vault) {
      const dir = join(vault, "Agent基础知识");
      const out: ChapterFile[] = [
        { path: join(dir, "README-学习路线.md"), slug: "readme", label: "README", pinned: true },
      ];
      // 阶段0..14,每阶段先讲义后实践
      const stages = subDirs(dir)
        .map((d) => ({ d, no: Number(/阶段(\d+)-/.exec(d.split(/[\\/]/).pop() ?? "")?.[1] ?? NaN) }))
        .filter((x) => Number.isFinite(x.no))
        .sort((a, b) => a.no - b.no);
      if (stages.length === 0) throw new Error(`${dir} 下没有「阶段N」目录`);
      let n = 1;
      for (const { d, no } of stages) {
        const files = mdFiles(d);
        for (const [prefix, kind] of [["讲义-", "lecture"], ["实践-", "practice"]] as const) {
          const hit = files.find((p) => (p.split(/[\\/]/).pop() ?? "").startsWith(prefix));
          if (!hit) continue;
          out.push({ path: hit, slug: `s${no}-${kind}`, label: pad(n++) });
        }
      }
      for (const [file, slug] of [
        ["术语表-Agent与Harness核心词汇.md", "glossary"],
        ["资料索引-外部权威资料清单.md", "resources"],
      ] as const) {
        out.push({ path: join(dir, file), slug, label: pad(n++) });
      }
      return out;
    },
  },
  {
    slug: "ai-native-swe",
    category: "pm",
    name: "AI native 软件工程教程",
    description: "为什么 vibe coding 不可以?AI 时代如何快速学习一项技术",
    sortOrder: 2,
    root: "AI native软件工程教程",
    collect(vault) {
      const dir = join(vault, "AI native软件工程教程");
      // 平铺目录没有序号,顺序取自「课程目录AI native软件工程师.md」里的课程编排
      const order = [
        "为什么vibe coding不可以？.md",
        "AI时代最重要的是什么？skills和软件更趋向于开源？.md",
        "工程问题与科学问题的区别？.md",
        "AI 时代，如何快速学习一项技术？.md",
        "构建一个新系统的设计和思考.md",
        "如何快速构建一个初始化项目？.md",
      ];
      return [
        { path: join(dir, "课程目录AI native软件工程师.md"), slug: "readme", label: "README", pinned: true },
        ...order.map((f, i) => ({ path: join(dir, f), slug: pad(i + 1), label: pad(i + 1) })),
      ];
    },
  },
  {
    slug: "sharing",
    category: "pm",
    name: "内容分享",
    description: "四大 Agent Harness 对比、pi 实战、karpathy 的 LLM-wiki 方法论与我们的实践",
    sortOrder: 3,
    root: "内容分享",
    // 所有者裁定 2026-08-31:与所有者工作相关,不同步。卡片保留、章节为空。
    collect: () => [],
  },
  {
    slug: "claude-code-harness",
    category: "deep-dive",
    name: "Claude Code Harness",
    description: "从混淆源码逆向一个闭源 harness:上下文预算才是架构主线",
    sortOrder: 1,
    root: "Claude Code Harness",
    collect: (v) => tutorial(join(v, "Claude Code Harness"), { trailing: ["Claude Code Harness 研究摘要.md"] }),
  },
  {
    slug: "codex-harness",
    category: "deep-dive",
    name: "Codex Harness",
    description: "102 个 crate 的单二进制:SQEQ 队列、模型判官审批、四套沙箱",
    sortOrder: 2,
    root: "Codex Harness",
    collect: (v) => tutorial(join(v, "Codex Harness"), { trailing: ["Codex Harness 研究摘要.md"] }),
  },
  {
    slug: "deepseek-harness",
    category: "deep-dive",
    name: "DeepSeek Harness",
    description: "一切皆插件:cordis 底座、Seam 架构、fail-closed 权限四层防线",
    sortOrder: 3,
    root: "DeepSeek Harness",
    collect: (v) => tutorial(join(v, "DeepSeek Harness"), { trailing: ["DeepSeek Harness 研究摘要.md"] }),
  },
  {
    slug: "pi",
    category: "deep-dive",
    name: "Pi",
    description: "最小可懂的 agent 内核:事件驱动、扩展系统、会话分叉",
    sortOrder: 4,
    root: "Pi",
    collect: (v) => tutorial(join(v, "Pi"), { trailing: ["Pi 研究摘要.md"] }),
  },
  {
    slug: "harness-engineering",
    category: "deep-dive",
    name: "Harness Engineering",
    description: "横向研究报告:四种 harness 哲学对照",
    sortOrder: 5,
    root: "Harness Engineering",
    collect: (v) => [
      {
        path: join(v, "Harness Engineering", "Harness Engineering 研究报告.md"),
        slug: "01",
        label: "01",
      },
    ],
  },
  {
    slug: "rust-bible",
    category: "engineering",
    name: "Rust 语言圣经",
    description: "所有权到 Tokio Mini-Redis:写出可靠高性能 Rust 的完整路径",
    sortOrder: 1,
    root: "Rust语言圣经",
    // 所有者裁定 4.3:只保留 markdown 正文,不得引用原始资料(course.rs 抓取素材,无授权)
    collect: (v) => tutorial(join(v, "Rust语言圣经")),
  },
  {
    slug: "typescript-deep",
    category: "engineering",
    name: "TypeScript 深度教程",
    description: "类型建模、infer、Monorepo 到发布策略的深潜",
    sortOrder: 2,
    root: "TypeScript深度教程",
    collect: (v) => tutorial(join(v, "TypeScript深度教程")),
  },
  {
    slug: "encore",
    category: "engineering",
    name: "Encore",
    description: "Encore.ts 深度教程与研究摘要:声明式后端与自动 infra",
    sortOrder: 3,
    root: "Encore",
    // 所有者裁定 4.3:20 章深度教程一并融入(设计稿卡片原文只写了「研究摘要」)。
    // 研究摘要与深度教程不在同一层目录,拼不进 tutorial() 的 trailing,故手工接在末尾。
    collect(v) {
      const chapters = tutorial(join(v, "Encore", "Encore深度教程"));
      const numbered = chapters.filter((c) => !c.pinned).length;
      chapters.push({
        path: join(v, "Encore", "Encore 研究摘要.md"),
        slug: "digest",
        label: pad(numbered + 1),
      });
      return chapters;
    },
  },
  {
    slug: "ai-blog-archive",
    category: "frontier",
    name: "大厂技术博客档案",
    description: "Anthropic / OpenAI / DeepMind / LangChain 精选文章中译 + takeaways",
    sortOrder: 1,
    root: "AI资料",
    collect(vault) {
      const dir = join(vault, "AI资料");
      // 只收中译(所有者裁定 4.2)。判据是文件名带 -Chinese-;英文原文一律不入库。
      // 另有两篇中文原创汇总不带该标记,显式白名单进来 —— 默认排除、白名单放行,
      // 这样 vault 新增未知形态的文件时是"漏收 + 报告",不会是"误发英文原文"。
      const picked: { path: string; slug: string }[] = [];
      const covered = new Set<string>();
      for (const sub of subDirs(dir)) {
        for (const f of mdFiles(sub)) {
          const base = f.split(/[\\/]/).pop() ?? "";
          if (!base.includes("-Chinese-")) continue;
          // slug 取**文件名**去掉 `-Chinese-<日期>` 后缀,不能取目录名:
          // Karpathy-LLM-Knowledge-Bases/ 一个目录下有两篇中译(Knowledge-Bases 与
          // Wiki-Detailed),按目录名会撞成同一个 slug,upsert 时后者把前者覆盖掉 ——
          // 表现是"少一章"而不是报错,极难发现(实测 61 vs 62)。
          const slug = slugifyAscii(base.replace(/\.md$/i, "").replace(/-Chinese-\d+$/i, ""));
          picked.push({ path: f, slug });
          covered.add(sub);
        }
      }
      for (const extra of ARCHIVE_EXTRA) {
        picked.push({ path: join(dir, extra.file), slug: extra.slug });
        covered.add(join(dir, extra.file.split("/")[0]));
      }

      // 覆盖校验:命名漂移(有一篇中译叫「… (Chinese Translation).md」而不是 -Chinese-)
      // 的表现是**静默漏收**,和"英文原文被误发"相比后果轻但同样看不见。这里把它变成硬失败。
      for (const sub of subDirs(dir)) {
        const name = sub.split(/[\\/]/).pop() ?? "";
        if (covered.has(sub) || ARCHIVE_SKIP.has(name)) continue;
        throw new Error(
          `AI资料/${name} 下没有识别出中译:\n` +
            `  ${mdFiles(sub).map((f) => f.split(/[\\/]/).pop()).join("\n  ")}\n` +
            "  确认是「只有英文原文」则把该目录名加进 ARCHIVE_SKIP;是命名不同则加进 ARCHIVE_EXTRA。",
        );
      }
      // 顺序在 main.ts 读到 frontmatter 后按 date 倒序重排;这里先给稳定的占位 label
      return picked.map((p, i) => ({ path: p.path, slug: p.slug, label: pad(i + 1) }));
    },
  },
  {
    slug: "ai-blog-index",
    category: "frontier",
    name: "AI 技术博客索引",
    description: "按公司与日期组织的全量索引,持续增量抓取",
    sortOrder: 2,
    root: "AI资料",
    collect: (v) => [{ path: join(v, "AI资料", "AI技术博客索引.md"), slug: "01", label: "01" }],
  },
];

/** 按日期倒序重排的系列(档案类);其余系列保持 manifest 给定的教学顺序 */
export const DATE_DESC_SERIES = new Set(["ai-blog-archive"]);
