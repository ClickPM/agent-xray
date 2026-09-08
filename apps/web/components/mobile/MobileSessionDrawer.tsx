"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { relativeTime, type SessionSummary } from "@/lib/agent-api";
import { mono } from "@/lib/styles";

/**
 * R-MOBILE 会话列表抽屉(画板 4j「会话列表 Sheet(左侧滑出)」)。
 *
 * 【为什么不是底部 Sheet】画板写死了:桌面 260px 常驻左栏 → **从左侧滑出、宽 84%、
 * 右两角 r20**,右侧留 16% 露出被压暗的会话区,点空白处收起 ——
 * 「保留『我只是临时看一眼列表』的位置感」。首版做成了通用底部 Sheet(92% 全宽),
 * 位置感与画板相反(本轮 codex 第 2 轮 P2)。
 *
 * 【桌面栏头三件套怎么拆的】字标去掉(标题由载体显示)、New → 品牌色实底胶囊主按钮、
 * **刷新图标 → 下拉刷新手势**。画板同时写明:左滑删除与下拉刷新是移动端固有的
 * 交互原语,**不是新功能** —— 它们分别替代桌面的悬停删除按钮与刷新图标按钮,
 * 能做的事一件不多、一件不少。
 *
 * 【下拉刷新只允许发生在列表容器内】列表容器 `overscroll-behavior: contain`,
 * 页面本身是 `none`(globals.css)。少了这条,整页下拉会把固定的功能条 / Tab Bar
 * 一起拽动,在内嵌 webview 里还会露出宿主背景。指示器复用既有 `omSpin`,不新造动效。
 */
const DRAWER_WIDTH = "84%";
/** 触发刷新的下拉距离(px)。低于它按「没想刷新」回弹。 */
const PULL_THRESHOLD = 64;
/** 下拉的最大视觉位移,避免把列表拉得太开。 */
const PULL_MAX = 96;

