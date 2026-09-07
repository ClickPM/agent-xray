"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TABS, type TabKey } from "@/lib/tabs";

/**
 * R-MOBILE 底部 Tab Bar(画板 4a,四格;附图给了三格态)。
 *
 * 桌面把四格 tab 组放在顶部导航条中间;移动端下移到底部,是 iOS 26 的标准位置。
 * 顶部让给「功能条」(左会话 / 右运行时),因为微信导航栏已经占了标题位。
 *
 * 【R-TABS 必须照旧生效】`visible` 由 `(site)/layout.tsx` 服务端取好传进来,
 * 与桌面 `GlobalNav` 用的是同一个来源。被关掉的 tab **整格不渲染**
 * (不置灰、不占位),剩下的格子 `flex:1` 平分 —— 三格 33.3% / 两格 50%。
 * 图标与 10px 文字尺寸不变,变的只有每格宽度(画板 4a 附图标注)。
 *
 * 【图标为什么不放进 lib/tabs.ts】那个文件同时被 Server 与 Client Component import,
 * 且它的文件头写着「新增 tab 要改三处」——再加一处会让那条约定更容易漏。
 * 这里改用**穷举类型** `Record<TabKey, string>`:新增 tab 而不给图标时 **tsc 直接报错**,
 * 比注释可靠。(注意 `dev.ps1 check` / `test` 都不跑 tsc,得靠 `apps/web` 的
 * `tsc --noEmit` 或生产 `next build` —— 见 rounds/BACKLOG.md。)
 *
 * 图标路径逐字取自画板尾部脚本的 `tabDefs`,不是另画的。
 */
const ICONS: Record<TabKey, string> = {
  runtime: "M22 12h-4l-3 9L9 3l-3 9H2",
  notes: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z",
  skills: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
  about: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 21v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1",
};

export function MobileTabBar({ visible }: { visible: readonly TabKey[] }) {
  const pathname = usePathname() ?? "/";
  const tabs = TABS.filter((t) => visible.includes(t.key));

  return (
    <nav
      className="m-glass-bottom m-show-narrow"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 5,
        // ⚠️ 这里**不能写 `display`** —— 显隐完全交给 `.m-show-narrow`。
        // 内联样式优先级高于类选择器,写了 `display:"flex"` 会盖掉那条 `display:none`,
        // 表现是**桌面上也出现底部 Tab Bar**(2026-09-07 首次预览实测到)。
        // 49 是 Tab Bar 本体;底下再垫安全区,Home Indicator 才不会压住文字。
        // 机型不同这一段高度不同,所以是变量不是写死的 34。
        height: `calc(49px + var(--safe-bottom))`,
        paddingBottom: "var(--safe-bottom)",
      }}
    >
      {tabs.map((t) => {
        const active = t.match(pathname);
        const color = active ? "var(--accent)" : "var(--text-muted)";
        return (
          <Link
            key={t.key}
            href={t.href}
            className="m-tap"
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              textDecoration: "none",
              color,
            }}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d={ICONS[t.key]} />
            </svg>
            <span style={{ fontSize: 10, fontWeight: active ? 600 : 400 }}>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
