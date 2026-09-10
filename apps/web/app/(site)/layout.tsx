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

          【这一层为什么还留着】首版套它是为了「Tab Bar 别盖住底栏的备案号」。
          R-MOBILE-2 起那条理由在移动端已经不成立:`SiteFooter` 带 `m-hide-narrow`,
          ≤768px 整条不渲染(两个号搬去了 About 页尾),内容区因此自然长到屏底 ——
          Tab Bar 贴的「内容区底」就是真正的屏底(画板 5d ①),收起时 `translateY(100%)`
          也就整条出屏、不再剩那条 26 高的残条(5d ②)。
          **桌面仍有底栏**,而 Tab Bar 在桌面 `display:none`,所以这一层保留:
          它现在的职责只是「给 Tab Bar 一个定位祖先」,拆掉等于让 Tab Bar 去找
          更外层那个还含底栏的容器,又会退回老问题。 */}
      <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex", flexDirection: "column" }}>
        {children}
        {/* 只在 ≤768px 出现(自身带 m-show-narrow);桌面 display:none,不占位、不参与布局 */}
        <MobileTabBar visible={visible} />
      </div>
      {/* 备案号占位(R8):ICP_BEIAN / MPS_BEIAN 都未配置时整块不渲染 —— 开发与预发下版式与画板一致。
          R-MOBILE-2:它自带 `m-hide-narrow`,≤768px 不渲染;移动端的两号在 About 页尾 */}
      <SiteFooter />
      {/* pageview 打点(R8):渲染 null,不参与布局 */}
      <Beacon />
    </div>
  );
}
