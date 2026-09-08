// Source 页的加载态(设计稿画板 2p,骨架对位 2o)。两个 `loading.tsx`(/source 与 /source/[...path])共用。
//
// 骨架规则照 2i(components/Skeleton.tsx 文件头):填充 `--bg-hover`,压在灰面上降一档 `--border`;
// 圆角 4 文本条 / 6 大标题条 / 7 按钮块与卡片;`omPulseBg` 只给两块锚点(22px 标题条与代码区第一行)。
// 44px 导航条、预览卡外壳、头部条底色、36px 行号列的 1px 右边框都是**实体**(它们是容器不是内容)。
// 目录树宽 264、栏间距 32、树行 26 高与缩进 8/20/32/44 与 2o 完全一致:内容到达时零跳版。
// 外层容器与 SourceBrowser 逐字相同(maxWidth 1100 / padding 30px 32px 64px)。
import Link from "next/link";
import type { CSSProperties } from "react";
import { Bar, Line, SkeletonScreen } from "@/components/Skeleton";
import { SourceLoadingNote } from "@/components/source/SourceLoadingNote";
import { mono } from "@/lib/styles";

const sectionLabel: CSSProperties = { ...mono(10, 600), color: "var(--text-dim)", letterSpacing: "0.08em", marginBottom: 6 };

/** 目录树的一行:高 26,缩进按层级,12px 箭头位留白(还不知道哪几行是目录) */
function TreeLine({ indent, w }: { indent: number; w: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, height: 26, padding: `0 8px 0 ${indent}px`, boxSizing: "border-box" }}>
      <span style={{ width: 12, flex: "none" }} />
      <Bar w={w} />
    </div>
  );
}

/** 画板 2p 的 12 行目录树骨架:缩进沿用 8 / 20 / 32 / 44 */
const TREE_LINES: Array<[number, number]> = [
  [8, 64], [20, 52], [32, 70], [44, 60], [44, 82], [44, 66], [32, 58], [20, 46], [8, 74], [8, 56], [8, 96], [8, 68],
];

/** 画板 2p 的 20 行代码骨架宽度(百分比) */
const CODE_LINES = [62, 54, 30, 38, 44, 12, 48, 36, 26, 58, 64, 41, 33, 70, 22, 50, 46, 29, 15, 40];

export function SourceSkeleton() {
  return (
    <SkeletonScreen>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "30px 32px 64px" }}>
        {/* 面包屑:Source 是真实链接(层级已知,也是访客改主意时的出口),后三级骨架;右侧「正在取 <path>…」 */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-dim)", minHeight: 17 }}>
          <Link href="/source" style={{ color: "var(--accent)" }}>Source</Link>
          <span>/</span>
          <Bar w={38} h={10} />
          <span>/</span>
          <Bar w={28} h={10} />
          <span>/</span>
          <Bar w={44} h={10} />
          <div style={{ flex: 1 }} />
          <SourceLoadingNote />
        </div>

        {/* 页头:标题条 r6(锚点)+ 徽标块;描述行;meta 行;右上一枚按钮块 */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginTop: 22 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, height: 29 }}>
              <Bar w={150} h={22} radius={6} pulse />
              <Bar w={34} h={16} />
            </div>
            <div style={{ maxWidth: 640, marginTop: 6 }}>
              <Line h={21}><Bar w={420} /></Line>
            </div>
            <Line h={15} style={{ marginTop: 10 }}><Bar w={330} h={10} /></Line>
          </div>
          <div style={{ display: "flex", gap: 8, flex: "none", paddingTop: 2 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 90, height: 32, background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 7, boxSizing: "border-box" }}>
              <Bar w={52} h={10} tone="onGrey" />
            </div>
          </div>
        </div>

        {/* 目录树 / 预览卡 */}
        <div style={{ display: "grid", gridTemplateColumns: "264px minmax(0,1fr)", gap: 32, marginTop: 26, alignItems: "start" }}>
          <div>
            <div style={sectionLabel}>FILES</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {TREE_LINES.map(([indent, w], i) => (
                <TreeLine key={i} indent={indent} w={w} />
              ))}
            </div>
          </div>

          <div style={{ border: "1px solid var(--border)", borderRadius: 7, overflow: "hidden", boxShadow: "0 1px 0 rgba(0,0,0,0.03)", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "var(--bg-panel)", borderBottom: "1px solid var(--border)", height: 31, boxSizing: "border-box" }}>
              <Bar w={150} tone="onGrey" />
              <Bar w={132} h={10} tone="onGrey" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "36px minmax(0,1fr)", padding: "12px 0", font: "400 12px/1.7 var(--font-mono)" }}>
              {CODE_LINES.map((w, i) => (
                <div key={i} style={{ display: "contents" }}>
                  <span style={{ borderRight: "1px solid var(--border)", height: 20 }} />
                  <span style={{ padding: "0 24px 0 14px", height: 20, display: "flex", alignItems: "center" }}>
                    <Bar w={`${w}%`} pulse={i === 0} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 22, lineHeight: 1.9 }}>这是本站自己的源码,与线上运行的版本一致;快照随每次发版更新。</div>
      </div>
    </SkeletonScreen>
  );
}
