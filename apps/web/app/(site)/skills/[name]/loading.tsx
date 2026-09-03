// Skill 详情页的加载态(设计稿画板 2i)。
//
// **为什么需要它**:这一页是 `force-dynamic`,软导航要等服务端把 RSC 渲染完才换内容,
// 而 App Router 在那之前**一个像素都不动** —— 访客的体验是「点了没反应」,会反复点。
// 2026-09-03 在生产实测:点 `diagram` 卡片到 URL 变化 4.0 秒,`ppt-master` 的 RSC 5.6–7.2 秒。
//
// **骨架逐项对位 2g**(画板 2i 的「对位」那一条):标题行 29px · 描述行 21px · meta 行 15px ·
// FILES 行 26px(缩进 8 / 20 / 32)· 预览正文行距 14×1.8=25.2px · 小节标题前 30px。
// 外层容器与 page.tsx 逐字相同(maxWidth 1100 / padding 30px 32px 64px),内容到达时零跳版。
//
// 骨架色、圆角、动效的裁定见 components/Skeleton.tsx 的文件头(都来自画板 2i 的裁定面板)。
import Link from "next/link";
import type { CSSProperties } from "react";
import { Bar, Line, LoadingNote, SkeletonScreen } from "@/components/Skeleton";
import { mono } from "@/lib/styles";

/** 与 SkillDetail 的 sectionLabel 同一份(INSTALL / FILES) */
const sectionLabel: CSSProperties = {
  ...mono(10, 600), color: "var(--text-dim)", letterSpacing: "0.08em", marginBottom: 6,
};

/**
 * 右上两枚 ghost 按钮画成骨架块、不做禁用态(画板 2i 裁定):
 * ①「下载 zip · N KB」的文案本身含还没取回的数据,做禁用态就得先编一个假体积;
 * ② 灰掉的实体按钮仍然像可点,访客会去点一个还没有 href 的目标。
 * 外形(32px / r7 / --border 边框)照 2g 原样保留,到达时零跳版。
 */
function ButtonBlock({ w, inner }: { w: number; inner: number }) {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: w, height: 32, background: "var(--bg-hover)",
        border: "1px solid var(--border)", borderRadius: 7, boxSizing: "border-box",
      }}
    >
      <Bar w={inner} h={10} tone="onGrey" />
    </div>
  );
}

/** 目录树的一行:高 26,缩进按层级 8 / 20 / 32,9px 折叠箭头位留空 */
function TreeLine({ indent, w }: { indent: number; w: number }) {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 6, height: 26,
        padding: `0 8px 0 ${indent}px`, boxSizing: "border-box",
      }}
    >
      <span style={{ width: 9, flex: "none" }} />
      <Bar w={w} />
    </div>
  );
}

/** 「本页目录」的一行:2px 左边框位先占住(transparent),真实目录高亮时不横移 */
function TocLine({ w }: { w: number }) {
  return (
    <div style={{ padding: "4px 0 4px 10px", borderLeft: "2px solid transparent" }}>
      <Bar w={w} h={10} />
    </div>
  );
}

