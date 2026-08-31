// SSE 写出小工具(`api.raw` + node:http,docs/architecture.md「流式通道」决策)。
// R1 在 spike/sse.ts 验证,R3 随正式端点落 agent 服务。
import type { ServerResponse } from "node:http";

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  // 常见反代(nginx 系)看这个头关闭缓冲;Caddy 用 flush_interval -1(deploy/Caddyfile)
  "X-Accel-Buffering": "no",
} as const;

/** 客户端已断开后再写会抛 ERR_STREAM_WRITE_AFTER_END,统一在这里挡掉。 */
function writable(resp: ServerResponse): boolean {
  return !resp.writableEnded && !resp.destroyed;
}

export function sse(resp: ServerResponse, event: string, data: unknown): void {
  if (!writable(resp)) return;
  resp.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function sseComment(resp: ServerResponse, text: string): void {
  if (!writable(resp)) return;
  resp.write(`: ${text}\n\n`);
}
