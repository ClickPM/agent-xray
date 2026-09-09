// R-CARDS-2:会话区静态 HTML 组件(画板 2v / 5b)的纯函数半边 —— ` ```xray-html ` 围栏 → `<iframe sandbox="" srcdoc>`。
//
// 这是 `docs/security.md` §0 第 13 条的边界:模型第一次给出**未经闭集校验的 HTML + CSS** 并在访客浏览器里成为文档。
// 兜底是三层各管一件事,**缺一不可**,而且它们不在同一个地方:
//   ① **不执行、无同源** —— 帧元素的 `sandbox=""`(空串 = 全部限制),在 `components/XrayHtml.tsx`;这一层**不靠清洗**;
//   ② **不出网** —— `buildSrcdoc` 在帧文档头部注入的 meta CSP(`default-src 'none'; style-src 'unsafe-inline'`),
//      图片 / 字体 / `@import` / CSS `url()` / 嵌套帧全部不发请求;模型自己再写一条 CSP 只会取交集、放松不了;
//   ③ **不出链、不换页** —— 下面这对判定函数 + `sanitizeFragment` 那层薄壳:sandbox 与 CSP 都拦不住帧**自导航**
//      (`<a href>` 点击、`<meta http-equiv="refresh">`),帧内加载第三方页 = 访客 IP 泄给第三方 + 站内出现看不到地址栏的外站内容。
//      **它不是 XSS 防线**:「不执行」由 ① 保证,清洗被绕过的最坏结果是一次点击后帧内换页,那个页仍在同一个 sandbox 里。
//      所以不引 DOMPurify(任务卡派生取舍 10):判定部分是两个纯函数,`bun test lib` 钉住;DOM 遍历是薄壳。
//
// 除 `sanitizeFragment` 外全部是纯函数、不碰 DOM、不 import React,`bun`(没有 DOMParser)里直接跑测试。
import { utf8Length } from "./xray-card";

/** 围栏的语言标签;回落成代码块时头部条上显示的也是它 */
export const HTML_LANG = "xray-html";

/** 任务卡裁定 6 / 派生取舍 8 / 12 的上限 */
export const HTML_LIMITS = {
  /** 围栏正文(UTF-8 字节);超过整段回落代码块。16 KB ≈ 5k token:流式期间访客盯着骨架约一分钟,也直接计入访客配额 */
  fenceBytes: 16 * 1024,
  /** 帧高的夹取区间与缺省(桌面);移动端上限另给(画板 5b:358 宽的屏上 480 高的帧会盖过大半屏) */
  heightMin: 160,
  heightMax: 480,
  heightMaxMobile: 360,
  heightDefault: 320,
} as const;

/** 围栏正文在不在字节上限内(按**原文**算,先于任何 trim —— 与 `parseCard` 同一口径) */
export function htmlWithinLimit(raw: string): boolean {
  return utf8Length(raw) <= HTML_LIMITS.fenceBytes;
}

/**
 * 从源文本取开围栏行的 info string(去掉围栏记号与两侧空白),如 `xray-html height=320`。
 * 行号是渲染器从 hast 拿到的开围栏所在行(1 起),开围栏行的前缀规则与 `fenceUnterminated` 同一套(容器前缀 / 列表标记)。
 * 不依赖 hast 的 `data.meta`:`Markdown` 手里本来就有源文本与行号(任务卡派生取舍 8)。取不到时回空串(→ 缺省高度)。
 */
