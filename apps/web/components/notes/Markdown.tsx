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
 * 目录锚点 id。**只按出现序号**,不掺标题文本:目录侧看到的是 markdown 原文
 * (`## [x](y)`),渲染侧看到的是解析后的文本(`x`),掺文本会让两边算出不同的 id,
 * 锚点静默失效。序号两边都是「跳过围栏后的第 n 个 h2」,必然一致。
 */
export function headingId(index: number): string {
  return `h-${index}`;
}

/**
 * 抽取二级标题做「本章目录」。必须跳过代码围栏 —— 教程正文里 bash / markdown 片段
 * 带 `## ` 的情况不少,不跳过会把代码行混进目录。
 */
export function extractToc(md: string): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  let fence: string | null = null;
  let i = 0;
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
      const text = m[1].replace(/[*_`]/g, "").trim();
      out.push({ id: headingId(i++), text });
    }
  }
  return out;
}

export function Markdown({ children }: { children: string }) {
  // h2 的 id 要和 extractToc 编号一致,这里用同一个计数器按出现顺序发号
  let h2Index = 0;

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h2 style={{ fontSize: 18, fontWeight: 650, marginTop: 30, marginBottom: 0 }}>{children}</h2>
        ),
        h2: ({ children }) => (
          <h2
            id={headingId(h2Index++)}
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
