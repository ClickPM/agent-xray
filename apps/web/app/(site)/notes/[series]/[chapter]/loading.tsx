// 文章阅读页的加载态(设计稿画板 2j)。
//
// **为什么需要它**:与 Skill 详情页同一个病 —— 页面 `force-dynamic`,软导航要等服务端渲染完
// 才换内容,在那之前界面一动不动。这一页的耗时不是载荷大小决定的,是服务端渲染在抖:
// 2026-09-03 生产实测同一个系列的六篇,0.11s / 0.43s / 0.45s / 0.81s / 1.72s / **3.35s**
// (最慢那篇只有 49 KB)。所以「等多久」预测不了,必须给反馈。
//
// **阅读进度线在这里不出现**(画板 2j 裁定,三选一):这条线的语义是「你读到哪」,
// 正文没到就不存在「哪」。归零(0 宽)视觉上等价,但实现里留一条 0 宽实体容易在首帧
// 闪出一个 2px 蓝点;改成不确定进度动效更糟 —— 同一条线会背上第二套语义(下载进度),
// 真实滚动上线后读者会误读它。它本来就是 position:absolute,内容到达时插入不占布局。
//
// 外层容器与 page.tsx 逐字相同(maxWidth 1000 / padding 26px 32px 64px / 720px+1fr / gap 56),
// 行距按 2c 对位(段内 14×1.7=23.8px、段间 12–14px、小节标题前 30px、列表 gap 4)。
import { Bar, Line, LoadingNote, SkeletonScreen } from "@/components/Skeleton";
import { mono } from "@/lib/styles";

/** 上/下一章按钮:章节名未知,与 2i 右上两枚同一裁定 —— 骨架块,不做禁用态(禁用态要编假文案) */
function NavBlock() {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 150, height: 32, background: "var(--bg-hover)",
        border: "1px solid var(--border)", borderRadius: 7, boxSizing: "border-box",
      }}
    >
      <Bar w={98} h={10} tone="onGrey" />
    </div>
  );
}

/** 三行列表形状:6px 方点 + 长短不一的条(照 2c 列表的 gap 4 与 1.8 行距) */
function BulletLine({ w }: { w: string }) {
  return (
    <div style={{ height: 25, display: "flex", alignItems: "center", gap: 10 }}>
      <Bar w={6} h={6} tone="onGrey" />
      <Bar w={w} />
    </div>
  );
}

export default function ChapterLoading() {
  return (
    <SkeletonScreen>
      <div
        style={{
          maxWidth: 1000, margin: "0 auto", padding: "26px 32px 64px",
          display: "grid", gridTemplateColumns: "minmax(0,720px) 1fr", gap: 56, alignItems: "start",
        }}
      >
        <div style={{ minWidth: 0 }}>
          {/* 面包屑:四级都来自数据(分类 / 系列 / 章节),整条骨架 */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 17 }}>
            <Bar w={240} h={10} />
            <div style={{ flex: 1 }} />
            <LoadingNote />
          </div>

          {/* 大标题条:31px 行高对上 2c 的 22px/1.4;omPulseBg 全页只给它一处 */}
          <Line h={31} style={{ marginTop: 18 }}><Bar w={460} h={22} radius={6} pulse /></Line>
          <Line h={15} style={{ marginTop: 8 }}><Bar w={210} h={10} /></Line>

          <div style={{ marginTop: 22 }}>
            <Line h={24}><Bar w="100%" /></Line>
            <Line h={24}><Bar w="96%" /></Line>
            <Line h={24}><Bar w="58%" /></Line>
          </div>

          <Line h={26} style={{ marginTop: 30 }}><Bar w={168} h={16} radius={5} /></Line>
          <div style={{ marginTop: 12 }}>
            <Line h={24}><Bar w="98%" /></Line>
            <Line h={24}><Bar w="92%" /></Line>
            <Line h={24}><Bar w="71%" /></Line>
          </div>

          {/* 代码卡片形状 */}
          <div style={{ border: "1px solid var(--border)", borderRadius: 7, marginTop: 14, overflow: "hidden", boxShadow: "0 1px 0 rgba(0,0,0,0.03)" }}>
            <div style={{ display: "flex", alignItems: "center", padding: "6px 12px", background: "var(--bg-panel)", borderBottom: "1px solid var(--border)", height: 27, boxSizing: "border-box" }}>
              <Bar w={66} h={10} tone="onGrey" />
            </div>
            <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 9 }}>
              <Bar w="58%" />
              <Bar w="74%" style={{ marginLeft: 16 }} />
              <Bar w="46%" style={{ marginLeft: 16 }} />
              <Bar w="22%" />
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <Line h={24}><Bar w="95%" /></Line>
            <Line h={24}><Bar w="64%" /></Line>
          </div>

          <Line h={26} style={{ marginTop: 30 }}><Bar w={196} h={16} radius={5} /></Line>
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 4 }}>
            <BulletLine w="78%" />
            <BulletLine w="88%" />
            <BulletLine w="56%" />
          </div>

          <div style={{ marginTop: 14 }}>
            <Line h={24}><Bar w="99%" /></Line>
            <Line h={24}><Bar w="86%" /></Line>
            <Line h={24}><Bar w="38%" /></Line>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 40 }}>
            <NavBlock />
            <NavBlock />
          </div>
        </div>

        {/* 本章目录:标题是固定文案,真实渲染;条目来自正文,骨架 */}
        <div style={{ paddingTop: 60 }}>
          <div style={{ ...mono(11, 600), color: "var(--text-dim)", letterSpacing: "0.05em", marginBottom: 8 }}>本章目录</div>
          <div style={{ padding: "4px 0 4px 10px", borderLeft: "2px solid transparent" }}><Bar w={64} h={10} /></div>
          <div style={{ padding: "4px 0 4px 10px", borderLeft: "2px solid transparent" }}><Bar w={88} h={10} /></div>
          <div style={{ padding: "4px 0 4px 10px", borderLeft: "2px solid transparent" }}><Bar w={52} h={10} /></div>
          <div style={{ padding: "4px 0 4px 10px", borderLeft: "2px solid transparent" }}><Bar w={76} h={10} /></div>
          <div style={{ padding: "4px 0 4px 10px", borderLeft: "2px solid transparent" }}><Bar w={44} h={10} /></div>
        </div>
      </div>
    </SkeletonScreen>
  );
}
