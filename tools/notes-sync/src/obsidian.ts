// Obsidian 专有语法 → 标准 markdown(所有者裁定 2026-08-31 决策 2)。
//
// 【最重要的不变式:改写永不进入代码】
// vault 里 `==` 绝大多数是 Rust/TS 代码里的比较运算符(491 段 rust + 419 段 ts 围栏),
// `<script>` / `<summary>` / `<div>` 也几乎全在围栏或行内代码里当例子讲。逐字符地跑
// 正则会把教程代码改烂,而且烂得很难发现(渲染出来仍是合法 markdown)。所以本模块先把
// 文档切成「围栏 / 行内代码 / 普通文本」三类片段,只在普通文本上动手。
//
// 实测口径(293 篇):wikilink 1825(带别名 1301,带锚点 9)· callout 695(10 种)
// · ==高亮== 41(其中真高亮仅约 5,其余是代码)· %%注释% 2 · ![宽度](…) 17 · 嵌入 ![[x]] 0

export interface LinkTarget {
  seriesSlug: string;
  chapterSlug: string;
}

export interface RewriteContext {
  /** 当前文件所属系列,用于同系列内的短链解析 */
  seriesSlug: string;
  /** 当前文件在 vault 内的目录(相对 `学习分享/`),用于相对路径解析 */
  dir: string;
  /** wikilink 解析器;返回 null 表示目标不在站内,链接降级为纯文本 */
  resolveLink(target: string, ctx: RewriteContext): LinkTarget | null;
  /** 图片解析器;返回新 URL,或 null 表示丢弃该图片 */
  resolveImage(relPath: string, ctx: RewriteContext): string | null;
}

export interface RewriteReport {
  /** 降级成纯文本的 wikilink 目标(去重计数),供所有者复核有没有该发布却漏链的内容 */
  unresolvedLinks: Map<string, number>;
  /** 丢弃的图片引用 */
  droppedImages: string[];
  /** 降级成链接的远程图片(不内嵌,见 renderImage) */
  remoteImages: string[];
  /** 改写后仍残留、渲染时会被转义成字面量的裸 HTML 标签 */
  residualHtml: string[];
  resolvedLinks: number;
  callouts: number;
  highlights: number;
}

export function emptyReport(): RewriteReport {
  return {
    unresolvedLinks: new Map(),
    droppedImages: [],
    remoteImages: [],
    residualHtml: [],
    resolvedLinks: 0,
    callouts: 0,
    highlights: 0,
  };
}

/** callout 类型 → 无标题时使用的中文标签 */
const CALLOUT_LABELS: Record<string, string> = {
  info: "说明",
  tip: "提示",
  warning: "注意",
  abstract: "核心要点",
  important: "要点",
  note: "备注",
  success: "结论",
  quote: "引用",
  faq: "常见问题",
  example: "示例",
  danger: "危险",
  bug: "缺陷",
  question: "问题",
  todo: "待办",
};

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;

/**
 * 主入口:输入去掉 frontmatter 的正文,输出标准 markdown。
 * report 会被就地累加,由调用方在整轮同步结束时汇总。
 */
export function rewrite(body: string, ctx: RewriteContext, report: RewriteReport): string {
  const lines = body.split(/\r?\n/);
  const out: string[] = [];

  let fence: string | null = null;
  // Obsidian 注释可跨行,状态要在行之间带着走
  const state = { inComment: false };
  for (const raw of lines) {
    // —— 围栏内原样透传;注释未闭合时,围栏本身也属于被注掉的内容 —— //
    const fenceHit = FENCE_RE.exec(raw);
    if (fence) {
      if (!state.inComment) out.push(raw);
      if (fenceHit && raw.trimStart().startsWith(fence)) fence = null;
      continue;
    }
    if (fenceHit && !state.inComment) {
      fence = fenceHit[1];
      out.push(raw);
      continue;
    }

    const line = rewriteLine(raw, ctx, report, state);
    // 整行都是注释时不要留下一行空白
    if (line.trim() === "" && raw.trim() !== "") continue;
    out.push(line);
  }

  return normalizeBlankLines(out.join("\n"));
}

/**
 * 从一段**普通文本**里剥掉 Obsidian 注释 `%%…%%`,返回存活内容与「注释是否仍开着」。
 *
 * 两条约束都是踩出来的:
 *  - 必须逐行 + 跨行状态,不能对整篇跑 `/%%…%%/g` —— 那样代码围栏里的 `%%`
 *    (批处理的 `%%A`、SQL 的 `LIKE '%%'`)会被当注释吃掉;
 *  - 必须在**行内代码切分之后**调用(codex review 2026-08-31 P1):放在切分之前的话,
 *    正文里写 `` `LIKE '%%'` `` 这样的例子会被改成 `` `LIKE '` ``,而且剩下的半个标记
 *    还会把后面几行一起吞掉。markdown 里代码跨度的优先级高于注释标记。
 */
