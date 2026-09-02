"use client";

import { useEffect, useRef } from "react";

/**
 * 阅读进度线(设计稿画板 2c 顶端那条 2px 蓝线)。
 *
 * 画板里它是写死的 `width:31%` —— `.dc.html` 是静态画板,画不出「跟随滚动」,
 * 只能定格在「读到三分之一」的那一帧。实现照抄了那一帧,于是线永远停在 31%:
 * 读到 90% 它还是 31%,看着像坏了。这里把那一帧接上真实滚动,**样式一字未动**
 * (2px / 品牌蓝 / sticky 贴顶 / z-index),只让长度活起来(规则 7)。
 *
 * 三个实现约束:
 *  - **改 `transform: scaleX()` 不改 `width`**。width 每帧触发布局,长文(本站
 *    最长的章节上万字)滚动会掉帧;scaleX 走合成器。`transformOrigin` 取左边缘,
 *    否则线会从中间往两头长。
 *  - **不进 state**。scroll 事件按动画帧合帧后直接写 ref 的 style —— 进 state
 *    等于每帧把整篇正文重渲染一次,与 TimelineView 里「贴底跟随」用 ref 不用
 *    state 是同一个理由。
 *  - **滚动的不是 window**。站点布局是 `100dvh` 的 flex 列,真正滚动的是文章页
 *    自己那层 `overflow:auto` 的容器,所以往上找最近的可滚动祖先;找不到才退回
 *    文档滚动元素(布局哪天改回 window 滚动也不至于失灵)。
 */
export function ReadingProgress() {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const bar = ref.current;
    if (!bar) return;

    let scroller: HTMLElement | null = bar.parentElement;
    while (scroller) {
      const oy = getComputedStyle(scroller).overflowY;
      if (oy === "auto" || oy === "scroll") break;
      scroller = scroller.parentElement;
    }
    const target: HTMLElement = scroller ?? document.documentElement;
    const source: HTMLElement | Window = scroller ?? window;

    let frame = 0;
    const paint = () => {
      frame = 0;
      const max = target.scrollHeight - target.clientHeight;
      // 一屏放得下的短文(max <= 0)按读完算 —— 一条满线比一条永远空着的线诚实
      const p = max > 0 ? Math.min(1, Math.max(0, target.scrollTop / max)) : 1;
      bar.style.transform = `scaleX(${p})`;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };

    // 首帧就算一次:带 #anchor 进来、或浏览器恢复了上次的滚动位置时,
    // 不能先挂一条 0 的线等用户滚一下才对
    paint();
    source.addEventListener("scroll", onScroll, { passive: true });

    // 容器尺寸变(窗口缩放)与内容高度变(图片加载完)都会改写进度分母。
    // 观察容器自身管前者,观察它的子元素管后者 —— 容器的盒子不会因内容变高而变。
    const ro = new ResizeObserver(onScroll);
    ro.observe(target);
    for (const child of Array.from(target.children)) ro.observe(child);

    return () => {
      source.removeEventListener("scroll", onScroll);
      ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      ref={ref}
      style={{
        position: "sticky", top: 0, left: 0, width: "100%", height: 2,
        background: "var(--accent)", zIndex: 2,
        // 服务端渲染出来就是 0:文章顶端进度本来就是 0,水合前不会先闪一条满线
        transform: "scaleX(0)", transformOrigin: "0 50%",
      }}
    />
  );
}
