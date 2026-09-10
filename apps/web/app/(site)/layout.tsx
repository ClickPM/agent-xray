import { Beacon } from "@/components/Beacon";
import { GlobalNav } from "@/components/GlobalNav";
import { MobileTabBar } from "@/components/mobile/MobileTabBar";
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
      {/* R-MOBILE:这一层是**移动端底部 Tab Bar 的定位容器**,桌面上完全透明。
          外层与内层的 flex 属性一致(flex:1 / minHeight:0 / column),各页原本作为
          直接 flex 子项的根 div(Workbench 的 `flex:1 minHeight:0 display:flex`、
          Notes 章节页的 `flex:1 minHeight:0 overflow:auto` 等)拿到的仍是同一份约束,
          桌面渲染逐像素不变(规则 7 要求的「写明理由与影响范围」即此)。

          【为什么 Tab Bar 不能直接 absolute 到最外层】最外层底部还有 SiteFooter
          (生产环境的 ICP 与公安联网备案号)。Tab Bar 贴最外层 bottom:0 会把备案号盖住,
          而备案号**必须可见**(docs/deploy-cn-lightweight.md 的部署约束)。
          套这一层之后:Tab Bar 贴的是「内容区」的底,备案条在它下面,两者都在。 */}
      <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex", flexDirection: "column" }}>
        {children}
        {/* 只在 ≤768px 出现(自身带 m-show-narrow);桌面 display:none,不占位、不参与布局 */}
        <MobileTabBar visible={visible} />
      </div>
      {/* 备案号占位(R8):ICP_BEIAN / MPS_BEIAN 都未配置时整块不渲染 —— 开发与预发下版式与画板一致 */}
      <SiteFooter />
      {/* pageview 打点(R8):渲染 null,不参与布局 */}
      <Beacon />
    </div>
  );
}
