// R-TOOLS 验收项本身(不是"覆盖率"),对应任务卡验收 #2 / #3 / #6:
//   #2 ①逐字段:目录条目与**按真实构造路径产出的定义**逐字段相等,不靠眼看;
//      ②集合相等:目录 name 集合 == 两个注册表 + web_search 的并集,多一个少一个都红;
//      ③穿过库的兜底:迁移里 `tool_config` 种下的每个名字都要有目录项;
//   #3 响应不泄配置面:grep 不到 key / baseUrl / model / provider / 限额数字 / enabled,
//      且 web_search 的条目与「有没有配置」无关;
//   #6 五个工具齐、分三组、每条都有输出形态说明。
// 经 `dev.ps1 test`(encore test)运行,CLAUDE.md 规则 2。
import { describe, expect, it } from "vitest";
import { listTools, toolCatalog, type ToolCatalogEntry, type ToolGroup } from "./catalog";
import { db } from "./db";
import {
  capText,
  makeWebSearchTool,
  MAX_RESULT_CHARS,
  SESSION_TOOL_REGISTRY,
  TOOL_REGISTRY,
  WEB_SEARCH_TOOL_NAME,
} from "./tools";
import type { ActiveWebSearchConfig } from "./websearch-config";

/**
 * 一份**每个值都独一无二**的假配置:任何一个值出现在响应里,都能被下面的 grep 抓到。
 * 数字刻意不与任何 schema 边界(64 / 128 / 120 / 20 / 300 / 60)重合。
 */
const FAKE_CFG: ActiveWebSearchConfig = {
  provider: "fake-provider-qzx",
  baseUrl: "https://fake-search-gateway.example/v1",
  modelId: "fake-model-vkq",
  toolType: "web_search_2099_01_01",
  totalTimeoutMs: 173_000,
  idleTimeoutMs: 29_000,
  dailySearchLimit: 4_242,
  apiKey: "sk-fake-key-do-not-leak-7f3a",
  fingerprint: "fp-fake-9c1d",
};

/** 一个真实形状的会话 id;工具从不把它写进任何可见字段,测试顺便验这一点 */
const SESSION_ID = "11111111-2222-4333-8444-555555555555";

/** 目录条目对应的、**按真实路径**构造出来的定义(与 loadEnabledTools / buildSessionTools 同源)。 */
function definitionFor(entry: ToolCatalogEntry) {
  switch (entry.group) {
    case "pure":
      return TOOL_REGISTRY[entry.name];
    case "session":
      return SESSION_TOOL_REGISTRY[entry.name]({ sessionId: SESSION_ID, needsTitle: true });
    case "outbound":
      return entry.name === WEB_SEARCH_TOOL_NAME ? makeWebSearchTool(FAKE_CFG) : undefined;
  }
}

/** 逐字段比对的那几个字段:定义与目录各取一份同名投影 */
const modelVisible = (t: { name: string; label: string; description: string; parameters: unknown }) => ({
  name: t.name,
  label: t.label,
  description: t.description,
  parameters: t.parameters,
});

const PUBLIC_KEYS = ["name", "label", "description", "group", "parameters", "output", "outputNote", "phases"];

describe("目录与实现双向对齐(验收 #2)", () => {
  it("①逐字段:每条 name / label / description / parameters 与真实构造路径产出的定义相等", () => {
    const catalog = toolCatalog();
    expect(catalog.length).toBeGreaterThan(0);
    for (const entry of catalog) {
      const def = definitionFor(entry);
      expect(def, `${entry.name} 在它声称的分组里找不到实现`).toBeDefined();
      expect(modelVisible(entry)).toEqual(modelVisible(def!));
    }
  });

  it("①目录里的 parameters 是拷贝不是活对象:改响应不会改到工具定义", () => {
    const [entry] = toolCatalog();
    const def = definitionFor(entry)!;
    expect(entry.parameters).toEqual(def.parameters);
    expect(entry.parameters).not.toBe(def.parameters);
  });

  it("②集合相等:目录 name 集合 == TOOL_REGISTRY ∪ SESSION_TOOL_REGISTRY ∪ {web_search}", () => {
    const expected = [
      ...Object.keys(TOOL_REGISTRY),
      ...Object.keys(SESSION_TOOL_REGISTRY),
      WEB_SEARCH_TOOL_NAME,
    ].sort();
    const actual = toolCatalog()
      .map((t) => t.name)
      .sort();
    expect(actual).toEqual(expected);
    expect(new Set(actual).size).toBe(actual.length); // 没有重名
  });

  it("②分组按注册路径派生:在哪张表里就是哪一组,不多不少", () => {
    for (const entry of toolCatalog()) {
      const inPure = Object.hasOwn(TOOL_REGISTRY, entry.name);
      const inSession = Object.hasOwn(SESSION_TOOL_REGISTRY, entry.name);
      const isWeb = entry.name === WEB_SEARCH_TOOL_NAME;
      const expected: ToolGroup = inPure ? "pure" : inSession ? "session" : isWeb ? "outbound" : "pure";
      expect([inPure, inSession, isWeb].filter(Boolean)).toHaveLength(1); // 一个名字只走一条路径
      expect(entry.group).toBe(expected);
    }
  });

  it("③穿过库的兜底:迁移里 tool_config 种下的每个名字都有目录项", async () => {
    const rows = await db.rawQueryAll<{ name: string }>(`SELECT name FROM tool_config ORDER BY name`);
    // 空表会让下面的 for 空转通过;种子不在等于兜底不在,先把这件事报出来
    expect(rows.length, "tool_config 里没有种子行(迁移 006/008/009 没跑?)").toBeGreaterThan(0);
    const names = new Set(toolCatalog().map((t) => t.name));
    for (const { name } of rows) {
      expect(names.has(name), `tool_config 里的 ${name} 没有 META / 没进目录`).toBe(true);
    }
  });
});

