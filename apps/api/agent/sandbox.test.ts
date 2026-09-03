// R7 沙箱与配额测试:第 1 层(工具白名单)/ 第 2 层(agent_ro 只读)/ 第 4 层(限额)。
// 经 `dev.ps1 test`(encore test)运行,CLAUDE.md 规则 2。
//
// 这里的用例不是"覆盖率",是**验收项本身**:ROUNDS.md R7 的
// 「以 agent_ro 连接尝试写库必须失败」与「超限路径有明确拒绝行为」两条,
// 就是下面 `第 2 层` 与 `第 4 层` 两个 describe。
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { encryptSecret } from "../shared/crypto";
import { db } from "./db";
import { queryAsAgentRo } from "./ro-db";
import { checkQuota, recordUsage, reserveSkillRun } from "./quota";
import { configEncryptionKey } from "./secrets";
import {
  buildSessionTools,
  GENERATE_IMAGE_TOOL,
  loadEnabledTools,
  snippetAround,
  capText,
  SESSION_RENAME_TOOL,
  SESSION_TOOL_REGISTRY,
  TOOL_REGISTRY,
  WEB_SEARCH_TOOL_NAME,
} from "./tools";
import { appendMessage, createSession } from "./store";

/** 迁移 006 种下的三行启停配置;本文件会清空 tool_config,跑完复原。 */
const SEED_TOOLS = ["notes_list_series", "notes_get_chapter", "notes_search"];
/** 迁移 009 种下的会话绑定工具。**复原时不能漏**:漏了等于把默认开启的命名工具关掉。 */
const SEED_SESSION_TOOLS = [SESSION_RENAME_TOOL];

/**
 * 复原迁移 006/008/009 的种子(三个只读工具 = 开,`web_search` = 关,`session_rename` = 开)。
 * 不复原的话,本文件跑完会让本地开发库少掉那几行 —— 表现是「跑过一次测试之后
 * 本机 agent 就没有工具了」,而没有任何东西会报错。
 */
async function restoreToolSeeds() {
  await db.exec`DELETE FROM tool_config`;
  for (const name of SEED_TOOLS) {
    await db.rawExec(
      `INSERT INTO tool_config (name, enabled, dangerous, note) VALUES ($1, TRUE, FALSE, 'R7 只读工具组')
       ON CONFLICT (name) DO NOTHING`,
      name,
    );
  }
  await db.rawExec(
    `INSERT INTO tool_config (name, enabled, dangerous, note)
     VALUES ('web_search', FALSE, FALSE, 'R-WEBSEARCH 外呼工具')
     ON CONFLICT (name) DO NOTHING`,
  );
  // 迁移 010 的种子(R-IMAGEGEN),同样默认关
  await db.rawExec(
    `INSERT INTO tool_config (name, enabled, dangerous, note)
     VALUES ('generate_image', FALSE, FALSE, 'R-IMAGEGEN 外呼工具')
     ON CONFLICT (name) DO NOTHING`,
  );
  for (const name of SEED_SESSION_TOOLS) {
    await db.rawExec(
      `INSERT INTO tool_config (name, enabled, dangerous, note) VALUES ($1, TRUE, FALSE, 'R-TITLE 会话绑定工具')
       ON CONFLICT (name) DO NOTHING`,
      name,
    );
  }
  // 迁移 013 的种子(R-SKILLS-2):两个都默认关;skill_run 是唯一的 dangerous 行
  await db.rawExec(
    `INSERT INTO tool_config (name, enabled, dangerous, note) VALUES
       ('skill_load', FALSE, FALSE, 'R-SKILLS-2 纯函数组'),
       ('skill_run',  FALSE, TRUE,  'R-SKILLS-2 沙箱执行组')
     ON CONFLICT (name) DO NOTHING`,
  );
}

async function seedNotes() {
  await db.exec`DELETE FROM notes_chapters`;
  await db.exec`DELETE FROM notes_series`;
  await db.exec`DELETE FROM notes_categories`;
  await db.exec`INSERT INTO notes_categories (slug, name, dot, sort_order)
                VALUES ('agent', 'Agent', '#2563eb', 1)`;
  await db.exec`INSERT INTO notes_series (slug, category_slug, name, description, sort_order)
                VALUES ('pi', 'agent', 'pi 内核', '拆解 pi 的 agent loop', 1)`;
  await db.exec`
    INSERT INTO notes_chapters
      (series_slug, slug, ordinal, label, pinned, title, summary, content_md, word_count,
       source_url, content_hash, published_at, updated_at)
    VALUES ('pi', 'loop', 1, '01', FALSE, 'agent loop 是什么', '一句话摘要',
            ${"开头一段。这里出现关键词 扩展事件 然后继续写正文。"}, 100,
            NULL, 'h1', NULL, now())`;
}

