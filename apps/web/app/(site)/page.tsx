import { Workbench } from "@/components/workbench/Workbench";
import { redirectAwayFromRuntime } from "@/lib/tabs-server";

// R-TABS:Runtime tab 被隐藏时,站点根路径让给第一个仍可见的 tab(302,不是 404 ——
// 理由见 lib/tabs-server.ts)。布局已是 force-dynamic,这里跟着动态渲染。
export const dynamic = "force-dynamic";

export default async function RuntimePage() {
  await redirectAwayFromRuntime();
  return <Workbench />;
}
