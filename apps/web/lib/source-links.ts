// Source 源码 tab 里 markdown 文件的相对链接改写(R-SOURCE,codex 第 2 / 3 轮 P2)。
//
// README / docs 里的 `[x](docs/security.md)` `[y](../rounds/BACKLOG.md#z)` 是**仓库内**相对路径;页面地址是 `/source`(首页)或
// `/source/docs/a.md`,浏览器会把它们解析成 `/docs/security.md` 这种站点 404。这里给出「一个链接目标 → 改写后的 href」的纯函数,
// 由 `lib/remark-link-href.ts` 的 remark 插件在 **mdast 的 link 节点**上调用 —— code span / 围栏代码 / 普通文本里
// 长得像链接的字符串不会被碰(第 2 轮那版逐行正则会误伤 `` `X[name](ctx)` ``,第 3 轮被点掉了);
// 引用式的 `definition` 也不碰(引用式图片共用它,第 4 轮被点掉了)—— 引用式链接因此保持原样,仓库里的 README / docs 用的都是行内链接。
// copy 按钮复制的仍是原文;图片节点(image)不在改写之列(指到源码页也显示不了,原样留着与改前一样 404,不更坏)。
//
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

/**
 * 给 remark 插件用的改写函数:仓库内相对目标 → `/source/<解析后路径>`(锚点保留);其余回 null(不动)。
 * `filePath` 是当前显示的文件(相对解析的基准)。
 */
export function sourceLinkHref(filePath: string): (url: string) => string | null {
  return (url) => {
    if (url === "" || NOT_RELATIVE.test(url)) return null;
    const hash = url.indexOf("#");
    const pathPart = hash >= 0 ? url.slice(0, hash) : url;
    const fragment = hash >= 0 ? url.slice(hash) : "";
    if (pathPart === "") return null;
    const resolved = resolveSourcePath(filePath, pathPart);
    if (!resolved) return null;
    return `${hrefFor(resolved)}${fragment}`;
  };
}
