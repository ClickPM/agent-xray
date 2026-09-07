import { useSyncExternalStore } from "react";

/**
 * R-MOBILE:移动端断点。**只在 Client Component 里用**(它是 hook)。
 *
 * 断点 768px 与 `globals.css` 里所有 `@media (max-width: 768px)` 一致 —— 改一处要改两处,
 * 漏一处的表现是「JS 认为是移动端、CSS 认为是桌面」,两套壳同时可见。
 *
 * 【为什么是 useSyncExternalStore 而不是 useState + useEffect】站点是 SSR 且
 * `(site)/layout.tsx` 是 `force-dynamic`。`useState(window.innerWidth < 768)` 在服务端会炸,
 * 而 `useState(false) + useEffect` 虽然能跑,却把「服务端快照」这件事藏在 effect 里,
 * React 18 的并发渲染下拿到的可能是撕裂的值。`useSyncExternalStore` 把三件事讲明白:
 * 订阅谁、客户端快照是什么、**服务端快照是什么**。
 *
 * 【服务端快照返回 false(桌面),这是刻意的】服务端拿不到视口宽度,只能猜一个。
 * 猜桌面而不是猜移动端,是因为**桌面已投产、规则 7 要求它零改动** ——
 * 服务端渲染与水合首帧都必须和改动前逐字节一致,任何别的取值都会让桌面首帧变样。
 *
 * 代价是移动端会有「桌面壳 → 移动壳」的一帧切换。**这一帧不能让访客看见**
 * (在微信里那正是打开页面的第一眼,闪一下三栏桌面版极难看),所以配套做法是:
 * 桌面壳外面套 `.m-hide-narrow`(globals.css 里 `max-width:768px` 时 `display:none`)——
 * **JS 决定挂哪一套(保证只有一份 SSE 与一份取数),CSS 保证窄屏永远不会把桌面壳画出来。**
 * 两条缺一不可:只有 CSS 会挂两份 SSE,只有 JS 会闪一帧。
 *
 * 【不用 UA 判断】微信 / X5 的 UA 五花八门,且 iPad 与折叠屏按 UA 判必错;
 * UA 只用来做载体差异提示(比如「zip 下载在微信里不可用」),不用来分流布局。
 */
const QUERY = "(max-width: 768px)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const mql = window.matchMedia(QUERY);
  // Safari 13 及更老的 WebView(微信在旧 iOS 上仍可能落到这里)只有 addListener。
  // 少了这条兜底的表现是:旋转屏幕 / 分屏时不重新判断,壳卡在进来时那一套。
  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }
  mql.addListener(onChange);
  return () => mql.removeListener(onChange);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(QUERY).matches;
}

function getServerSnapshot(): boolean {
  return false;
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
