// 加载骨架的公共零件(设计稿画板 2i / 2j)。
//
// **纯标记、无 hook、无 "use client"**:两个 `loading.tsx` 都是 Server Component,
// 骨架不需要任何客户端 JS —— 它在服务端 RSC 返回之前就要显示,那时页面还没有数据可谈。
//
// 画板 2i 的「骨架 TOKEN 与裁定」定了三件事,这里只是把它们写成代码:
//   · 填充统一 `--bg-hover`(= #eeeeee,ghost 按钮底色);叠在 `--bg-panel` / `--bg-hover`
//     面上的条降一档取 `--border`(= #e0e0e0)才看得见。**无新增色值**。
//   · 圆角 4 文本条 / 5 小节标题条 / 6 大标题条 / 7 按钮块与卡片,全走现有档位。
//   · 动效只有既有的 `omPulseBg`(给全页一两块作锚点)与 `omSpin`(「正在取…」),
//     其余骨架静态 —— 整页同相位脉动就是闪屏。
import type { CSSProperties, ReactNode } from "react";

/** 骨架填充两档:底面是白时用 base,压在灰面(panel / hover)上时降一档 */
const TONE = { base: "var(--bg-hover)", onGrey: "var(--border)" } as const;

export function Bar({
  w,
  h = 11,
  radius = 4,
  tone = "base",
  pulse = false,
  style,
}: {
  /** 数字 = px;字符串 = 百分比等 CSS 长度(正文段落用百分比,窄容器里才收得住) */
  w: number | string;
  h?: number;
  radius?: number;
  tone?: keyof typeof TONE;
  /** 只给全页一两块当「在动」的锚点(画板裁定),别整页都开 */
  pulse?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        width: w, height: h, borderRadius: radius, background: TONE[tone], flex: "none",
        ...(pulse ? { animation: "omPulseBg 1.8s ease-in-out infinite" } : null),
        ...style,
      }}
    />
  );
}

/**
 * 固定高度的一行。骨架条比真实文字矮,直接堆起来行距就短一截,内容到达时整页往下跳;
 * 用真实行高包住、条压在视觉中线上,到达时零跳版(画板的「对位」那几条)。
 */
export function Line({ h, children, style }: { h: number; children?: ReactNode; style?: CSSProperties }) {
  return <div style={{ height: h, display: "flex", alignItems: "center", ...style }}>{children}</div>;
}

/**
 * 「正在取…」。骨架说的是「这里会有东西」,这一行说的是「已经收到你的点击、在取了」——
 * 画板 2i / 2j 都把它放在面包屑行的最右,是全页唯一一处明说。
 */
export function LoadingNote() {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 6, color: "var(--text-dim)",
        ...mono10, letterSpacing: "0.08em",
      }}
    >
      <svg
        width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.4" strokeLinecap="round" style={{ animation: "omSpin 0.8s linear infinite" }}
      >
        <path d="M12 3a9 9 0 1 0 9 9" />
      </svg>
      正在取…
    </div>
  );
}

const mono10: CSSProperties = { font: "600 10px var(--font-mono)" };

/**
 * 骨架外壳。除了页面容器,它还带 200ms 的显形闸(画板 2i 的实现备注:
 * 0.1s 就返回的请求不该闪一层灰条)——keyframe 与理由见 app/globals.css 的 omSkeletonIn。
 */
export function SkeletonScreen({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        flex: 1, minHeight: 0, overflow: "auto",
        animation: "omSkeletonIn 0.12s linear 0.2s both",
      }}
    >
      {children}
    </div>
  );
}
