// SSE 分帧器(R3 建于 agent-api.ts,R4 抽出:对话流与轨迹流两条流共用)。
//
// 用 fetch + ReadableStream 而不是 `EventSource`:对话流是 POST(EventSource 只能
// GET),轨迹流则需要按 HTTP 状态码分档处理(404 会话不存在要停,429 要退避,
// 网络中断要重连)——`EventSource` 的 onerror 拿不到状态码,只会无脑重连。

export interface SseFrame {
  event: string;
  data: string;
}

/** 把一个帧块切成 {event, data};注释帧(`: hb` 心跳)与无 event 的帧返回 null。 */
export function parseFrame(block: string): SseFrame | null {
  let event = "";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trim());
  }
  return event ? { event, data: data.join("\n") } : null;
}

/**
 * 按 `\n\n` 切帧,逐帧产出直到流结束。
 * 调用方用 `break` / `return` 提前退出时,for-await 会调用生成器的 return,
 * 下面的 finally 负责释放 reader —— 否则连接会一直挂着。
 */
export async function* sseFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const frame = parseFrame(buffer.slice(0, sep));
        buffer = buffer.slice(sep + 2);
        if (frame) yield frame;
      }
    }
  } finally {
    reader.cancel().catch(() => {
      /* 已经断掉的流再 cancel 会抛,忽略 */
    });
    reader.releaseLock();
  }
}
