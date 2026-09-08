// remark 插件:改写 mdast 里 **link / definition 节点**的目标地址(R-SOURCE,codex 第 3 轮 P2)。
//
// 只碰真正的链接节点,code span / 围栏代码 / 普通文本里长得像 `[x](y)` 的字符串一个字都不动 ——
// 这正是逐行正则做不到的(`` `SESSION_TOOL_REGISTRY[name](ctx)` `` 会被正则当成链接)。
// 与 Markdown.tsx 里的 remarkDollarGuard 同一形态:一个遍历 mdast 的小函数,不引 unist-util-visit。
//
// **纯的**:不 import 任何组件 / css,`bun test lib` 直接测。

/** mdast 里我们会读的那几个字段,不为此引 @types/mdast */
export interface MdNode {
  type: string;
  url?: string;
  children?: MdNode[];
}

/** 深度遍历,把每个 link / definition 的 url 交给 fn;fn 回 null 表示不动 */
export function rewriteLinkNodes(tree: MdNode, fn: (url: string) => string | null): void {
  if ((tree.type === "link" || tree.type === "definition") && typeof tree.url === "string") {
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
