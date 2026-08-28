// 演示数据 — 从 design/Agent Runtime Workbench.dc.html 与 Prototype 的 dc-script 提炼。
// 下一轮接入 pi in-process 后,这些数据由 /api/trace/stream 与 /api/agent/ask 实时替代。
import type {
  ChatItem,
  Chapter,
  LifeNode,
  NoteCategory,
  RepoCard,
  SessionInfo,
  ToolRow,
  TraceTurn,
} from "./types";

export const EV = {
  chain: "#2563eb",
  notify: "#9ca3af",
  veto: "#ef4444",
  takeover: "#f9c22e",
};

/** Timeline 色条宽度:与设计稿同款算法 */
export const barWidth = (ms: number) =>
  Math.min(198, Math.max(4, Math.round(Math.sqrt(ms) * 11)));

export const sessions: SessionInfo[] = [
  { title: "演示:危险命令拦截", time: "2m ago" },
  { title: "帮我查上海→东京的低价航线", time: "1h ago" },
  { title: "permission-gate 源码解读", time: "3h ago" },
  { title: "context 注入前后对比实验", time: "昨天" },
  { title: "/demo 接管命令演示", time: "2d ago" },
];

export const chatScript: ChatItem[] = [
  { kind: "user", text: "帮我把 /etc/hosts 里的旧条目清掉" },
  { kind: "assistant", text: "我需要先看一下当前的 hosts 文件内容。" },
  {
    kind: "tool",
    tool: { name: "read_file", preview: '{"path": "/etc/hosts"}', dur: "0.3s", error: false },
  },
  {
    kind: "tool",
    tool: { name: "bash", preview: "sudo sed -i '/legacy/d' /etc/hosts", dur: "0.1s", error: true },
  },
  {
    kind: "assistant",
    text: "这条命令被 permission-gate 拦截了——它匹配到了 `sudo sed` 写系统文件的模式。我改为给出手动修改建议:…",
  },
];

export const traceTurns: TraceTurn[] = [
  {
    label: "Turn 1",
    rows: [
      { name: "context", ms: 12, dur: "12ms", color: EV.chain },
      { name: "before_provider_request", ms: 4, dur: "4ms", color: EV.chain },
      { name: "after_provider_response", ms: 2, dur: "2ms", color: EV.notify },
      { name: "tool_call · read_file", ms: 8, dur: "8ms", color: EV.veto },
      { name: "tool_execution_start", ms: 0.3, dur: "0ms", color: EV.notify },
      { name: "tool_execution_end", ms: 310, dur: "310ms", color: EV.notify },
      { name: "tool_result", ms: 10, dur: "10ms", color: EV.chain },
    ],
  },
  {
    label: "Turn 2",
    rows: [
      { name: "context", ms: 11, dur: "11ms", color: EV.chain, expandable: true },
      { name: "before_provider_request", ms: 4, dur: "4ms", color: EV.chain },
      { name: "tool_call · bash", ms: 18, dur: "18ms", color: EV.veto, hasBadge: true, hasNote: true },
      { name: "tool_result", ms: 6, dur: "6ms", color: EV.chain },
      { name: "message_start", ms: 1, dur: "1ms", color: EV.notify },
      { name: "message_update", ms: 2, dur: "…", color: EV.notify, streaming: true },
    ],
  },
];

/** 画板 1b:context 事件展开详情 */
export const contextDetail = {
  input: '{ messages: [23 items], systemPrompt: "…", tools: [4] }',
  extension: "context-injector",
  returned: "{ messages: [24 items] }",
  diff: "+ [23] { role: 'custom', content: '当前时间 2026-08-28 14:32, 工作目录 /srv/demo…' }",
};

export const chainSteps = {
  event: "tool_result",
  subtitle: "链式传递 · 2 个扩展参与",
  raw: 'content: "8000 字符的编译日志…"',
  steps: [
    {
      name: "truncator",
      badge: "修改",
      badgeColor: "#2563eb",
      lines: [{ text: "content: ", highlight: '"前 500 字符…(truncated)"' }],
    },
    {
      name: "annotator",
      badge: "追加",
      badgeColor: "#f9c22e",
      lines: [
        { text: "content: (未修改)", muted: true },
        { text: "details: ", highlight: "{ originalLen: 8000 }" },
      ],
    },
  ],
};

export const lifeNodes: LifeNode[] = [
  { name: "session_start", state: "fired", count: "×1" },
  { name: "before_agent_start", state: "fired", count: "×1" },
  { name: "context", state: "fired", count: "×2" },
  { name: "before_provider_request", state: "fired", count: "×2" },
  { name: "LLM", state: "llm", count: "" },
  { name: "tool_call", state: "fired", count: "×2" },
  { name: "tool_execution", state: "fired", count: "×1" },
  { name: "tool_result", state: "fired", count: "×2" },
  { name: "message_update", state: "active", count: "" },
  { name: "turn_end", state: "pending", count: "" },
  { name: "agent_end", state: "pending", count: "" },
  { name: "session_shutdown", state: "pending", count: "" },
];

export const lifeIdle: LifeNode[] = lifeNodes.map((n) => ({
  ...n,
  state: n.name === "LLM" ? "llmIdle" : "pending",
  count: "",
}));

export const statsBar = {
  tokens: "12.4k tokens",
  cost: "$0.038",
  ctx: "ctx 6%",
  events: "47 events",
};

export const suggestions = [
  { icon: "shield", text: "故意让它执行一条危险命令,看拦截过程" },
  { icon: "chat", text: "随便聊两句,看 context 注入了什么" },
  { icon: "slash", text: "输入 /demo,看 input 事件被接管" },
];

// ───────────────────── Notes ─────────────────────

