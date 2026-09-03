"use client";

// (site) 段的错误边界 —— 设计稿画板 2k 的变体 A「页面出错」。
//
// **在此之前这里是 Next.js 的默认白屏**:整页只有一行英文
// `Application error: a client-side exception has occurred while loading www.kzgai.cloud`。
// 访客既看不懂也不知道能做什么(所有者 2026-09-03 在生产上就是撞到这一屏才报的障)。
//
// 版式与裁定全在 components/StatusScreen.tsx 的文件头(照画板 2k)。这里只负责两件事:
// 拿 `reset()` 当主出口,以及把「哪一次」变成一个能带走的短标识。
//
// **不显示 error.message**:服务端错误在生产会被 Next 换成通用文案 + digest,
// 但客户端错误的 message 是原文,可能带上内部路径或字段名。只露 digest + 时间戳,
// 既够所有者在日志里对上这一次,又不把实现细节摊给访客(docs/security.md §5 同一口径)。
import { useEffect, useState } from "react";
import { CopyableId, StatusScreen } from "@/components/StatusScreen";

/** 画板 2k 的 `err_7f3a2c14 · 2026-09-03 06:41 UTC`;没有 digest 时只留时间 */
function stamp(digest: string | undefined, at: Date): string {
  const utc = at.toISOString().slice(0, 16).replace("T", " ");
  return digest ? `${digest} · ${utc} UTC` : `${utc} UTC`;
}

export default function SiteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  /** 重新渲染当前路由段(不是刷新整页)—— 数据源是瞬时故障时这一下就能恢复 */
  reset: () => void;
}) {
  // 时间戳只在挂载后算。服务端组件抛错时这个边界也会在服务端渲染一遍,
  // 渲染期取 `new Date()` 两边必然对不上,那是一个必现的水合失配
  // —— 本轮修的正是这一类问题,不该在修它的文件里再造一个。
  const [at, setAt] = useState<Date | null>(null);
  useEffect(() => setAt(new Date()), []);

  return (
    <StatusScreen
      dot="var(--err-text)"
      code="HTTP 500"
      title="这一页没能取回来"
      description="服务端在处理这次请求时出错了,不是你操作的问题。重试通常就好;要是反复出现,把下面这个标识发我,我能在日志里对上这一次。"
      primary={{ label: "重试", onClick: reset }}
      footer={at ? <CopyableId text={stamp(error.digest, at)} /> : null}
    />
  );
}