export default function SkillLoading() {
  return (
    <SkeletonScreen>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "30px 32px 64px" }}>
        {/* 面包屑:Skills 是真实链接(层级已知,也是访客改主意时的出口),后两级骨架 */}
        <div style={{ fontSize: 12, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 6, minHeight: 17 }}>
          <Link href="/skills" style={{ color: "var(--accent)" }}>Skills</Link>
          <span>/</span>
          <Bar w={56} h={10} />
          <span>/</span>
          <Bar w={108} h={10} />
          <div style={{ flex: 1 }} />
          <LoadingNote />
        </div>

        {/* 头部 */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginTop: 22 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, height: 29 }}>
              <Bar w={260} h={22} radius={6} pulse />
              <Bar w={34} h={16} />
            </div>
            <div style={{ maxWidth: 640, marginTop: 6 }}>
              <Line h={21}><Bar w={640} /></Line>
              <Line h={21}><Bar w={384} /></Line>
            </div>
            <Line h={15} style={{ marginTop: 10 }}><Bar w={300} h={10} /></Line>
          </div>
          <div style={{ display: "flex", gap: 8, flex: "none", paddingTop: 2 }}>
            <ButtonBlock w={90} inner={52} />
            <ButtonBlock w={118} inner={74} />
          </div>
        </div>

        {/* INSTALL —— 小标题是固定文案,真实渲染;命令未到,不画 copy(复制只会拿到空串) */}
        <div style={{ marginTop: 22, background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 7, padding: "12px 14px" }}>
          <div style={sectionLabel}>INSTALL</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "7px 10px" }}>
            <Bar w={420} h={12} pulse />
          </div>
          <Line h={17} style={{ marginTop: 8 }}><Bar w={330} h={10} tone="onGrey" /></Line>
        </div>

        {/* 目录树 / 文件预览 */}
        <div style={{ display: "grid", gridTemplateColumns: "240px minmax(0,1fr)", gap: 32, marginTop: 26, alignItems: "start" }}>
          <div>
            <div style={sectionLabel}>FILES</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <TreeLine indent={8} w={118} />
              <TreeLine indent={20} w={78} />
              <TreeLine indent={20} w={66} />
              <TreeLine indent={32} w={84} />
              <TreeLine indent={32} w={92} />
              <TreeLine indent={20} w={88} />
              <TreeLine indent={32} w={128} />
              <TreeLine indent={32} w={74} />
            </div>
            <div style={{ marginTop: 22 }}>
              <div style={{ ...mono(11, 600), color: "var(--text-dim)", letterSpacing: "0.05em", marginBottom: 8 }}>本页目录</div>
              <TocLine w={56} />
              <TocLine w={40} />
              <TocLine w={68} />
              <TocLine w={32} />
            </div>
          </div>

          {/* 预览卡:边框 / 圆角 / 头部条是容器,保留实体;只有文件名、元信息与正文是骨架 */}
          <div style={{ border: "1px solid var(--border)", borderRadius: 7, overflow: "hidden", boxShadow: "0 1px 0 rgba(0,0,0,0.03)", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "var(--bg-panel)", borderBottom: "1px solid var(--border)", height: 31, boxSizing: "border-box" }}>
              <Bar w={68} tone="onGrey" />
              <Bar w={150} h={10} tone="onGrey" />
            </div>
            <div style={{ padding: "4px 24px 24px" }}>
              {/* frontmatter 键值块 */}
              <div style={{ background: "var(--bg-panel)", borderRadius: 6, padding: "10px 12px", marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <Bar w={44} h={10} tone="onGrey" />
                  <Bar w={180} h={10} tone="onGrey" />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <Bar w={68} h={10} tone="onGrey" />
                  <Bar w={420} h={10} tone="onGrey" />
                </div>
              </div>

              <Line h={25} style={{ marginTop: 30 }}><Bar w={210} h={16} radius={5} /></Line>
              <div style={{ marginTop: 12 }}>
                <Line h={25}><Bar w="100%" /></Line>
                <Line h={25}><Bar w="94%" /></Line>
                <Line h={25}><Bar w="62%" /></Line>
              </div>

              <Line h={25} style={{ marginTop: 30 }}><Bar w={150} h={16} radius={5} /></Line>
              <div style={{ marginTop: 12 }}>
                <Line h={25}><Bar w="97%" /></Line>
                <Line h={25}><Bar w="88%" /></Line>
                <Line h={25}><Bar w="46%" /></Line>
              </div>

              {/* 一块代码卡片形状:等长横条会让人以为页面坏了,轮廓要读起来像一份文档 */}
              <div style={{ border: "1px solid var(--border)", borderRadius: 7, marginTop: 14, overflow: "hidden", boxShadow: "0 1px 0 rgba(0,0,0,0.03)" }}>
                <div style={{ display: "flex", alignItems: "center", padding: "6px 12px", background: "var(--bg-panel)", borderBottom: "1px solid var(--border)", height: 27, boxSizing: "border-box" }}>
                  <Bar w={44} h={10} tone="onGrey" />
                </div>
                <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 9 }}>
                  <Bar w="70%" />
                  <Bar w="52%" />
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <Line h={25}><Bar w="92%" /></Line>
                <Line h={25}><Bar w="74%" /></Line>
              </div>
            </div>
          </div>
        </div>
      </div>
    </SkeletonScreen>
  );
}
