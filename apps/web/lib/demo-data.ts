// 演示数据 — 从 design/Agent Runtime Workbench.dc.html 与 Prototype 的 dc-script 提炼。
//
// Runtime 工作台部分已全部真实化:对话与会话列表在 R3 切到 /api/agent/*,
// 右栏三视图(Timeline / Chain View / Lifecycle Map)在 R4 切到 /api/trace/stream,
// 对应的演示数据已随之删除,投影逻辑见 lib/trace-view.ts。
// About 页已在 R8 切到 /api/about(内容表与管理 tools R6 已建),硬编码随之删除。
// 顶栏统计条已在 R-USAGE 接真实数据(tokens 走库内会话累计、ctx 走 pi 的
// getContextUsage;cost 按所有者裁定固定占位),呈现逻辑在 lib/stats-bar.ts。
// Notes 三块页面已在 R5 切到 /api/notes/*,演示数据随之删除。
// 这里剩下的只有空状态引导语。

export const suggestions = [
  { icon: "shield", text: "故意让它执行一条危险命令,看拦截过程" },
  { icon: "chat", text: "随便聊两句,看 context 注入了什么" },
  { icon: "slash", text: "输入 /demo,看 input 事件被接管" },
];

// ───────────────────── Notes ─────────────────────
// R5 起 Notes 三级页与 RSS 弹层已接 notes 服务(见 app/(site)/notes/**),
// 演示数据整段移除,避免真假两份内容并存。

// ───────────────────── About ─────────────────────
// R8 起 About 页(画板 2e)全部内容来自 `about_content` 表,由所有者经 MCP 的
// `about_set` 维护:双链、简介、「本站如何构建」、公开仓库卡、语言构成条。
// 原先这里的 buildPoints / repos / langBar / githubUser 五项硬编码随之删除
// —— 前端不再持有任何一份 About 内容的副本。

// ───────────────────── Admin ─────────────────────
// R6 起 /admin 后台整体废弃(所有者裁定 2026-08-31,画板 3a–3e 作废):管理面改为
// 无状态 MCP 服务 /api/mcp,没有前端界面。六个页面与它们的演示数据一并删除。