describe("第 1 层 · 工具白名单", () => {
  beforeEach(async () => {
    await db.exec`DELETE FROM tool_config`;
  });

  afterAll(restoreToolSeeds);

  it("两张注册表里只有三个只读工具 + 一个会话绑定工具,执行类工具根本不存在", () => {
    expect(Object.keys(TOOL_REGISTRY).sort()).toEqual([...SEED_TOOLS].sort());
    expect(Object.keys(SESSION_TOOL_REGISTRY)).toEqual(SEED_SESSION_TOOLS);
    // CLAUDE.md 规则 9 的物理落点:这些名字不是"被关掉",是没有实现 —— 两张表都不能有
    for (const forbidden of ["bash", "write", "edit", "read", "powershell", "exec"]) {
      expect(TOOL_REGISTRY[forbidden]).toBeUndefined();
      expect(SESSION_TOOL_REGISTRY[forbidden]).toBeUndefined();
    }
  });

  it("tool_config 里的未知名字被丢弃,不会凭名字长出工具", async () => {
    await db.rawExec(`INSERT INTO tool_config (name, enabled, dangerous) VALUES ('bash', TRUE, FALSE)`);
    await db.rawExec(
      `INSERT INTO tool_config (name, enabled, dangerous) VALUES ('notes_search', TRUE, FALSE)`,
    );
    const enabled = await loadEnabledTools();
    expect(enabled.names).toEqual(["notes_search"]);
    expect(enabled.definitions).toHaveLength(1);
  });

  it("原型链上的键不算「已实现」(constructor / toString)", async () => {
    // tool_config_set 的 snake_case 校验放行 'constructor',而 `in` 会命中 Object.prototype
    for (const name of ["constructor", "tostring", "valueof"]) {
      await db.rawExec(`INSERT INTO tool_config (name, enabled, dangerous) VALUES ($1, TRUE, FALSE)`, name);
    }
    const enabled = await loadEnabledTools();
    expect(enabled.names).toEqual([]);
    expect(enabled.definitions).toEqual([]);
  });

  it("enabled=false 的行不注册", async () => {
    await db.rawExec(
      `INSERT INTO tool_config (name, enabled, dangerous) VALUES ('notes_search', FALSE, FALSE)`,
    );
    expect((await loadEnabledTools()).names).toEqual([]);
  });

  it("dangerous 行需要 env 双闸:缺 env 时即使表里为 true 也不注册", async () => {
    await db.rawExec(
      `INSERT INTO tool_config (name, enabled, dangerous) VALUES ('notes_search', TRUE, TRUE)`,
    );
    const before = process.env.XRAY_UNLOCK_DANGEROUS_TOOLS;
    delete process.env.XRAY_UNLOCK_DANGEROUS_TOOLS;
    try {
      expect((await loadEnabledTools()).names).toEqual([]);
      process.env.XRAY_UNLOCK_DANGEROUS_TOOLS = "1";
      expect((await loadEnabledTools()).names).toEqual(["notes_search"]);
    } finally {
      if (before === undefined) delete process.env.XRAY_UNLOCK_DANGEROUS_TOOLS;
      else process.env.XRAY_UNLOCK_DANGEROUS_TOOLS = before;
    }
  });

  it("指纹随集合变化,用于触发会话重建", async () => {
    await db.rawExec(
      `INSERT INTO tool_config (name, enabled, dangerous) VALUES ('notes_search', TRUE, FALSE)`,
    );
    const a = await loadEnabledTools();
    await db.rawExec(
      `INSERT INTO tool_config (name, enabled, dangerous) VALUES ('notes_get_chapter', TRUE, FALSE)`,
    );
    const b = await loadEnabledTools();
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });
});