function stripComments(text: string, open: boolean): { kept: string; open: boolean } {
  let kept = "";
  let i = 0;
  let inComment = open;
  for (;;) {
    const at = text.indexOf("%%", i);
    if (at < 0) {
      if (!inComment) kept += text.slice(i);
      return { kept, open: inComment };
    }
    if (!inComment) kept += text.slice(i, at);
    inComment = !inComment;
    i = at + 2;
  }
}

function rewriteLine(
  line: string,
  ctx: RewriteContext,
  report: RewriteReport,
  state: { inComment: boolean },
): string {
  const head = state.inComment ? line : rewriteCallout(line, report);
  let out = "";
  for (const seg of splitSegments(head)) {
    if (seg.code) {
      // 行内代码整段原样保留,里面的 `%%` 不算注释标记;
      // 但注释若已经开着,这段本来就在被注掉的范围内
      if (!state.inComment) out += seg.text;
      continue;
    }
    const { kept, open } = stripComments(seg.text, state.inComment);
    state.inComment = open;
    out += rewriteInline(kept, ctx, report);
  }
  return out;
}

/**
 * `> [!info] 标题` → `> **标题**`。折叠标记 `+` / `-` 一并吃掉。
 * 设计稿的文章画板有 blockquote 样式(左侧 3px 竖线 + 淡底),callout 落到它上面是最贴的。
 */
function rewriteCallout(line: string, report: RewriteReport): string {
  const m = /^(\s*>\s*)\[!([A-Za-z]+)\][+-]?\s*(.*)$/.exec(line);
  if (!m) return line;
  const [, prefix, type, title] = m;
  const label = title.trim() || CALLOUT_LABELS[type.toLowerCase()] || type.toUpperCase();
  report.callouts++;
  return `${prefix}**${label}**`;
}

interface Segment {
  /** true = 行内代码跨度,原样保留 */
  code: boolean;
  text: string;
}

/**
 * 把一行切成「行内代码 / 普通文本」交替片段。返回片段而不是就地映射,是因为
 * 注释剥离也要按片段走(见 stripComments 的第二条约束)。
 * 反引号数量需成对匹配(``a`b`` 这种双反引号包单反引号的写法在 TS 教程里出现过)。
 */
function splitSegments(line: string): Segment[] {
  const segs: Segment[] = [];
  let i = 0;
  while (i < line.length) {
    const tick = line.indexOf("`", i);
    if (tick < 0) {
      segs.push({ code: false, text: line.slice(i) });
      break;
    }
    if (tick > i) segs.push({ code: false, text: line.slice(i, tick) });

    let openLen = 0;
    while (line[tick + openLen] === "`") openLen++;
    const open = "`".repeat(openLen);
    const close = line.indexOf(open, tick + openLen);
    if (close < 0) {
      // 不闭合的反引号:剩余部分当代码原样留着(宁可少改也不改错)
      segs.push({ code: true, text: line.slice(tick) });
      break;
    }
    segs.push({ code: true, text: line.slice(tick, close + openLen) });
    i = close + openLen;
  }
  return segs;
}

function rewriteInline(text: string, ctx: RewriteContext, report: RewriteReport): string {
  let s = text;
  s = rewriteImages(s, ctx, report);
  s = rewriteWikiLinks(s, ctx, report);
  s = rewriteRelativeLinks(s, ctx, report);
  s = rewriteHighlights(s, report);
  s = rewriteRawHtml(s, report);
  s = stripInlineTags(s);
  return s;
}

/**
 * 普通 markdown 链接里的**相对目的地**,套用与 wikilink 完全相同的策略:
 * 能解析到站内章节就改写成 `/notes/…`,解析不了就降级成纯文本。
 *
 * 为什么必须管:实测库里有 66 处这种链接,其中只有 2 处真指向 vault 内的文章
 * (`第9章-….md`),其余全是被拆解仓库的源码路径(`repo/packages/…/runner.ts`、
 * `./docs/typescript/…`)—— 教程正文里它们是"这段代码在哪"的说明,不是站点导航。
 * 原样渲染出去就是 66 个点了会 404 的链接。
 *
 * 不碰的:http(s)、mailto、站内绝对路径 `/…`、纯锚点 `#…`(那是本页跳转)。
 */
