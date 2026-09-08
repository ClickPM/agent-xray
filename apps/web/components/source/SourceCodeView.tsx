// Source 文件页的代码预览(画板 2o):36px 行号列钉住,**只有代码列一个 `overflow-x:auto` 容器**横滚。
//
// 与 Skills 的 `CodeView`(画板 2h)刻意分开:那一个整块横滚(行号跟着走),是 2h 的定格;2o 的裁定是
// 「长行在代码列内部横向滚动,行号列与页面都不动」,行高写死 20.4px(= 12×1.7)让 11px 的号码与代码行严格同格。
// 规则 7:Skills 的组件零改动,所以这里另写一份,而不是给 CodeView 加开关。
//
// 纯函数、无 hook,服务端与客户端都能渲染。**内容永远只是文本**:tokenizer 只切字符串,不生成 HTML。
import { highlight, type TokenType } from "@/lib/highlight";

/** 三 token 的颜色:关键字 / 字符串 / 注释(design/README.md 的 Skills 一节,Source 沿用),其余继承正文色 */
const TOKEN_COLOR: Record<TokenType, string | undefined> = {
  kw: "var(--accent)",
  str: "var(--ok-text)",
  cmt: "var(--text-dim)",
  p: undefined,
};

const LINE_HEIGHT = "20.4px";

export function SourceCodeView({ kind, content }: { kind: string; content: string }) {
  // 行数口径与服务端 lines 一致:空文件 0 行,末尾换行不另起一行(a\nb\n 是 2 行)
  const lines = content === "" ? [] : highlight(kind, content);
  if (lines.length > 1 && content.endsWith("\n")) lines.pop();

  return (
    <div style={{ display: "flex", font: "400 12px/1.7 var(--font-mono)", padding: "12px 0" }}>
      {/* 行号列在滚动容器之外:长行横滚时它钉住不动 */}
      <div style={{ flex: "none", width: 36, display: "flex", flexDirection: "column", borderRight: "1px solid var(--border)" }}>
        {lines.map((_, i) => (
          <span
            key={i}
            style={{ fontSize: 11, lineHeight: LINE_HEIGHT, color: "var(--text-dim)", textAlign: "right", paddingRight: 10, userSelect: "none" }}
          >
            {i + 1}
          </span>
        ))}
      </div>
      {/* 唯一一处 overflow-x:auto:整个代码列一条滚动条,落在卡片下沿;不做逐行滚动 */}
      <div style={{ flex: 1, minWidth: 0, overflowX: "auto" }}>
        {lines.map((tokens, i) => (
          <div
            key={i}
            style={{ padding: "0 24px 0 14px", lineHeight: LINE_HEIGHT, whiteSpace: "pre", width: "max-content", minWidth: "100%", boxSizing: "border-box" }}
          >
            {tokens.length === 0
              ? " "
              : tokens.map((t, j) => (t.t === "p" ? t.s : <span key={j} style={{ color: TOKEN_COLOR[t.t] }}>{t.s}</span>))}
          </div>
        ))}
      </div>
    </div>
  );
}