describe("第 1 层 · 外呼组 web_search 的注册闸(R-WEBSEARCH)", () => {
  async function enableWebSearch() {
    await db.exec`DELETE FROM tool_config`;
    await db.rawExec(
      `INSERT INTO tool_config (name, enabled, dangerous) VALUES ('web_search', TRUE, FALSE)`,
    );
  }

  async function configureProvider(over: { baseUrl?: string; modelId?: string } = {}) {
    await db.exec`DELETE FROM websearch_config`;
    await db.rawExec(
      `INSERT INTO websearch_config
         (provider, base_url, api_key_enc, api_key_hint, model_id, is_default)
       VALUES ('deepseek', $1, $2, 'sk-…test', $3, TRUE)`,
      over.baseUrl ?? "https://api.deepseek.com",
      encryptSecret(configEncryptionKey(), "sk-fake-key-for-tests-0001"),
      over.modelId ?? "deepseek-v4-flash",
    );
  }

  beforeEach(async () => {
    await db.exec`DELETE FROM websearch_config`;
  });

  afterAll(async () => {
    await db.exec`DELETE FROM websearch_config`;
    await restoreToolSeeds();
  });

  it("开着开关但没配 provider → 丢弃,不注册一个必然失败的工具", async () => {
    await enableWebSearch();
    const enabled = await loadEnabledTools();
    expect(enabled.names).toEqual([]);
    expect(enabled.definitions).toEqual([]);
  });

  it("配好 provider 之后才注册,且工具形状对得上", async () => {
    await enableWebSearch();
    await configureProvider();
    const enabled = await loadEnabledTools();
    expect(enabled.names).toEqual([WEB_SEARCH_TOOL_NAME]);
    const [def] = enabled.definitions;
    expect(def.name).toBe(WEB_SEARCH_TOOL_NAME);
    // 【访客控不到网络原语】参数面只有一个 query,additionalProperties 关死:
    // 任何形如 url / host / headers 的入参都进不来(docs/security.md §1 外呼组约束 1)
    const params = def.parameters as unknown as {
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties: boolean;
    };
    expect(Object.keys(params.properties)).toEqual(["query"]);
    expect(params.required).toEqual(["query"]);
    expect(params.additionalProperties).toBe(false);
  });

  it("配好 provider 但开关是关的 → 不注册(两道闸都要过)", async () => {
    await db.exec`DELETE FROM tool_config`;
    await db.rawExec(
      `INSERT INTO tool_config (name, enabled, dangerous) VALUES ('web_search', FALSE, FALSE)`,
    );
    await configureProvider();
    expect((await loadEnabledTools()).names).toEqual([]);
  });

  it("**改 websearch 配置会改变指纹**(否则「改了不生效」:端点被闭包定格在旧会话里)", async () => {
    await enableWebSearch();
    await configureProvider();
    const a = await loadEnabledTools();
    await configureProvider({ modelId: "deepseek-v4-pro" });
    const b = await loadEnabledTools();
    expect(a.names).toEqual(b.names); // 名字一模一样
    expect(a.fingerprint).not.toBe(b.fingerprint); // 但配置变了,会话要重建
  });

  it("密文解不开时只丢这一个工具,不影响其余工具", async () => {
    await db.exec`DELETE FROM tool_config`;
    for (const name of ["web_search", "notes_search"]) {
      await db.rawExec(
        `INSERT INTO tool_config (name, enabled, dangerous) VALUES ($1, TRUE, FALSE)`,
        name,
      );
    }
    await db.exec`DELETE FROM websearch_config`;
    // 用另一把密钥加密 = 运行期解不开(等价于 ConfigEncryptionKey 被换过)
    await db.rawExec(
      `INSERT INTO websearch_config
         (provider, base_url, api_key_enc, api_key_hint, model_id, is_default)
       VALUES ('broken', 'https://api.deepseek.com', $1, 'sk-…brok', 'm', TRUE)`,
      encryptSecret(Buffer.alloc(32, 3).toString("base64"), "sk-unreadable"),
    );
    const enabled = await loadEnabledTools();
    expect(enabled.names).toEqual(["notes_search"]);
  });
});

