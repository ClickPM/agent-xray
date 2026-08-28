// R1 spike:SSE 写出小工具(api.raw + node:http,docs/architecture.md 流式通道决策)。
import type { ServerResponse } from "node:http";

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  // 常见反代(nginx 系)看这个头关闭缓冲;Caddy 用 flush_interval -1(deploy/Caddyfile)
  "X-Accel-Buffering": "no",
} as const;

export function sse(resp: ServerResponse, event: string, data: unknown): void {
  resp.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function sseComment(resp: ServerResponse, text: string): void {
  resp.write(`: ${text}\n\n`);
}
