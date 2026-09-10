"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useIsMobile } from "@/lib/use-mobile";

/**
 * R-MOBILE-2(画板 5c):一级页「到顶不出条、滚过大标题后条淡入」的判定。
 *
 * 【为什么按大标题的位置判,而不是按滚了多少像素】画板 5c 的规则原文是
 * 「功能条只在**大标题滚出后**出现」—— 阈值是那块标题的高度,而它随字号、
 * 折行数、安全区变。量元素比量常数稳:`title.bottom <= bar.bottom` 就是
 * 「大标题已经整块滚到条的下边缘之上」,320 / 430 与横屏都不用另配数。
 *
 * 【为什么用 `.m-h1` 找标题】三个一级页的大标题都挂着这个类(globals.css 里
 * 34/700 那条规则就是按它写的),等于现成的契约;找不到时**退回「条常驻」**
 * ——宁可多一条空条,也不能把条里的动作(Notes 的 RSS)永久藏掉。
 *
 * 【为什么监听 document 的捕获阶段】与 `MobileTabBar` 的 `useHideOnScroll` 同一
 * 理由:scroll 不冒泡但会捕获,各页真正滚动的是自己那层 `overflow:auto` 容器。
 */
function useCollapsedTitle(enabled: boolean, barRef: RefObject<HTMLDivElement | null>): boolean {
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = useState(false);
  const frame = useRef(0);

  useEffect(() => {
    // 桌面上这条整条 `display:none`(`.m-show-narrow`),不必挂监听;
    // 首帧 `useIsMobile()` 回 false,所以初值必须是「不收起」——与服务端一致,不会水合报错。
    if (!enabled || !isMobile) {
      setCollapsed(false);
      return;
    }
    const bar = barRef.current;
    if (!bar) return;
    const title = bar.parentElement?.querySelector<HTMLElement>(".m-h1") ?? null;
    if (!title) {
      setCollapsed(true);
      return;
    }
    const measure = () => {
      frame.current = 0;
      const barRect = bar.getBoundingClientRect();
      if (barRect.height === 0) return; // 条不可见(断点刚切过去、还没重排)时不改状态
      setCollapsed(title.getBoundingClientRect().bottom <= barRect.bottom);
    };
    const schedule = () => {
      if (!frame.current) frame.current = requestAnimationFrame(measure);
    };
    measure(); // 从别处返回时浏览器会还原滚动位置,初值要按当时的位置算
    document.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      document.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [enabled, isMobile, barRef]);

  return collapsed;
}

/**
 * R-MOBILE 内容页的顶部功能条(画板 4k–4r;一级页的两态由 R-MOBILE-2 的画板 5c 定)。
 * Notes / Skills / About 三个 tab 共用。
 *
 * 【为什么这里是 sticky,而 Runtime 那边是 absolute】Runtime 的壳自己不滚动
 * (对话在内层滚),功能条钉在壳上用 absolute 正好;而 Notes / Skills / About
 * **整页就是那个滚动容器**,absolute 会跟着内容滚走,需要一个不滚动的定位祖先才行。
 * `sticky` 不需要祖先配合,滚动时自然停在顶端,内容从它底下过 —— 同样的观感,少一层耦合。
 *
 * 【功能条不是标题栏】画板 4k–4r 的一致裁定:一级页(Notes / Skills / About 首页)
 * 左位子空着(没有上一级可返回),右位子放该页的动作(RSS / 目录);
 * 二级页左位子是**带文字的返回**(iOS 惯例:返回带上一级的名字)。
 * 中间只放轻量信息(章序之类),**不放页面标题** —— 标题是页面内容里的大标题。
 *
 * 【一级页从 R-MOBILE-2 起是两态的】传了 `collapseTitle` 就进「收起态」这一套(画板 5c):
 * 到顶**整条不占流、不可见**(4a–4u 是以微信 webview 画的,宿主那条 44 导航栏在
 * standalone / 普通浏览器里并不存在,再挂一条空条就是一条什么都不装的白边);
 * 滚过大标题后玻璃条淡入,条里是 **17/600 左对齐**的页名 + 右侧动作。
 * 二级页(章节 4m / Skill 详情 4p–4q)不传这个 prop,条里有带文字的返回、
 * 本来就不是空条 —— **它们从到顶起就在,本轮一个像素不动**。
 */
export function MobilePageBar({
  backHref,
  backLabel,
  center,
  right,
  /** 贴在功能条底缘的进度线(章节页,画板 4m)。0–1。 */
  progress,
  /**
   * 一级页专用(画板 5c):滚过大标题后显示在条里的页名(17/600 左对齐)。
   * 传了就进「到顶不出条」的两态;不传 = 二级页的常驻条,行为与 R-MOBILE 首版一致。
   */
  collapseTitle,
}: {
  backHref?: string;
  backLabel?: string;
  center?: ReactNode;
  right?: ReactNode;
  progress?: ReactNode;
  collapseTitle?: string;
}) {
  const collapsible = collapseTitle !== undefined;
  const barRef = useRef<HTMLDivElement>(null);
  const collapsed = useCollapsedTitle(collapsible, barRef);
  // 一级页到顶 = 条不可见且**不拦点击**(它盖在大标题上方,拦了就点不到 RSS)
  const shown = !collapsible || collapsed;

  return (
    <div
      ref={barRef}
      className={`m-glass-top m-show-narrow m-pagebar${collapsible ? " m-pagebar-float" : ""}`}
      aria-hidden={collapsible && !shown}
      style={{
        position: "sticky",
        top: 0,
        zIndex: 4,
        alignItems: "center",
        // 二级页三个位子之间留 4;一级页收起态里画板给的是「左内边距 6 + 8 的隔条」=
        // 页名距屏边 14,再插一道 gap 就成了 18,所以这一档不留(右位子在最右端,不受影响)。
        gap: collapsible ? 0 : 4,
        ...(collapsible
          ? {
              opacity: shown ? 1 : 0,
              pointerEvents: shown ? ("auto" as const) : ("none" as const),
              // 缓动沿用 4a 给 Tab Bar 的那一条,本轮不加新 token
              transition: "opacity .25s cubic-bezier(.32,.72,0,1)",
            }
          : null),
        // ⚠️ **不要在这里写 `height` 或 `padding` 简写** —— 高度与顶部内边距由
        // `.m-glass-top` 按 `--safe-top` 给。写死 `height:44` / `padding:"0 6px"`
        // 会把那两条规则整条盖掉,standalone 下(safe-top 非零)导航控件就落到
        // 状态栏 / 刘海底下(本轮 codex 第 2 轮 P1)。
        // sticky 元素要脱离父级的左右 padding,靠负外边距顶到内容区边缘。
        marginLeft: -16,
        marginRight: -16,
        paddingLeft: 6,
        paddingRight: 6,
      }}
    >
      {/* 左位子:二级页是带文字的返回(44 起);一级页没有上一级,画板 5c② 把它收成
          8px 的隔条 —— 留 44 会把 17/600 的页名推到离屏边 50 的位置,读起来不再是
          「刚滚走的大标题」的延续。 */}
      <div style={{ minWidth: collapsible ? 8 : 44, flex: "none", display: "flex", alignItems: "center" }}>
        {backHref && (
          <Link
            href={backHref}
            className="m-tap"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 2,
              minHeight: 44,
              padding: "0 6px 0 2px",
              color: "var(--accent)",
              fontSize: 15,
              textDecoration: "none",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            {backLabel}
          </Link>
        )}
      </div>
      {/* 中间:二级页放轻量信息(章序)居中;一级页放收起的页名,**左对齐不居中**
          (画板 4k 附的理由:居中读成孤零零一条标题栏,左对齐才承接刚滚走的大标题)。 */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: collapsible ? "flex-start" : "center",
          ...(collapsible ? { fontSize: 17, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden" } : null),
        }}
      >
        {collapsible ? collapseTitle : center}
      </div>
      <div style={{ minWidth: 44, flex: "none", display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
        {right}
      </div>
      {progress}
    </div>
  );
}

/**
 * 功能条右侧的圆形动作按钮(RSS / 目录 / 文件…)。44 命中区,视觉 30 圆。
 */
export function MobileBarButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      className="m-tap"
      aria-label={label}
      onClick={onClick}
      style={{
        width: 44,
        height: 44,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "none",
        border: "none",
        padding: 0,
        color: "var(--accent)",
      }}
    >
      <span
        style={{
          width: 30,
          height: 30,
          borderRadius: 15,
          background: "var(--m-fill)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {children}
      </span>
    </button>
  );
}
