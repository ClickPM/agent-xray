import { Beacon } from "@/components/Beacon";
import { GlobalNav } from "@/components/GlobalNav";
import { SiteFooter } from "@/components/SiteFooter";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
      <GlobalNav />
      {children}
      {/* 备案号占位(R8):ICP_BEIAN 未配置时整块不渲染 —— 开发与预发下版式与画板一致 */}
      <SiteFooter />
      {/* pageview 打点(R8):渲染 null,不参与布局 */}
      <Beacon />
    </div>
  );
}
