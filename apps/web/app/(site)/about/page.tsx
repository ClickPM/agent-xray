import Link from "next/link";
import { buildPoints, githubUser, langBar, repos } from "@/lib/demo-data";
import { mono } from "@/lib/styles";

const GH = `https://github.com/${githubUser}`;

const ghostLink = {
  display: "flex", alignItems: "center", height: 32, padding: "0 14px",
  background: "var(--bg-hover)", border: "1px solid var(--border)", color: "var(--text-muted)",
  borderRadius: 7, fontSize: 12, whiteSpace: "nowrap", boxSizing: "border-box",
  textDecoration: "none",
} as const;

export default function AboutPage() {
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "40px 32px 64px" }}>
        {/* 头部 — 仅 GitHub 公开信息,无姓名/公司/经历 */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 18 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${GH}.png`}
            alt="GitHub avatar"
            width={64}
            height={64}
            style={{ width: 64, height: 64, borderRadius: "50%", border: "1px solid var(--border)", flex: "none" }}
          />
          <div style={{ flex: 1 }}>
            <a href={GH} target="_blank" rel="noreferrer" style={{ ...mono(15, 600) }}>
              @{githubUser}
            </a>
            <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.7, marginTop: 6, maxWidth: 560 }}>
              研究 agent 运行时与 harness 工程。本站本身就是一件作品:你在 Runtime 里看到的每一条事件轨迹,都来自它背后真实运行的 agent 内核。
            </div>
          </div>
          <a href={GH} target="_blank" rel="noreferrer" style={ghostLink}>
            GitHub ↗
          </a>
        </div>

        {/* 本站如何构建 */}
        <div style={{ marginTop: 42 }}>
          <div style={{ fontSize: 13, fontWeight: 600, paddingBottom: 8, borderBottom: "1px solid var(--border)" }}>本站如何构建</div>
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 2 }}>
            {buildPoints.map((p) => (
              <div key={p} style={{ display: "flex", gap: 10, padding: "5px 0", fontSize: 13, lineHeight: 1.7 }}>
                <span style={{ color: "var(--text-dim)", flex: "none" }}>·</span>
                <span>{p}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 公开仓库 */}
        <div style={{ marginTop: 42 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, paddingBottom: 8, borderBottom: "1px solid var(--border)" }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>公开仓库</span>
            <span style={{ ...mono(11), color: "var(--text-dim)" }}>{repos.length} repositories</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12, marginTop: 14 }}>
            {repos.map((r) => (
              <a
                key={r.name}
                href={`${GH}/${r.name}`}
                target="_blank"
                rel="noreferrer"
                className="repo-card"
                style={{
                  border: "1px solid var(--border)", borderRadius: 7, padding: 14,
                  boxSizing: "border-box", color: "var(--text)", display: "block", textDecoration: "none",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ ...mono(13, 600), color: "var(--accent)", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
                  <span style={{ fontSize: 11, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums", flex: "none" }}>★ {r.stars}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6, marginTop: 6, minHeight: 38 }}>{r.desc}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 10 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)" }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: r.dot, display: "inline-block" }} />
                    {r.lang}
                  </span>
                  <span style={{ ...mono(11), color: "var(--text-dim)", marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>{r.pushed}</span>
                </div>
              </a>
            ))}
            <a
              href={GH}
              target="_blank"
              rel="noreferrer"
              style={{
                border: "1px dashed var(--border)", borderRadius: 7, display: "flex",
                alignItems: "center", justifyContent: "center", minHeight: 110, textDecoration: "none",
              }}
            >
              <span style={{ ...mono(11), color: "var(--text-dim)" }}>github.com/{githubUser} ↗</span>
            </a>
          </div>
        </div>

        {/* 语言构成 + 导流 */}
        <div style={{ marginTop: 42 }}>
          <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", border: "1px solid var(--border)" }}>
            {langBar.map((l) => (
              <div key={l.name} style={{ height: 8, background: l.color, width: `${l.pct}%` }} />
            ))}
          </div>
          <div style={{ display: "flex", gap: 18, marginTop: 8, flexWrap: "wrap" }}>
            {langBar.map((l) => (
              <span key={l.name} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: l.color, display: "inline-block" }} />
                {l.name} {l.pct}%
              </span>
            ))}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 20 }}>
            教程库全部内容开源并提供 RSS 订阅 → <Link href="/notes" style={{ color: "var(--accent)" }}>Notes</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
