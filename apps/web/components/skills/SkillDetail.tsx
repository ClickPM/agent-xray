"use client";

// Skill 详情页(设计稿画板 2g / 2h):头部 + INSTALL 面板 + 「左目录树 / 右文件预览」。
// 交互只有三样:目录树点选切换预览(并同步 `?file=`)、两处 copy 的 1.5s 回落、GitHub / zip 两枚 ghost 按钮。
// 数据在 app/(site)/skills/[name]/page.tsx 服务端取好传进来;整包内容一次到位,切换文件不打后端。
// markdown 文件由服务端预渲染成 ReactNode(`mdViews`,理由见 MarkdownFile.tsx),这里只决定显示哪一个;
// 代码文件在这里用 CodeView 渲染(纯函数,无水合差异)。
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Badge } from "@/components/ui";
import { CodeView } from "@/components/skills/CodeView";
import { mono } from "@/lib/styles";

export interface DetailFile {
  path: string;
  kind: string;
  content: string;
  sizeBytes: number;
  lineCount: number;
}

export interface DetailSkill {
  name: string;
  categoryName: string;
  summary: string;
  sourceType: "own" | "curated";
  repo: string;
  /** 已过 safeExternal;null = 不渲染 GitHub 按钮与出处链接 */
  repoUrl: string | null;
  version: string | null;
  fileCount: number;
  totalBytes: number;
  zipSize: number;
  /** YYYY-MM-DD */
  updatedDate: string;
}

const BADGE_COLOR = { own: "var(--accent)", curated: "var(--text-dim)" } as const;
const BADGE_TEXT = { own: "自研", curated: "精选" } as const;

/** 画板 2g 的 ghost 按钮(与 About 页 GitHub 按钮同款) */
const ghostLink: CSSProperties = {
  display: "flex", alignItems: "center", height: 32, padding: "0 14px",
  background: "var(--bg-hover)", border: "1px solid var(--border)", color: "var(--text-muted)",
  borderRadius: 7, fontSize: 12, whiteSpace: "nowrap", boxSizing: "border-box", textDecoration: "none",
};

/** mono 10px 字距 0.08em 的小标题(INSTALL / FILES;同 1g 的 INPUT/OUTPUT) */
const sectionLabel: CSSProperties = { ...mono(10, 600), color: "var(--text-dim)", letterSpacing: "0.08em", marginBottom: 6 };

/** 文件大小:画板写作 `3.8 KB` / `8.0 KB` */
export const fmtKB = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

// ───────────────────── 目录树 ─────────────────────

interface TreeNode {
  name: string;
  /** 文件才有;目录没有 */
  path?: string;
  sizeBytes?: number;
  children: TreeNode[];
}

/**
 * 路径列表 → 树。每一层先文件后目录、各自按名字排;根目录的 SKILL.md 钉在首位(画板 2g)。
 * 目录一律展开(画板没有折叠态)。
 */
function buildTree(files: DetailFile[]): TreeNode[] {
  const root: TreeNode = { name: "", children: [] };
  for (const f of files) {
    const parts = f.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      let dir = node.children.find((c) => c.path === undefined && c.name === parts[i]);
      if (!dir) node.children.push((dir = { name: parts[i], children: [] }));
      node = dir;
    }
    node.children.push({ name: parts[parts.length - 1], path: f.path, sizeBytes: f.sizeBytes, children: [] });
  }
  const sortLevel = (nodes: TreeNode[], depth: number) => {
    nodes.sort((a, b) => {
      const af = a.path !== undefined;
      const bf = b.path !== undefined;
      if (af !== bf) return af ? -1 : 1;
      if (depth === 0 && af && bf) {
        if (a.path === "SKILL.md") return -1;
        if (b.path === "SKILL.md") return 1;
      }
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
    for (const n of nodes) if (n.path === undefined) sortLevel(n.children, depth + 1);
  };
  sortLevel(root.children, 0);
  return root.children;
}

function TreeRow({
  name,
  depth,
  isDir,
  size,
  selected,
  bold,
  onPick,
}: {
  name: string;
  depth: number;
  isDir: boolean;
  size?: number;
  selected: boolean;
  bold: boolean;
  onPick?: () => void;
}) {
  return (
    <div
      onClick={onPick}
      style={{
        display: "flex", alignItems: "center", gap: 6, height: 26,
        // 画板 2g:根 8px,每层缩进 12px
        padding: `0 8px 0 ${8 + 12 * depth}px`, borderRadius: 5,
        font: `${bold ? 600 : 400} 12px var(--font-mono)`, color: "var(--text)",
        cursor: "pointer", whiteSpace: "nowrap", boxSizing: "border-box",
        background: selected ? "var(--bg-selected)" : "transparent",
      }}
      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = "transparent"; }}
    >
      <span style={{ fontSize: 9, color: "var(--text-dim)", width: 9, flex: "none" }}>{isDir ? "▾" : ""}</span>
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
      {size !== undefined && (
        <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>{fmtKB(size)}</span>
      )}
    </div>
  );
}

