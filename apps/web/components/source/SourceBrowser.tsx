"use client";

// Source 源码 tab 的页面本体(设计稿画板 2n 首页 README 态 / 2o 代码文件态):页头 + 「左可折叠目录树 / 右文件预览」。
//
// 交互只有三样:目录行展开 / 收起(客户端状态)、文件行 = 链接(`/source/<path>`,软导航,加载态走 loading.tsx)、
// 预览卡头部的 copy 1.5s 回落。数据在 app/(site)/source/**/page.tsx 服务端取好传进来;当前文件是 markdown 时
// 由服务端预渲染成 ReactNode 传进来(`mdView`,与 Skills 详情页 R-PERF 后的口径一致),代码文件用 SourceCodeView。
//
// 【折叠规则,画板 2n / 2o 的裁定】默认只展开当前文件所在的那条路径,其余目录收起;直达 /source(README.md 在根)时六个根目录全收起。
// 访客手动展开过的目录在同一页面内保留(路由切换时 React 复用本组件,`expanded` 不会被重置;换文件时把新路径并进去)。
//
// 【移动端】所有者裁定「先桌面」:本组件**不套**移动壳、不用 `m-hide-narrow` —— 窄视口按桌面版式渲染而不是空白;Tab Bar 上没有它。
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Badge } from "@/components/ui";
import { MarkdownFile } from "@/components/skills/MarkdownFile";
import { SourceCodeView } from "@/components/source/SourceCodeView";
import { rewriteSourceLinks } from "@/lib/source-links";
import { buildSourceTree, dirsOf, fmtLines, fmtSize, type SourceFileMeta, type SourceTreeNode } from "@/lib/source-tree";
import { mono } from "@/lib/styles";

export interface SourceSnapshotView {
  sha: string;
  shortSha: string;
  /** YYYY-MM-DD */
  publishedDate: string;
  fileCount: number;
  totalBytes: number;
  repo: string;
  /** 已过 safeExternal;服务端常量,不会为空 */
  repoUrl: string;
}

export interface SourceFileView {
  path: string;
  kind: string;
  content: string;
  bytes: number;
  lines: number;
}

/** 画板 2n 的 ghost 按钮(与 Skills 详情页 GitHub 按钮同款) */
const ghostLink: CSSProperties = {
  display: "flex", alignItems: "center", height: 32, padding: "0 14px",
  background: "var(--bg-hover)", border: "1px solid var(--border)", color: "var(--text-muted)",
  borderRadius: 7, fontSize: 12, whiteSpace: "nowrap", boxSizing: "border-box", textDecoration: "none",
};
const ghostEnter = (e: React.MouseEvent<HTMLElement>) => {
  e.currentTarget.style.background = "var(--bg-selected)";
  e.currentTarget.style.color = "var(--accent)";
  e.currentTarget.style.borderColor = "rgba(37,99,235,0.35)";
};
const ghostLeave = (e: React.MouseEvent<HTMLElement>) => {
  e.currentTarget.style.background = "var(--bg-hover)";
  e.currentTarget.style.color = "var(--text-muted)";
  e.currentTarget.style.borderColor = "var(--border)";
};

/** mono 10px 字距 0.08em 的小标题(FILES;同 2g) */
const sectionLabel: CSSProperties = { ...mono(10, 600), color: "var(--text-dim)", letterSpacing: "0.08em", marginBottom: 6 };

/** 画板文案:页头一句话与页脚一行 */
const TAGLINE = "本站自己的源码,只读浏览:左边点文件,右边看内容。";
const FOOTNOTE = "这是本站自己的源码,与线上运行的版本一致;快照随每次发版更新。";

/** `/source/<path>`:逐段编码,`(site)` `[series]` 这类段落也能进 URL */
export function sourceHref(path: string): string {
  return `/source/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** `GitHub ↗`:首页指整仓在该 sha 的树,文件页指该文件在该 sha 的 blob(画板 2n / 2o 注释) */
export function githubHref(repoUrl: string, sha: string, path: string | null): string {
  if (path === null) return `${repoUrl}/tree/${sha}`;
  return `${repoUrl}/blob/${sha}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

// ───────────────────── 目录树 ─────────────────────

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }}>
      {open ? <polyline points="6 9 12 15 18 9" /> : <polyline points="9 6 15 12 9 18" />}
    </svg>
  );
}

/** 画板 2n:行高 26 / 根 8px、每层缩进 12 / 圆角 5 / 选中 `--bg-selected` + 600 / hover `--bg-hover` */
const rowStyle = (depth: number, selected: boolean): CSSProperties => ({
  display: "flex", alignItems: "center", gap: 6, height: 26,
  padding: `0 8px 0 ${8 + 12 * depth}px`, borderRadius: 5,
  font: `${selected ? 600 : 400} 12px var(--font-mono)`, color: "var(--text)",
  cursor: "pointer", whiteSpace: "nowrap", boxSizing: "border-box",
  background: selected ? "var(--bg-selected)" : "transparent", textDecoration: "none",
});
const rowEnter = (selected: boolean) => (e: React.MouseEvent<HTMLElement>) => {
  if (!selected) e.currentTarget.style.background = "var(--bg-hover)";
};
const rowLeave = (selected: boolean) => (e: React.MouseEvent<HTMLElement>) => {
  if (!selected) e.currentTarget.style.background = "transparent";
};

function DirRow({ name, depth, open, onToggle }: { name: string; depth: number; open: boolean; onToggle: () => void }) {
  return (
    <div onClick={onToggle} style={rowStyle(depth, false)} onMouseEnter={rowEnter(false)} onMouseLeave={rowLeave(false)}>
      <Chevron open={open} />
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{name}/</span>
    </div>
  );
}