describe("响应不泄配置面(验收 #3)", () => {
  it("字段集就是白名单,没有 execute 也没有任何配置字段", async () => {
    const res = await listTools();
    for (const entry of res.tools) {
      for (const key of Object.keys(entry)) {
        expect(PUBLIC_KEYS, `${entry.name} 多出一个字段 ${key}`).toContain(key);
      }
      expect(entry).not.toHaveProperty("execute");
      expect(entry).not.toHaveProperty("enabled");
      expect(entry).not.toHaveProperty("promptSnippet"); // 只进系统提示,不上面板
    }
  });

  it("响应文本里 grep 不到 key / baseUrl / model / provider / 限额数字 / enabled / 会话 id", async () => {
    const text = JSON.stringify(await listTools());
    // 假配置的每一个值:一个都不能出现(makeWebSearchTool 在本文件里被真的调用过,
    // 但那份 cfg 只活在闭包里,目录取的是闭包外面的 META)
    for (const value of Object.values(FAKE_CFG)) {
      expect(text).not.toContain(String(value));
    }
    expect(text).not.toContain(SESSION_ID);
    // 配置面的字段名本身也不该出现(哪怕值是空的)
    for (const key of [
      "apiKey",
      "api_key",
      "baseUrl",
      "base_url",
      "modelId",
      "model_id",
      "provider",
      "dailySearchLimit",
      "daily_search_limit",
      "totalTimeoutMs",
      "idleTimeoutMs",
      "toolType",
      "fingerprint",
      "enabled",
      "dangerous",
      "execute",
    ]) {
      expect(text).not.toMatch(new RegExp(`"${key}"`));
    }
  });

  it("web_search 的条目与配置无关:没配 provider、开关关着,照样列出且内容不变", async () => {
    // 测试库默认就是这个状态(迁移 008 种子 enabled=false,websearch_config 为空);
    // 这里显式断言前提,免得别的测试文件残留让本用例失真
    await db.exec`DELETE FROM websearch_config`;
    const cfgRows = await db.rawQueryAll(`SELECT 1 FROM websearch_config`);
    expect(cfgRows).toHaveLength(0);

    const entry = toolCatalog().find((t) => t.name === WEB_SEARCH_TOOL_NAME);
    expect(entry).toBeDefined();
    expect(entry!.group).toBe("outbound");
    // 没有任何「可不可用 / 配没配 / 开没开」的字段(那是「不显示启停状态」的另一面)
    for (const key of ["available", "configured", "enabled", "disabled", "status"]) {
      expect(entry).not.toHaveProperty(key);
    }
    // 与按真实路径(带配置)构造出来的定义逐字段一致 —— 配置存在与否不改变目录内容
    expect(modelVisible(entry!)).toEqual(modelVisible(makeWebSearchTool(FAKE_CFG)));
  });
});

describe("五个工具齐、分三组、每条有输出形态(验收 #6)", () => {
  it("三组都在,组的顺序是 纯函数 → 外呼 → 会话绑定", () => {
    const groups = toolCatalog().map((t) => t.group);
    const firstIndex = (g: ToolGroup) => groups.indexOf(g);
    expect(new Set(groups)).toEqual(new Set<ToolGroup>(["pure", "outbound", "session"]));
    expect(firstIndex("pure")).toBeLessThan(firstIndex("outbound"));
    expect(firstIndex("outbound")).toBeLessThan(firstIndex("session"));
  });

  it("每条都有非空的 output;入参一律 object + additionalProperties:false", () => {
    for (const entry of toolCatalog()) {
      expect(entry.output.trim().length, `${entry.name} 缺输出形态说明`).toBeGreaterThan(0);
      expect(entry.parameters.type).toBe("object");
      expect(entry.parameters.additionalProperties).toBe(false);
      // required 里的名字必须真的是一个已声明的属性
      for (const r of entry.parameters.required) {
        expect(Object.keys(entry.parameters.properties)).toContain(r);
      }
      // 每个入参都有描述(面板要画它)
      for (const [name, schema] of Object.entries(entry.parameters.properties)) {
        expect(schema.description.length, `${entry.name}.${name} 缺描述`).toBeGreaterThan(0);
      }
    }
  });

  it("会上报进度的工具带 phases,顺序就是上报顺序;其余没有这个字段", () => {
    for (const entry of toolCatalog()) {
      if (entry.name === WEB_SEARCH_TOOL_NAME) {
        expect(entry.phases).toEqual(["发起", "已受理", "检索中", "综述中"]);
      } else {
        expect(entry).not.toHaveProperty("phases");
      }
    }
  });

  it("脚注的正文上限来自 capText 真正用的那个常量,语义是「正文预算 + 标注另加」", async () => {
    const { resultBodyCharLimit: n } = await listTools();
    expect(n).toBe(MAX_RESULT_CHARS);
    // 恰好 N 字符:原样,不截
    expect(capText("x".repeat(n))).toBe("x".repeat(n));
    // N+1 字符:前 N 字符原样保留,其后是显式截断标注 —— 整段结果因此**长于** N,
    // 这正是端点把它叫「正文上限」而不是「结果上限」的原因(codex 初审 P2)
    const capped = capText("x".repeat(n + 1));
    expect(capped.slice(0, n)).toBe("x".repeat(n));
    expect(capped.slice(n)).toMatch(/^\n…\(已截断/);
    expect(capped.length).toBeGreaterThan(n);
  });

  it("端点响应就是目录本身(没有第二份手工目录)", async () => {
    const res = await listTools();
    expect(res.tools).toEqual(toolCatalog());
  });
});