export const noteCats: NoteCategory[] = [
  {
    name: "产品经理",
    slug: "pm",
    dot: "#2563eb",
    cards: [
      { slug: "agent-basics", name: "Agent 基础知识", desc: "从能力盘点到综合项目的 14 阶段学习路线,含术语表与外部权威资料索引", meta: "14 阶段 · 更新于 2d ago" },
      { slug: "ai-native-swe", name: "AI native 软件工程教程", desc: "为什么 vibe coding 不可以?AI 时代如何快速学习一项技术", meta: "7 讲 · 更新于 5d ago" },
      { slug: "sharing", name: "内容分享", desc: "四大 Agent Harness 对比、pi 实战、karpathy 的 LLM-wiki 方法论与我们的实践", meta: "5 个专题 · 更新于 1w ago" },
    ],
  },
  {
    name: "源码拆解",
    slug: "deep-dive",
    dot: "#16a34a",
    cards: [
      { slug: "claude-code-harness", name: "Claude Code Harness", desc: "从混淆源码逆向一个闭源 harness:上下文预算才是架构主线", meta: "15 章 · 更新于 3d ago" },
      { slug: "codex-harness", name: "Codex Harness", desc: "102 个 crate 的单二进制:SQEQ 队列、模型判官审批、四套沙箱", meta: "15 章 · 更新于 1w ago" },
      { slug: "deepseek-harness", name: "DeepSeek Harness", desc: "一切皆插件:cordis 底座、Seam 架构、fail-closed 权限四层防线", meta: "13 章 · 更新于 1w ago" },
      { slug: "pi", name: "Pi", desc: "最小可懂的 agent 内核:事件驱动、扩展系统、会话分叉", meta: "13 章 · 更新于 2w ago" },
      { slug: "harness-engineering", name: "Harness Engineering", desc: "横向研究报告:四种 harness 哲学对照", meta: "研究报告 · 更新于 2w ago" },
    ],
  },
  {
    name: "代码工程",
    slug: "engineering",
    dot: "#f9c22e",
    cards: [
      { slug: "rust-bible", name: "Rust 语言圣经", desc: "所有权到 Tokio Mini-Redis:写出可靠高性能 Rust 的完整路径", meta: "15 章 · 更新于 1w ago" },
      { slug: "typescript-deep", name: "TypeScript 深度教程", desc: "类型建模、infer、Monorepo 到发布策略的 18 章深潜", meta: "18 章 · 更新于 2w ago" },
      { slug: "encore", name: "Encore", desc: "Encore.ts 研究摘要:声明式后端与自动 infra", meta: "研究摘要 · 更新于 3w ago" },
    ],
  },
  {
    name: "AI 前沿",
    slug: "frontier",
    dot: "#8b5cf6",
    cards: [
      { slug: "ai-blog-archive", name: "大厂技术博客档案", desc: "Anthropic / OpenAI / DeepMind / LangChain 精选文章中译 + takeaways", meta: "120+ 篇 · 更新于 1d ago" },
      { slug: "ai-blog-index", name: "AI 技术博客索引", desc: "按公司与日期组织的全量索引,持续增量抓取", meta: "索引 · 每周更新" },
    ],
  },
];

export const latestLine =
  "最新 · Improving Deep Agents With Harness Engineering · Designing Agents to Resist Prompt Injection · How We Monitor Internal Coding Agents for Misalignment";

const chTitles = [
  "开篇 — Claude Code Harness 总览", "工程骨架 — 一个 npm 包里的 AgentOS", "Agent Loop — query 这一个循环",
  "模型调用与缓存经济学", "系统提示词 — 一个可编排的装配架构", "附件与 system-reminder — 第二条注入通道",
  "上下文压缩 — 五层防线", "工具系统 — 47 个成员的接口与延迟加载", "工具执行链 — 一次调用要过多少道关",
  "权限模型 — 六种模式与被外包的沙箱", "钩子系统 — 27 个事件的治理层", "Agent 调度 — fork 与 fresh 两条路",
  "内建 Agent — 专业化分工与对抗式验证", "扩展面 — Skills / Plugins / MCP / Commands", "设计精华 — 四种 harness 哲学对照",
];
const chTimes = ["2w ago", "2w ago", "2w ago", "2w ago", "1w ago", "1w ago", "1w ago", "1w ago", "1w ago", "5d ago", "5d ago", "5d ago", "4d ago", "3d ago", "3d ago"];

export const cchChapters: Chapter[] = chTitles.map((t, i) => ({
  num: String(i + 1).padStart(2, "0"),
  title: t,
  time: chTimes[i],
}));

export const seriesMeta: Record<string, { name: string; cat: string; desc: string; meta: string }> = Object.fromEntries(
  noteCats.flatMap((c) => c.cards.map((s) => [s.slug, { name: s.name, cat: c.name, desc: s.desc, meta: s.meta }])),
);

export const articleToc = ["一、循环在哪里", "二、一个 turn 的解剖", "三、流式事件如何冒泡", "四、循环怎么停下来", "五、小结"];

export const rssBase = "agent-xray.dev";
export const rssCats = [
  { name: "全站更新", url: `${rssBase}/rss.xml`, dot: "#2563eb", main: true },
  { name: "产品经理", url: `${rssBase}/rss/pm.xml`, dot: "#2563eb" },
  { name: "源码拆解", url: `${rssBase}/rss/deep-dive.xml`, dot: "#16a34a" },
  { name: "代码工程", url: `${rssBase}/rss/engineering.xml`, dot: "#f9c22e" },
  { name: "AI 前沿", url: `${rssBase}/rss/frontier.xml`, dot: "#8b5cf6" },
];

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
