// 章节正文渲染:标准 markdown(GFM)→ 设计稿画板 2c 的排版。
//
// 库里存的是 markdown、渲染在前端(所有者裁定 2026-08-31 决策 2)。这里做的事只有一件:
// 把 markdown 的元素映射到**画板 2c 已有的那套内联样式上**,不引入新的视觉语言
// (CLAUDE.md 规则 7)。画板没给样式的元素(列表 / 表格 / 分隔线 / 图片)按同一套
// design token 就近构造,理由与影响范围写在 rounds/round-05/round-05.md。
//
// 裸 HTML 不放行:react-markdown 默认丢弃 html 节点(没挂 rehype-raw),
// vault 正文里残留的标签会被忽略而不是执行 —— 这是 XSS 的兜底,不要为了渲染
// 某个 <details> 而挂 rehype-raw。
import type { CSSProperties, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { mono } from "@/lib/styles";

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

/** 渲染后的 React 子树 → 纯文本,用于给标题算 id */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  const el = node as { props?: { children?: ReactNode } };
  return el.props ? textOf(el.props.children) : "";
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

export function Markdown({ children }: { children: string }) {
  // 与 extractToc 共用同一套 slug + 同名去重规则,两边各自从头计数即可对齐
  const seen = new Map<string, number>();

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h2 style={{ fontSize: 18, fontWeight: 650, marginTop: 30, marginBottom: 0 }}>{children}</h2>
        ),
        h2: ({ children }) => (
          <h2
            id={uniqueId(seen, textOf(children))}
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
