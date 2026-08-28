import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
