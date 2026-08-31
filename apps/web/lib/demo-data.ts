// 演示数据 — 从 design/Agent Runtime Workbench.dc.html 与 Prototype 的 dc-script 提炼。
//
// Runtime 工作台部分已全部真实化:对话与会话列表在 R3 切到 /api/agent/*,
// 右栏三视图(Timeline / Chain View / Lifecycle Map)在 R4 切到 /api/trace/stream,
// 对应的演示数据已随之删除,投影逻辑见 lib/trace-view.ts。
// 这里剩下的是尚未接后端的部分:统计条的 tokens/cost/ctx(R7/R8 计量)、
// 空状态引导语、About / Admin 两块(R7 / R8)。
// Notes 三块页面已在 R5 切到 /api/notes/*,演示数据随之删除。
import type { RepoCard, ToolRow } from "./types";

// 顶栏统计条:events 已由真实轨迹流计数(R4),其余三项等 R7/R8 的计量与限额
export const statsBar = {
  tokens: "12.4k tokens",
  cost: "$0.038",
  ctx: "ctx 6%",
};

export const suggestions = [
  { icon: "shield", text: "故意让它执行一条危险命令,看拦截过程" },
  { icon: "chat", text: "随便聊两句,看 context 注入了什么" },
  { icon: "slash", text: "输入 /demo,看 input 事件被接管" },
];

// ───────────────────── Notes ─────────────────────
// R5 起 Notes 三级页与 RSS 弹层已接 notes 服务(见 app/(site)/notes/**),
// 演示数据整段移除,避免真假两份内容并存。

// ───────────────────── About ─────────────────────

export const buildPoints = [
  "pi coding agent 以 SDK 方式 in-process 嵌入 Encore.ts 后端(无 sidecar)",
  "一个观测者扩展订阅全部 34 种内核事件,零侵入采集运行时轨迹",
  "SSE 双通道:对话流 + 事件轨迹流,毫秒级推到浏览器",
  "前端基于 pi-web (Next.js) 改造:三栏工作台 + DevTools 式运行时面板",
  "教程库由 Obsidian vault 静态编译,四分类 RSS 自动生成",
];

export const repos: RepoCard[] = [
  { name: "GPUI-Pi", lang: "Rust", dot: "#dea584", stars: 0, desc: "Native GPUI desktop client for the pi coding agent — no Electron, no Chromium", pushed: "2026-08-27" },
  { name: "dsh-acp-interactive", lang: "TypeScript", dot: "#3178c6", stars: 1, desc: "面向 Zed 等编辑器的 DeepSeek Harness 交互式 ACP 插件", pushed: "2026-08-27" },
  { name: "dsh-toolbelt", lang: "TypeScript", dot: "#3178c6", stars: 1, desc: "Eight DeepSeek Harness plugins: persona, language guard, per-request vision fallback…", pushed: "2026-08-25" },
  { name: "pi-agent-desktop", lang: "Python", dot: "#3572A5", stars: 0, desc: "pi agent 桌面端", pushed: "2026-08-24" },
  { name: "Ralph-control", lang: "Rust", dot: "#dea584", stars: 0, desc: "Ralph 自动化控制", pushed: "2026-05-22" },
  { name: "encore-backend", lang: "TypeScript", dot: "#3178c6", stars: 0, desc: "Encore.ts 后端实践", pushed: "2026-05-08" },
  { name: "encore-frontend", lang: "Vue", dot: "#41b883", stars: 0, desc: "Encore 配套前端", pushed: "2026-05-08" },
];

export const langBar = [
  { name: "Rust", pct: 29, color: "#dea584" },
  { name: "TypeScript", pct: 43, color: "#3178c6" },
  { name: "Python", pct: 14, color: "#3572A5" },
  { name: "Vue", pct: 14, color: "#41b883" },
];

export const githubUser = "cking000bigdemon";

// ───────────────────── Admin ─────────────────────

export const ovStats = [
  { value: "342", label: "今日 PV", delta: "↑18%", deltaColor: "#16a34a" },
  { value: "89", label: "今日 UV", delta: "↑9%", deltaColor: "#16a34a" },
  { value: "23", label: "新会话", delta: "↑4", deltaColor: "#16a34a" },
  { value: "148k", label: "tokens", delta: "", deltaColor: "#9ca3af" },
  { value: "$0.42", label: "费用", delta: "", deltaColor: "#9ca3af" },
  { value: "6", label: "拦截次数", delta: "↓2", deltaColor: "#ef4444" },
];

