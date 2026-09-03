// 标准 markdown(GFM)→ 设计稿画板 2c 的排版。两处在用:Notes 章节正文(画板 2c),
// 以及 Runtime 工作台聊天区的助手回复(画板 1a)——后者刻意复用同一套排版与节奏,
// 不另造一份「聊天版 markdown 样式」(CLAUDE.md 规则 7:不新增视觉语言)。
//
// 库里存的是 markdown、渲染在前端(所有者裁定 2026-08-31 决策 2)。这里做的事只有一件:
// 把 markdown 的元素映射到**画板 2c 已有的那套内联样式上**,不引入新的视觉语言
// (CLAUDE.md 规则 7)。画板没给样式的元素(列表 / 表格 / 分隔线 / 图片)按同一套
// design token 就近构造,理由与影响范围写在 rounds/round-05/round-05.md。
//
// 裸 HTML 不放行:react-markdown 默认丢弃 html 节点(没挂 rehype-raw),
// vault 正文里残留的标签会被忽略而不是执行 —— 这是 XSS 的兜底,不要为了渲染
// 某个 <details> 而挂 rehype-raw。
//
// 数学公式:`$…$` / `$$…$$` 走 remark-math + rehype-katex(KaTeX 在服务端把公式
// 编译成 span/MathML,前端不跑求值器)。没有它时 `$\mathcal{D}_{\text{train}}$`
// 会原样漏出来,更糟的是里面的 `_` 被当强调吃掉,公式缺字符还看不出来。
// KaTeX 的 `trust` 保持默认 false —— `\href`/`\url`/`\includegraphics`/`\html*`
// 全部禁用,正文里的 LaTeX 因此拿不到 javascript: 之类的出口,与上面那条同一个口径。
import type { CSSProperties, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { mono } from "@/lib/styles";
// KaTeX 自带样式表:字体文件由构建产物同源提供(不连 CDN,与 app/layout.tsx
// 自托管 JetBrains Mono 同一个理由 —— 境内首访不能挂在外域字体请求上)。
import "katex/dist/katex.min.css";

/** 画板 2c 的行内代码样式 */
const inlineCode: CSSProperties = {
  font: "400 12px var(--font-mono)",
  background: "var(--bg-subtle)",
  borderRadius: 4,
  padding: "1px 5px",
};

const para: CSSProperties = { fontSize: 14, lineHeight: 1.7, marginTop: 12, marginBottom: 0 };

/**
 * 标题锚点 id:标题可见文本的 slug(GitHub / Obsidian 那一套)。
 *
 * 早先用的是 `h-0`/`h-1` 这种出现序号,好处是目录与渲染器不可能算出不同的值;
 * 坏处有两个,都被审查抓到了:
 *  - 正文里**已有的** `[见](#控制-subagent-的派生)` 永远找不到目标,点了没反应;
 *    这不是 vault 的锅 —— 标准 markdown 就该这么写,是渲染器没给出标题 slug;
 *  - 序号一旦两边数得不一样(引用块内 H2、Setext H2),后面**所有**锚点一起错位。
 * 换成文本 slug 后,最坏情况退化成"某一条目录项对不上",不再是整体错位。
 */
function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** 同名标题按出现次序加后缀,与 GitHub 一致;两侧各自从头计数,结果相同 */
function uniqueId(seen: Map<string, number>, text: string): string {
  const base = slugify(text) || "section";
  const n = seen.get(base) ?? 0;
  seen.set(base, n + 1);
  return n === 0 ? base : `${base}-${n}`;
}

/** 把标题里的行内 markdown 压成可见文本:`## [x](y)` 的目录项该是 `x` 而不是 `[x](y)` */
function headingText(raw: string): string {
  return raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]*)\|?([^\]]*)\]\]/g, (_m, a: string, b: string) => b || a)
    .replace(/[*_`~]/g, "")
    .trim();
}

/** hast 里我们真正会读的那几个字段,不为此引 @types/hast */
type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

/** hast 子树 → 纯文本,用于给标题算 id */
function hastText(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(hastText).join("");
}

/**
 * 给 H2 挂锚点 id。**必须在 rehype 阶段做,不能在渲染期数**(R-PERF)。
 *
 * 早先这里是 `Markdown()` 闭包里的一个 `seen` Map,由 `components.h2` 在渲染时递增 ——
 * 于是「同一段正文渲染了几次」会改变 id:React 开发态的 StrictMode 双调用渲染函数,
 * 而 `seen` 活在外层闭包里不跟着重建,第二遍就把 id 数成了 `何时用-1`,与
 * `extractToc` 算出来的目录对不上(2026-09-03 实测:水合警告)。当时的绕法是
 * 「`Markdown` 只许在服务端渲染」,把这个组件钉死在 Server Component 里;
 * R-PERF 要让 Skill 详情页在客户端渲染非首个 markdown 文件,那条约束必须解掉。
 *
 * 放到 rehype 阶段之后,id 由 hast 树一次算定,与渲染几次无关。
 *
 * **排在 rehype-katex 之后**:改动前 id 取自渲染期的 children 文本,那时公式已经被
 * katex 换成了 span(含 `<annotation>` 里的 TeX 源码);排在它之后看到的是同一段文本,
 * 存量正文的 id 因此逐字不变 —— 这是本轮验收 #3(标题里带公式的那几篇尤其靠它)。
 */
function rehypeHeadingIds() {
  return (tree: HastNode) => {
    // 与 extractToc 共用同一套 slug + 同名去重规则,两边各自从头计数即可对齐
    const seen = new Map<string, number>();
    const walk = (node: HastNode) => {
      for (const child of node.children ?? []) {
        if (child.type === "element" && child.tagName === "h2") {
          child.properties = { ...child.properties, id: uniqueId(seen, hastText(child)) };
        }
        walk(child);
      }
    };
    walk(tree);
  };
}

/** mdast 里我们真正会读的那几个字段,不为此引 @types/mdast */
type MdNode = {
  type: string;
  value?: string;
  children?: MdNode[];
  position?: { start?: { offset?: number }; end?: { offset?: number } };
};

/**
 * `$…$` 只有在满足 Pandoc 的美元规则时才算行内公式:开定界符后不跟空白、
 * 闭定界符前不是空白、闭定界符后不跟数字。
 *
 * 为什么需要这一层:remark-math 的行内配对是「照反引号那套」写的
 * (micromark-extension-math 的 math-text),不看定界符两侧,于是正文里的**货币金额**
 * 会被当成公式吃掉 —— `从 $6.00 降到 $1.15,降本 81%` 里 `$6.00 降到 $` 整段进公式,
 * 后半句掉出来;`**$0.30/MTok 的缓存价**被读取,而不是原本的 **$3.00/MTok**` 更是
 * 连两处加粗一起被吞。拿本地 vault 全量 226 篇跑过:169 个公式节点里正好这 3 处是
 * 金额,其余 162 个行内公式(`$\mathcal{D}_{\text{train}}$` 这类)一个不落全过。
 */
function dollarLooksLikeMath(raw: string, after: string): boolean {
  if (raw.startsWith("$$")) return true; // 作者显式写了双美元,意图明确
  const inner = raw.slice(1, -1);
  if (inner.trim() === "") return false;
  if (/^\s|\s$/.test(inner)) return false;
  return !/^[0-9]/.test(after);
}

/** 树里所有不合规则的行内公式,返回它们**开定界符**在源码里的偏移 */
function offendingDollars(tree: MdNode, src: string): number[] {
  const out: number[] = [];
  const walk = (node: MdNode) => {
    for (const kid of node.children ?? []) {
      if (kid.type !== "inlineMath") {
        walk(kid);
        continue;
      }
      const from = kid.position?.start?.offset;
      const to = kid.position?.end?.offset;
      if (from === undefined || to === undefined) continue; // 没位置信息就不判,按公式走
      if (!dollarLooksLikeMath(src.slice(from, to), src.slice(to, to + 1))) out.push(from);
    }
  };
  walk(tree);
  return out;
}

/**
 * 把违规的开定界符转义成 `\$` 后**重新解析整篇**,而不是把那一段就地换成纯文本。
 * 差别在于被误判那段里的行内 markdown:就地换文本会把 `**` 之类原样显示出来
 * (上面第二例就是),重解析则让加粗、行内代码照常生效,只有 `$` 落回字面量。
 *
 * 重解析用的是 `this.parse` —— 插件的 this 就是当前 processor,拿到的是同一套
 * micromark 扩展(gfm + math),不需要另外装一份 remark-parse。
 * 只转义开定界符不动闭定界符:闭的那个可能正是后面真公式的开头
 * (`$1 和 $\alpha$` → `\$1 和 $\alpha$`),所以每轮只改一处再重来,最多 4 轮。
 * 正文里没有违规美元时一次都不会重解析,常见情况零开销。
 */
function remarkDollarGuard(this: { parse: (doc: string) => MdNode }) {
  const processor = this;
  return (tree: MdNode, file: { value?: unknown }) => {
    let src = String(file);
    let current = tree;
    for (let round = 0; round < 4; round++) {
      const bad = offendingDollars(current, src);
      if (bad.length === 0) break;
      // 从后往前插,前面的偏移量才不会被自己挪动
      for (let i = bad.length - 1; i >= 0; i--) src = `${src.slice(0, bad[i])}\\${src.slice(bad[i])}`;
      current = processor.parse(src);
      file.value = src; // 让下游拿到的 position 与源码仍然对得上
    }
    return current;
  };
}

/**
 * 抽取二级标题做「本章目录」。必须跳过代码围栏 —— 教程正文里 bash / markdown 片段
 * 带 `## ` 的情况不少,不跳过会把代码行混进目录。
 */
export function extractToc(md: string): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  const seen = new Map<string, number>();
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
    const m = /^\s{0,3}##\s+(.+?)\s*$/.exec(line);
    if (m) {
      const text = headingText(m[1]);
      out.push({ id: uniqueId(seen, text), text });
    }
  }
  return out;
}