// ───────────────────── copy ─────────────────────

function CopyIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

/** 画板 2g/2h 的 copy 按钮:点击后 1.5s 显示 `copied`(绿)再回落 */
function CopyButton({ copied, onClick }: { copied: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 4, fontSize: 11, cursor: "pointer",
        borderRadius: 5, padding: "2px 6px", color: copied ? "var(--ok-text)" : "var(--text-dim)",
      }}
      onMouseEnter={(e) => { if (!copied) { e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.background = "var(--bg-hover)"; } }}
      onMouseLeave={(e) => { e.currentTarget.style.color = copied ? "var(--ok-text)" : "var(--text-dim)"; e.currentTarget.style.background = "transparent"; }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {copied ? "copied" : "copy"}
    </div>
  );
}

// ───────────────────── 页面 ─────────────────────

export interface TocItem {
  id: string;
  text: string;
}

export function SkillDetail({
  skill,
  files,
  initialPath,
  mdViews,
  tocs,
}: {
  skill: DetailSkill;
  files: DetailFile[];
  /** 服务端按 `?file=` 选好的初始文件(不存在时已回落到 SKILL.md) */
  initialPath: string;
  /** markdown 文件的服务端预渲染结果,按 path 取;非 markdown 文件没有条目 */
  mdViews: Record<string, ReactNode>;
  /** 每个 markdown 文件的「本页目录」(H2 列表),与预渲染的标题 id 同一套算法 */
  tocs: Record<string, TocItem[]>;
}) {
  const [cur, setCur] = useState(initialPath);
  const [copied, setCopied] = useState<"" | "install" | "file">("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const file = files.find((f) => f.path === cur) ?? files[0];
  const tree = useMemo(() => buildTree(files), [files]);
  const toc = file ? (tocs[file.path] ?? []) : [];
  const installCmd = `npx skills add ${skill.repo} --skill ${skill.name}`;

  const stamp = useCallback((key: "install" | "file", text: string) => {
    // 非安全上下文 / 权限被拒时 writeText 会同步抛或异步 reject,两条路都吞掉:按钮态照常回落
    try {
      navigator.clipboard?.writeText(text).catch(() => {});
    } catch {}
    setCopied(key);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(""), 1500);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  /** 切文件 = 客户端状态 + 同步地址栏的 `?file=`(深链可直达;SKILL.md 是默认,不带查询串) */
  const pick = (path: string) => {
    setCur(path);
    const url = path === "SKILL.md" ? window.location.pathname : `${window.location.pathname}?file=${encodeURIComponent(path)}`;
    window.history.replaceState(null, "", url);
  };

  const owner = skill.repo.split("/")[0];
  const meta = [
    skill.version ? `v${skill.version}` : null,
    `${skill.fileCount} 个文件`,
    fmtKB(skill.totalBytes),
    `更新于 ${skill.updatedDate}`,
  ].filter(Boolean).join(" · ");

  const renderTree = (nodes: TreeNode[], depth: number): React.ReactNode =>
    nodes.map((n) =>
      n.path !== undefined ? (
        <TreeRow key={n.path} name={n.name} depth={depth} isDir={false} size={n.sizeBytes} selected={n.path === cur} bold={n.path === cur} onPick={() => pick(n.path!)} />
      ) : (
        <div key={`${depth}/${n.name}`} style={{ display: "contents" }}>
          <TreeRow name={`${n.name}/`} depth={depth} isDir selected={false} bold={false} />
          {renderTree(n.children, depth + 1)}
        </div>
      ),
    );

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "30px 32px 64px" }}>
        {/* 面包屑 */}
        <div style={{ fontSize: 12, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 6 }}>
          <Link href="/skills" style={{ color: "var(--accent)" }}>Skills</Link>
          <span>/</span>
          <Link href="/skills" style={{ color: "var(--accent)" }}>{skill.categoryName}</Link>
          <span>/</span>
          <span style={{ ...mono(12), color: "var(--text-muted)" }}>{skill.name}</span>
        </div>

        {/* 头部 */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginTop: 22 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ ...mono(22, 650), letterSpacing: "-0.01em" }}>{skill.name}</span>
              <Badge color={BADGE_COLOR[skill.sourceType]}>{BADGE_TEXT[skill.sourceType]}</Badge>
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, marginTop: 6, maxWidth: 640 }}>{skill.summary}</div>
            <div style={{ ...mono(11), color: "var(--text-dim)", marginTop: 10 }}>
              {meta}
              {" · "}
              {skill.sourceType === "own" ? (
                `@${owner}`
              ) : skill.repoUrl ? (
                <>
                  出处{" "}
                  <a href={skill.repoUrl} target="_blank" rel="noreferrer noopener" style={{ color: "var(--accent)" }}>
                    {skill.repo} ↗
                  </a>
                </>
              ) : (
                skill.repo
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flex: "none", paddingTop: 2 }}>
            {skill.repoUrl && (
              <a href={skill.repoUrl} target="_blank" rel="noreferrer noopener" style={ghostLink} onMouseEnter={ghostEnter} onMouseLeave={ghostLeave}>
                GitHub ↗
              </a>
            )}
            {/* 对外 URL 是站根下的 /skills/<name>.zip(Caddy / next dev 按 .zip 扩展名分流到 api) */}
            <a href={`/skills/${skill.name}.zip`} style={ghostLink} onMouseEnter={ghostEnter} onMouseLeave={ghostLeave}>
              下载 zip · {Math.max(1, Math.round(skill.zipSize / 1024))} KB
            </a>
          </div>
        </div>

        {/* INSTALL */}
        <div style={{ marginTop: 22, background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 7, padding: "12px 14px" }}>
          <div style={sectionLabel}>INSTALL</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "7px 10px" }}>
            <span style={{ ...mono(12), flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              npx skills add {skill.repo} <span style={{ color: "var(--text-dim)" }}>--skill</span> {skill.name}
            </span>
            <CopyButton copied={copied === "install"} onClick={() => stamp("install", installCmd)} />
          </div>
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 8, lineHeight: 1.6 }}>
            装进 <span style={{ ...mono(11), color: "var(--text-muted)" }}>.claude/skills/{skill.name}/</span>;Codex 读 <span style={{ ...mono(11), color: "var(--text-muted)" }}>.agents/skills/</span>,同一目录结构。
          </div>
        </div>

        {/* 目录树 / 文件预览 */}
        <div style={{ display: "grid", gridTemplateColumns: "240px minmax(0,1fr)", gap: 32, marginTop: 26, alignItems: "start" }}>
          <div style={{ position: "sticky", top: 0 }}>
            <div style={sectionLabel}>FILES</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <TreeRow name={`${skill.name}/`} depth={0} isDir selected={false} bold />
              {renderTree(tree, 1)}
            </div>
            {toc.length > 0 && (
              <div style={{ marginTop: 22 }}>
                <div style={{ ...mono(11, 600), color: "var(--text-dim)", letterSpacing: "0.05em", marginBottom: 8 }}>本页目录</div>
                {toc.map((h) => (
                  <a
                    key={h.id}
                    href={`#${h.id}`}
                    style={{
                      display: "block", fontSize: 11, padding: "4px 0 4px 10px",
                      borderLeft: "2px solid transparent",
                      color: "var(--text-muted)", fontWeight: 400, cursor: "pointer", textDecoration: "none",
                    }}
                  >
                    {h.text}
                  </a>
                ))}
              </div>
            )}
          </div>

          {file && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 7, overflow: "hidden", boxShadow: "0 1px 0 rgba(0,0,0,0.03)", minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "var(--bg-panel)", borderBottom: "1px solid var(--border)" }}>
                <span style={{ ...mono(11, 650), color: "var(--text-muted)" }}>{file.path}</span>
                <span style={{ ...mono(11), color: "var(--text-dim)", flex: 1 }}>
                  {file.kind} · {fmtKB(file.sizeBytes)} · {file.lineCount} 行
                </span>
                <CopyButton copied={copied === "file"} onClick={() => stamp("file", file.content)} />
              </div>
              {file.kind === "markdown" ? (
                mdViews[file.path]
              ) : (
                <CodeView key={file.path} kind={file.kind} content={file.content} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ghostEnter(e: React.MouseEvent<HTMLAnchorElement>) {
  e.currentTarget.style.background = "var(--bg-selected)";
  e.currentTarget.style.color = "var(--accent)";
  e.currentTarget.style.borderColor = "rgba(37,99,235,0.35)";
}

function ghostLeave(e: React.MouseEvent<HTMLAnchorElement>) {
  e.currentTarget.style.background = "var(--bg-hover)";
  e.currentTarget.style.color = "var(--text-muted)";
  e.currentTarget.style.borderColor = "var(--border)";
}
