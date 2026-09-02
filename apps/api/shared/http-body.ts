// 带字节上界的响应体读取(docs/security.md §1 外呼组约束 5:「字节上界要覆盖每一条读路径」)。
//
// `res.text()` / `res.json()` 都是"先全缓冲再说",一个回几百 MB 的上游能直接把容器内存吃光
// (R-WEBSEARCH codex 初审 P2)。外呼组的每个工具都要读上游响应体,而上界的实现只能有一份 ——
// R-IMAGEGEN 把它从 `agent/websearch.ts` 抽到这里,两个工具各自给自己的上界与错误类型。
//
// 超上限**直接抛**而不是截断:一段被砍掉一半的 JSON 解析出来是垃圾,
// 而"上游回了个不该这么大的东西"本身就是要报出来的事实。

export interface ReadBodyCappedOptions {
  /** 字节上界(含)。超过就调 `oversize()` 拿一个错误抛出去。 */
  maxBytes: number;
  /** 超限时要抛的错误由调用方造:它要带自己的 kind,进自己的日志口径。 */
  oversize: (maxBytes: number) => Error;
  /**
   * 每收到一块数据调一次,带这一块的字节数;调用方用它重置空闲计时器(R-WEBSEARCH codex 复审 P2:
   * 一个响应头很快、body 却要流上一分钟的上游,不重置就会在**持续有数据**的情况下被空闲超时掐掉),
   * 生图那边还用它给进度上报算「已收 N KB」。
   */
  onChunk?: (chunkBytes: number) => void;
}

/**
 * 读完整个响应体为文本。
 *
 * 【上界触发时要主动放弃剩下的字节】否则连接会一直挂着把数据读完。`finally` 里的
 * `reader.cancel()` 对正常读完的流是无害空操作。
 */
export async function readBodyCapped(res: Response, opts: ReadBodyCappedOptions): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const n = value?.byteLength ?? 0;
      opts.onChunk?.(n);
      bytes += n;
      if (bytes > opts.maxBytes) throw opts.oversize(opts.maxBytes);
      out += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return out + decoder.decode();
}
