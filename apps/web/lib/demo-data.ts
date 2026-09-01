// 演示数据 — 从 design/Agent Runtime Workbench.dc.html 与 Prototype 的 dc-script 提炼。
//
// Runtime 工作台部分已全部真实化:对话与会话列表在 R3 切到 /api/agent/*,
// 右栏三视图(Timeline / Chain View / Lifecycle Map)在 R4 切到 /api/trace/stream,
// 对应的演示数据已随之删除,投影逻辑见 lib/trace-view.ts。
// 这里剩下的是尚未接后端的部分:统计条的 tokens/cost/ctx(R7/R8 计量)、
// 空状态引导语,以及 About 页(内容表与管理 tools 已在 R6 落地,前端接线在 R8)。
// Notes 三块页面已在 R5 切到 /api/notes/*,演示数据随之删除。
import type { RepoCard } from "./types";

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
// R6 起 /admin 后台整体废弃(所有者裁定 2026-08-31,画板 3a–3e 作废):管理面改为
// 无状态 MCP 服务 /api/mcp,没有前端界面。六个页面与它们的演示数据一并删除。