describe("第 1 层 · 外呼组 generate_image 的注册闸(R-IMAGEGEN)", () => {
  async function enableImageGen() {
    await db.exec`DELETE FROM tool_config`;
    await db.rawExec(
      `INSERT INTO tool_config (name, enabled, dangerous) VALUES ('generate_image', TRUE, FALSE)`,
    );
  }

  async function configureProvider(over: { modelId?: string; apiStyle?: string } = {}) {
    await db.exec`DELETE FROM imagegen_config`;
    await db.rawExec(
      `INSERT INTO imagegen_config
         (provider, base_url, api_key_enc, api_key_hint, model_id, api_style, is_default)
       VALUES ('openai', 'https://api.openai.com/v1', $1, 'sk-…test', $2, $3, TRUE)`,
      encryptSecret(configEncryptionKey(), "sk-fake-key-for-tests-0002"),
      over.modelId ?? "gpt-image-2",
      over.apiStyle ?? "images",
    );
  }

  beforeEach(async () => {
    await db.exec`DELETE FROM imagegen_config`;
  });

  afterAll(async () => {
    await db.exec`DELETE FROM imagegen_config`;
    await restoreToolSeeds();
  });

  it("开着开关但没配 provider → 丢弃,不注册一个必然失败的工具", async () => {
    await enableImageGen();
    const enabled = await loadEnabledTools();
    expect(enabled.names).toEqual([]);
    expect(enabled.sessionScoped).toEqual([]);
    expect(enabled.imageGen).toBeNull();
  });

  it("配好 provider 之后才注册:名字进 sessionScoped(要绑会话),实现由 buildSessionTools 现构造", async () => {
    await enableImageGen();
    await configureProvider();
    const enabled = await loadEnabledTools();
    expect(enabled.names).toEqual([GENERATE_IMAGE_TOOL]);
    expect(enabled.definitions).toEqual([]); // 不是无状态工具
    expect(enabled.sessionScoped).toEqual([GENERATE_IMAGE_TOOL]);
    expect(enabled.imageGen?.modelId).toBe("gpt-image-2");
    const built = buildSessionTools(enabled, { sessionId: "11111111-2222-4333-8444-555555555555", needsTitle: false });
    expect(built.names).toEqual([GENERATE_IMAGE_TOOL]);
    expect(built.definitions[0].name).toBe(GENERATE_IMAGE_TOOL);
    // 明文 key 只活在闭包里:定义对象上找不到它
    expect(JSON.stringify(built.definitions[0])).not.toContain("sk-fake-key-for-tests-0002");
  });

  it("配好 provider 但开关是关的 → 不注册(两道闸都要过)", async () => {
    await db.exec`DELETE FROM tool_config`;
    await db.rawExec(
      `INSERT INTO tool_config (name, enabled, dangerous) VALUES ('generate_image', FALSE, FALSE)`,
    );
    await configureProvider();
    expect((await loadEnabledTools()).names).toEqual([]);
  });

  it("**改 imagegen 配置会改变指纹**(端点 / 协议形态被闭包定格在旧会话里)", async () => {
    await enableImageGen();
    await configureProvider();
    const a = await loadEnabledTools();
    await configureProvider({ apiStyle: "chat" });
    const b = await loadEnabledTools();
    expect(a.names).toEqual(b.names);
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  it("密文解不开时只丢这一个工具,不影响其余工具", async () => {
    await db.exec`DELETE FROM tool_config`;
    for (const name of ["generate_image", "notes_search"]) {
      await db.rawExec(`INSERT INTO tool_config (name, enabled, dangerous) VALUES ($1, TRUE, FALSE)`, name);
    }
    await db.rawExec(
      `INSERT INTO imagegen_config
         (provider, base_url, api_key_enc, api_key_hint, model_id, is_default)
       VALUES ('broken', 'https://api.openai.com/v1', $1, 'sk-…brok', 'm', TRUE)`,
      encryptSecret(Buffer.alloc(32, 3).toString("base64"), "sk-unreadable"),
    );
    expect((await loadEnabledTools()).names).toEqual(["notes_search"]);
  });
});

describe("第 1 层 · 沙箱执行组 skill_load / skill_run 的注册闸(R-SKILLS-2)", () => {
  const RUNNER_ENV = "XRAY_SKILL_RUNNER_URL";
  const UNLOCK_ENV = "XRAY_UNLOCK_DANGEROUS_TOOLS";
  const saved: Record<string, string | undefined> = {};

  /** 把某个代码副本(runner/skills/<name>/ 的全部文件)种进库并按需打开(与所有者经 MCP 上传 + skills_agent_set 的效果相同) */
  async function seedCodeSkill(name: string, enabled = true) {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join, relative, resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "runner", "skills", name);
    const walk = (d: string, base = d): string[] =>
      readdirSync(d).flatMap((n) => {
        const f = join(d, n);
        return statSync(f).isDirectory() ? walk(f, base) : [relative(base, f).split("\\").join("/")];
      });
    await db.rawExec(
      `INSERT INTO skills (name, category_slug, summary, source_type, repo, sort_order, zip, zip_size, content_hash, agent_enabled)
       VALUES ($1, 'framework', '', 'own', 'ClickPM/agent-skills', 0, decode('', 'hex'), 0, 'h', $2)`,
      name,
      enabled,
    );
    for (const p of walk(dir)) {
      const content = readFileSync(join(dir, p), "utf8");
      await db.rawExec(
        `INSERT INTO skill_files (skill_name, path, kind, content, size_bytes, line_count, sort_order)
         VALUES ($1, $2, 'text', $3, $4, 1, 0)`,
        name,
        p,
        content,
        Buffer.byteLength(content, "utf8"),
      );
    }
  }
  const seedTextTools = (enabled = true) => seedCodeSkill("text-tools", enabled);

  async function enable(names: string[], dangerousRun = true) {
    await db.exec`DELETE FROM tool_config`;
    for (const name of names) {
      await db.rawExec(`INSERT INTO tool_config (name, enabled, dangerous) VALUES ($1, TRUE, $2)`, name, name === "skill_run" && dangerousRun);
    }
  }

  beforeEach(async () => {
    for (const k of [RUNNER_ENV, UNLOCK_ENV]) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    await db.exec`DELETE FROM skill_files`;
    await db.exec`DELETE FROM skills`;
  });

  afterAll(async () => {
    for (const k of [RUNNER_ENV, UNLOCK_ENV]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await db.exec`DELETE FROM skill_files`;
    await db.exec`DELETE FROM skills`;
    await restoreToolSeeds();
  });

  it("skill_load 开着但没有对 agent 开放的 skill → 不注册(不给模型一个必然失败的工具)", async () => {
    await enable(["skill_load"]);
    const enabled = await loadEnabledTools();
    expect(enabled.names).toEqual([]);
    expect(enabled.skills.skills).toEqual([]);
  });

  it("skill_load:库里有一致副本且打开 → 注册;可用集合进 EnabledTools.skills;关掉 skill 后指纹变、工具消失", async () => {
    await enable(["skill_load"]);
    await seedTextTools(true);
    const a = await loadEnabledTools();
    expect(a.names).toEqual(["skill_load"]);
    expect(a.skills.skills.map((s) => s.name)).toEqual(["text-tools"]);
    expect(a.definitions[0].name).toBe("skill_load");
    await db.rawExec(`UPDATE skills SET agent_enabled = FALSE WHERE name = 'text-tools'`);
    const b = await loadEnabledTools();
    expect(b.names).toEqual([]);
    expect(b.fingerprint).not.toBe(a.fingerprint);
  });

  it("skill_run 的高危身份在代码里:经 MCP 把表里那一行改成 dangerous=false,缺 env 仍不注册(codex 第 2 轮 P1)", async () => {
    await enable(["skill_run"], false); // 表里 dangerous=false
    await seedTextTools(true);
    expect((await loadEnabledTools()).names).toEqual([]);
    process.env[UNLOCK_ENV] = "1";
    expect((await loadEnabledTools()).names).toEqual(["skill_run"]);
    // 反过来:表里把别的工具标成 dangerous 是能把它**加**进闸里的(R7 既有语义不变)
    delete process.env[UNLOCK_ENV];
    await db.exec`DELETE FROM tool_config`;
    await db.rawExec(`INSERT INTO tool_config (name, enabled, dangerous) VALUES ('notes_search', TRUE, TRUE)`);
    expect((await loadEnabledTools()).names).toEqual([]);
  });

  it("skill_run 是 dangerous 行:缺 env 双闸 → 不注册;有 env 但 runner 地址不合法 → 不注册;合法 → 注册(沙箱执行组)", async () => {
    await enable(["skill_run"]);
    await seedTextTools(true);
    expect((await loadEnabledTools()).names).toEqual([]); // 缺 XRAY_UNLOCK_DANGEROUS_TOOLS
    process.env[UNLOCK_ENV] = "1";
    process.env[RUNNER_ENV] = "http://runner:8000"; // 闭集之外
    expect((await loadEnabledTools()).names).toEqual([]);
    process.env[RUNNER_ENV] = "http://127.0.0.1:8000";
    const ok = await loadEnabledTools();
    expect(ok.names).toEqual(["skill_run"]);
    expect(ok.definitions[0].name).toBe("skill_run");
    // 明文里找不到运行器地址 / 超时 / 限额(它们只活在闭包里)
    expect(JSON.stringify(ok.definitions[0])).not.toContain("127.0.0.1");
    delete process.env[RUNNER_ENV]; // 缺省 = unix 默认值,同样合法
    expect((await loadEnabledTools()).names).toEqual(["skill_run"]);
  });

  it("skill_run:可用集合里没有可运行型(只有注入型)→ 不注册", async () => {
    await enable(["skill_run"]);
    process.env[UNLOCK_ENV] = "1";
    // 只种 encore-api(注入型,无脚本;整包 = SKILL.md + 上游 LICENSE)
    await seedCodeSkill("encore-api", true);
    const enabled = await loadEnabledTools();
    expect(enabled.skills.skills.map((s) => s.name)).toEqual(["encore-api"]);
    expect(enabled.names).toEqual([]);
  });

  it("展示副本漂移 → 不注入,且不影响其它工具", async () => {
    await enable(["skill_load", "notes_search"]);
    await seedTextTools(true);
    await db.rawExec(`UPDATE skill_files SET content = content || ' ' WHERE skill_name = 'text-tools' AND path = 'SKILL.md'`);
    const enabled = await loadEnabledTools();
    expect(enabled.names).toEqual(["notes_search"]);
    expect(enabled.skills.dropped.some((d) => d.includes("drift"))).toBe(true);
  });

  it("改 sandbox_config 会改变指纹(两个上限被闭包定格在旧会话里)", async () => {
    await enable(["skill_run"]);
    await seedTextTools(true);
    process.env[UNLOCK_ENV] = "1";
    const a = await loadEnabledTools();
    await db.rawExec(`UPDATE sandbox_config SET total_timeout_ms = 45000 WHERE id = 1`);
    try {
      const b = await loadEnabledTools();
      expect(a.names).toEqual(b.names);
      expect(a.fingerprint).not.toBe(b.fingerprint);
    } finally {
      await db.rawExec(`UPDATE sandbox_config SET total_timeout_ms = 30000 WHERE id = 1`);
    }
  });
});

describe("第 4 层 · 每日运行次数闸 reserveSkillRun(R-SKILLS-2,验收 ⑪)", () => {
  beforeEach(async () => {
    await db.exec`DELETE FROM daily_quota`;
  });
  afterAll(async () => {
    await db.exec`DELETE FROM daily_quota`;
  });

  it("原子:上限 5、并发 20 次只放行 5 次", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => reserveSkillRun(5)));
    expect(results.filter(Boolean)).toHaveLength(5);
    const row = await db.rawQueryRow<{ n: number }>(`SELECT skill_runs::double precision AS n FROM daily_quota`);
    expect(row?.n).toBe(5);
  });

  it("0 = 不限;与 searches / images 各计各的", async () => {
    for (let i = 0; i < 7; i++) expect(await reserveSkillRun(0)).toBe(true);
    const row = await db.rawQueryRow<{ runs: number; searches: number; images: number }>(
      `SELECT skill_runs::double precision AS runs, searches::double precision AS searches, images::double precision AS images FROM daily_quota`,
    );
    expect(row).toEqual({ runs: 7, searches: 0, images: 0 });
  });
});

