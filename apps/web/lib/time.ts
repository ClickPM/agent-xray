// 相对时间,格式与设计稿一致(`2d ago` / `1w ago`)。
// 服务端渲染:同一次请求内 now 只取一次,避免同页不同卡片出现不一致的相对时间。
export function relTime(iso: string | null, now = Date.now()): string {
  if (!iso) return "";
  const diff = Math.max(0, now - new Date(iso).getTime());
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  return mo < 12 ? `${mo}mo ago` : `${Math.floor(d / 365)}y ago`;
}

/**
 * 中文相对时间(R-SKILLS,画板 2f 的卡片元信息与页脚:`更新于 12 天前` / `3 天前`)。
 * Notes 那边的画板写的是 `3d ago`,两种写法各照各的画板,不合并。
 */
export function relTimeZh(iso: string | null, now = Date.now()): string {
  if (!iso) return "";
  const diff = Math.max(0, now - new Date(iso).getTime());
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "刚刚";
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 45) return `${d} 天前`;
  const mo = Math.floor(d / 30);
  return mo < 12 ? `${mo} 个月前` : `${Math.floor(d / 365)} 年前`;
}

/** 文章页的绝对日期(设计稿:`更新于 2026-08-25`) */
export function isoDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/** 中文按 400 字/分钟估算阅读时长(设计稿:`约 8 分钟`) */
export function readingMinutes(wordCount: number): number {
  return Math.max(1, Math.round(wordCount / 400));
}

/** 万字;设计稿系列页写作「约 12 万字」 */
export function tenThousand(wordCount: number): string {
  return (wordCount / 10000).toFixed(1).replace(/\.0$/, "");
}
