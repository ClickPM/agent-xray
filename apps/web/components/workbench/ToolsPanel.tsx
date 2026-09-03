"use client";

import { useEffect, useState } from "react";
import {
  listTools,
  type ToolCatalog,
  type ToolCatalogEntry,
  type ToolGroup,
  type ToolParamSchema,
} from "@/lib/agent-api";
import { mono } from "@/lib/styles";

/**
 * Tools 工具面板(画板 1f 列表态 / 1g 展开态;R-TOOLS)。
 *
 * 与右栏另外三个面板的性质不同:它们回答「本次运行发生了什么」,这里回答「这个 agent
 * 具备什么能力」—— 数据是静态目录,不依赖 `events`,空会话下也有内容。
 *
 * 【前端不按工具名硬编码任何东西】(任务卡「禁止」段)没有 `switch (tool.name)`,
 * 没有 name → 文案/颜色 的表。文案全部来自后端 META,这里只认工具属于哪一组:
 * 三组的色值与组名是固定的(设计稿),工具不是。
 */

/**
 * 四个分组的固定呈现。**按 `group` 键入**,`Record<ToolGroup, …>` 让「后端多出一组」
 * 变成前端编译错误,而不是页面上悄悄少一组。色值沿用既有语义色(design/README「工具分组」):
 * 纯函数组 = 文本次级色 · 外呼组 = chain 蓝 · 会话绑定组 = takeover 黄 · 沙箱执行组 = frontier 紫(`#8b5cf6`,
 * R-SKILLS-2;任务卡建议沿用的既有语义色,待所有者在画板 1f/1g 上定稿后按画板核对),没有新造 token。
 */
const GROUPS: Record<ToolGroup, { label: string; note: string; badge: string; color: string }> = {
  pure: { label: "纯函数组", note: "只读教程库三张表 · 不联网 · 不碰文件系统", badge: "纯函数", color: "#6b7280" },
  outbound: { label: "外呼组", note: "持服务端凭据发请求 · 访客只控 query", badge: "外呼", color: "#2563eb" },
  session: { label: "会话绑定组", note: "只写当前这次会话的标题 · 会话 id 不是入参", badge: "会话绑定", color: "#f9c22e" },
  sandbox: { label: "沙箱执行组", note: "独立无网络容器里跑 skill 自带的脚本 · 只能跑清单里的", badge: "沙箱执行", color: "#8b5cf6" },
};
/** 画板上的分组顺序(第四组加在末尾) */
const GROUP_ORDER: readonly ToolGroup[] = ["pure", "outbound", "session", "sandbox"];

/**
 * 目录在一次页面生命周期里只取一次:它是静态的,每次切到这个 tab 都重新请求没有意义。
 * 失败不缓存(下次切过来再试)。
 */
let catalogPromise: Promise<ToolCatalog> | null = null;
function loadCatalog(): Promise<ToolCatalog> {
  if (!catalogPromise) {
    catalogPromise = listTools().catch((err) => {
      catalogPromise = null;
      throw err;
    });
  }
  return catalogPromise;
}

/** 画板上的约束徽标(`≤64` / `1–128` / `1–20`),从 JSON Schema 的边界关键字派生。 */
function ruleOf(p: ToolParamSchema): string {
  const lo = p.minLength ?? p.minimum;
  const hi = p.maxLength ?? p.maximum;
  if (lo !== undefined && hi !== undefined) return `${lo}–${hi}`;
  if (hi !== undefined) return `≤${hi}`;
  if (lo !== undefined) return `≥${lo}`;
  return "";
}

const SECTION_HEAD = { ...mono(10, 600), color: "var(--text-dim)", letterSpacing: "0.08em", marginBottom: 6 } as const;

function ParamRow({ name, schema, required }: { name: string; schema: ToolParamSchema; required: boolean }) {
  const rule = ruleOf(schema);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={{ ...mono(11, 600), color: "var(--text)" }}>{name}</span>
        <span style={{ ...mono(11), color: "var(--text-muted)" }}>{schema.type}</span>
        <span
          style={{
            fontSize: 10, fontWeight: 600, borderRadius: 4, padding: "1px 5px",
            background: required ? "var(--bg-hover)" : "var(--bg-panel)",
            color: required ? "var(--text)" : "var(--text-dim)",
          }}
        >
          {required ? "必填" : "可选"}
        </span>
        {rule && (
          <span style={{ ...mono(10), borderRadius: 4, padding: "1px 5px", background: "var(--bg-panel)", color: "var(--text-muted)" }}>
            {rule}
          </span>
        )}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.65, marginTop: 3 }}>{schema.description}</div>
    </div>
  );
}

