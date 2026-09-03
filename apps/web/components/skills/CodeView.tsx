// 详情页右栏的代码预览(画板 2h 的 Python 态):带行号的网格 + 三 token 高亮(lib/highlight.ts)。
//
// 纯函数、无 hook、输出只由 (kind, content) 决定,所以放在客户端树里也不会有水合差异
// (markdown 文件走服务端的 MarkdownFile,理由见那个文件头)。
// **内容永远只是文本**:tokenizer 只切字符串,不生成 HTML;含 <script> 的 .py 在页面上就是那几个字符。
import { highlight, type TokenType } from "@/lib/highlight";

/** 三 token 的颜色:关键字 / 字符串 / 注释(design/README.md 的 Skills 一节),其余继承正文色 */
const TOKEN_COLOR: Record<TokenType, string | undefined> = {
  kw: "var(--accent)",
  str: "var(--ok-text)",
  cmt: "var(--text-dim)",
  p: undefined,
};

export function CodeView({ kind, content }: { kind: string; content: string }) {
  // 行数口径与服务端 line_count 一致:空文件 0 行(不画一个编号 1 的空行,头部写的是 `0 行`),
  // 末尾换行不另起一行(a\nb\n 是 2 行)
  const lines = content === "" ? [] : highlight(kind, content);
  if (lines.length > 1 && content.endsWith("\n")) lines.pop();

  return (
    <div
      style={{
        display: "grid", gridTemplateColumns: "36px minmax(0,1fr)",
        font: "400 12px/1.7 var(--font-mono)", padding: "12px 0",
        // 长行在整块里横向滚动,而不是每一行各自出一条滚动条(画板是静态定格,画不出这层差别)
        overflowX: "auto",
      }}
    >
      {lines.map((tokens, i) => (
        <LineRow key={i} n={i + 1} tokens={tokens} />
      ))}
    </div>
  );
}

function LineRow({ n, tokens }: { n: number; tokens: { t: TokenType; s: string }[] }) {
  return (
    <>
      <span
        style={{
          fontSize: 11, color: "var(--text-dim)", textAlign: "right", paddingRight: 10,
          borderRight: "1px solid var(--border)", userSelect: "none",
        }}
      >
        {n}
      </span>
      <span style={{ padding: "0 24px 0 14px", whiteSpace: "pre" }}>
        {tokens.map((t, i) =>
          t.t === "p" ? t.s : <span key={i} style={{ color: TOKEN_COLOR[t.t] }}>{t.s}</span>,
        )}
      </span>
    </>
  );
}
