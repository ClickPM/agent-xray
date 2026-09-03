"use client";

// 画板 2k 变体 B 的客户端半边:主出口按「当前在哪一层 + 那一层现在露不露」挑,末尾回显访问路径。
//
// **为什么要拆成两个文件**:哪个 tab 可见只有服务端知道(`visibleTabKeys()` 打后端),
// 而访问的是哪个路径只有客户端知道(`usePathname()`,服务端组件拿不到当前路径)。
// 于是 `(site)/not-found.tsx` 是 Server Component,把可见集合取好传进来;这里做剩下的判断。
import { usePathname } from "next/navigation";
import type { TabKey } from "@/lib/tabs";
import { StatusScreen } from "@/components/StatusScreen";
import { mono } from "@/lib/styles";

/**
 * 主出口 = 「回上一层列表」(画板 2k)。
 *
 * **那一层被藏起来时不能指过去**(codex 首轮 P2):所有者用 `site_tab_set` 把 Skills 藏了之后,
 * `/skills` 与 `/skills/<name>` 本来就会 404(R-TABS:隐藏 = 页面在站点上不存在),
 * 这时再给一枚「回 Skills 列表」,点下去是同一个 404 —— 访问的正好是列表根路径时,
 * 那枚按钮甚至指向当前地址,原地打转。
 *
 * 退化目标固定是首页:`/` 永远有落点 —— 写面拒绝关掉最后一个可见 tab,
 * 而 `runtime` 被藏时 `/` 会 307 到第一个可见 tab(`lib/tabs-server.ts` 的 redirectAwayFromRuntime)。
 */
function exitFor(pathname: string, visible: readonly TabKey[]): { label: string; href: string } {
  if (pathname.startsWith("/skills") && visible.includes("skills")) {
    return { label: "回 Skills 列表", href: "/skills" };
  }
  if (pathname.startsWith("/notes") && visible.includes("notes")) {
    return { label: "回 Notes 列表", href: "/notes" };
  }
  return { label: "返回首页", href: "/" };
}

export function NotFoundScreen({ visible }: { visible: readonly TabKey[] }) {
  const pathname = usePathname() ?? "/";
  const primary = exitFor(pathname, visible);

  return (
    <StatusScreen
      dot="var(--text-dim)"
      code="HTTP 404"
      title="这个地址没有对应的内容"
      description="链接可能过期了,或者这一篇 / 这个 skill 改了名字。从列表里找一遍通常能找到它。"
      primary={primary}
      // 主出口已经是首页时不并排两个一样的出口
      secondary={primary.href === "/" ? null : { label: "返回首页", href: "/" }}
      footer={
        <div
          style={{
            ...mono(11), color: "var(--text-dim)", marginTop: 22,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}
        >
          {pathname}
        </div>
      }
    />
  );
}
