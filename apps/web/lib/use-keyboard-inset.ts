import { useEffect, useState } from "react";

/**
 * R-MOBILE:软件键盘占掉的高度(px)。没有键盘时是 0。
 *
 * 【为什么非有不可】iOS Safari / WKWebView 弹出键盘时**不改布局视口**,只把
 * `visualViewport` 缩小。所以纯靠 `100dvh` + `position:absolute; bottom:0` 的输入栏
 * 会**停在布局视口底部、被键盘整条盖住** —— 移动端的核心交互(发消息)直接不可用。
 * 这是本轮 codex 审查的 P1 之一,也是 `impl-prompt.md` §3.3 早就写明的要求。
 *
 * 【算法】键盘高度 = 布局视口高 − 可视视口高 − 可视视口的上偏移。
 * 减 `offsetTop` 是因为页面被顶起时可视视口整体上移,那一段不算键盘。
 * 结果夹到 ≥0:桌面浏览器缩放、地址栏收放都会让这个差值出现小的正负抖动。
 *
 * 【阈值 80】小于 80 的差值不当键盘:iOS 收放地址栏会造成几十 px 的变化,
 * 当成键盘会让输入栏在滚动时乱跳。真实键盘至少 200+。
 *
 * 【同时给 body 挂标记】Tab Bar 在站点 layout 里、比 Runtime 壳高两层,
 * 拿不到这件事;键盘弹起时它必须让位(iOS 惯例,画板 4b 也这么标)。
 * 用 body 上的类往上传,与错误态的 `m-errored` 同一手法。
 */
const KEYBOARD_MIN = 80;

export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : undefined;
    if (!vv) return;

    let frame = 0;
    const measure = () => {
      frame = 0;
      const raw = window.innerHeight - vv.height - vv.offsetTop;
      const next = raw > KEYBOARD_MIN ? Math.round(raw) : 0;
      setInset((cur) => (cur === next ? cur : next));
      document.body.classList.toggle("m-keyboard", next > 0);
    };
    const onChange = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    measure();
    vv.addEventListener("resize", onChange);
    vv.addEventListener("scroll", onChange);
    return () => {
      vv.removeEventListener("resize", onChange);
      vv.removeEventListener("scroll", onChange);
      if (frame) cancelAnimationFrame(frame);
      document.body.classList.remove("m-keyboard");
    };
  }, []);

  return inset;
}
