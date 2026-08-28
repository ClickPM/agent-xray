// 占位首页 — 设计终稿确认后按 design/Agent X-Ray Prototype.dc.html 实现三 Tab 全站。
export default function Home() {
  return (
    <main
      style={{
        height: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
      }}
    >
      <div style={{ fontSize: 20, fontWeight: 650 }}>Agent X-Ray</div>
      <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
        设计定稿阶段 — 实现即将开始。设计稿见仓库 design/ 目录。
      </div>
    </main>
  );
}