function rewriteRelativeLinks(text: string, ctx: RewriteContext, report: RewriteReport): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf("[", i);
    // `![` 是图片,前一轮已经处理过;`[[` 是 wikilink,同理
    if (start < 0 || text[start + 1] === "[") {
      out += start < 0 ? text.slice(i) : text.slice(i, start + 2);
      if (start < 0) break;
      i = start + 2;
      continue;
    }
    if (start > 0 && text[start - 1] === "!") {
      out += text.slice(i, start + 1);
      i = start + 1;
      continue;
    }

    const textEnd = text.indexOf("]", start + 1);
    if (textEnd < 0 || text[textEnd + 1] !== "(") {
      out += text.slice(i, start + 1);
      i = start + 1;
      continue;
    }
    const destEnd = matchParen(text, textEnd + 1);
    if (destEnd < 0) {
      out += text.slice(i, start + 1);
      i = start + 1;
      continue;
    }

    const label = text.slice(start + 1, textEnd);
    const dest = text.slice(textEnd + 2, destEnd).trim();
    out += text.slice(i, start);
    out += renderRelativeLink(label, dest, ctx, report);
    i = destEnd + 1;
  }
  return out;
}

function renderRelativeLink(
  label: string,
  dest: string,
  ctx: RewriteContext,
  report: RewriteReport,
): string {
  const keep = () => `[${label}](${dest})`;
  if (!dest || /^(https?:|mailto:|tel:|\/|#)/i.test(dest)) return keep();

  const target = ctx.resolveLink(dest.split("#")[0], ctx);
  if (target) {
    report.resolvedLinks++;
    return `[${label}](/notes/${target.seriesSlug}/${target.chapterSlug})`;
  }
  report.unresolvedLinks.set(dest, (report.unresolvedLinks.get(dest) ?? 0) + 1);
  return label;
}

/**
 * `![1200](assets/x.png)` → `![](/notes/<series>/<hash>.webp)`;alt 里的纯数字是 Obsidian 的宽度语法。
 *
 * 不能用正则:vault 里存在 `01-分层图(阶段-0-的-⭐-最小产出就是把这张图画出来).png` 这种
 * **未转义的括号嵌在文件名里**的路径,`[^)\s]+` 会在第一个 `)` 处截断,把 `.png)` 甩在外面。
 * 按 CommonMark 的括号配平规则手写扫描器。
 */
function rewriteImages(text: string, ctx: RewriteContext, report: RewriteReport): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf("![", i);
    if (start < 0) {
      out += text.slice(i);
      break;
    }
    const altEnd = text.indexOf("]", start + 2);
    if (altEnd < 0 || text[altEnd + 1] !== "(") {
      out += text.slice(i, start + 2);
      i = start + 2;
      continue;
    }
    const urlEnd = matchParen(text, altEnd + 1);
    if (urlEnd < 0) {
      out += text.slice(i, start + 2);
      i = start + 2;
      continue;
    }

    const alt = text.slice(start + 2, altEnd);
    const dest = text.slice(altEnd + 2, urlEnd).trim();
    out += text.slice(i, start);
    out += renderImage(alt, dest, ctx, report);
    i = urlEnd + 1;
  }
  return out;
}

/** 单个孤立的 `%` 会让 decodeURI 抛 URIError;路径解不开时按原样用,不让一张图掀翻整轮同步 */
function safeDecode(url: string): string {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
}

/** 从 `(` 位置出发返回配平的 `)` 下标;不配平返回 -1 */
function matchParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

function renderImage(alt: string, dest: string, ctx: RewriteContext, report: RewriteReport): string {
  // 目的地里可能带 CommonMark 的可选 title(`路径 "标题"`),本仓内容没有用到,直接丢
  const url = dest.replace(/\s+"[^"]*"$/, "");

  // 远程图原样内嵌。codex 第 2 轮把它报成 P1(内嵌会把访客请求暴露给第三方,
  // 且 twimg 防盗链、知识星球要鉴权,图本身多半加载不出来),实测 53 张 / 14 章。
  // **所有者 2026-08-31 裁定不在管线上处理**:根因是 vault 里引用了远程图,
  // 以后写文章一律把 PNG 存进 vault,远程引用会从源头消失 —— 不为此新增
  // 「降级成链接」或「构建期镜像」的机制。存量的 53 张随内容更新自然收敛。
  if (/^https?:\/\//i.test(url)) {
    report.remoteImages.push(url);
    return `![${alt}](${url})`;
  }
  const mapped = ctx.resolveImage(safeDecode(url), ctx);
  if (!mapped) {
    report.droppedImages.push(`${ctx.dir}/${url}`);
    return "";
  }
  const cleanAlt = /^\d+$/.test(alt.trim()) ? "" : alt;
  return `![${cleanAlt}](${mapped})`;
}

/**
 * `[[目标]]` / `[[目标|别名]]` / `[[目标#锚点|别名]]`
 *   → 站内命中:`[别名](/notes/系列/章节)`;未命中:降级为纯文本(别名或目标末段)。
 * 锚点丢弃 —— 站内没有稳定的标题锚点,保留它只会产生 404 片段。
 */