function ToolCard({ tool, open, onToggle }: { tool: ToolCatalogEntry; open: boolean; onToggle: () => void }) {
  const g = GROUPS[tool.group];
  const params = Object.entries(tool.parameters.properties);
  return (
    <div
      onClick={onToggle}
      style={{ border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", padding: "7px 9px", cursor: "pointer" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "var(--bg)")}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ ...mono(12, 600), color: "var(--text)" }}>{tool.name}</span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{tool.label}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, borderRadius: 4, padding: "1px 5px", background: "var(--bg-panel)", color: g.color }}>{g.badge}</span>
        <span style={{ fontSize: 9, color: "var(--text-dim)" }}>{open ? "▾" : "▸"}</span>
      </div>
      {!open ? (
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {tool.description}
        </div>
      ) : (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12, lineHeight: 1.7, color: "var(--text-muted)", textWrap: "pretty" }}>{tool.description}</div>
          <div>
            <div style={SECTION_HEAD}>INPUT</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {params.map(([name, schema]) => (
                <ParamRow key={name} name={name} schema={schema} required={tool.parameters.required.includes(name)} />
              ))}
            </div>
          </div>
          <div>
            <div style={SECTION_HEAD}>OUTPUT</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.7 }}>{tool.output}</div>
            {tool.outputNote && (
              <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.7, marginTop: 3 }}>{tool.outputNote}</div>
            )}
          </div>
          {tool.phases && tool.phases.length > 0 && (
            <div>
              <div style={SECTION_HEAD}>PROGRESS</div>
              <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                {tool.phases.map((label, i) => (
                  <div key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ fontSize: 11, color: "var(--text-muted)", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 4, padding: "1px 6px" }}>
                      {label}
                    </span>
                    {i < tool.phases!.length - 1 && <span style={{ fontSize: 10, color: "var(--text-dim)" }}>→</span>}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.65, marginTop: 6 }}>
                执行期间持续上报阶段 — 即 Timeline 上那串 <span style={{ ...mono(10), color: "var(--text-muted)" }}>tool_execution_update</span> 事件
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 脚注里的等宽片段 */
function Code({ children }: { children: React.ReactNode }) {
  return <span style={{ ...mono(10), color: "var(--text-muted)" }}>{children}</span>;
}

export function ToolsPanel() {
  const [catalog, setCatalog] = useState<ToolCatalog | null>(null);
  const [openTool, setOpenTool] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadCatalog()
      .then((c) => { if (alive) setCatalog(c); })
      .catch((err) => console.error("load tools failed:", err));
    return () => { alive = false; };
  }, []);

  const groups = GROUP_ORDER
    .map((key) => ({ key, ...GROUPS[key], tools: catalog?.tools.filter((t) => t.group === key) ?? [] }))
    .filter((g) => g.tools.length > 0);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, overflow: "auto", padding: "10px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
        {groups.map((g) => (
          <div key={g.key}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "4px 0 6px", borderBottom: "1px solid var(--border)", marginBottom: 7 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", flex: "none", background: g.color }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.05em" }}>{g.label}</span>
              <span style={{ fontSize: 11, color: "var(--text-dim)", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.note}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {g.tools.map((t) => (
                <ToolCard
                  key={t.name}
                  tool={t}
                  open={openTool === t.name}
                  onToggle={() => setOpenTool((cur) => (cur === t.name ? null : t.name))}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      {catalog && (
        <div style={{ flex: "none", borderTop: "1px solid var(--border)", padding: "9px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.6 }}>
            入参一律 <Code>additionalProperties: false</Code> — 不接受未声明字段
          </div>
          {/* 「正文」二字是契约的一部分:超限时正文截到 N,截断标注另加,整段结果会略长于 N(见 catalog.ts) */}
          <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.6 }}>
            工具结果正文统一 <Code>{catalog.resultBodyCharLimit}</Code> 字符上限 — 超出显式标注截断,不静默丢尾
          </div>
          <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.6 }}>
            工具集合中不存在 <Code>bash</Code> / <Code>write</Code> / 任意代码执行类工具
          </div>
        </div>
      )}
    </div>
  );
}