export function fenceInfo(source: string, openerLine: number): string {
  const line = source.split(/\r?\n/)[openerLine - 1] ?? "";
  const m = /^(?:[\s>]|[-+*](?=\s)|\d{1,9}[.)](?=\s))*(?:`{3,}|~{3,})[ \t]*(.*)$/.exec(line);
  return m ? m[1].trim() : "";
}

/**
 * info string 里声明的高度:只认一个键 `height=<整数>`(按空白分词,第一个匹配的算数;`height=abc` / 缺失 → null → 缺省)。
 * 前导零与正号都不认(`^\d+$`),小数不认 —— 这是给模型写的一个词,不是给人写的表达式。
 */
export function declaredHeight(info: string): number | null {
  for (const token of info.split(/\s+/)) {
    const m = /^height=(\d{1,5})$/.exec(token);
    if (m) return Number(m[1]);
  }
  return null;
}

/** 夹到 [160, 480](移动端 [160, 360]);未声明 / 非法 → 320(任务卡裁定 6) */
export function clampHeight(declared: number | null, mobile: boolean): number {
  const max = mobile ? HTML_LIMITS.heightMaxMobile : HTML_LIMITS.heightMax;
  const want = declared ?? HTML_LIMITS.heightDefault;
  return Math.min(max, Math.max(HTML_LIMITS.heightMin, want));
}

/**
 * 整个元素去掉(连同子树)。任务卡派生取舍 10 的名单 + 三个同类:`image`(SVG 里的位图,等于 `img`)、`template`(没有脚本就没有用处,
 * 而它的内容在 DOM 遍历里看不见)、`portal` / `fencedframe`(嵌入类)。**保留** `style` / `details` / `summary` / 内联 `svg` / `math` 与全部排版元素。
 * 入参是 `localName`(SVG 元素大小写敏感,这里统一小写比)。
 */
const DROP_ELEMENTS = new Set([
  "script", "iframe", "frame", "frameset", "object", "embed", "applet", "portal", "fencedframe",
  "form", "input", "textarea", "select", "button",
  "meta", "link", "base", "template",
  "img", "image", "picture", "source", "video", "audio", "track",
]);

export function shouldDropElement(tag: string): boolean {
  return DROP_ELEMENTS.has(tag.toLowerCase());
}

/** 能承载 URL 的属性(任务卡派生取舍 10 的名单 + 几个古老同类);值以 `#` 起头(帧内锚点)时放行 */
const URL_ATTRIBUTES = new Set([
  "href", "src", "srcset", "xlink:href", "action", "formaction", "poster", "ping", "background", "data", "cite", "longdesc", "usemap",
  "srcdoc", "manifest", "codebase", "archive", "classid", "profile", "dynsrc", "lowsrc",
]);

/**
 * 属性去不去:所有 `on*`(事件,sandbox 下本就不执行,去掉是为了「帧内 DOM 没有 on* 属性」这个可验证的判据)、
 * `target`(一律去:没有可换的页)、URL 承载属性 —— **除非**值去掉空白与控制字符后以 `#` 开头(帧内锚点,`<use href="#id">` 靠它)。
 * 名字按小写比(HTML 属性大小写不敏感;`xlink:href` 保留冒号);`javascript:` / `data:` / 带 `\t` `\n` 的变体全都不以 `#` 开头,自然落到「去」。
 */
export function shouldDropAttribute(name: string, value: string): boolean {
  const n = name.toLowerCase();
  if (n.startsWith("on")) return true;
  if (n === "target") return true;
  if (!URL_ATTRIBUTES.has(n)) return false;
  const v = value.replace(/[\s\p{Cc}]/gu, "");
  return !v.startsWith("#");
}

/** 注进帧里的站点主题变量(任务卡派生取舍 11);值从父页 `getComputedStyle(document.documentElement)` 读,由 `components/XrayHtml.tsx` 供 */
export interface FrameTheme {
  bg: string;
  fg: string;
  muted: string;
  dim: string;
  panel: string;
  border: string;
  brand: string;
  sans: string;
  mono: string;
}

/**
 * 主题值进 `<style>` 前的过滤:值来自站点自己的样式表(不是模型给的),这里只挡住能改变 CSS 结构的四个字符与 `<`(`</style>` 逃逸),
 * 其余原样 —— 字体栈里的引号与逗号都要留。
 */
function cssValue(v: string): string {
  return v.replace(/[;{}<]/g, "").trim();
}

/**
 * 拼帧文档(任务卡派生取舍 9):doctype + charset + **CSP 在任何模型内容之前** + 基础样式 + 清洗后的片段。
 * 模型片段只占 body;片段里的 `</body></html>` 逃逸无效 —— 整段都在 sandbox 里,后面接的任何东西同样不执行、不出网。
 * 基础样式只给版式底子与 `--xh-*` 变量,不给组件语汇(那是模型自己写的)。`mobile` 只影响 `summary` 的命中高度(画板 5b:44)。
 */
export function buildSrcdoc(fragment: string, theme: FrameTheme, mobile: boolean): string {
  const vars =
    `--xh-bg:${cssValue(theme.bg)};--xh-fg:${cssValue(theme.fg)};--xh-muted:${cssValue(theme.muted)};--xh-dim:${cssValue(theme.dim)};` +
    `--xh-panel:${cssValue(theme.panel)};--xh-border:${cssValue(theme.border)};--xh-brand:${cssValue(theme.brand)};` +
    `--xh-sans:${cssValue(theme.sans)};--xh-mono:${cssValue(theme.mono)}`;
  const base =
    `:root{${vars}}` +
    "html,body{margin:0}" +
    "*,*::before,*::after{box-sizing:border-box}" +
    "body{padding:12px;font:14px/1.6 var(--xh-sans);color:var(--xh-fg);background:var(--xh-bg);overflow-wrap:anywhere}" +
    "svg,table{max-width:100%}" +
    "pre,code,kbd,samp{font-family:var(--xh-mono)}" +
    "a{color:var(--xh-brand)}" +
    (mobile ? "summary{min-height:44px;padding:8px 0}" : "");
  return (
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'\">" +
    `<style>${base}</style></head><body>${fragment}</body></html>`
  );
}

/**
 * DOM 遍历那层薄壳(**只能在浏览器里调**:bun 没有 DOMParser)。把模型片段解析成一个独立文档(DOMParser 文档里脚本永不执行、
 * 资源永不加载),按上面两个判定函数去元素 / 去属性,再把 head(剩下的只会是 `style` / `title`)与 body 序列化回去。
 * 模型写的是完整文档还是一段片段都行:两种在 `text/html` 解析下都会落进 head / body。
 */
export function sanitizeFragment(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  scrub(doc.head);
  scrub(doc.body);
  return doc.head.innerHTML + doc.body.innerHTML;
}

function scrub(root: Element): void {
  for (const el of Array.from(root.children)) {
    if (shouldDropElement(el.localName)) {
      el.remove();
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      if (shouldDropAttribute(attr.name, attr.value)) el.removeAttribute(attr.name);
    }
    scrub(el);
  }
}
