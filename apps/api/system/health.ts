import { api } from "encore.dev/api";

// 健康检查 — 框架期唯一的实端点;其余服务(agent/trace/notes/admin/metrics)
// 的接口形状在设计终稿确认后实现,职责与安全约束见各目录 README 与 docs/。
export const health = api(
  {
    expose: true,
    method: "GET", path: "/health",
    // 【R-VISITOR】访客 cookie 的 Path 是 `/`,浏览器**直接访问这条路径时会把它一并带来**
    // (哪怕本端点根本不看它)。不设 sensitive 的话,一个可冒充身份的凭据会进 trace。
    // 口径见 shared/visitor-cookie.ts 的「Path=/ 的连带义务」与 docs/security.md §6。
    sensitive: true,
  },

  async (): Promise<{ status: string }> => {
    return { status: "ok" };
  },
);
