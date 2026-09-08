"use client";

// 画板 2p:「正在取 apps/api/agent/tools.ts…」—— 路径来自 URL,是加载时唯一已知的真信息。
// `loading.tsx` 拿不到 params,所以这一句要在客户端从 pathname 读;首页(/source)没有路径就只说「正在取…」。
// 样式与 components/Skeleton 的 LoadingNote 同一份(mono 10/600、字距 0.08em、omSpin 0.8s)。
import { usePathname } from "next/navigation";
import { mono } from "@/lib/styles";

export function SourceLoadingNote() {
  const pathname = usePathname() ?? "/source";
  const rest = pathname.startsWith("/source/") ? pathname.slice("/source/".length) : "";
  let path = "";
  try {
    path = rest.split("/").map(decodeURIComponent).join("/");
  } catch {
    path = rest;
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-dim)", ...mono(10, 600), letterSpacing: "0.08em" }}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" style={{ animation: "omSpin 0.8s linear infinite" }}>
        <path d="M12 3a9 9 0 1 0 9 9" />
      </svg>
      {path ? `正在取 ${path}…` : "正在取…"}
    </div>
  );
}