function FileRow({ name, depth, path, bytes, selected }: { name: string; depth: number; path: string; bytes: number; selected: boolean }) {
  return (
    <Link href={sourceHref(path)} style={rowStyle(depth, selected)} onMouseEnter={rowEnter(selected)} onMouseLeave={rowLeave(selected)}>
      <span style={{ width: 12, flex: "none" }} />
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
      <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>{fmtSize(bytes)}</span>
    </Link>
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

/** 画板 2o 的 copy 按钮:点击后 1.5s 显示 `copied`(成功色 + 对勾)再回落(同 2h) */
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

export function SourceBrowser({
  snapshot,
  files,
  file,
  mdView,
  isIndex,
}: {
  snapshot: SourceSnapshotView;
  files: SourceFileMeta[];
  file: SourceFileView;
  /** 当前文件是 markdown 时的服务端预渲染;取不到就在客户端现渲 */
  mdView?: ReactNode;
  /** `/source`(README 态,画板 2n):标题是仓库名、面包屑只有 Source、GitHub 指整仓的树 */
  isIndex: boolean;
}) {
  const tree = useMemo(() => buildSourceTree(files), [files]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(dirsOf(file.path)));
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 换文件时把新路径并进展开集合(访客手动展开过的保留)
  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const d of dirsOf(file.path)) next.add(d);
      return next;
    });
    setCopied(false);
  }, [file.path]);

  const toggle = useCallback((dir: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  }, []);

  const copy = useCallback(() => {
    // 非安全上下文 / 权限被拒时 writeText 会同步抛或异步 reject,两条路都吞掉:按钮态照常回落
    try {
      navigator.clipboard?.writeText(file.content).catch(() => {});
    } catch {}
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }, [file.content]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const renderTree = (nodes: SourceTreeNode[], depth: number): ReactNode =>
    nodes.map((n) =>
      n.dir !== undefined ? (
        <div key={`d:${n.dir}`} style={{ display: "contents" }}>
          <DirRow name={n.name} depth={depth} open={expanded.has(n.dir)} onToggle={() => toggle(n.dir!)} />
          {expanded.has(n.dir) && renderTree(n.children, depth + 1)}
        </div>
      ) : (
        <FileRow key={`f:${n.path}`} name={n.name} depth={depth} path={n.path!} bytes={n.bytes ?? 0} selected={n.path === file.path} />
      ),
    );

  const segments = file.path.split("/");
  const fileName = segments[segments.length - 1];
  const dirSegments = segments.slice(0, -1);
  const meta = `快照 ${snapshot.shortSha} · 发布 ${snapshot.publishedDate} · ${snapshot.fileCount} 个文件 · ${fmtSize(snapshot.totalBytes)}`;

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "30px 32px 64px" }}>
        {/* 面包屑:首页只有 Source(2n);文件页 Source 是链接、目录段是文本(2o;没有目录页) */}
        <div style={{ fontSize: 12, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 6 }}>
          {isIndex ? (
            <span style={{ color: "var(--text-muted)" }}>Source</span>
          ) : (
            <>
              <Link href="/source" style={{ color: "var(--accent)" }}>Source</Link>
              {dirSegments.map((s, i) => (
                <span key={`${i}-${s}`} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span>/</span>
                  <span style={{ ...mono(12), color: "var(--text-muted)" }}>{s}</span>
                </span>
              ))}
            </>
          )}
        </div>

        {/* 页头 */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginTop: 22 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ ...mono(22, 650), letterSpacing: "-0.01em" }}>{isIndex ? snapshot.repo : fileName}</span>
              <Badge color="var(--text-dim)">MIT</Badge>
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, marginTop: 6, maxWidth: 640 }}>{TAGLINE}</div>
            <div style={{ ...mono(11), color: "var(--text-dim)", marginTop: 10 }}>{meta}</div>
          </div>
          <div style={{ display: "flex", gap: 8, flex: "none", paddingTop: 2 }}>
            <a
              href={githubHref(snapshot.repoUrl, snapshot.sha, isIndex ? null : file.path)}
              target="_blank"
              rel="noreferrer noopener"
              style={ghostLink}
              onMouseEnter={ghostEnter}
              onMouseLeave={ghostLeave}
            >
              GitHub ↗
            </a>
          </div>
        </div>

        {/* 目录树 / 文件预览(画板 2n:264px 粘性左栏,栏间距 32) */}
        <div style={{ display: "grid", gridTemplateColumns: "264px minmax(0,1fr)", gap: 32, marginTop: 26, alignItems: "start" }}>
          <div style={{ position: "sticky", top: 0 }}>
            <div style={sectionLabel}>FILES</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>{renderTree(tree, 0)}</div>
          </div>

          <div style={{ border: "1px solid var(--border)", borderRadius: 7, overflow: "hidden", boxShadow: "0 1px 0 rgba(0,0,0,0.03)", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "var(--bg-panel)", borderBottom: "1px solid var(--border)" }}>
              <span style={{ ...mono(11, 650), color: "var(--text-muted)" }}>{file.path}</span>
              <span style={{ ...mono(11), color: "var(--text-dim)", flex: 1 }}>
                {file.kind} · {fmtSize(file.bytes)} · {fmtLines(file.lines)}
              </span>
              <CopyButton copied={copied} onClick={copy} />
            </div>
            {file.kind === "markdown" ? (mdView ?? <MarkdownFile content={rewriteSourceLinks(file.content, file.path)} />) : <SourceCodeView kind={file.kind} content={file.content} />}
          </div>
        </div>

        <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 22, lineHeight: 1.9 }}>{FOOTNOTE}</div>
      </div>
    </div>
  );
}