describe("第 2 层 · agent_ro 只读(ROUNDS.md R7 验收:写库必须失败)", () => {
  beforeEach(seedNotes);

  it("降权之后 current_user 就是 agent_ro", async () => {
    const who = await queryAsAgentRo((tx) =>
      tx.rawQueryRow<{ u: string }>(`SELECT current_user AS u`),
    );
    expect(who?.u).toBe("agent_ro");
  });

  it("能读 notes 三张表", async () => {
    const rows = await queryAsAgentRo((tx) =>
      tx.rawQueryAll<{ n: number }>(
        `SELECT (SELECT COUNT(*) FROM notes_categories)
              + (SELECT COUNT(*) FROM notes_series)
              + (SELECT COUNT(*) FROM notes_chapters) AS n`,
      ),
    );
    expect(Number(rows[0].n)).toBe(3);
  });

  it("写 notes 表被拒(权限,不是事务只读标志)", async () => {
    // 【为什么要单独开一个不带 READ ONLY 的事务】`queryAsAgentRo` 里同时立了两道闸,
    // 直接用它测,拒绝可能来自 "cannot execute UPDATE in a read-only transaction",
    // 而验收项要证明的是**角色权限**那道。这里只 SET ROLE,不设 READ ONLY。
    const tx = await db.begin();
    let message = "";
    try {
      await tx.rawExec("SET LOCAL ROLE agent_ro");
      await tx.rawExec(`UPDATE notes_chapters SET title = 'hacked'`);
      message = "NO ERROR";
    } catch (err) {
      message = String(err);
    } finally {
      await tx.rollback().catch(() => {});
    }
    expect(message).toMatch(/permission denied/i);
  });

  it("建表 / 删表同样被拒", async () => {
    const tx = await db.begin();
    let message = "";
    try {
      await tx.rawExec("SET LOCAL ROLE agent_ro");
      await tx.rawExec(`CREATE TABLE agent_ro_should_not_exist (x int)`);
      message = "NO ERROR";
    } catch (err) {
      message = String(err);
    } finally {
      await tx.rollback().catch(() => {});
    }
    expect(message).toMatch(/permission denied|must be owner/i);
  });

  it("配置面与配额面对 agent_ro 不可见", async () => {
    // 与 docs/security.md §1 第 2 层逐表列举的清单一致。`visits` 是 R8 建的
    // 访客统计表(合并 main 时补入):它同样属于「管理/数据面写、agent 永不可见」那一侧
    const denied = [
      "llm_config",
      "tool_config",
      "about_content",
      "notes_assets",
      "mcp_audit",
      "daily_quota",
      "visits",
      // R-SKILLS(所有者裁定 2026-09-03):本轮 agent 不读 skills,三张表不授权任何 agent 角色
      // (docs/security.md §1 第 2 层 R-SKILLS 补记;迁移 012 不写 GRANT 就是全部答案)
      "skills_categories",
      "skills",
      "skill_files",
      // R-SKILLS-2:沙箱配置面同样不授权任何 agent 角色(迁移 013 不写 GRANT 就是全部答案);
      // skills.agent_enabled 在 skills 表上,上面那一行已经盖住
      "sandbox_config",
    ];
    for (const table of denied) {
      const tx = await db.begin();
      let message = "";
      try {
        await tx.rawExec("SET LOCAL ROLE agent_ro");
        await tx.rawExec(`SELECT * FROM ${table} LIMIT 1`);
        message = "NO ERROR";
      } catch (err) {
        message = String(err);
      } finally {
        await tx.rollback().catch(() => {});
      }
      expect(`${table}: ${message}`).toMatch(/permission denied/i);
    }
  });

  it("SET LOCAL 随事务结束复位,不把降权泄漏给后续请求", async () => {
    await queryAsAgentRo((tx) => tx.rawQueryRow(`SELECT 1`));
    // 连接归还池子后再写:降权若泄漏,这里会 permission denied
    for (let i = 0; i < 5; i++) {
      await db.rawExec(`UPDATE notes_chapters SET summary = $1`, `ok-${i}`);
    }
    const row = await db.rawQueryRow<{ summary: string }>(`SELECT summary FROM notes_chapters LIMIT 1`);
    expect(row?.summary).toBe("ok-4");
  });
});

