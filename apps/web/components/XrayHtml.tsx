"use client";

// R-CARDS-2:会话区里模型自己写的静态 HTML 组件(画板 2v 桌面 / 5b 移动)—— ` ```xray-html ` 围栏 → 一个全部限制的 `<iframe>`。
//
// 三层兜底里的第 ① 层在这个文件(`docs/security.md` §0 第 13 条):`sandbox=""`(空串 = 全部限制:无脚本、opaque origin、
// 无表单提交、无弹窗、无顶层导航、无下载),**永不**给 `allow-scripts` / `allow-same-origin`,没有 `allow` 属性;
// `referrerPolicy="no-referrer"`。第 ② 层(帧内 meta CSP)与第 ③ 层(窄清洗)在 `lib/xray-html.ts`,这里只是把它们串起来。
//
// **外框照代码块 / 工具卡展开体**(画板 2v 裁定):r7 + 1px `--border`,帧内容不另画外框(套第二层会出双线);帧上**没有**标题栏、
// 没有「全屏 / 复制 / 新窗口 / 刷新」—— 它是正文的一部分,不是一个应用窗口。宽 = 正文宽(模型控不到),高由围栏声明夹取,超高在帧内滚。
//
// **`srcdoc` = (围栏原文, 主题, 端) 的确定性函数**:`useMemo` 按这三样记忆化,无关重渲染不重建帧(重建 = 帧闪);切换主题 → 重拼 → 帧重载
// 一闪(静态内容,无状态可丢,任务卡已认);同一主题下刷新前后一字不差(验收 #14 / #15)。
//
// **服务端不拼**:主题值要从父页 `getComputedStyle` 读、清洗要 `DOMParser`,两样都只有浏览器有 —— 服务端快照回 null,先画骨架,
// 挂载后一次换成帧。会话区的正文本来就不走 SSR(历史是客户端取的),这条只是让组件在任何地方都不会炸。
import { memo, useMemo, useSyncExternalStore, type CSSProperties } from "react";
import { Bar } from "@/components/Skeleton";
import { useIsMobile } from "@/lib/use-mobile";
import { buildSrcdoc, clampHeight, sanitizeFragment, type FrameTheme } from "@/lib/xray-html";

/** 帧的外框 = 2c 代码块 / 2m 展开体那一枚:r7 + 1px 中性描边;marginTop 14 是会话区节奏 */
const frame: CSSProperties = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  border: "1px solid var(--border)",
  borderRadius: 7,
  background: "var(--bg)",
  marginTop: 14,
};

// ── 主题快照:父页的九个变量读成一个字符串(原始值,不是 CSS),用 useSyncExternalStore 订阅 html.dark 的开关 ──
// 快照是字符串(原始值),所以 React 的 Object.is 比较在没变时不会触发重渲染;对象形态由下面 parseTheme 从它还原。
const THEME_VARS: [keyof FrameTheme, string][] = [
  ["bg", "--bg"], ["fg", "--text"], ["muted", "--text-muted"], ["dim", "--text-dim"], ["panel", "--bg-panel"],
  ["border", "--border"], ["brand", "--accent"], ["sans", "--font-ui"], ["mono", "--font-mono"],
];
const SEP = String.fromCharCode(0x1f); // U+001F 单元分隔符:不会出现在任何 CSS 值里(按字符码写,源码里不放控制字符)

function readTheme(): string {
  const cs = getComputedStyle(document.documentElement);
  return THEME_VARS.map(([, v]) => cs.getPropertyValue(v).trim()).join(SEP);
}

function subscribeTheme(onChange: () => void): () => void {
  // 站点的主题开关就是 documentElement 上的 `dark` 类(GlobalNav / MobileThemeRow 都是 classList.toggle),盯 class 属性即可
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => mo.disconnect();
}

function useThemeSnapshot(): string | null {
  return useSyncExternalStore(subscribeTheme, readTheme, () => null);
}

/**
 * 快照 → 主题对象。等宽字体那一项要把 Next 注入的 `var(--font-jetbrains-mono)` 去掉:那个 `@font-face` 只在父文档里声明,
 * 帧是另一个文档、CSP 也不放字体请求,留着只会让帧里出现一个解析不了的家族名;剩下的 `"JetBrains Mono", monospace` 在装了同款字体的机器上照常命中。
 */
function parseTheme(snapshot: string): FrameTheme {
  const parts = snapshot.split(SEP);
  const theme = {} as FrameTheme;
  THEME_VARS.forEach(([k], i) => { theme[k] = parts[i] ?? ""; });
  theme.mono = theme.mono.replace(/var\([^)]*\)\s*,?\s*/g, "").trim() || '"JetBrains Mono", monospace';
  theme.sans = theme.sans || "sans-serif";
  return theme;
}

/**
 * 一帧。`html` 是围栏正文原文(已过 16 KB 上限,见 Markdown.tsx);`declared` 是开围栏行声明的高度(null = 缺省),
 * 夹取在这里做(移动端上限 360 要靠 `useIsMobile`,那是 hook,所以由本组件而不是渲染器来夹)。
 */
export const XrayHtml = memo(function XrayHtml({ html, declared }: { html: string; declared: number | null }) {
  const mobile = useIsMobile();
  const snapshot = useThemeSnapshot();
  const height = clampHeight(declared, mobile);
  const srcdoc = useMemo(() => {
    if (snapshot === null || typeof DOMParser === "undefined") return null;
    return buildSrcdoc(sanitizeFragment(html), parseTheme(snapshot), mobile);
  }, [html, snapshot, mobile]);
  if (srcdoc === null) return <XrayHtmlSkeleton declared={declared} />;
  return (
    <iframe
      className="xhtml-frame"
      data-xray-html=""
      sandbox=""
      srcDoc={srcdoc}
      referrerPolicy="no-referrer"
      loading="lazy"
      title="agent 生成的组件"
      style={{ ...frame, height }}
    />
  );
});

/**
 * 正在到达的帧(画板 2v 标本① / 5b ②屏):开围栏行一到,高度就定了 → 按夹取后的高度立住的外框 + 三条 r4 骨架条,
 * 闭合时原位换成帧、**不跳版**。骨架条叠在白底上,取基础档 `--bg-hover`(不降档);`omPulseBg` 只挂第一条。
 */
export const XrayHtmlSkeleton = memo(function XrayHtmlSkeleton({ declared }: { declared: number | null }) {
  const mobile = useIsMobile();
  const height = clampHeight(declared, mobile);
  return (
    <div className="xhtml-frame" data-xray-html="skeleton" aria-busy="true" style={{ ...frame, height, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12, overflow: "hidden" }}>
      <Bar w="100%" h={11} pulse />
      <Bar w="100%" h={11} />
      <Bar w="58%" h={11} />
    </div>
  );
});
