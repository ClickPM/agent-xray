// 画板 2h 的三 token 代码高亮(R-SKILLS,所有者裁定第 4 条:自写最小 tokenizer,不引高亮库)。
//
// 只做三种颜色 —— 关键字 / 字符串 / 注释(含 docstring)—— 其余一律等宽正文色;
// 只做四种语言 python / typescript / javascript / shell,其余 kind(json / yaml / toml / text)
// 原样输出。它不是语法分析器:目标是让画板上那三种颜色落在对的词上,而不是覆盖每一种边角
// (正则字面量、f-string 内嵌表达式、heredoc 都按最朴素的规则走)。
//
// 输入是访客可下载的 skill 文件原文;输出只是「切成带类别的字符串片段」,
// 交给 React 当文本渲染 —— 这里不生成 HTML,内容永远不会被当成标记解析。

export type TokenType = "kw" | "str" | "cmt" | "p";

export interface Token {
  t: TokenType;
  s: string;
}

type Lang = "python" | "typescript" | "javascript" | "shell";

const KEYWORDS: Record<Lang, ReadonlySet<string>> = {
  python: new Set(
    "False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case self".split(" "),
  ),
  typescript: new Set(
    "abstract any as async await boolean break case catch class const constructor continue debugger declare default delete do else enum export extends false finally for from function get if implements import in instanceof interface is keyof let module namespace never new null number of package private protected public readonly return satisfies set static string super switch symbol this throw true try type typeof undefined unique unknown var void while with yield".split(" "),
  ),
  javascript: new Set(
    "async await break case catch class const continue debugger default delete do else export extends false finally for from function get if import in instanceof let new null of return set static super switch this throw true try typeof undefined var void while with yield".split(" "),
  ),
  shell: new Set(
    "if then else elif fi for while until do done case esac in function select time return exit export local readonly declare set unset shift source break continue true false".split(" "),
  ),
};

function langOf(kind: string): Lang | null {
  return kind === "python" || kind === "typescript" || kind === "javascript" || kind === "shell" ? kind : null;
}

/** 跨行状态:正处在一个多行块里(python 三引号 / js 块注释 / 模板字面量) */
interface Block {
  t: "str" | "cmt";
  close: string;
}

function isIdentStart(ch: string, lang: Lang): boolean {
  return /[A-Za-z_]/.test(ch) || (lang !== "python" && lang !== "shell" && ch === "$");
}

function isIdentChar(ch: string, lang: Lang): boolean {
  return /[A-Za-z0-9_]/.test(ch) || (lang !== "python" && lang !== "shell" && ch === "$");
}

/**
 * 整个文件 → 每行的 token 列表。行数与 `text.split("\n")` 一致;
 * 末尾换行产生的最后一个空行由调用方决定要不要显示。
 */
export function highlight(kind: string, text: string): Token[][] {
  const lang = langOf(kind);
  const lines = text.split("\n");
  if (!lang) return lines.map((l) => [{ t: "p", s: l }]);

  let block: Block | null = null;
  return lines.map((line) => {
    const out: Token[] = [];
    let plain = "";
    const flush = () => {
      if (plain) out.push({ t: "p", s: plain });
      plain = "";
    };
    let i = 0;
    while (i < line.length) {
      if (block) {
        const end = line.indexOf(block.close, i);
        if (end < 0) {
          flush();
          out.push({ t: block.t, s: line.slice(i) });
          i = line.length;
        } else {
          flush();
          out.push({ t: block.t, s: line.slice(i, end + block.close.length) });
          i = end + block.close.length;
          block = null;
        }
        continue;
      }

      const ch = line[i];
      const two = line.slice(i, i + 2);
      const three = line.slice(i, i + 3);

      // 注释
      if ((lang === "python" || lang === "shell") && ch === "#" && !(lang === "shell" && line[i - 1] === "$")) {
        flush();
        out.push({ t: "cmt", s: line.slice(i) });
        break;
      }
      if ((lang === "typescript" || lang === "javascript") && two === "//") {
        flush();
        out.push({ t: "cmt", s: line.slice(i) });
        break;
      }
      if ((lang === "typescript" || lang === "javascript") && two === "/*") {
        flush();
        block = { t: "cmt", close: "*/" };
        // 让上面的 block 分支从 `/*` 之后找闭合;先把开头两个字符吞进块里
        const end = line.indexOf("*/", i + 2);
        if (end < 0) {
          out.push({ t: "cmt", s: line.slice(i) });
          i = line.length;
        } else {
          out.push({ t: "cmt", s: line.slice(i, end + 2) });
          i = end + 2;
          block = null;
        }
        continue;
      }

      // python 三引号:docstring 与注释同色(画板 2h)
      if (lang === "python" && (three === '"""' || three === "'''")) {
        flush();
        const end = line.indexOf(three, i + 3);
        if (end < 0) {
          out.push({ t: "cmt", s: line.slice(i) });
          block = { t: "cmt", close: three };
          i = line.length;
        } else {
          out.push({ t: "cmt", s: line.slice(i, end + 3) });
          i = end + 3;
        }
        continue;
      }

      // 模板字面量可跨行
      if ((lang === "typescript" || lang === "javascript") && ch === "`") {
        flush();
        const end = findClose(line, i + 1, "`");
        if (end < 0) {
          out.push({ t: "str", s: line.slice(i) });
          block = { t: "str", close: "`" };
          i = line.length;
        } else {
          out.push({ t: "str", s: line.slice(i, end + 1) });
          i = end + 1;
        }
        continue;
      }

      // 单行字符串
      if (ch === '"' || ch === "'") {
        flush();
        const end = findClose(line, i + 1, ch);
        const stop = end < 0 ? line.length : end + 1;
        out.push({ t: "str", s: line.slice(i, stop) });
        i = stop;
        continue;
      }

      // 标识符 / 关键字
      if (isIdentStart(ch, lang)) {
        let j = i + 1;
        while (j < line.length && isIdentChar(line[j], lang)) j++;
        const word = line.slice(i, j);
        // `.length` / `obj.default` 这类成员访问不算关键字
        const prev = line.slice(0, i).trimEnd();
        if (KEYWORDS[lang].has(word) && !prev.endsWith(".")) {
          flush();
          out.push({ t: "kw", s: word });
        } else {
          plain += word;
        }
        i = j;
        continue;
      }

      plain += ch;
      i++;
    }
    flush();
    return out;
  });
}

/** 从 from 起找未被反斜杠转义的闭合引号;找不到回 -1 */
function findClose(line: string, from: number, quote: string): number {
  for (let k = from; k < line.length; k++) {
    if (line[k] === "\\") {
      k++;
      continue;
    }
    if (line[k] === quote) return k;
  }
  return -1;
}