export const ovEvents = [
  { time: "14:32", badge: "限额", bc: "#b45309", text: "tokens 达到日限额 30%", actor: "—" },
  { time: "11:07", badge: "工具", bc: "#8b5cf6", text: "web_search 已启用", actor: "admin" },
  { time: "09:41", badge: "配置", bc: "#2563eb", text: "每日费用上限 $1.00 → $2.00", actor: "admin" },
  { time: "09:38", badge: "登录", bc: "#6b7280", text: "登录成功 · 116.23.x.x(哈希)", actor: "—" },
  { time: "昨天", badge: "工具", bc: "#8b5cf6", text: "image_gen 已停用", actor: "admin" },
];

export const pv7 = [198, 232, 175, 289, 305, 268, 342];
export const pv30 = [162, 178, 155, 190, 171, 201, 188, 214, 196, 182, 220, 207, 193, 228, 215, 241, 199, 232, 175, 246, 238, 252, 231, 260, 244, 271, 236, 258, 289, 342];
export const uv30 = pv30.map((v, i) => Math.round(v * 0.31 + (i % 3) * 4));

/** 折线坐标:与设计稿同款算法 */
export function chartPts(data: number[], W: number, H: number): string {
  const max = Math.max(...data);
  const min = Math.min(...data) * 0.85;
  return data
    .map(
      (v, i) =>
        `${Math.round(15 + (i * (W - 30)) / (data.length - 1))},${Math.round(H - 12 - ((v - min) / (max - min)) * (H - 42))}`,
    )
    .join(" ");
}

export const pageTop = [
  { path: "/", pv: 186, uv: 61 },
  { path: "/notes", pv: 64, uv: 38 },
  { path: "/notes/claude-code-harness", pv: 41, uv: 25 },
  { path: "/about", pv: 28, uv: 22 },
  { path: "/notes/pi/03-agent-loop", pv: 23, uv: 17 },
];

export const trafficSources = [
  { name: "直接访问", pct: "47%" },
  { name: "github.com", pct: "22%" },
  { name: "RSS 阅读器", pct: "14%" },
  { name: "搜索", pct: "9%" },
  { name: "其他", pct: "8%" },
];

export const conversion = [
  { name: "访客 → 开启会话", value: "26%" },
  { name: "平均 turns / 会话", value: "4.2" },
  { name: "平均 events / 会话", value: "38" },
];

export const toolRows: ToolRow[] = [
  { name: "notes_list_series", src: "内置", risk: "安全", desc: "列出教程库全部系列(agent_ro 只读角色)", state: "on" },
  { name: "notes_get_chapter", src: "内置", risk: "安全", desc: "读取指定章节正文(只读)", state: "on" },
  { name: "notes_search", src: "内置", risk: "安全", desc: "教程库全文检索(只读)", state: "on" },
  { name: "web_search", src: "MCP", risk: "外呼", desc: "联网搜索(服务端 key · 域白名单 · 计入日限额)", state: "on" },
  { name: "image_gen", src: "MCP", risk: "外呼", desc: "生图(服务端 key · 计入日限额)", state: "off" },
  { name: "session_fork_demo", src: "pi extension", risk: "安全", desc: "会话分叉演示扩展", state: "on" },
  { name: "bash", src: "内置", risk: "高危", desc: "进程内命令执行——永久锁定", state: "locked" },
  { name: "write_file", src: "内置", risk: "高危", desc: "文件写入——永久锁定", state: "locked" },
];

export const SRC_COLOR: Record<string, string> = { 内置: "#6b7280", MCP: "#2563eb", "pi extension": "#8b5cf6" };
export const RISK_COLOR: Record<string, string> = { 安全: "#16a34a", 外呼: "#b45309", 高危: "#ef4444" };

export const toolLog = [
  { time: "今天 11:07", tool: "web_search", action: "启用", color: "#16a34a" },
  { time: "昨天 16:20", tool: "image_gen", action: "停用", color: "#6b7280" },
  { time: "昨天 16:18", tool: "image_gen", action: "启用", color: "#16a34a" },
  { time: "08-26 10:02", tool: "notes_search", action: "启用", color: "#16a34a" },
];
