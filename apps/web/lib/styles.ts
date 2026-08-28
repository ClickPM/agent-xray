import type { CSSProperties } from "react";

/** 等宽字体简写(server/client 通用的纯样式助手) */
export const mono = (size: number, weight = 400): CSSProperties => ({
  font: `${weight} ${size}px var(--font-mono)`,
});
