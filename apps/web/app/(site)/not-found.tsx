// (site) 段的「找不到」—— 设计稿画板 2k 的变体 B。
//
// **在此之前这里是 Next.js 的默认英文页** `404 | This page could not be found`。
// 触发它的是站内真实可达的几条路:失效的 skill 链接、改过名的系列 / 章节
// (`lib/api.ts` 的 `notFoundOnBadRoute`),以及被隐藏 tab 的地址
// (`lib/tabs-server.ts` 的 `requireVisibleTab` —— R-TABS 裁定「隐藏 = 页面不存在」)。
//
// **不显示可复制的错误标识**(画板 2k 裁定):404 背后没有服务端异常可对账,
// 给一串 id 只会让人误以为出了故障。末尾只回显访问的那个路径,让人一眼看出是拼错还是改名。
//
// **这一层是 Server Component,只为取一件事:哪几个 tab 现在露着**。
// 主出口是「回上一层列表」,而那一层可能正是被藏起来的那个 —— 那时指过去只会得到同一个 404
// (codex 首轮 P2)。判断在客户端半边 `components/NotFoundScreen.tsx` 做,它还要 usePathname。
// `visibleTabKeys()` 被 React `cache` 包过,同一次请求里 `requireVisibleTab` 已经取过一次,
// 这里不会再打一次后端。
//
// ⚠️ 本文件只接管 `(site)` 段内的 `notFound()`。**完全不匹配任何路由的地址**(如 `/foo`)
// 走根部的 `app/not-found.tsx`,那里仍是 Next 默认页 —— 所有者裁定 2026-09-03 不做,
// 理由记在 rounds/round-perf/round-perf.md。
import { NotFoundScreen } from "@/components/NotFoundScreen";
import { visibleTabKeys } from "@/lib/tabs-server";

export default async function SiteNotFound() {
  return <NotFoundScreen visible={await visibleTabKeys()} />;
}
