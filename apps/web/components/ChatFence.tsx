"use client";

// R-CARDS / R-CARDS-2:会话区的围栏渲染器 —— ` ```xray-card ` / ` ```xray-html ` 围栏的三个出口(骨架 / 组件 / 代码块),
// 以及「每轮最多两个组件」的硬限。**只在会话区用**(`Markdown` 的 `cards` / `html` 任一为真时),Notes / Skills / Source 仍走
// `Markdown.tsx` 里那个内联的普通 `pre`。
//
// 【为什么是一个模块级组件 + Context,而不是 `Markdown` 里的内联回调】react-markdown 把 `components.pre` 当**元素类型**用;
// 内联回调每次渲染都是新函数 → React 认成不同类型 → 整棵子树卸载重挂。R-CARDS 的卡片没暴露这个问题(memo 的 `AssistantMessage`
// 让已完成的消息不再渲染),R-CARDS-2 两处撞上:① 可回传卡点过之后一轮生成期间父层重渲染,卡的「已发送锁定」本地态被重挂清掉;
// ② 帧在围栏闭合后正文还在流,每个 delta 重挂一次 = 帧重载一次(任务卡派生取舍 9:「一次围栏只建一次帧」)。
// 所以渲染器是**恒等的组件类型**,每次渲染会变的东西(源文本 / 预算 / 开关 / 流式态 / 预填通路)经 `ChatFenceContext` 送进来。
import { createContext, useContext, type ReactNode } from "react";
import { fenceUnterminated, parseCard } from "@/lib/xray-card";
import { HTML_LANG, declaredHeight, fenceInfo, htmlWithinLimit } from "@/lib/xray-html";
import { COMPONENT_ATTR } from "@/lib/remark-component-budget";
import { CodeBlock, codeText, fenceLang, type PreChild } from "@/components/CodeBlock";
import { XrayCard, XrayCardSkeleton } from "@/components/XrayCard";
import { XrayHtml, XrayHtmlSkeleton } from "@/components/XrayHtml";

/** R-CARDS:信息卡片围栏的语言标签(` ```xray-card `);回落成代码块时头部条上显示的也是它 */
export const CARD_LANG = "xray-card";

export interface ChatFenceValue {
  /** 整篇正文(围栏未闭合的判据与 info string 都从它上面取) */
  source: string;
  cards: boolean;
  html: boolean;
  streaming: boolean;
  onAsk?: (text: string) => void;
}

const ChatFenceContext = createContext<ChatFenceValue | null>(null);

export function ChatFenceProvider({ value, children }: { value: ChatFenceValue; children: ReactNode }) {
  return <ChatFenceContext.Provider value={value}>{children}</ChatFenceContext.Provider>;
}

/**
 * 会话区的 `pre`。三个出口(画板 2t / 2v 裁定):
 *   围栏未闭合 → 流式期间骨架、流结束了仍没闭合 → 代码块(闭合之前即使 JSON 已完整也不画卡,codex 第 1 轮 P2);
 *   闭合且合法 → 卡 / 帧;其余(闭合了仍不合法 / 超限 / 未知 kind / 第三个起 / 拿不到行号)→ 普通代码块,
 *   语言标签就是围栏名、正文是那段原始文本,**没有错误提示**。
 * 「前两个」的标记由 `lib/remark-component-budget.ts` 在 mdast 上打好、落在 `<code>` 元素的 `data-xray-component` 上(没有标记 = 第三个起);
 * 开围栏的行号来自 hast 的 position(mdast-util-to-hast 把 code 节点的 position 原样拷到 pre 上);帧的高度从开围栏行的 info string 读(`height=`),
 * 骨架按同一高度立住。
 */
export function ChatFencePre({ children, node }: { children?: ReactNode; node?: unknown }) {
  const ctx = useContext(ChatFenceContext);
  const child = children as PreChild;
  const lang = fenceLang(child);
  const isCard = !!ctx?.cards && lang === CARD_LANG;
  const isHtml = !!ctx?.html && lang === HTML_LANG;
  if (ctx && (isCard || isHtml) && child?.props?.[COMPONENT_ATTR] !== undefined) {
    const line = (node as { position?: { start?: { line?: number } } } | undefined)?.position?.start?.line;
    if (typeof line === "number") {
      const raw = codeText(child?.props?.children);
      if (fenceUnterminated(ctx.source, line)) {
        if (ctx.streaming) return isCard ? <XrayCardSkeleton /> : <XrayHtmlSkeleton declared={declaredHeight(fenceInfo(ctx.source, line))} />;
      } else if (isCard) {
        const spec = parseCard(raw);
        if (spec) return <XrayCard spec={spec} onAsk={ctx.onAsk} />;
      } else if (htmlWithinLimit(raw)) {
        return <XrayHtml html={raw} declared={declaredHeight(fenceInfo(ctx.source, line))} />;
      }
    }
  }
  return <CodeBlock lang={lang}>{child?.props?.children}</CodeBlock>;
}
