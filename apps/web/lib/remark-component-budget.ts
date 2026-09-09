// remark 插件:R-CARDS-2「每轮最多两个组件」的前端硬限 —— 在 mdast 上按文档序给**前 N 个** xray 围栏(卡 / 帧不分)的 `code` 节点
// 打一个标记,会话区渲染器(`components/ChatFence.tsx`)只把带标记的围栏当组件,其余走代码块出口。
//
// 【为什么在解析器自己的树上数,而不是扫源文本】(所有者裁定 2026-09-09,codex 第 2 / 3 轮)第一版是一个逐行正则扫描器
// (`leadingComponentFences`),它得自己判断「这一行是不是围栏」—— 第 2 轮嫌它把顶层四个空格缩进的代码块当围栏,收紧到 ≤ 3 空格后
// 第 3 轮又嫌它拒掉列表续行里的合法围栏(那四个空格是列表容器的缩进)。判据两边分叉的根因是扫描器在重新实现 CommonMark 的一角;
// 按「审查循环不是设计」的规矩停下来换方案:围栏是不是围栏由 micromark 说了算,这里只在它产出的树上数,两边**不可能**再不一致。
// 与 `remarkDollarGuard` / `remarkLinkHref` 同一形态:一个遍历 mdast 的小函数,不引 unist-util-visit。
//
// **纯的**:不 import 任何组件 / css,`bun test lib` 直接测。标记经 mdast-util-to-hast 的 `data.hProperties` 落到 `<code>` 元素上,
// 再由 react-markdown 变成 `<code>` React 元素的 `data-xray-component` prop(`pre` 渲染器拿到的 children 就是它)。
import { COMPONENT_LANGS } from "./xray-card";

/** 落到 `<code>` 上的属性名(hast 属性名 `dataXrayComponent` 的 HTML 形态) */
export const COMPONENT_ATTR = "data-xray-component";

/** mdast 里我们会读 / 写的那几个字段,不为此引 @types/mdast */
export interface MdNode {
  type: string;
  lang?: string | null;
  children?: MdNode[];
  data?: { hProperties?: Record<string, unknown> } & Record<string, unknown>;
}

/**
 * 按文档序(深度优先,与渲染顺序一致)给前 `limit` 个 xray 围栏打标记,返回打了几个。
 * 只认 `code` 节点的 `lang`(micromark 已经把 info string 的第一个词放在这里,` ```xray-html height=320 ` 的 lang 就是 `xray-html`);
 * 缩进代码块的 `lang` 是 null,天然不算。列表项 / 引用块里的围栏与顶层的一视同仁 —— 位置由树决定,不由缩进决定。
 */
export function markComponentFences(tree: MdNode, limit: number): number {
  let marked = 0;
  const walk = (node: MdNode): void => {
    for (const kid of node.children ?? []) {
      if (marked >= limit) return;
      if (kid.type === "code") {
        if (typeof kid.lang === "string" && (COMPONENT_LANGS as readonly string[]).includes(kid.lang)) {
          kid.data = { ...kid.data, hProperties: { ...kid.data?.hProperties, dataXrayComponent: "1" } };
          marked++;
        }
        continue; // code 节点没有子节点
      }
      walk(kid);
    }
  };
  walk(tree);
  return marked;
}

/**
 * unified 插件形态(与 `remarkLinkHref` 同一形状):工厂 → attacher → transformer。
 * `remarkPlugins={[remarkComponentBudget(2)]}`;unified 调 attacher 拿 transformer,transformer 拿到 mdast 的 root。
 */
export function remarkComponentBudget(limit: number) {
  return function attacher() {
    return (tree: MdNode) => {
      markComponentFences(tree, limit);
    };
  };
}