/**
 * @param headingIds 是否给 H2 挂锚点 id(默认挂,给「本章目录」跳转用)。
 *   聊天区必须传 false:一个会话里会同时渲染多条助手回复,各自从头计数的 slug
 *   会在同一个文档里撞成重复 id(HTML 非法,锚点跳转与读屏都指到第一条)。
 */
export function Markdown({ children, headingIds = true }: { children: string; headingIds?: boolean }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath, remarkDollarGuard]}
      // 公式写错时 rehype-katex 自己兜住 ParseError(不会把整页渲染带崩),
      // 退化成「原文标红」;这里只把那个红换成现成的 --err-text(规则 7:不新增视觉语言)。
      // 不挂 id 时连 rehypeHeadingIds 都不装,聊天区因此一个 id 都不会产出(见上方 headingIds 的说明)
      rehypePlugins={
        headingIds
          ? [[rehypeKatex, { errorColor: "var(--err-text)" }], rehypeHeadingIds]
          : [[rehypeKatex, { errorColor: "var(--err-text)" }]]
      }
      components={{
        h1: ({ children }) => (
          <h2 style={{ fontSize: 18, fontWeight: 650, marginTop: 30, marginBottom: 0 }}>{children}</h2>
        ),
        // id 由 rehypeHeadingIds 在 hast 上挂好后原样透传;这里不再计数(理由见那个插件)
        h2: ({ children, id }) => (
          <h2
            id={id}
            style={{ fontSize: 16, fontWeight: 650, marginTop: 30, marginBottom: 0, scrollMarginTop: 16 }}
          >
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 style={{ fontSize: 14, fontWeight: 650, marginTop: 22, marginBottom: 0 }}>{children}</h3>
        ),
        h4: ({ children }) => (
          <h4 style={{ fontSize: 13, fontWeight: 650, marginTop: 18, marginBottom: 0 }}>{children}</h4>
        ),
        h5: ({ children }) => (
          <h5 style={{ fontSize: 13, fontWeight: 650, marginTop: 18, marginBottom: 0 }}>{children}</h5>
        ),
        h6: ({ children }) => (
          <h6 style={{ fontSize: 13, fontWeight: 650, marginTop: 18, marginBottom: 0 }}>{children}</h6>
        ),
        p: ({ children }) => <p style={para}>{children}</p>,
        a: ({ href, children }) => (
          <a href={href} style={{ color: "var(--accent)" }}>
            {children}
          </a>
        ),
        strong: ({ children }) => <strong style={{ fontWeight: 650 }}>{children}</strong>,
        ul: ({ children }) => <ul style={{ ...para, paddingLeft: 22 }}>{children}</ul>,
        ol: ({ children }) => <ol style={{ ...para, paddingLeft: 22 }}>{children}</ol>,
        li: ({ children }) => <li style={{ marginTop: 4 }}>{children}</li>,
        hr: () => <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "26px 0 0" }} />,
        blockquote: ({ children }) => (
          <blockquote
            style={{
              borderLeft: "3px solid #b6bac2", borderRadius: "0 6px 6px 0", background: "var(--bg-subtle)",
              padding: "10px 14px", margin: "22px 0 0", fontSize: 14, lineHeight: 1.7, color: "var(--text-muted)",
            }}
          >
            {children}
          </blockquote>
        ),
        img: ({ src, alt }) => (
          // eslint-disable-next-line @next/next/no-img-element -- 正文图是同源静态资源,
          // 尺寸未知且不参与布局位移优化;上 next/image 会为每张图引入运行时开销
          <img
            src={typeof src === "string" ? src : ""}
            alt={alt ?? ""}
            style={{
              display: "block", maxWidth: "100%", height: "auto", marginTop: 14,
              border: "1px solid var(--border)", borderRadius: 7,
            }}
          />
        ),
        code: ({ className, children }) => {
          // 围栏代码由下面的 pre 负责画卡片,这里只处理行内代码
          if (className?.startsWith("language-")) return <code className={className}>{children}</code>;
          return <span style={inlineCode}>{children}</span>;
        },
        pre: ({ children }) => {
          const child = children as { props?: { className?: string; children?: ReactNode } } | undefined;
          const lang = child?.props?.className?.replace(/^language-/, "") ?? "text";
          return (
            <div
              style={{
                border: "1px solid var(--border)", borderRadius: 7, marginTop: 14,
                overflow: "hidden", boxShadow: "0 1px 0 rgba(0,0,0,0.03)",
              }}
            >
              <div
                style={{
                  display: "flex", alignItems: "center", padding: "6px 12px",
                  background: "var(--bg-panel)", borderBottom: "1px solid var(--border)",
                }}
              >
                <span style={{ ...mono(11, 650), color: "var(--text-muted)", flex: 1 }}>{lang}</span>
              </div>
              <pre style={{ margin: 0, padding: "12px 14px", font: "400 12px/1.7 var(--font-mono)", overflow: "auto" }}>
                {child?.props?.children}
              </pre>
            </div>
          );
        },
        // 画板 2c 没有表格样例;按代码块卡片的同一套 token 构造,不新增视觉语言。
        // 宽表在自己的容器里横向滚动,不让整页出现横向滚动条。
        table: ({ children }) => (
          <div style={{ marginTop: 14, border: "1px solid var(--border)", borderRadius: 7, overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13, lineHeight: 1.6 }}>
              {children}
            </table>
          </div>
        ),
        thead: ({ children }) => <thead style={{ background: "var(--bg-panel)" }}>{children}</thead>,
        th: ({ children }) => (
          <th
            style={{
              textAlign: "left", fontWeight: 600, padding: "8px 12px",
              borderBottom: "1px solid var(--border)", whiteSpace: "nowrap",
            }}
          >
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td style={{ padding: "8px 12px", borderTop: "1px solid var(--bg-hover)", verticalAlign: "top" }}>
            {children}
          </td>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
