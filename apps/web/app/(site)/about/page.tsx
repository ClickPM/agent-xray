// About 页数据源(R8):真实 API 取代 demo-data。
//
// 内容全部来自 `about_content` 表,由所有者经 MCP 管理面的 `about_set` 维护
// (`apps/api/mcp/tools.ts`)。**样式零改动**(CLAUDE.md 规则 7):相对 R5 的实现,
// 这里只做两件事 ——
//   1. 数据从 `@/lib/demo-data` 的常量换成 `api.about.get()`;
//   2. 头部 GitHub 按钮旁按需并排一个同款 ghost 按钮「origin ↗」
//      (ROUNDS.md R8「github/origin 双链」;所有者裁定 2026-09-01)。
//      `originUrl` 为空时整个按钮不渲染,此时页面与画板 2e 一字不差。
//
// 每一块都按「有数据才渲染」处理:新环境部署完、所有者还没写过内容时,
// About 页应该是一个空页,而不是一堆破图与空框(githubUser 为空时
// `https://github.com/.png` 会是一张 404 的头像)。
import Link from "next/link";
import { api } from "@/lib/api";
import { mono } from "@/lib/styles";

// 内容随 MCP 写入变化,且 docker build 时后端不可达 —— 不允许构建期预渲染。
export const dynamic = "force-dynamic";

const ghostLink = {
  display: "flex", alignItems: "center", height: 32, padding: "0 14px",
  background: "var(--bg-hover)", border: "1px solid var(--border)", color: "var(--text-muted)",
  borderRadius: 7, fontSize: 12, whiteSpace: "nowrap", boxSizing: "border-box",
  textDecoration: "none",
} as const;

/**
 * 外链协议白名单。`originUrl` 在服务端已被 `about_set` 限定成 http(s) 绝对地址,
 * 这里是第二道 —— 库是可以绕过 tool 直接改的,而这个值会进 `<a href>`。
 * React 会转义属性值,但它不会替你判断协议:`javascript:` 照样能点。
 */
function safeExternal(url: string): string | null {
  return /^https?:\/\//i.test(url) ? url : null;
}

export default async function AboutPage() {
  const about = await api.about.get();
  const gh = about.githubUser ? `https://github.com/${about.githubUser}` : null;
  const origin = safeExternal(about.originUrl);

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "40px 32px 64px" }}>
        {/* 头部 — 仅 GitHub 公开信息,无姓名/公司/经历。
            三项任一有值就渲染:about_set 的每个字段都可省略,只配了 originUrl 的
            库行是合法状态,漏掉它会让那条链接**永远不出现**(codex 第 1 轮 P2)。 */}
        {(gh || origin || about.intro) && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 18 }}>
            {gh && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`${gh}.png`}
                alt="GitHub avatar"
                width={64}
                height={64}
                style={{ width: 64, height: 64, borderRadius: "50%", border: "1px solid var(--border)", flex: "none" }}
              />
            )}
            <div style={{ flex: 1 }}>
              {gh && (
                <a href={gh} target="_blank" rel="noreferrer" style={{ ...mono(15, 600) }}>
                  @{about.githubUser}
                </a>
              )}
              <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.7, marginTop: 6, maxWidth: 560 }}>
                {about.intro}
              </div>
            </div>
            {gh && (
              <a href={gh} target="_blank" rel="noreferrer" style={ghostLink}>
                GitHub ↗
              </a>
            )}
            {origin && (
              <a href={origin} target="_blank" rel="noreferrer" style={ghostLink}>
                origin ↗
              </a>
            )}
          </div>
        )}

        {/* 本站如何构建 */}
        {about.buildPoints.length > 0 && (
          <div style={{ marginTop: 42 }}>
            <div style={{ fontSize: 13, fontWeight: 600, paddingBottom: 8, borderBottom: "1px solid var(--border)" }}>本站如何构建</div>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 2 }}>
              {about.buildPoints.map((p) => (
                <div key={p} style={{ display: "flex", gap: 10, padding: "5px 0", fontSize: 13, lineHeight: 1.7 }}>
                  <span style={{ color: "var(--text-dim)", flex: "none" }}>·</span>
                  <span>{p}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 公开仓库 */}
        {gh && about.repos.length > 0 && (
          <div style={{ marginTop: 42 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, paddingBottom: 8, borderBottom: "1px solid var(--border)" }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>公开仓库</span>
              <span style={{ ...mono(11), color: "var(--text-dim)" }}>{about.repos.length} repositories</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12, marginTop: 14 }}>
              {about.repos.map((r) => (
                <a
                  key={r.name}
                  href={`${gh}/${r.name}`}
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
                href={gh}
                target="_blank"
                rel="noreferrer"
                style={{
                  border: "1px dashed var(--border)", borderRadius: 7, display: "flex",
                  alignItems: "center", justifyContent: "center", minHeight: 110, textDecoration: "none",
                }}
              >
                <span style={{ ...mono(11), color: "var(--text-dim)" }}>github.com/{about.githubUser} ↗</span>
              </a>
            </div>
          </div>
        )}

        {/* 语言构成 + 导流 */}
        <div style={{ marginTop: 42 }}>
          {about.langBar.length > 0 && (
            <>
              <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", border: "1px solid var(--border)" }}>
                {about.langBar.map((l) => (
                  <div key={l.name} style={{ height: 8, background: l.color, width: `${l.pct}%` }} />
                ))}
              </div>
              <div style={{ display: "flex", gap: 18, marginTop: 8, flexWrap: "wrap" }}>
                {about.langBar.map((l) => (
                  <span key={l.name} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)" }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: l.color, display: "inline-block" }} />
                    {l.name} {l.pct}%
                  </span>
                ))}
              </div>
            </>
          )}
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 20 }}>
            教程库全部内容开源并提供 RSS 订阅 → <Link href="/notes" style={{ color: "var(--accent)" }}>Notes</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
