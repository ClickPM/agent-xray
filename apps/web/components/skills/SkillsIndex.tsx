"use client";

// Skills 首页(设计稿画板 2f)。与 Notes 首页(components/notes/NotesIndex)同构:
// 分类表 + 色点 + 卡片网格;卡片 = 等宽 skill 名 + 「自研 / 精选」描边微徽标 + 一句话 + 元信息行。
// 拆成 Client Component 只为卡片的 hover 态(与 NotesIndex 同一做法);数据在 app/(site)/skills/page.tsx 服务端取。
// 卡片上不放按钮(复制 / 下载都在详情页),没有搜索 / 筛选 / RSS —— 画板上没有的一律不做(规则 8)。
import Link from "next/link";
import { Badge } from "@/components/ui";
import { mono } from "@/lib/styles";

export interface IndexSkill {
  name: string;
  /** own = 自研(徽标蓝)/ curated = 精选(徽标灰) */
  sourceType: "own" | "curated";
  summary: string;
  /** `<出处> · <N> 个文件 · 更新于 <relTime>`,服务端拼好 */
  meta: string;
}

export interface IndexCategory {
  slug: string;
  name: string;
  dot: string;
  cards: IndexSkill[];
}

/** 出处微徽标的两种颜色(design/README.md:自研=#2563eb · 精选=#9ca3af,沿用既有 token) */
const BADGE_COLOR = { own: "var(--accent)", curated: "var(--text-dim)" } as const;
const BADGE_TEXT = { own: "自研", curated: "精选" } as const;

const code = { ...mono(11), color: "var(--text-muted)" } as const;

export function SkillsIndex({
  categories,
  total,
  latest,
}: {
  categories: IndexCategory[];
  total: number;
  /** 页脚「最近更新:<name> · <relTime>」;没有 skill 时为 null */
  latest: { name: string; rel: string } | null;
}) {
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "36px 32px 64px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 650 }}>Skills · 技能库</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 6 }}>
              我在 agent 开发里反复用到的 skill:自己写的与精选的第三方都在这里,每个都能看目录、读文件、一条命令装进 Claude Code / Codex。
            </div>
          </div>
        </div>

        {categories.map((cat) => (
          <div key={cat.slug} style={{ marginTop: 32 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{ width: 10, height: 10, borderRadius: 4, background: cat.dot }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{cat.name}</span>
              <span style={{ ...mono(11), color: "var(--text-dim)" }}>{cat.slug}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
              {cat.cards.map((c) => (
                <Link
                  key={c.name}
                  href={`/skills/${c.name}`}
                  style={{
                    background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 7,
                    padding: 14, cursor: "pointer", boxSizing: "border-box", display: "block",
                    color: "var(--text)", textDecoration: "none",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.borderColor = "rgba(37,99,235,0.35)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-panel)"; e.currentTarget.style.borderColor = "var(--border)"; }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ ...mono(13, 600), flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
                    <Badge color={BADGE_COLOR[c.sourceType]}>{BADGE_TEXT[c.sourceType]}</Badge>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6, marginTop: 5, minHeight: 38 }}>{c.summary}</div>
                  <div style={{ ...mono(11), color: "var(--text-dim)", marginTop: 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.meta}</div>
                </Link>
              ))}
            </div>
          </div>
        ))}

        <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 12, lineHeight: 1.9 }}>
          <div>
            共 {total} 个 skill
            {latest && (
              <>
                {" · 最近更新:"}
                <span style={code}>{latest.name}</span>
                {` · ${latest.rel}`}
              </>
            )}
          </div>
          <div>
            skill = 一个目录:<span style={code}>SKILL.md</span>(必需)+ <span style={code}>scripts/</span> + <span style={code}>references/</span>,放进 <span style={code}>.claude/skills/</span> 或 <span style={code}>.agents/skills/</span> 即生效。
          </div>
        </div>
      </div>
    </div>
  );
}