function rewriteWikiLinks(text: string, ctx: RewriteContext, report: RewriteReport): string {
  return text.replace(/\[\[([^\[\]]*)\]\]/g, (_whole, inner: string) => {
    const [rawTarget, alias] = splitAlias(inner);
    const target = rawTarget.split("#")[0].trim();
    const display = (alias ?? basename(target)).trim();
    if (!target) return display;

    const hit = ctx.resolveLink(target, ctx);
    if (!hit) {
      report.unresolvedLinks.set(target, (report.unresolvedLinks.get(target) ?? 0) + 1);
      return display;
    }
    report.resolvedLinks++;
    return `[${display}](/notes/${hit.seriesSlug}/${hit.chapterSlug})`;
  });
}

/**
 * 别名分隔符可能被转义成 `\|` —— Obsidian 在**表格单元格里**必须这么写,否则竖线会被
 * 当成列分隔。AI技术博客索引整张表(每行两个链接)都是这个形态,不处理的话全表链接失效。
 */
function splitAlias(inner: string): [string, string | undefined] {
  const bar = inner.search(/\\?\|/);
  if (bar < 0) return [inner, undefined];
  const skip = inner[bar] === "\\" ? 2 : 1;
  return [inner.slice(0, bar), inner.slice(bar + skip)];
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

/**
 * `==x==` → `**x**`。标准 markdown 没有高亮,设计稿也没有 mark 样式,落到加粗上。
 * 严格限定:不跨行、内部无 `=`、长度 ≤ 60 —— 代码里的 `a == b` 不满足(两侧有空格且成对失败)。
 */
function rewriteHighlights(text: string, report: RewriteReport): string {
  return text.replace(/==([^=\s][^=]{0,58}[^=\s])==/g, (_w, inner: string) => {
    report.highlights++;
    return `**${inner}**`;
  });
}

/**
 * 围栏外的裸 HTML:`<br>` 变换行;`<details>`/`<summary>` 拆成加粗标题;
 * 其余(实测围栏外没有)记进报告 —— 渲染侧不放行裸 HTML(XSS),残留会被转义成字面量。
 */
function rewriteRawHtml(text: string, report: RewriteReport): string {
  let s = text.replace(/<br\s*\/?>/gi, "  \n");
  // Web Clipper 抓回来的推文里带整段 <video>/<iframe> 内嵌(实测 1 处):站内不放行第三方
  // 内嵌播放器,整块删掉而不是留个转义后的标签字面量给读者看。
  s = s.replace(/<(video|iframe|audio|object|embed)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  // 内嵌块常被 Web Clipper 拆成多行,逐行改写时开闭标签不在同一段,所以两条规则都要有
  s = s.replace(/<(video|iframe|audio|source|embed)\b[^>]*\/?>/gi, "");
  s = s.replace(/<\/(video|iframe|audio|object|embed)>/gi, "");
  s = s.replace(/<\/?details[^>]*>/gi, "");
  s = s.replace(/<summary[^>]*>([\s\S]*?)<\/summary>/gi, (_w, inner: string) => `**${inner.trim()}**`);
  // 只认真正的 HTML 标签名再报告:TypeScript 教程正文里 `<T>` / `<Props>` 这类泛型写在
  // 围栏外的情况不少,全量匹配会把报告淹掉。
  const residual = s.match(
    /<\/?(a|div|span|img|table|thead|tbody|tr|td|th|script|style|iframe|form|input|button|p|ul|ol|li|h[1-6]|pre|code|em|strong|section|article|figure|video|audio|object|embed|link|meta)\b[^<>]*>/gi,
  );
  if (residual) report.residualHtml.push(...residual);
  return s;
}

/**
 * 行内 `#标签`(实测 4 处)。标题的 `# ` 有空格,不会命中。
 *
 * 前缀只认「行首或空白」—— 早先把 `(`、`(` 也算进前缀,结果把
 * `[控制 subagent 的派生](#控制-subagent-的派生)` 里的锚点吃成了相对路径,
 * 站内跳转直接跳走(codex review 2026-08-31 第 2 轮 P2)。真正的行内标签前面
 * 不会紧跟左括号,收紧前缀是零代价的。
 */
function stripInlineTags(text: string): string {
  return text.replace(/(^|\s)#([一-龥A-Za-z][一-龥\w/-]*)/g, "$1$2");
}

/** 改写会留下空行(丢弃的图片、注释),压成最多一个空行 */
function normalizeBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/** 验收项 2 用:扫描已入库正文里是否还有 Obsidian 残留 */
export function findObsidianResidue(md: string): string[] {
  const hits: string[] = [];
  if (/\[\[/.test(md)) hits.push("wikilink");
  if (/^\s*>\s*\[!/m.test(md)) hits.push("callout");
  if (/%%/.test(md)) hits.push("comment");
  return hits;
}
