import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// 自托管 JetBrains Mono(R9)。原先这里是一张指向 fonts.googleapis.com 的
// **渲染阻塞样式表**,境内首访会挂在字体请求超时上(架构评审 2026-08-29 的 P1-4)。
// next/font/local 把 woff2 编进构建产物,与页面同源同连接,断外网也不影响渲染。
// 字体本身、字重、字号一律不变(CLAUDE.md 规则 7:只换取数来源,不动样式)。
// 子集与版本的取舍见 app/fonts/README.md。
const jetbrainsMono = localFont({
  src: "./fonts/JetBrainsMono-latin.woff2",
  // 变量字体,一份文件覆盖设计稿用到的 400/500/600/700
  weight: "100 800",
  style: "normal",
  display: "swap",
  variable: "--font-jetbrains-mono",
  // 落到 --font-mono 后半段那几个系统等宽字体上,与自托管前的回退链同口径
  fallback: ["Noto Sans Mono", "Consolas", "ui-monospace", "monospace"],
});

export const metadata: Metadata = {
  title: "Agent X-Ray",
  description:
    "See every heartbeat of an agent kernel — 与 agent 对话的同时,实时观测 agent loop 的内核轨迹。",
};

/**
 * R-MOBILE。主要目标场景是**微信等社交 webview**(CLAUDE.md 规则 8 的 R-MOBILE 裁定 ③)。
 *
 * - `viewportFit: "cover"` 是 `env(safe-area-inset-*)` 生效的前提;少了它底部 Home Indicator
 *   会盖住 Tab Bar。
 * - `maximumScale: 1` + `userScalable: false` 是所有者要的「禁双指缩放」(裁定 ⑥)。
 *   **但 iOS 从 Safari 10 起忽略这两个字段,微信 WKWebView 同内核也忽略** —— 真正拦住捏合的是
 *   下面 `<head>` 里那段 `gesturestart` 拦截,这里写着是给 Android 与桌面浏览器用的。
 * - `themeColor` 给明暗两条:Safari 用它染地址栏,深色下不给就会露出浅色条。
 *   两条的值 = `globals.css` 里 `--bg` 的明暗两态,改那边要一起改。
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1a1a" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className={jetbrainsMono.variable} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(localStorage.getItem("xray-theme")==="dark")document.documentElement.classList.add("dark")}catch(e){}})();`,
          }}
        />
        {/* R-MOBILE:禁双指缩放(所有者裁定 ⑥)。
            **必须是 JS,不能只靠 viewport meta** —— iOS Safari 10 起忽略 `user-scalable=no` 与
            `maximum-scale`,微信 WKWebView 同内核也忽略;`gesturestart` 是 WebKit 上唯一拦得住捏合的钩子。
            `touchmove` 那条兜 Android(它没有 gesture 事件);只在**多指**时拦,单指滚动不受影响。
            三个 gesture 事件都要拦:只拦 start 时,已经开始的捏合仍会继续放大。
            `{passive:false}` 不能省 —— 触摸事件默认被当 passive,passive 监听里 preventDefault 无效。
            双击放大由 `globals.css` 的 `touch-action: manipulation` 负责,不在这里。 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var p=function(e){e.preventDefault()},o={passive:false};document.addEventListener("gesturestart",p,o);document.addEventListener("gesturechange",p,o);document.addEventListener("gestureend",p,o);document.addEventListener("touchmove",function(e){if(e.touches&&e.touches.length>1)e.preventDefault()},o)}catch(e){}})();`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
