import type { Metadata } from "next";
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
      </head>
      <body>{children}</body>
    </html>
  );
}
