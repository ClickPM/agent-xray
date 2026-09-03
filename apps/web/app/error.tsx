"use client";

// 根段的错误边界 —— 设计稿画板 2k 变体 A,**没有导航条的那一版**。
//
// **为什么需要两个 error.tsx**(2026-09-03 本机实测发现,不是照抄模板):
// `error.tsx` 只兜住**自己 children** 里的错误,兜不住**同段 layout 自己**的错误。
// 而本站最可能的一种故障恰恰在 layout 里 —— `(site)/layout.tsx` 每次请求都要
// `visibleTabKeys()` 打一次后端(R-TABS:导航条显示哪几格由库里的开关决定)。
// 后端不可达时,先炸的是 layout,`(site)/error.tsx` 根本没机会渲染:
// 本机把 api 停掉复现,页面回到 Next 默认的
// `Application error: a server-side exception has occurred`。所以这里再兜一层。
//
// **这一层没有导航条,是不得已、也是诚实的**:导航条要显示哪几格正是刚刚取失败的那份数据。
// 退化成「全部显示」会把所有者用 site_tab_set 藏起来的 tab 露出来 —— 那是合规运维动作
// (ROUNDS.md R-TABS),不能靠猜;退化成「一格不显示」则是一条空条,不如不画。
// 于是这一层只给 2k 的内容区,出口用文字链回首页。
//
// 页面级的错误(某个 page 自己抛)仍然走 `(site)/error.tsx`,那一层**带导航条**,与画板 2k 一致。
import { useEffect, useState } from "react";
import { CopyableId, StatusScreen } from "@/components/StatusScreen";

function stamp(digest: string | undefined, at: Date): string {
  const utc = at.toISOString().slice(0, 16).replace("T", " ");
  return digest ? `${digest} · ${utc} UTC` : `${utc} UTC`;
}

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // 与 (site)/error.tsx 同一处理:渲染期取 new Date() 会在服务端渲染这一层时造成水合失配
  const [at, setAt] = useState<Date | null>(null);
  useEffect(() => setAt(new Date()), []);

  return (
    // 根 layout 的 body 没有布局容器((site)/layout.tsx 才有),这里自己撑满一屏
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
      <StatusScreen
        dot="var(--err-text)"
        code="HTTP 500"
        title="这一页没能取回来"
        description="服务端在处理这次请求时出错了,不是你操作的问题。重试通常就好;要是反复出现,把下面这个标识发我,我能在日志里对上这一次。"
        primary={{ label: "重试", onClick: reset }}
        footer={at ? <CopyableId text={stamp(error.digest, at)} /> : null}
      />
    </div>
  );
}
