"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * R-MOBILE 两档 Sheet(画板 4e / 4f)。运行时面板、会话列表、本章目录、RSS、文件树都用它。
 *
 * 【两档的高度是比例,不是像素】画板标的 medium 354 / large 651 是在 390×845 基准下
 * 相对**内容安全高度 708** 的 50% / 92%。这里直接写百分比,定位父级就是内容区 ——
 * 于是换机型、换微信导航栏高度、装到主屏幕(没有微信栏,内容区更高)都自动对。
 * 写死 354 的话在小屏上会盖住对话,那正是 medium 档存在的意义所在。
 *
 * 【medium 档故意只占一半】画板 4e 裁定:「边看输出边看事件」是这个站的核心体验,
 * 桌面右栏永不遮挡对话,移动端只能靠 medium 档换回同一件事。Sheet 升起后盖住
 * 输入栏与 Tab Bar(iOS 语义),但**绝不许盖住对话**。
 *
 * 【Sheet 是实底,不是玻璃】全站只有功能条 / 输入栏 / Tab Bar 三处玻璃。
 * 运行时面板装的是密集 mono 数据,发糊就读不了 —— 这是「内容卡片一律实底」最该保护的一块,
 * 也顺带让它在 backdrop-filter 不可用的 Android 微信内核上零降级。
 */
export type Detent = "medium" | "large";

const HEIGHT: Record<Detent, string> = { medium: "50%", large: "92%" };

/** 拖动切档 / 关闭的位移阈值(px)。低于它按「没想动」处理,回弹原档。 */
const DRAG_THRESHOLD = 60;

export function Sheet({
  open,
  onClose,
  detent,
  onDetentChange,
  header,
  children,
  label,
}: {
  open: boolean;
  onClose: () => void;
  detent: Detent;
  onDetentChange: (d: Detent) => void;
  /** grabber 之下、滚动区之上的固定头部(统计条 + 分段控件等),不参与滚动 */
  header?: ReactNode;
  children: ReactNode;
  /** 无障碍名字。禁缩放已经损失了一层可达性,这里不再省。 */
  label: string;
}) {
  // 拖动中的临时位移。松手后清零 —— 落到哪一档由 onDetentChange / onClose 决定。
  const [dragY, setDragY] = useState(0);
  const startY = useRef<number | null>(null);

  // Esc 关闭。移动端用不上,但站点在桌面窄窗口下也会走移动壳,留着不亏。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    startY.current = e.touches[0]?.clientY ?? null;
  }, []);

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (startY.current === null) return;
      const dy = (e.touches[0]?.clientY ?? 0) - startY.current;
      // 往上拖到 large 之后不再跟手(没有更高的档),避免橡皮筋错觉
      setDragY(detent === "large" && dy < 0 ? 0 : dy);
    },
    [detent],
  );

  const onTouchEnd = useCallback(() => {
    const dy = dragY;
    startY.current = null;
    setDragY(0);
    if (dy > DRAG_THRESHOLD) {
      // 下拖:large → medium → 关闭
      if (detent === "large") onDetentChange("medium");
      else onClose();
    } else if (dy < -DRAG_THRESHOLD && detent === "medium") {
      onDetentChange("large");
    }
  }, [dragY, detent, onDetentChange, onClose]);

  if (!open) return null;

  return (
    <>
      {/* 遮罩。点它关闭 —— iOS 惯例,也是禁缩放后唯一不占屏幕空间的退出路径。 */}
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 6,
          background: "rgba(0,0,0,0.22)",
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 7,
          height: HEIGHT[detent],
          // 拖动中跟手;松手后 dragY 归零,由 transition 滑到目标档
          transform: `translateY(${Math.max(0, dragY)}px)`,
          transition: dragY === 0 ? "height .28s cubic-bezier(.32,.72,0,1), transform .28s cubic-bezier(.32,.72,0,1)" : "none",
          background: "var(--bg)",
          borderRadius: "20px 20px 0 0",
          boxShadow: "0 -8px 40px rgba(0,0,0,0.18)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* grabber。拖动手柄整块可拖(36×5 太小抓不住),所以监听挂在这一条上而不是那个小方块。 */}
        <div
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          style={{
            flex: "none",
            display: "flex",
            justifyContent: "center",
            padding: "6px 0 2px",
            // 让整条 grabber 区可拖而不触发页面滚动
            touchAction: "none",
            cursor: "grab",
          }}
        >
          <span
            style={{
              width: 36,
              height: 5,
              borderRadius: 2.5,
              background: "var(--m-grabber)",
            }}
          />
        </div>
        {header}
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>{children}</div>
      </div>
    </>
  );
}

/**
 * Sheet 头部的分段控件(画板 4e)。桌面右栏那四格方角 tab 在移动端换成它。
 * 容器 r9 + 内 r7 是**圆角同心**:外层圆角 9 − 内边距 2 = 7。
 */
export function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
}: {
  items: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="tablist"
      style={{
        flex: "none",
        margin: "0 16px 8px",
        display: "flex",
        background: "var(--m-fill)",
        borderRadius: 9,
        padding: 2,
        gap: 2,
      }}
    >
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.value)}
            className="m-tap"
            style={{
              flex: 1,
              minWidth: 0,
              textAlign: "center",
              // ⚠️ 别在这后面写 `font: "inherit"` —— 简写会把 fontSize / fontWeight 一起冲掉
              fontFamily: "inherit",
              fontSize: 13,
              fontWeight: active ? 600 : 400,
              color: active ? "var(--text)" : "var(--text-muted)",
              background: active ? "var(--bg)" : "transparent",
              borderRadius: 7,
              padding: "6px 0",
              boxShadow: active ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              border: "none",
            }}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
