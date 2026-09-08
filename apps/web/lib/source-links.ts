// Source 源码 tab 里 markdown 文件的相对链接改写(R-SOURCE,codex 第 2 轮 P2)。
//
// README / docs 里的 `[x](docs/security.md)` `[y](../rounds/BACKLOG.md#z)` 是**仓库内**相对路径;页面地址是 `/source`(首页)或
// `/source/docs/a.md`,浏览器会把它们解析成 `/docs/security.md` 这种站点 404。这里在**渲染前**把仓库内相对链接改成 `/source/<解析后的路径>`,
// 与 Notes 曾经的改写器不是一回事:不改写正文的任何别的东西,只碰行内链接的目标;copy 按钮复制的仍是原文。
//
// 只改「链接」不改「图片」:图片的目标会是一张图,指到源码页也显示不了,原样留着(与改前一样 404,不更坏);
// 围栏代码块(``` / ~~~)里的内容不碰 —— 文档里演示 markdown 语法的例子不该被改。
// **必须是纯的**:被 Server Component(page.tsx)与 Client Component(SourceBrowser 的客户端回落)同时 import。

/** 绝对地址(带 scheme)、站内根路径、纯锚点:都不是仓库内相对路径,不碰 */
const NOT_RELATIVE = /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i;

/**
 * 相对路径按当前文件所在目录解析成仓库根相对路径;解析到仓库根之外(`..` 超出)回 null。
 * 只认 `/` 分隔;`.` 段丢掉,`..` 回退一级。
 */
export function resolveSourcePath(fromFile: string, rel: string): string | null {
  const base = fromFile.split("/").slice(0, -1);
  const out = [...base];
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.length === 0 ? null : out.join("/");
}

/** `/source/<path>`,逐段编码(与 SourceBrowser 的 sourceHref 同一口径) */
function hrefFor(path: string): string {
  return `/source/${path.split("/").map(encodeURIComponent).join("/")}`;
}

// 行内链接:`[text](target)` / `[text](<target>)` / `[text](target "title")`;前面不是 `!`(图片不碰)
const INLINE_LINK = /(^|[^!])\[([^\]\n]*)\]\(<?([^)\s>]+)>?((?:\s+"[^"\n]*")?)\)/g;
const FENCE = /^\s*(```|~~~)/;

/** 把 markdown 正文里指向仓库内文件的相对链接改成 `/source/...`;围栏代码块内不动 */
export function rewriteSourceLinks(md: string, filePath: string): string {
  const lines = md.split("\n");
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    lines[i] = lines[i].replace(INLINE_LINK, (whole, pre: string, text: string, target: string, title: string) => {
      if (NOT_RELATIVE.test(target)) return whole;
      const hash = target.indexOf("#");
      const pathPart = hash >= 0 ? target.slice(0, hash) : target;
      const fragment = hash >= 0 ? target.slice(hash) : "";
      if (pathPart === "") return whole;
      const resolved = resolveSourcePath(filePath, pathPart);
      if (!resolved) return whole;
      return `${pre}[${text}](${hrefFor(resolved)}${fragment}${title})`;
    });
  }
  return lines.join("\n");
}
