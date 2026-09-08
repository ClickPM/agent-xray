// remark 插件:改写 mdast 里 **link 节点**的目标地址(R-SOURCE,codex 第 3 / 4 轮 P2)。
//
// 只碰行内链接节点(`[x](y)`),code span / 围栏代码 / 普通文本里长得像 `[x](y)` 的字符串一个字都不动 ——
// 这正是逐行正则做不到的(`` `SESSION_TOOL_REGISTRY[name](ctx)` `` 会被正则当成链接,第 3 轮)。
//
// **刻意不碰 `definition`**(第 4 轮):引用式图片 `![alt][img]` 与引用式链接 `[x][ref]` 共用同一种 `definition` 节点,
// 改写它会把 `<img src>` 指到源码页面。要区分「这条定义被谁引用」就得再长一套引用追踪 —— 同一块自建机制连续三轮被点,
// 按「审查循环不是设计」的口径选删代码:引用式链接保持原样(与改前一样 404,不更坏),仓库里的 README / docs 用的都是行内链接。
// 与 Markdown.tsx 里的 remarkDollarGuard 同一形态:一个遍历 mdast 的小函数,不引 unist-util-visit。
//
// **纯的**:不 import 任何组件 / css,`bun test lib` 直接测。

/** mdast 里我们会读的那几个字段,不为此引 @types/mdast */
export interface MdNode {
  type: string;
  url?: string;
  children?: MdNode[];
}

/** 深度遍历,把每个 link 的 url 交给 fn;fn 回 null 表示不动。image / imageReference / definition / linkReference 一律不碰 */
export function rewriteLinkNodes(tree: MdNode, fn: (url: string) => string | null): void {
  if (tree.type === "link" && typeof tree.url === "string") {
    const next = fn(tree.url);
    if (next !== null) tree.url = next;
  }
  if (tree.children) for (const c of tree.children) rewriteLinkNodes(c, fn);
}

/** react-markdown 的 remarkPlugins 里用:`remarkLinkHref(fn)` */
export function remarkLinkHref(fn: (url: string) => string | null) {
  return () => (tree: MdNode) => {
    rewriteLinkNodes(tree, fn);
  };
}