describe("只读工具的行为", () => {
  beforeEach(seedNotes);

  const call = async (name: string, args: unknown) => {
    const out = await TOOL_REGISTRY[name].execute("t1", args as never, undefined, undefined, {} as never);
    return out.content.map((c) => ("text" in c ? c.text : "")).join("");
  };

  it("notes_list_series 列系列,给 series 时列章节", async () => {
    expect(await call("notes_list_series", {})).toContain("pi 内核");
    const chapters = await call("notes_list_series", { series: "pi" });
    expect(chapters).toContain("loop");
    expect(await call("notes_list_series", { series: "nope" })).toContain("不存在");
  });

  it("系列的章节数与公开 API 同口径:置顶 README 不算一章", async () => {
    await db.rawExec(
      `INSERT INTO notes_chapters
         (series_slug, slug, ordinal, label, pinned, title, summary, content_md, word_count,
          source_url, content_hash, published_at, updated_at)
       VALUES ('pi','readme',0,'README',TRUE,'总览','','x',10,NULL,'h-readme',NULL,now())`,
    );
    // 不 import notes/store 来做对比:跨服务 import 会把 Encore 的服务归属搞乱。
    // 口径在 notes/store.ts 的 listSeriesCards / getSeries 里,
    // 都是 `COUNT(...) FILTER (WHERE NOT pinned)` —— 两章里只有一章不是置顶。
    const parsed = JSON.parse(await call("notes_list_series", {})) as {
      series: { slug: string; chapterCount: number }[];
    };
    expect(parsed.series[0].chapterCount).toBe(1);
  });

  it("只在摘要里命中时,片段取的是摘要而不是正文开头", async () => {
    await db.rawExec(
      `INSERT INTO notes_chapters
         (series_slug, slug, ordinal, label, pinned, title, summary, content_md, word_count,
          source_url, content_hash, published_at, updated_at)
       VALUES ('pi','only-summary',5,'05',FALSE,'另一章',$1,$2,10,NULL,'h-os',NULL,now())`,
      "这一章讲的是 独门关键词 的用法",
      "正文里完全没有那个词,只有一堆别的内容。",
    );
    const text = await call("notes_search", { query: "独门关键词" });
    const parsed = JSON.parse(text) as { hits: { chapter: string; snippet: string }[] };
    const hit = parsed.hits.find((h) => h.chapter === "only-summary");
    expect(hit).toBeDefined();
    expect(hit!.snippet).toContain("独门关键词");
  });

  it("notes_get_chapter 返回正文,找不到时给出可行动的提示", async () => {
    expect(await call("notes_get_chapter", { series: "pi", chapter: "loop" })).toContain("扩展事件");
    expect(await call("notes_get_chapter", { series: "pi", chapter: "x" })).toContain("notes_list_series");
  });

  it("notes_search 子串命中,通配符不是通配符", async () => {
    expect(await call("notes_search", { query: "扩展事件" })).toContain("loop");
    // strpos 是纯子串:'%' 不该命中任何东西(若用 ILIKE 未转义,这里会全表命中)
    expect(await call("notes_search", { query: "%" })).toContain("没有匹配");
  });

  it("列表结果先裁条数再序列化,产出的仍是合法 JSON", async () => {
    // 造一批超过 8000 字符预算的章节,确认结果能 JSON.parse 且带 omitted
    for (let i = 0; i < 40; i++) {
      await db.rawExec(
        `INSERT INTO notes_chapters
           (series_slug, slug, ordinal, label, pinned, title, summary, content_md, word_count,
            source_url, content_hash, published_at, updated_at)
         VALUES ('pi', $1, $2, $3, FALSE, $4, '', 'x', 10, NULL, $1, NULL, now())`,
        `ch-${i}`,
        i + 10,
        `c${i}`,
        `标题-${i}-${"长".repeat(200)}`,
      );
    }
    const text = await call("notes_list_series", { series: "pi" });
    expect(text.length).toBeLessThanOrEqual(8_000);
    const parsed = JSON.parse(text) as { chapters: unknown[]; omitted?: number };
    expect(Array.isArray(parsed.chapters)).toBe(true);
    expect(parsed.omitted).toBeGreaterThan(0);
  });

  it("查询失败走 pi 的错误路径,且只出固定文案", async () => {
    // 传一个 Postgres 绑不上的参数,把 execute 内部打失败。
    // 断言两件事:①抛出(pi 据此置 isError:true,轨迹面板才不会把失败画成成功)
    //           ②消息是固定文案,不含上游细节
    const boom = TOOL_REGISTRY.notes_get_chapter.execute(
      "t1",
      { series: { nope: true }, chapter: "loop" } as never,
      undefined,
      undefined,
      {} as never,
    );
    await expect(boom).rejects.toThrow("查询失败,请稍后再试或换个问法。");
    await expect(boom).rejects.not.toThrow(/notes_chapters|postgres|select/i);
  });

  it("结果有界:超长正文被截断并标注", () => {
    const long = "x".repeat(20_000);
    const capped = capText(long);
    expect(capped.length).toBeLessThan(long.length);
    expect(capped).toContain("已截断");
  });

  it("片段取命中位置附近", () => {
    const text = `${"a".repeat(400)}关键词${"b".repeat(400)}`;
    const snippet = snippetAround(text, text.indexOf("关键词") + 1, 40);
    expect(snippet).toContain("关键词");
    expect(snippet.length).toBeLessThan(60);
  });
});

