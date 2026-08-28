import { api } from "encore.dev/api";

// 健康检查 — 框架期唯一的实端点;其余服务(agent/trace/notes/admin/metrics)
// 的接口形状在设计终稿确认后实现,职责与安全约束见各目录 README 与 docs/。
export const health = api(
  { expose: true, method: "GET", path: "/health" },
  async (): Promise<{ status: string }> => {
    return { status: "ok" };
  },
);
