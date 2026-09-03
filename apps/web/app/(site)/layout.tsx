import { Beacon } from "@/components/Beacon";
import { GlobalNav } from "@/components/GlobalNav";
import { SiteFooter } from "@/components/SiteFooter";
import { visibleTabKeys } from "@/lib/tabs-server";

// R-TABS:导航条要显示哪几格由库里的开关决定(所有者经 MCP 的 site_tab_set 改),
// 且 docker build 时后端不可达 —— 不允许构建期预渲染。
// 这也让站点根路径 `/` 从此是动态渲染的:`runtime` 被隐藏时它要 302 到别处。
export const dynamic = "force-dynamic";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  // `visibleTabKeys` 用 React cache 包过,同一次请求里页面再取一次不会多打一次后端
  const visible = await visibleTabKeys();
  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
      <GlobalNav visible={visible} />
      {children}
      {/* 备案号占位(R8):ICP_BEIAN 未配置时整块不渲染 —— 开发与预发下版式与画板一致 */}
      <SiteFooter />
      {/* pageview 打点(R8):渲染 null,不参与布局 */}
      <Beacon />
    </div>
  );
}
