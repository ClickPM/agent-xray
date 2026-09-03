// R-SKILLS-2 验收 ⑬:四个新 MCP 工具(skills_agent_set / skills_agent_status / sandbox_config_get / sandbox_config_set)。
// skills_agent_status 对「库里没有 / 未开 / drift / 可用」四种状态各回对应值;skills_agent_set 只能在代码清单之内开关;
// sandbox_config_set 部分更新且 CHECK 越界回可读理由。总数 46 的闸在 mcp.test.ts。经 `dev.ps1 test` 运行。
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as z from "zod";
import { AGENT_SKILLS } from "../shared/skills.generated";
import { db } from "./db";
import * as store from "./store";
import { registerTools } from "./tools";

interface Registered {
  name: string;
  config: { inputSchema?: Record<string, z.ZodType> };
  handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
}
const registered: Registered[] = [];
registerTools(
  {
    registerTool(name: string, config: Registered["config"], handler: Registered["handler"]) {
      registered.push({ name, config, handler });
    },
  } as never,
  {},
);
const tool = (name: string) => {
  const t = registered.find((r) => r.name === name);
  expect(t, `${name} 未注册`).toBeDefined();
  return t!;
};
const callJson = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await tool(name).handler(args);
  const text = r.content.map((c) => c.text).join("");
  return { isError: r.isError === true, text, json: r.isError ? null : JSON.parse(text) };
};

/** 从代码副本种展示副本(= 所有者经 skills_upsert 上传了同样的文件),可选改动 */
async function seedSkill(name: string, mutate?: (files: { path: string; content: string }[]) => void) {
  const s = AGENT_SKILLS.find((x) => x.name === name)!;
  // 用 mcp 自己的写面:与所有者上传走同一条路。内容从 runner/skills 读(测试可读文件系统)
  const { readFileSync } = await import("node:fs");
  const { resolve, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "runner", "skills", name);
  const files = s.files.map((f) => ({ path: f.path, content: readFileSync(resolve(dir, f.path), "utf8") }));
  mutate?.(files);
  await store.upsertSkill({
    name,
    categorySlug: "framework",
    summary: "seed",
    sourceType: "own",
    repo: "ClickPM/agent-skills",
    repoUrl: null,
    version: null,
    sortOrder: 0,
    files,
  });
}

async function clear() {
  await db.exec`DELETE FROM skill_files`;
  await db.exec`DELETE FROM skills`;
  await db.exec`DELETE FROM mcp_audit`;
  await db.rawExec(`UPDATE sandbox_config SET daily_run_limit = 0, total_timeout_ms = 30000 WHERE id = 1`);
}

