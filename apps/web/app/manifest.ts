import type { MetadataRoute } from "next";

/**
 * R-MOBILE。Web App Manifest,Next 的 metadata 路由约定 → `/manifest.webmanifest`。
 *
 * **它的作用范围要说清楚,别高估**(CLAUDE.md 规则 8 的 R-MOBILE 裁定 ③):
 * 本轮的主要目标场景是**微信等社交 webview**,而**微信内置浏览器根本不读 manifest**
 * (Service Worker 也用不了、没有安装入口)。所以这份文件对主场景是**零作用**。
 * 留着它只为一件事:访客**自己**在 Safari / Chrome 里「添加到主屏幕」之后能以
 * standalone 全屏启动(画板 4u 第 3 态)。**我们不做任何安装引导 UI**(所有者裁定)。
 *
 * 因此本轮也**不做 Service Worker**:微信用不了、站点 `(site)/layout.tsx` 是
 * `force-dynamic`(tab 露不露由库里开关决定,缓存 HTML 会让关掉的 tab 仍可见)、
 * 且站点核心是实时对话没有离线价值。代价是 Android Chrome 的安装提示可能不出现 ——
 * 本来就不引导安装,不影响目标。见 `rounds/BACKLOG.md`。
 *
 * `orientation: "portrait"` 只在 standalone 启动时生效。**在浏览器与 webview 里网页锁不了方向**
 * (`screen.orientation.lock()` 拿不到),那两种载体下的竖屏靠 CSS 降级 —— 见 globals.css 的
 * `@media (orientation: landscape)` 一段与画板 4u 第 4 态。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Agent X-Ray",
    short_name: "X-Ray",
    description:
      "See every heartbeat of an agent kernel — 与 agent 对话的同时,实时观测 agent loop 的内核轨迹。",
    lang: "zh-CN",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      // `app/icon.svg` 是 Next 的 metadata 文件约定,浏览器 tab 用它;
      // manifest 这边要位图,三张都由 `components/XrayMark.tsx` 的同一图形导出
      // (改图形要把 XrayMark / icon.svg / 这三张一起改)。
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // maskable 版本图形缩进到中心 80% 安全区,否则 Android 圆形遮罩会切掉边缘
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