export function MobileSessionDrawer({
  open,
  onClose,
  sessions,
  selected,
  onSelect,
  onNew,
  onDelete,
  onRefresh,
}: {
  open: boolean;
  onClose: () => void;
  sessions: SessionSummary[];
  selected: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
}) {
  const [swiped, setSwiped] = useState<string | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const pullStart = useRef<number | null>(null);
  const swipeStart = useRef<number | null>(null);

  // 抽屉关上时清掉左滑态:下次打开不该还残留着上次划开的那一行
  useEffect(() => {
    if (!open) {
      setSwiped(null);
      setPull(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // ── 下拉刷新 ─────────────────────────────────────────────────────────
  const onListTouchStart = useCallback((e: React.TouchEvent) => {
    // 只有列表**已经在顶端**时才认下拉,否则那是正常的向上滚动
    pullStart.current = (listRef.current?.scrollTop ?? 0) <= 0 ? (e.touches[0]?.clientY ?? null) : null;
  }, []);

  const onListTouchMove = useCallback((e: React.TouchEvent) => {
    if (pullStart.current === null) return;
    const dy = (e.touches[0]?.clientY ?? 0) - pullStart.current;
    // 阻尼:实际位移取拉动距离的一半,拉到 PULL_MAX 封顶
    setPull(dy > 0 ? Math.min(PULL_MAX, dy / 2) : 0);
  }, []);

  const onListTouchEnd = useCallback(() => {
    const dist = pull;
    pullStart.current = null;
    setPull(0);
    if (dist >= PULL_THRESHOLD / 2) {
      setRefreshing(true);
      onRefresh();
      // 刷新本身没有完成回调(`onRefresh` 只是重新拉列表),给一个短暂的可见反馈,
      // 不假装知道网络什么时候回来
      setTimeout(() => setRefreshing(false), 900);
    }
  }, [pull, onRefresh]);

  if (!open) return null;

  const showSpinner = refreshing || pull > 0;

  return (
    <>
      {/* 右侧留出的 16%:被压暗的会话区。点它收起 —— 画板要的「临时看一眼」的位置感 */}
      <div
        onClick={onClose}
        style={{ position: "absolute", inset: 0, zIndex: 6, background: "rgba(0,0,0,0.22)" }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="会话列表"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: DRAWER_WIDTH,
          zIndex: 7,
          // 右两角圆角:左边贴着屏幕边缘,不需要圆角
          borderRadius: "0 20px 20px 0",
          background: "var(--bg-panel)",
          boxShadow: "8px 0 40px rgba(0,0,0,0.18)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          // 顶部让开安全区(standalone 下状态栏那一段)
          paddingTop: "var(--safe-top)",
          paddingBottom: "var(--safe-bottom)",
        }}
      >
        <div style={{ flex: "none", padding: "14px 16px 10px" }}>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em", marginBottom: 12 }}>会话</div>
          <button
            className="m-tap"
            onClick={onNew}
            style={{
              width: "100%",
              height: 44,
              borderRadius: 22,
              background: "var(--accent)",
              color: "#ffffff",
              border: "none",
              fontSize: 15,
              fontWeight: 600,
              fontFamily: "inherit",
            }}
          >
            新会话
          </button>
        </div>

        {/* 刷新指示条。只在下拉中 / 刷新中占位,常态高度 0 —— 不常驻一条空条 */}
        <div
          style={{
            flex: "none",
            height: showSpinner ? 28 : 0,
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            transition: pull > 0 ? "none" : "height .2s ease",
            ...mono(11),
            color: "var(--text-dim)",
          }}
        >
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"
            style={{
              animation: refreshing ? "omSpin 0.8s linear infinite" : "none",
              transformOrigin: "50% 50%",
            }}
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          {refreshing ? "刷新中…" : "下拉刷新"}
        </div>

        <div
          ref={listRef}
          onTouchStart={onListTouchStart}
          onTouchMove={onListTouchMove}
          onTouchEnd={onListTouchEnd}
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            // 下拉刷新只允许发生在**这个容器内**:页面本身是 overscroll-behavior:none,
            // 这里用 contain,不把橡皮筋传导给祖先(画板 4j)
            overscrollBehavior: "contain",
            transform: pull > 0 ? `translateY(${pull}px)` : "none",
            transition: pull > 0 ? "none" : "transform .2s ease",
            padding: "0 16px 16px",
          }}
        >
          <div style={{ borderRadius: 16, background: "var(--bg)", overflow: "hidden" }}>
            {sessions.length === 0 && (
              <div style={{ padding: "18px 16px", fontSize: 15, color: "var(--text-muted)" }}>还没有会话</div>
            )}
            {sessions.map((s) => {
              const isSwiped = swiped === s.id;
              return (
                <div key={s.id} className="m-sep-row" style={{ position: "relative", overflow: "hidden" }}>
                  <button
                    onClick={() => {
                      onDelete(s.id);
                      setSwiped(null);
                    }}
                    style={{
                      position: "absolute", top: 0, right: 0, bottom: 0, width: 84,
                      background: "var(--err-text)", color: "#ffffff", border: "none",
                      fontSize: 15, fontWeight: 600, fontFamily: "inherit",
                    }}
                  >
                    删除
                  </button>
                  <div
                    className="m-tap"
                    onClick={() => (isSwiped ? setSwiped(null) : onSelect(s.id))}
                    onTouchStart={(e) => { swipeStart.current = e.touches[0]?.clientX ?? null; }}
                    onTouchEnd={(e) => {
                      if (swipeStart.current === null) return;
                      const dx = (e.changedTouches[0]?.clientX ?? 0) - swipeStart.current;
                      if (dx < -40) setSwiped(s.id);
                      else if (dx > 40) setSwiped(null);
                      swipeStart.current = null;
                    }}
                    style={{
                      position: "relative",
                      minHeight: 56,
                      boxSizing: "border-box",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "0 16px",
                      // 选中行换品牌色淡底:桌面的 #e8e8e8 在 iOS 白卡上读不出选中
                      // (画板 4j:保留语义、换值)。
                      //
                      // **这一层必须不透明** —— 删除按钮是常驻的绝对定位元素,靠本行盖住它、
                      // 靠 translateX 把它露出来。直接写 `rgba(37,99,235,0.06)` 会 94% 透光:
                      // 选中的那一行**没划开也露着红色删除按钮**,行内的时间与 chevron 正好压在
                      // 「删除」二字上,且 `elementFromPoint` 打在按钮中心命中的是时间 span 而不是按钮
                      // (2026-09-08 所有者在微信 webview 上报障,合成 DOM 复刻确认)。未选中行用
                      // 不透明的 var(--bg),所以只有选中行会犯 —— 本机验收时选中行恰好没进视野。
                      // 用 linear-gradient 叠一层实色而不是硬写混合后的色值:渲染结果与原来
                      // 一字不差,且明暗两套主题各自跟着 --bg 走。
                      background: s.id === selected
                        ? "linear-gradient(rgba(37,99,235,0.06), rgba(37,99,235,0.06)), var(--bg)"
                        : "var(--bg)",
                      transform: isSwiped ? "translateX(-84px)" : "translateX(0)",
                      transition: "transform .2s ease",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {s.title || "新会话"}
                      </div>
                    </div>
                    <span style={{ fontSize: 12, color: "var(--text-dim)", flex: "none" }}>
                      {relativeTime(s.lastActiveAt)}
                    </span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--m-chevron)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }}>
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
