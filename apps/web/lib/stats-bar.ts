// 顶栏统计条的四项呈现(R-USAGE)。纯函数,不碰 React —— 测试直接断言字符串。
//
// 在此之前四项里有三项是 `demo-data.ts` 的硬编码("12.4k tokens" / "$0.038" / "ctx 6%"),
// 只有 events 是真的(R4 起从轨迹流计数)。本轮把 tokens 与 ctx 接上真实数据源,
// cost 按所有者裁定(2026-09-04)**固定占位**,不接数据也不从统计条里删。
//
// 数据从哪来:`/agent/ask` 的收尾帧(一轮结束时当场更新)与 `GET /agent/sessions/:id`
// (打开会话时取初值)。边界见 docs/security.md §2 R-USAGE 补记。

/**
 * 没有值时的占位。**四项共用同一个字符**:cost 永远是它,ctx 在服务端拿不到当前
 * 上下文占用时也是它。统一之后统计条在「没数据」这件事上只有一种长相。
 */
export const STAT_PLACEHOLDER = "-";

/**
 * 会话累计 token → 统计条文案。画板 1a 的样本是 `12.4k tokens`。
 *
 * 【为什么千位以上一律保留一位小数,哪怕是 `1.0k`】统计条用 `font-variant-numeric:
 * tabular-nums`,图的就是数字宽度稳定;把 `12.0k` 缩成 `12k` 会让这一格在轮次之间
 * 忽宽忽窄,旁边的 events 跟着横跳。宁可多一个 `.0`。
 */
export function formatTokens(total: number | null | undefined): string {
  if (typeof total !== "number" || !Number.isFinite(total) || total < 0) {
    return `${STAT_PLACEHOLDER} tokens`;
  }
  const n = Math.round(total);
  if (n < 1_000) return `${n} tokens`;
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k tokens`;
  return `${(n / 1_000_000).toFixed(1)}M tokens`;
}

/**
 * 上下文占用 → 统计条文案。入参是 pi 的 `ContextUsage.percent`,**已经是 0–100 的数**
 * (源码:`(estimate.tokens / contextWindow) * 100`),且不取整 —— 取整在这里做。
 *
 * 【不设上限是刻意的】压缩发生之前 percent 可以超过 100,`ctx 104%` 是当时的真实状态;
 * 夹到 100 会把「马上要压缩了」这个信号抹掉,而这个站点整个存在的意义就是让内核状态可见。
 *
 * 缺席(会话不在运行时里 / pi 刚压缩过回 null)显示占位,不编一个数。
 */
export function formatCtx(percent: number | null | undefined): string {
  if (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0) {
    return `ctx ${STAT_PLACEHOLDER}`;
  }
  return `ctx ${Math.round(percent)}%`;
}

// 【这里刻意没有 ctxDotColor】ctx 圆点恒为画板 1a 的 `#16a34a`。
// 本轮曾让它在无值时压成 `--text-dim`(理由:`ctx -` 配绿点等于在「不知道」时声称「正常」),
// 被 codex 第 1 轮 P2 判为违反规则 7 —— 画板只画过有值的常绿态,那是个没画过的态。
// 已撤回并记 BACKLOG 等所有者裁定;**按百分比分档变色(黄/红)更不做**,那是新视觉语言。
