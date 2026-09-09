"use client";

// R-CARDS-2:可回传卡(`choice` / `form`)通往 composer 的那条线(画板 2u / 5a;`docs/security.md` §0 第 12 条 ③)。
//
// `onSend` = 把一句话作为访客消息发出,走既有 composer 的发送函数(`Workbench` 的 `sendFromCard` → `sendText`);
// `busy` = 一轮生成中,卡上的选项与按钮禁用(与 composer 发送按钮同一判据、同一禁用视觉)。
//
// 【为什么是 Context 而不是 props】`AssistantMessage` 是 memo 的(流式期间靠它避免每帧重解析全部 markdown);`busy` 一轮变两次,
// 作为 props 传下去会让**每一条**已完成的消息都跟着重渲染两次。Context 的消费者只有卡本身:值变了只有卡重渲染,memo 层原封不动。
// 缺省值 `busy: true` + 没有 `onSend`:Workbench 之外(理论上不会有,会话区是唯一开卡的地方)可回传卡按禁用画,不会有可点的出口。
import { createContext, useContext } from "react";

export interface ComposerValue {
  busy: boolean;
  onSend?: (text: string) => void;
}

export const ComposerContext = createContext<ComposerValue>({ busy: true });

export function useComposer(): ComposerValue {
  return useContext(ComposerContext);
}