describe("第 4 层 · 每日限额与单会话轮数(ROUNDS.md R7 验收:超限有明确拒绝)", () => {
  beforeEach(async () => {
    await db.exec`DELETE FROM daily_quota`;
    await db.exec`DELETE FROM llm_config`;
  });

  afterAll(async () => {
    await db.exec`DELETE FROM daily_quota`;
    await db.exec`DELETE FROM llm_config`;
  });

  /** 写一行默认 provider,只为带上限额值;密文内容与本组用例无关。 */
  async function seedLimits(opts: { tokens?: number; cents?: number; turns?: number }) {
    await db.rawExec(
      `INSERT INTO llm_config (provider, api_key_enc, api_key_hint, model_id, is_default,
                               daily_token_limit, daily_cost_limit_cents, max_turns_per_session)
       VALUES ('test', decode('00', 'hex'), 'sk-…test', 'm1', TRUE, $1, $2, $3)`,
      opts.tokens ?? 0,
      opts.cents ?? 0,
      opts.turns ?? 0,
    );
  }

  /** 全新会话:一个库里还没有行的 uuid,与 ask.ts 的 `randomUUID()` 同形 */
  const FRESH = "00000000-0000-4000-8000-000000000001";

  it("没有默认 provider 时不拦(由 503「未配置模型」去说话)", async () => {
    expect(await checkQuota(FRESH)).toBeNull();
  });

  it("限额为 0 = 不限", async () => {
    await seedLimits({});
    await recordUsage(999_999, 999_999_999);
    expect(await checkQuota(FRESH)).toBeNull();
  });

  it("超过每日 token 限额后拒绝新会话", async () => {
    await seedLimits({ tokens: 100 });
    expect(await checkQuota(FRESH)).toBeNull();
    await recordUsage(60, 0);
    expect(await checkQuota(FRESH)).toBeNull();
    await recordUsage(60, 0); // 累计 120 ≥ 100
    expect((await checkQuota(FRESH))?.reason).toBe("daily_tokens");
  });

  it("超过每日费用限额后拒绝新会话(cents ↔ micros 换算)", async () => {
    await seedLimits({ cents: 2 }); // 2 分 = 20000 micros
    await recordUsage(0, 19_999);
    expect(await checkQuota(FRESH)).toBeNull();
    await recordUsage(0, 1);
    expect((await checkQuota(FRESH))?.reason).toBe("daily_cost");
  });

  it("预建的空会话不能绕过每日限额(codex 初审 P1)", async () => {
    // POST /agent/sessions 是公开端点:先批量建空会话、再逐个带 id 提问,
    // 按「带了 id 就算续接」判定的话每日限额会被整体绕过
    await seedLimits({ tokens: 10 });
    await recordUsage(50, 0);
    const empty = await createSession(null);
    expect((await checkQuota(empty.id))?.reason).toBe("daily_tokens");
  });

  it("每日超限只拦新对话,已开始的会话靠 turn 上限兜住", async () => {
    await seedLimits({ tokens: 10, turns: 3 });
    await recordUsage(50, 0);
    const s = await createSession(null);
    await appendMessage(s.id, "user", "第一轮");
    // 已经开始的会话:每日额度已超,但仍放行(docs/security.md §1 第 4 层的原文口径)
    expect(await checkQuota(s.id)).toBeNull();
    await appendMessage(s.id, "user", "第二轮");
    await appendMessage(s.id, "user", "第三轮");
    expect((await checkQuota(s.id))?.reason).toBe("turn_limit");
  });

  it("recordUsage 按日累加,turns 同步计数", async () => {
    await seedLimits({});
    await recordUsage(10, 100);
    await recordUsage(5, 50);
    const row = await db.rawQueryRow<{ tokens: number; costMicros: number; turns: number }>(
      `SELECT tokens::double precision AS tokens,
              cost_micros::double precision AS "costMicros",
              turns::double precision AS turns
         FROM daily_quota`,
    );
    expect(row).toEqual({ tokens: 15, costMicros: 150, turns: 2 });
  });
});
