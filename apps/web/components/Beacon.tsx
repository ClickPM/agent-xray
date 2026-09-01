"use client";

// R8 pageview 打点客户端。自托管统计,**不引入任何第三方脚本、不写 cookie、
// 不读 localStorage**(`docs/security.md` §6)—— 这个组件发出的全部信息就是
// 一个站内路径,访客身份由服务端从 IP + UA 派生成加盐哈希,原文不落库。
//
// 挂在 `app/(site)/layout.tsx`,渲染 null,不参与任何布局(规则 7)。
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

const ENDPOINT = "/api/t";

export function Beacon() {
  const pathname = usePathname();
  // 已上报的路径。App Router 的客户端跳转不重挂载本组件,effect 靠 pathname 依赖触发;
  // 这个 ref 挡两件事:React 严格模式下开发期的 effect 双跑,以及
  // 同一路径因其他原因重跑 effect 时的重复计数。
  const reported = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || reported.current === pathname) return;
    reported.current = pathname;

    const body = JSON.stringify({ path: pathname });

    // sendBeacon 优先:它由浏览器在后台投递,页面立刻被关掉也不会丢
    // (普通 fetch 会随文档一起被取消)。
    try {
      if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        // 同源请求,application/json 不触发预检
        if (navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }))) return;
        // 返回 false = 浏览器没接下这次投递(队列满等),落到下面的 fetch 再试一次
      }
    } catch {
      // 某些环境下 sendBeacon 对特定 MIME 直接抛;走 fetch 兜底
    }

    // `keepalive` 让请求在文档卸载后继续;失败一律吞掉 —— 统计是旁路,
    // 不该在访客的控制台里留下红字。
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  }, [pathname]);

  return null;
}
