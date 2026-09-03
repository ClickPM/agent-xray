// 详情页右栏的 markdown 文件预览(画板 2g 的 SKILL.md 态):frontmatter 键值块 + 既有 components/Markdown。
//
// **这是 Server Component,刻意不进客户端树**:`Markdown` 的标题 id 是渲染时按出现次序计数的
// (与 extractToc 两边各自从头数),放进 Client Component 后 React 开发态的 StrictMode 会把
// 渲染函数双调用,id 变成 `何时用-1`,与服务端输出对不上(2026-09-03 实测:水合警告)。
// Notes 文章页把 Markdown 放在服务端所以没这个问题;这里照做 —— page.tsx 把每个 markdown 文件
// 预渲染成 ReactNode 传给 SkillDetail,客户端只负责「显示哪一个」。Markdown.tsx 本轮零改动(规则 7)。
//
// **内容永远只是文本**:frontmatter 的值与正文都交给 React / Markdown 组件当字符串处理,不开 raw HTML
// (docs/security.md §4 R-SKILLS 补记)。含 <script> 的 .md 在页面上就是那几个字符。
import { Markdown } from "@/components/Markdown";
import { splitFrontmatter } from "@/lib/frontmatter";
import { mono } from "@/lib/styles";

export function MarkdownFile({ content }: { content: string }) {
  const { entries, body } = splitFrontmatter(content);
  return (
    <div style={{ padding: "4px 24px 24px" }}>
      {entries.length > 0 && (
        <div
          style={{
            background: "var(--bg-panel)", borderRadius: 6, padding: "10px 12px", marginTop: 16,
            display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 14px", alignItems: "baseline",
          }}
        >
          {entries.map((e, i) => (
            <FrontmatterRow key={`${i}-${e.key}`} k={e.key} v={e.value} />
          ))}
        </div>
      )}
      <Markdown>{body}</Markdown>
    </div>
  );
}

function FrontmatterRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <span style={{ ...mono(11, 600), color: "var(--text-muted)" }}>{k}</span>
      {/* 画板 2g:name 的值等宽,description 的值正文字体 */}
      {k === "name" ? (
        <span style={{ ...mono(12), lineHeight: 1.6 }}>{v}</span>
      ) : (
        <span style={{ fontSize: 12, lineHeight: 1.6 }}>{v}</span>
      )}
    </>
  );
}
