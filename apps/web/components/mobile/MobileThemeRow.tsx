"use client";

import { useEffect, useState } from "react";

/**
 * R-MOBILE:About 页的「外观」分组(画板 4r)。
 *
 * 【为什么必须有这一块】桌面的主题切换在导航条右端那枚月亮图标上,而移动端
 * `GlobalNav` 整条 `display:none` —— 不把它搬过来,移动端就**完全没有切主题的入口**
 * (本轮实现期实测到的功能回归,不是新功能)。
 *
 * 【为什么落在 About】移动端功能条只有两个位子,给会话与运行时;主题是一次性设置,
 * 一个月点不到一次,收进 About 的「外观」分组是它该在的地方(画板 4r 裁定)。
 *
 * 【开关配色】iOS Switch 51×31,开启态填**品牌色 #2563eb**,不用 iOS 系统绿 ——
 * 全站只有一个强调色(画板 4r)。
 *
 * 【读写与既有那段内联脚本同一口径】`html.dark` 类 + `localStorage("xray-theme")`,
 * 与 `app/layout.tsx` 里那段防闪脚本读的是同一个键。那段脚本不许动(CLAUDE.md 规则 8
 * 的 R-MOBILE 段),这里只做同样的读写。
 */
export function MobileThemeRow() {
  // 服务端渲染不出真实值(主题在 localStorage 里),先按浅色渲染,挂载后校正 ——
  // 与 `app/layout.tsx` 的防闪脚本分工:那段负责首帧不闪,这里只负责开关的位置对。
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = () => {
    const next = document.documentElement.classList.toggle("dark");
    try {
      localStorage.setItem("xray-theme", next ? "dark" : "light");
    } catch {
      // 隐私模式下写不进去:开关本次仍然生效,只是不记住 —— 不值得报错
    }
    setDark(next);
  };

  return (
    <div className="m-show-narrow" style={{ flexDirection: "column", marginTop: 26 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>外观</div>
      <div style={{ background: "var(--bg-panel)", borderRadius: 16, padding: "0 16px" }}>
        {/*
          ⚠️ **不要用 `<label>` 包一个受控 `<input type="checkbox">`**(本轮实测踩过):
          label 的隐式激活会把点击**再转发一次**给 input,`onChange` 因此跑两次 ——
          `classList.toggle` 与 `setDark` 各翻两次却不同相,表现是
          「主题真的切了,但开关的视觉停在原位」(html.dark=true 而组件渲染的是关闭分支)。
          `<button role="switch">` 只有一次 click,没有这层隐式行为,可达性也不比 checkbox 差。
        */}
        <button
          type="button"
          role="switch"
          aria-checked={dark}
          aria-label="深色模式"
          onClick={toggle}
          className="m-tap"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            width: "100%",
            minHeight: 56,
            background: "none",
            border: "none",
            padding: 0,
            color: "var(--text)",
            fontFamily: "inherit",
            textAlign: "left",
          }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }}>
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
          <span style={{ flex: 1, minWidth: 0, fontSize: 15 }}>深色模式</span>
          {/* iOS Switch 51×31;开启态填品牌色(不用 iOS 系统绿 —— 全站只有一个强调色) */}
          <span
            aria-hidden
            style={{
              width: 51,
              height: 31,
              borderRadius: 16,
              flex: "none",
              background: dark ? "var(--accent)" : "rgba(120,120,128,0.16)",
              transition: "background .2s ease",
              display: "flex",
              alignItems: "center",
              padding: 2,
              boxSizing: "border-box",
            }}
          >
            <span
              style={{
                width: 27,
                height: 27,
                borderRadius: "50%",
                background: "#ffffff",
                boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                transform: dark ? "translateX(20px)" : "translateX(0)",
                transition: "transform .2s ease",
              }}
            />
          </span>
        </button>
      </div>
    </div>
  );
}