describe("skills_agent_set / skills_agent_status(验收 ⑬)", () => {
  beforeEach(clear);
  afterAll(clear);

  it("四个工具都注册了;入参 schema:name 合法 skill 名 + enabled 布尔", () => {
    for (const n of ["skills_agent_set", "skills_agent_status", "sandbox_config_get", "sandbox_config_set"]) tool(n);
    const schema = z.object(tool("skills_agent_set").config.inputSchema!);
    expect(schema.safeParse({ name: "text-tools", enabled: true }).success).toBe(true);
    expect(schema.safeParse({ name: "Text", enabled: true }).success).toBe(false);
    expect(schema.safeParse({ name: "text-tools", enabled: "yes" }).success).toBe(false);
  });

  it("状态「库里没有」:inLibrary=false、consistency=missing、available=false;两个闸默认关", async () => {
    const { json } = await callJson("skills_agent_status");
    expect(json.gates).toEqual({ skill_load: false, skill_run: false });
    expect(json.skills.map((s: { name: string }) => s.name)).toEqual(AGENT_SKILLS.map((s) => s.name));
    const tt = json.skills.find((s: { name: string }) => s.name === "text-tools");
    expect(tt).toMatchObject({ inLibrary: false, agentEnabled: false, consistency: "missing", available: false, network: "none" });
    expect(tt.scripts).toEqual(["json_pretty.py", "wordfreq.py"]);
  });

  it("状态「未开」:上传了一致的副本但没打开 → consistency ok、available false", async () => {
    await seedSkill("text-tools");
    const { json } = await callJson("skills_agent_status");
    expect(json.skills.find((s: { name: string }) => s.name === "text-tools")).toMatchObject({
      inLibrary: true,
      agentEnabled: false,
      consistency: "ok",
      available: false,
    });
  });

  it("状态「drift」:打开了但副本改了一字节 → consistency drift、列出 changed、available false", async () => {
    await seedSkill("text-tools", (files) => {
      const md = files.find((f) => f.path === "SKILL.md")!;
      md.content = `${md.content}\n`;
    });
    const set = await callJson("skills_agent_set", { name: "text-tools", enabled: true });
    expect(set.isError).toBe(false);
    const { json } = await callJson("skills_agent_status");
    const tt = json.skills.find((s: { name: string }) => s.name === "text-tools");
    expect(tt).toMatchObject({ inLibrary: true, agentEnabled: true, consistency: "drift", available: false });
    expect(tt.drift).toEqual({ missing: [], extra: [], changed: ["SKILL.md"] });
  });

  it("状态「可用」:一致 + 打开 → available true;关掉又回 false;写操作有审计", async () => {
    await seedSkill("encore-api");
    await callJson("skills_agent_set", { name: "encore-api", enabled: true });
    let { json } = await callJson("skills_agent_status");
    expect(json.skills.find((s: { name: string }) => s.name === "encore-api")).toMatchObject({ consistency: "ok", available: true });
    await callJson("skills_agent_set", { name: "encore-api", enabled: false });
    ({ json } = await callJson("skills_agent_status"));
    expect(json.skills.find((s: { name: string }) => s.name === "encore-api").available).toBe(false);
    const audits = await db.rawQueryAll<{ tool: string }>(`SELECT tool FROM mcp_audit WHERE tool = 'skills_agent_set'`);
    expect(audits).toHaveLength(2);
  });

  it("skills_agent_set:不在代码清单里的名字被拒(库里只能在集合之内开关);库里没有的报 NotFound", async () => {
    const notInCode = await callJson("skills_agent_set", { name: "not-in-code", enabled: true });
    expect(notInCode.isError).toBe(true);
    expect(notInCode.text).toContain("不在代码清单");
    const notInLib = await callJson("skills_agent_set", { name: "text-tools", enabled: true });
    expect(notInLib.isError).toBe(true);
    expect(notInLib.text).toContain("先用 skills_upsert");
  });

  it("gates 反映 tool_config 的 enabled", async () => {
    await store.setToolConfig({ name: "skill_load", enabled: true });
    const { json } = await callJson("skills_agent_status");
    expect(json.gates.skill_load).toBe(true);
    await store.setToolConfig({ name: "skill_load", enabled: false });
  });
});

describe("sandbox_config_get / sandbox_config_set", () => {
  beforeEach(clear);
  afterAll(clear);

  it("默认单行:dailyRunLimit 0、totalTimeoutMs 30000", async () => {
    const { json } = await callJson("sandbox_config_get");
    expect(json).toMatchObject({ dailyRunLimit: 0, totalTimeoutMs: 30000 });
    expect(typeof json.updatedAt).toBe("string");
  });

  it("部分更新:只给一个字段,另一个保留原值", async () => {
    await callJson("sandbox_config_set", { totalTimeoutMs: 45000 });
    await callJson("sandbox_config_set", { dailyRunLimit: 20 });
    const { json } = await callJson("sandbox_config_get");
    expect(json).toMatchObject({ dailyRunLimit: 20, totalTimeoutMs: 45000 });
  });

  it("越界:schema 先拒(5000–120000 / ≥ 0);绕过 schema 直写库时 CHECK 拒且回可读理由", async () => {
    const schema = z.object(tool("sandbox_config_set").config.inputSchema!);
    expect(schema.safeParse({ totalTimeoutMs: 4999 }).success).toBe(false);
    expect(schema.safeParse({ totalTimeoutMs: 120001 }).success).toBe(false);
    expect(schema.safeParse({ dailyRunLimit: -1 }).success).toBe(false);
    expect(schema.safeParse({ totalTimeoutMs: 5000, dailyRunLimit: 0 }).success).toBe(true);
    await expect(store.setSandboxConfig({ totalTimeoutMs: 200_000 })).rejects.toThrow("取值越界");
    await expect(store.setSandboxConfig({ dailyRunLimit: -5 })).rejects.toThrow("取值越界");
    // 库里的值没被越界写坏
    expect(await store.getSandboxConfig()).toMatchObject({ dailyRunLimit: 0, totalTimeoutMs: 30000 });
  });
});
