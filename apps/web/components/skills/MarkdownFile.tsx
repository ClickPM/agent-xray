// 详情页右栏的 markdown 文件预览(画板 2g 的 SKILL.md 态):frontmatter 键值块 + 既有 components/Markdown。
//
// **服务端与客户端通用**(R-PERF 改)。本组件没有 hook、输出只由 content 决定,两边都能渲染:
// - 服务端:`page.tsx` 只为**当前要显示的那一个**文件预渲染(首屏直出、可被搜索引擎读到);
// - 客户端:`SkillDetail` 切到别的 markdown 文件时就地渲染,不打后端。
//
// 曾经这里写着「刻意不进客户端树」,理由是 `Markdown` 的标题 id 按渲染次序计数,进客户端后
// 开发态 StrictMode 双调用会把 id 数成 `何时用-1`。那条约束在 R-PERF 里被根治掉了 ——
// id 改由 `Markdown.tsx` 的 rehypeHeadingIds 在 hast 上一次算定,与渲染几次无关。
// 之所以要解掉它:整包 markdown 全在服务端预渲染让 ppt-master 的 RSC 载荷到了 1.57 MB / 5–7 秒,
// 还偶发水合失败(React #418)。
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
