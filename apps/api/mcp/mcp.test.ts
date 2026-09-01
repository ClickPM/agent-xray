// R6 mcp 服务测试。经 `dev.ps1 test` 运行(CLAUDE.md 规则 2)。
//
// 覆盖面按「错了会静默」排序:
//   - 凭据加解密与掩码 —— 错了会把明文 key 送出服务端(docs/security.md §3)
//   - bearer 校验 —— 错了管理面就是裸奔的
//   - 附件的 base64 / 魔数校验 —— 错了会在同源下存一份可执行文档
//   - 章节 upsert 的幂等 —— 错了 RSS 每次重发都假装有更新
//   - provider 部分更新 —— 错了改个 baseUrl 会把限额清零
//   - About 部分更新 —— 错了改一句 intro 会静默清空七张仓库卡(R8)
//   - 访问统计聚合 —— 错了统计数字与打点对不上,而没有任何东西会报错(R8)
import { beforeEach, describe, expect, it } from "vitest";
import * as z from "zod";
import { siteDay, siteDayAgo } from "../shared/site-time";
import {
  DecryptError,
  EncryptionKeyError,
  decryptSecret,
  encryptSecret,
  maskSecret,
  parseEncryptionKey,
  timingSafeEqualHex,
} from "../shared/crypto";
import { allowedHosts, checkBaseUrl } from "../shared/websearch-hosts";
import { parseBearer, sha256Hex, verifyAuth } from "./auth";
import { chapterHash, countWords } from "./content";
import { db } from "./db";
import * as store from "./store";
import { decodeBase64Strict, isHttpUrl, magicMatches, registerTools } from "./tools";

const KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 9).toString("base64");

/** 1x1 webp,用于魔数正例(与 t4 冒烟同一份)。 */
const WEBP = Buffer.from("UklGRiYAAABXRUJQVlA4IBoAAAAwAQCdASoBAAEAAgA0JaQAA3AA/vuUAAA=", "base64");

describe("配置密文(shared/crypto)", () => {
  it("往返", () => {
    const plain = "sk-abcdefghijklmnop";
    expect(decryptSecret(KEY, encryptSecret(KEY, plain))).toBe(plain);
  });

  it("同一明文两次加密的密文不同(nonce 随机)", () => {
    const a = encryptSecret(KEY, "sk-same-input");
    const b = encryptSecret(KEY, "sk-same-input");
    expect(a.equals(b)).toBe(false);
  });

  it("换密钥解不开", () => {
    expect(() => decryptSecret(OTHER_KEY, encryptSecret(KEY, "sk-x"))).toThrow(DecryptError);
  });

  it("密文被改一个字节就解不开(GCM 认证)", () => {
    const blob = encryptSecret(KEY, "sk-tamper-me");
    blob[blob.length - 1] ^= 0xff;
    expect(() => decryptSecret(KEY, blob)).toThrow(DecryptError);
  });

  it("截断的密文不当作空明文", () => {
    expect(() => decryptSecret(KEY, Buffer.alloc(8))).toThrow(DecryptError);
  });

  it("密钥长度不对时给的是配置错误,不是解密失败", () => {
    expect(() => parseEncryptionKey("")).toThrow(EncryptionKeyError);
    expect(() => parseEncryptionKey(Buffer.alloc(16).toString("base64"))).toThrow(EncryptionKeyError);
  });

  it("掩码只露前 3 后 4;短串一律只回 …", () => {
    expect(maskSecret("sk-0123456789abcd")).toBe("sk-…abcd");
    expect(maskSecret("short")).toBe("…");
    // 11 位仍算短:前 3 后 4 会露掉七成
    expect(maskSecret("sk-12345678")).toBe("…");
  });
});

describe("bearer 校验(mcp/auth)", () => {
  const token = "a".repeat(43);
  const hash = sha256Hex(token);

  it("解析 Authorization 头", () => {
    expect(parseBearer(`Bearer ${token}`)).toBe(token);
    expect(parseBearer(`bearer ${token}`)).toBe(token);
    expect(parseBearer(`Bearer\t${token}`)).toBe(token);
    expect(parseBearer(token)).toBeNull();
    expect(parseBearer(undefined)).toBeNull();
    // 多段 = 不是单个 token,不猜
    expect(parseBearer(`Bearer ${token} extra`)).toBeNull();
  });

  it("正确 token 通过", () => {
    expect(verifyAuth(`Bearer ${token}`, hash).ok).toBe(true);
    expect(verifyAuth(`Bearer ${token}`, hash.toUpperCase()).ok).toBe(true);
  });

  it("错 token / 缺 token 拒绝", () => {
    expect(verifyAuth(`Bearer ${token}x`, hash).ok).toBe(false);
    expect(verifyAuth(undefined, hash).ok).toBe(false);
  });

  it("secret 未配置或不是 sha256 时一律拒绝(不能默认放行)", () => {
    expect(verifyAuth(`Bearer ${token}`, undefined).ok).toBe(false);
    expect(verifyAuth(`Bearer ${token}`, "").ok).toBe(false);
    expect(verifyAuth(`Bearer ${token}`, "not-a-hash").ok).toBe(false);
    // 长度对但不是 hex
    expect(verifyAuth(`Bearer ${token}`, "z".repeat(64)).ok).toBe(false);
  });

  it("等长比较不因长度不同抛异常", () => {
    expect(timingSafeEqualHex("abc", "abcd")).toBe(false);
    expect(timingSafeEqualHex("", "")).toBe(false);
    expect(timingSafeEqualHex("abcd", "abcd")).toBe(true);
  });
});

describe("派生字段(mcp/content)", () => {
  it("中文按字、西文按词", () => {
    expect(countWords("你好世界")).toBe(4);
    expect(countWords("hello world")).toBe(2);
    expect(countWords("图片不计入 ![x](/a.webp)")).toBe(5);
  });

  const base = {
    ordinal: 1,
    label: "01",
    pinned: false,
    title: "标题",
    summary: "摘要",
    contentMd: "正文",
    sourceUrl: null,
    publishedAt: null,
  };

  it("同输入同哈希", () => {
    expect(chapterHash(base)).toBe(chapterHash({ ...base }));
  });

  it("任一展示字段变化都改变哈希", () => {
    for (const patch of [
      { title: "改了" },
      { summary: "改了" },
      { contentMd: "改了" },
      { label: "02" },
      { ordinal: 2 },
      { pinned: true },
      { sourceUrl: "https://x.example" },
      { publishedAt: "2026-01-01T00:00:00.000Z" },
    ]) {
      expect(chapterHash({ ...base, ...patch })).not.toBe(chapterHash(base));
    }
  });

  it("字段边界不串味", () => {
    // ("ab","c") 与 ("a","bc") 必须不同哈希,否则改标题会被判成"没变"
    expect(chapterHash({ ...base, title: "ab", summary: "c" })).not.toBe(
      chapterHash({ ...base, title: "a", summary: "bc" }),
    );
  });
});

describe("附件输入校验(mcp/tools)", () => {
  it("严格 base64:非法字符、长度不对齐、非规范填充都拒", () => {
    expect(decodeBase64Strict(WEBP.toString("base64")).equals(WEBP)).toBe(true);
    // 下面这些 Buffer.from 都会静默接受(解出半截数据),所以必须显式拒
    expect(() => decodeBase64Strict("!!!not base64!!!")).toThrow();
    expect(() => decodeBase64Strict("QUJD=")).toThrow(); // 长度不是 4 的倍数
    expect(() => decodeBase64Strict("QU=JD")).toThrow(); // 填充出现在中间
    // 尾部比特非零:能解码,但回编码得到 QUJDRA== —— 不是同一份输入
    expect(() => decodeBase64Strict("QUJDRB==")).toThrow();
  });

  it("允许换行(客户端常按 76 列折行)", () => {
    const wrapped = WEBP.toString("base64").replace(/(.{20})/g, "$1\n");
    expect(decodeBase64Strict(wrapped).equals(WEBP)).toBe(true);
  });

  it("魔数与声明类型必须一致", () => {
    expect(magicMatches("image/webp", WEBP)).toBe(true);
    expect(magicMatches("image/png", WEBP)).toBe(false);
    // 一份声称是 png 的 HTML —— 这正是同源存储型 XSS 的形状
    expect(magicMatches("image/png", Buffer.from("<html><script>x</script>"))).toBe(false);
    expect(magicMatches("image/png", Buffer.from("89504e470d0a1a0a0000", "hex"))).toBe(true);
    expect(magicMatches("image/jpeg", Buffer.from("ffd8ffe000", "hex"))).toBe(true);
    expect(magicMatches("image/gif", Buffer.from("GIF89a\0"))).toBe(true);
    expect(magicMatches("image/svg+xml", Buffer.from("<svg/>"))).toBe(false);
    // 太短的输入不能因为越界读出 undefined 就当成匹配
    expect(magicMatches("image/webp", Buffer.from("RIFF"))).toBe(false);
  });
});

describe("库读写(mcp/store)", () => {
  beforeEach(async () => {
    // 外键顺序:附件/章节 → 系列 → 分类
    await db.exec`DELETE FROM notes_assets`;
    await db.exec`DELETE FROM notes_chapters`;
    await db.exec`DELETE FROM notes_series`;
    await db.exec`DELETE FROM notes_categories`;
    await db.exec`DELETE FROM llm_config`;
    await db.exec`DELETE FROM tool_config`;
    await db.exec`DELETE FROM about_content`;
    await store.upsertCategory({ slug: "cat", name: "分类", dot: "#2563eb", sortOrder: 1 });
    await store.upsertSeries({
      slug: "ser",
      categorySlug: "cat",
      name: "系列",
      description: "",
      sortOrder: 1,
    });
  });

  const chapter = {
    seriesSlug: "ser",
    slug: "01",
    ordinal: 1,
    label: "01",
    pinned: false,
    title: "标题",
    summary: "摘要",
    contentMd: "# 正文\n\n一二三四五",
    sourceUrl: null,
    publishedAt: null,
  };

  it("章节 upsert:内容未变则整行不动(updated_at 不刷新)", async () => {
    const first = await store.upsertChapter(chapter);
    expect(first).toMatchObject({ created: true, unchanged: false });
    const t1 = (await store.getChapter("ser", "01"))!.updatedAt;

    const again = await store.upsertChapter(chapter);
    expect(again.unchanged).toBe(true);
    expect((await store.getChapter("ser", "01"))!.updatedAt).toBe(t1);

    const changed = await store.upsertChapter({ ...chapter, title: "新标题" });
    expect(changed).toMatchObject({ created: false, unchanged: false });
    expect((await store.getChapter("ser", "01"))!.updatedAt).toBeGreaterThanOrEqual(t1);
  });

  it("章节字数由服务端算,不信客户端", async () => {
    const r = await store.upsertChapter({ ...chapter, contentMd: "你好世界 hello" });
    expect(r.wordCount).toBe(5);
  });

  it("系列不存在时拒绝写章节", async () => {
    await expect(store.upsertChapter({ ...chapter, seriesSlug: "nope" })).rejects.toBeInstanceOf(
      store.NotFoundError,
    );
  });

  it("删系列:有内容时必须显式 cascade", async () => {
    await store.upsertChapter(chapter);
    await expect(store.deleteSeries("ser", false)).rejects.toBeInstanceOf(store.ConflictError);
    await store.deleteSeries("ser", true);
    expect(await store.getChapter("ser", "01")).toBeNull();
  });

  it("删分类:底下还有系列时拒绝", async () => {
    await expect(store.deleteCategory("cat")).rejects.toBeInstanceOf(store.ConflictError);
  });

  it("附件:写入后可读回,重传覆盖", async () => {
    const put = await store.putAsset({
      seriesSlug: "ser",
      name: "a.webp",
      contentType: "image/webp",
      bytes: WEBP,
    });
    expect(put).toMatchObject({ created: true, byteSize: WEBP.length });
    // 对外地址保持 R5 口径,不带 /api 也不带 /assets
    expect(put.url).toBe("/notes/ser/a.webp");

    const again = await store.putAsset({
      seriesSlug: "ser",
      name: "a.webp",
      contentType: "image/webp",
      bytes: Buffer.concat([WEBP, Buffer.from([0])]),
    });
    expect(again.created).toBe(false);
    expect(again.etag).not.toBe(put.etag);

    expect((await store.listAssets("ser")).length).toBe(1);
  });

  it("附件:系列不存在时拒绝(挡住拼错系列名导致的破图)", async () => {
    await expect(
      store.putAsset({ seriesSlug: "nope", name: "a.webp", contentType: "image/webp", bytes: WEBP }),
    ).rejects.toBeInstanceOf(store.NotFoundError);
  });

  it("provider:首个自动成为默认,key 只回掩码且库里是密文", async () => {
    const r = await store.upsertProvider(
      { provider: "p1", apiKey: "sk-0123456789abcd", modelId: "m1", makeDefault: false },
      KEY,
    );
    expect(r).toMatchObject({ created: true, apiKeyHint: "sk-…abcd", isDefault: true });

    const listed = await store.listProviders();
    expect(listed[0].apiKeyHint).toBe("sk-…abcd");
    // 列表结构里不该出现任何形如明文 key 的字段
    expect(JSON.stringify(listed)).not.toContain("0123456789abcd");

    const raw = await db.rawQueryRow<{ enc: Uint8Array }>(
      `SELECT api_key_enc AS enc FROM llm_config WHERE provider = 'p1'`,
    );
    expect(Buffer.from(raw!.enc).toString("utf8")).not.toContain("sk-");
    expect(decryptSecret(KEY, raw!.enc)).toBe("sk-0123456789abcd");
  });

  it("provider:部分更新——省略的字段保留原值", async () => {
    await store.upsertProvider(
      {
        provider: "p1",
        apiKey: "sk-0123456789abcd",
        modelId: "m1",
        baseUrl: "https://a.example",
        makeDefault: true,
        dailyTokenLimit: 1000,
      },
      KEY,
    );
    // 只改 baseUrl:限额、模型、key 都不该被清掉(改之前这里会静默清零)
    await store.upsertProvider({ provider: "p1", baseUrl: "https://b.example", makeDefault: false }, KEY);
    const [p] = await store.listProviders();
    expect(p).toMatchObject({
      baseUrl: "https://b.example",
      modelId: "m1",
      dailyTokenLimit: 1000,
      apiKeyHint: "sk-…abcd",
      isDefault: true,
    });
    // null 才是显式清空
    await store.upsertProvider({ provider: "p1", baseUrl: null, makeDefault: false }, KEY);
    expect((await store.listProviders())[0].baseUrl).toBeNull();
  });

  it("provider:新建时缺 apiKey / modelId 都被拒", async () => {
    await expect(
      store.upsertProvider({ provider: "p9", modelId: "m", makeDefault: false }, KEY),
    ).rejects.toBeInstanceOf(store.NotFoundError);
    await expect(
      store.upsertProvider({ provider: "p9", apiKey: "sk-0123456789ab", makeDefault: false }, KEY),
    ).rejects.toBeInstanceOf(store.NotFoundError);
  });

  it("provider:默认唯一,切换后旧的让位", async () => {
    await store.upsertProvider(
      { provider: "p1", apiKey: "sk-0123456789abcd", modelId: "m1", makeDefault: true },
      KEY,
    );
    await store.upsertProvider(
      { provider: "p2", apiKey: "sk-0123456789efgh", modelId: "m2", makeDefault: true },
      KEY,
    );
    const defaults = (await store.listProviders()).filter((p) => p.isDefault);
    expect(defaults.map((p) => p.provider)).toEqual(["p2"]);

    await store.setDefaultProvider("p1");
    expect((await store.listProviders()).filter((p) => p.isDefault).map((p) => p.provider)).toEqual(["p1"]);

    // 删掉唯一的默认之后要如实报告「没有默认了」
    const del = await store.deleteProvider("p1");
    expect(del.defaultRemains).toBe(false);
    await expect(store.deleteProvider("p1")).rejects.toBeInstanceOf(store.NotFoundError);
  });

  it("About:单行覆盖", async () => {
    expect(await store.getAbout()).toMatchObject({ githubUser: "", buildPoints: [], updatedAt: null });
    await store.setAbout({
      githubUser: "someone",
      originUrl: "https://origin.example/u",
      intro: "简介",
      buildPoints: ["一", "二"],
    });
    await store.setAbout({
      githubUser: "someone",
      originUrl: "https://origin.example/u",
      intro: "改过的简介",
      buildPoints: ["一"],
    });
    const a = await store.getAbout();
    expect(a).toMatchObject({ intro: "改过的简介", buildPoints: ["一"] });
    const n = await db.rawQueryRow<{ n: number }>(`SELECT COUNT(*)::int AS n FROM about_content`);
    expect(n!.n).toBe(1);
  });

  it("工具启停:省略的标记保留原值", async () => {
    expect(await store.setToolConfig({ name: "notes_search", enabled: true, note: "只读" })).toEqual({
      created: true,
    });
    await store.setToolConfig({ name: "notes_search", enabled: false });
    const [t] = await store.listToolConfig();
    expect(t).toMatchObject({ name: "notes_search", enabled: false, dangerous: false, note: "只读" });
  });
});

describe("外链校验(mcp/tools,R8)", () => {
  it("接受带主机名的 http(s) 绝对地址与空串", () => {
    expect(isHttpUrl("")).toBe(true);
    expect(isHttpUrl("https://example.com/u")).toBe(true);
    expect(isHttpUrl("http://example.com")).toBe(true);
    expect(isHttpUrl("HTTPS://Example.com")).toBe(true);
  });

  it("**没有主机名的串必须拒**(前缀匹配放得过去,链接却点不开)", () => {
    // codex 第 2 轮 P3:原实现是 /^https?:\/\// 前缀匹配,这两个都能通过
    expect(isHttpUrl("https://")).toBe(false);
    expect(isHttpUrl("http://?x")).toBe(false);
  });

  it("协议白名单不能省:javascript: 是能被 URL 解析成功的", () => {
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("data:text/html,<script>x</script>")).toBe(false);
    expect(isHttpUrl("file:///etc/passwd")).toBe(false);
  });

  it("非绝对地址与畸形串一律拒", () => {
    expect(isHttpUrl("//evil.com")).toBe(false);
    expect(isHttpUrl("example.com")).toBe(false);
    expect(isHttpUrl("https://a b")).toBe(false);
    expect(isHttpUrl("   ")).toBe(false);
  });
});

describe("About 内容(mcp/store,R8)", () => {
  beforeEach(async () => {
    await db.exec`DELETE FROM about_content`;
  });

  const full = {
    githubUser: "someone",
    originUrl: "https://origin.example/u",
    intro: "简介",
    buildPoints: ["a", "b"],
    repos: [{ name: "repo-a", lang: "Rust", dot: "#dea584", stars: 3, desc: "d", pushed: "2026-08-27" }],
    langBar: [{ name: "Rust", pct: 60, color: "#dea584" }],
  };

  it("空表回全空而不是 null —— About 页此时应该是空页,不是错误页", async () => {
    expect(await store.getAbout()).toMatchObject({
      githubUser: "",
      originUrl: "",
      intro: "",
      buildPoints: [],
      repos: [],
      langBar: [],
      updatedAt: null,
    });
  });

  it("首次写入即建行,读回一致", async () => {
    await store.setAbout(full);
    const got = await store.getAbout();
    expect(got).toMatchObject(full);
    expect(got.updatedAt).not.toBeNull();
  });

  it("**部分更新**:省略的字段保留原值(R8 改的就是这条口径)", async () => {
    await store.setAbout(full);
    await store.setAbout({ intro: "只改这一句" });
    const got = await store.getAbout();
    expect(got.intro).toBe("只改这一句");
    // 这三项没被提到,就一个字都不该动 —— 原先的整体覆盖会把它们清空
    expect(got.githubUser).toBe("someone");
    expect(got.repos).toEqual(full.repos);
    expect(got.langBar).toEqual(full.langBar);
    expect(got.buildPoints).toEqual(full.buildPoints);
  });

  it("清空是显式动作:传 [] / \"\" 才清", async () => {
    await store.setAbout(full);
    await store.setAbout({ repos: [], originUrl: "" });
    const got = await store.getAbout();
    expect(got.repos).toEqual([]);
    expect(got.originUrl).toBe("");
    // 同一次调用里没提到的照旧
    expect(got.langBar).toEqual(full.langBar);
  });

  it("JSONB 落的是数组而不是 JSON 字符串标量(CLAUDE.md 规则 4)", async () => {
    await store.setAbout(full);
    const row = await db.queryRow<{ t1: string; t2: string; t3: string }>`
      SELECT jsonb_typeof(build_points) AS t1, jsonb_typeof(repos) AS t2, jsonb_typeof(lang_bar) AS t3
        FROM about_content WHERE id`;
    expect(row).toMatchObject({ t1: "array", t2: "array", t3: "array" });
  });
});

describe("访问统计聚合(mcp/store,R8)", () => {
  const today = siteDay();
  const yesterday = siteDayAgo(1);

  // 打点写入方是 metrics 服务;这里直接下 SQL 造数据,不跨服务 import 它的 store。
  const visit = (day: string, path: string, visitor: string, ua: string, hits: number) =>
    db.exec`INSERT INTO visits (day, path, visitor, ua, hits)
            VALUES (${day}::date, ${path}, ${visitor}, ${ua}, ${hits})`;

  beforeEach(async () => {
    await db.exec`DELETE FROM visits`;
  });

  it("统计结果与打点一致(验收项:PV / 单日 UV / 路径分布 / UA 分布)", async () => {
    // 今天:v1 看首页两次 + 文章一次;v2 看首页一次
    await visit(today, "/", "v1", "Chrome/Windows", 2);
    await visit(today, "/notes/pi/01", "v1", "Chrome/Windows", 1);
    await visit(today, "/", "v2", "Safari/iOS", 1);
    // 昨天:v3 看 About 一次(同一个人换天必然是另一个 visitor —— 见 metrics/visitor.ts)
    await visit(yesterday, "/about", "v3", "Safari/iOS", 1);

    const overview = await store.trafficOverview(30);
    expect(overview.pageviews).toBe(5);
    // 各日 UV 之和:今天 2 + 昨天 1。**不是**去重人数
    expect(overview.visitorDays).toBe(3);
    expect(overview.to).toBe(today);
    expect(overview.from).toBe(siteDayAgo(29));
    expect(overview.daily).toEqual([
      { day: yesterday, pv: 1, uv: 1 },
      { day: today, pv: 4, uv: 2 },
    ]);

    expect(await store.trafficPaths(30, 10)).toEqual([
      { key: "/", pv: 3, visitorDays: 2 },
      { key: "/about", pv: 1, visitorDays: 1 },
      { key: "/notes/pi/01", pv: 1, visitorDays: 1 },
    ]);

    expect(await store.trafficAgents(30)).toEqual([
      { key: "Chrome/Windows", pv: 3, visitorDays: 1 },
      { key: "Safari/iOS", pv: 2, visitorDays: 2 },
    ]);
  });

  it("区间收窄能把昨天切出去(days=1 只含今天)", async () => {
    await visit(today, "/", "v1", "Chrome/Windows", 1);
    await visit(yesterday, "/", "v2", "Chrome/Windows", 1);
    const overview = await store.trafficOverview(1);
    expect(overview.from).toBe(today);
    expect(overview.pageviews).toBe(1);
  });

  it("limit 生效且按 pv 倒序", async () => {
    await visit(today, "/", "v1", "Chrome/Windows", 5);
    await visit(today, "/about", "v1", "Chrome/Windows", 3);
    await visit(today, "/notes", "v1", "Chrome/Windows", 1);
    expect(await store.trafficPaths(30, 2)).toEqual([
      { key: "/", pv: 5, visitorDays: 1 },
      { key: "/about", pv: 3, visitorDays: 1 },
    ]);
  });

  it("没有数据时回 0 与空数组,不炸", async () => {
    expect(await store.trafficOverview(30)).toMatchObject({
      pageviews: 0,
      visitorDays: 0,
      daily: [],
    });
    expect(await store.trafficPaths(30, 10)).toEqual([]);
    expect(await store.trafficAgents(30)).toEqual([]);
  });
});

// ───────────────────── websearch provider(R-WEBSEARCH)─────────────────────

describe("websearch provider(mcp/store + shared/websearch-hosts)", () => {
  beforeEach(async () => {
    await db.exec`DELETE FROM websearch_config`;
  });

  const base = {
    provider: "deepseek",
    apiKey: "sk-0123456789abcd",
    baseUrl: "https://api.deepseek.com",
    modelId: "deepseek-v4-flash",
    makeDefault: false,
  };

  it("首个自动成为默认,key 只回掩码且库里是密文", async () => {
    const r = await store.upsertWebSearchProvider(base, KEY);
    expect(r).toMatchObject({ created: true, apiKeyHint: "sk-…abcd", isDefault: true });

    const listed = await store.listWebSearchProviders();
    expect(listed[0]).toMatchObject({
      provider: "deepseek",
      apiKeyHint: "sk-…abcd",
      toolType: "web_search",
      totalTimeoutMs: 180_000,
      idleTimeoutMs: 45_000,
      dailySearchLimit: 0,
      isDefault: true,
    });
    // 列表结构里不该出现任何形如明文 key 的字段(docs/security.md §3)
    expect(JSON.stringify(listed)).not.toContain("0123456789abcd");

    const raw = await db.rawQueryRow<{ enc: Uint8Array }>(
      `SELECT api_key_enc AS enc FROM websearch_config WHERE provider = 'deepseek'`,
    );
    expect(decryptSecret(KEY, raw!.enc)).toBe("sk-0123456789abcd");
  });

  it("首次写入必须给 apiKey / baseUrl / modelId(这张表没有内置端点可回落)", async () => {
    for (const missing of ["apiKey", "baseUrl", "modelId"] as const) {
      const input = { ...base, [missing]: undefined };
      await expect(store.upsertWebSearchProvider(input, KEY)).rejects.toThrow(store.NotFoundError);
    }
  });

  it("部分更新:只改 modelId 不会把超时与限额清零", async () => {
    await store.upsertWebSearchProvider(
      { ...base, makeDefault: true, totalTimeoutMs: 120_000, idleTimeoutMs: 30_000, dailySearchLimit: 50 },
      KEY,
    );
    await store.upsertWebSearchProvider(
      { provider: "deepseek", modelId: "deepseek-v4-pro", makeDefault: false },
      KEY,
    );
    const [p] = await store.listWebSearchProviders();
    expect(p).toMatchObject({
      modelId: "deepseek-v4-pro",
      totalTimeoutMs: 120_000,
      idleTimeoutMs: 30_000,
      dailySearchLimit: 50,
      apiKeyHint: "sk-…abcd",
    });
  });

  it("idle > total 在写入前就被拒(给所有者一句能行动的话,不是「详见日志」)", async () => {
    await store.upsertWebSearchProvider(base, KEY);
    await expect(
      store.upsertWebSearchProvider(
        { provider: "deepseek", idleTimeoutMs: 120_000, totalTimeoutMs: 60_000, makeDefault: false },
        KEY,
      ),
    ).rejects.toThrow(store.ConflictError);
    // 只给 idle、让它越过库内既有的 total,同样要拒
    await expect(
      store.upsertWebSearchProvider(
        { provider: "deepseek", idleTimeoutMs: 200_000, makeDefault: false },
        KEY,
      ),
    ).rejects.toThrow(store.ConflictError);
  });

  it("**store.ts 里的超时默认值与迁移 008 的列默认值一致**(重复常量由测试钉住)", async () => {
    const rows = await db.rawQueryAll<{ column_name: string; column_default: string }>(
      `SELECT column_name, column_default FROM information_schema.columns
        WHERE table_name = 'websearch_config'
          AND column_name IN ('total_timeout_ms', 'idle_timeout_ms')`,
    );
    const byCol = Object.fromEntries(rows.map((r) => [r.column_name, parseInt(r.column_default, 10)]));
    expect(byCol.total_timeout_ms).toBe(store.DEFAULT_TOTAL_TIMEOUT_MS);
    expect(byCol.idle_timeout_ms).toBe(store.DEFAULT_IDLE_TIMEOUT_MS);
  });

  it("唯一默认:切换之后旧的那个不再是默认", async () => {
    await store.upsertWebSearchProvider(base, KEY);
    await store.upsertWebSearchProvider({ ...base, provider: "gw" }, KEY);
    await store.setDefaultWebSearchProvider("gw");
    const listed = await store.listWebSearchProviders();
    expect(listed.filter((p) => p.isDefault).map((p) => p.provider)).toEqual(["gw"]);
  });

  it("删不存在的 provider 报 NotFound;删完最后一个如实回 defaultRemains=false", async () => {
    await expect(store.deleteWebSearchProvider("nope")).rejects.toThrow(store.NotFoundError);
    await store.upsertWebSearchProvider(base, KEY);
    expect(await store.deleteWebSearchProvider("deepseek")).toEqual({ defaultRemains: false });
  });

  it("目标域白名单:写入侧与调用侧用的是同一份判据", () => {
    expect(checkBaseUrl("https://api.deepseek.com").ok).toBe(true);
    expect(checkBaseUrl("https://aigateway.variflight.com/api").ok).toBe(true);
    for (const bad of [
      "https://evil.tld",
      "https://api.deepseek.com.evil.tld",
      "http://api.deepseek.com",
      "https://u:p@api.deepseek.com",
      "https://api.deepseek.com?x=1",
      "not-a-url",
    ]) {
      expect(checkBaseUrl(bad).ok, bad).toBe(false);
    }
    expect(allowedHosts()).toContain("api.deepseek.com");
  });

  it("tool_type 的库级 CHECK 挡住任意字符串", async () => {
    await store.upsertWebSearchProvider(base, KEY);
    await expect(
      db.rawExec(`UPDATE websearch_config SET tool_type = 'bash' WHERE provider = 'deepseek'`),
    ).rejects.toThrow();
    // 带日期的官方变体要放行(DeepSeek 的 web_search_2025_08_26)
    await store.upsertWebSearchProvider(
      { provider: "deepseek", toolType: "web_search_2025_08_26", makeDefault: false },
      KEY,
    );
    expect((await store.listWebSearchProviders())[0].toolType).toBe("web_search_2025_08_26");
  });
});

// ───────────────────── MCP 工具注册面的入参 schema ─────────────────────
//
// 【为什么非要测这一层】本轮踩到的:`.refine(check, (v) => ({message}))` 是 zod 3 的
// 「函数形式 params」,zod 4.5 **静默忽略**它 —— 不报错、不抛,只是把消息退回成
// 一句 "Invalid input"。store 层的测试一个都照不到这里,因为它们直接调 store 函数,
// 根本不过 schema。这里用一个假 server 收下注册配置,再拿真 schema 去 parse。
describe("websearch 管理 tool 的入参 schema", () => {
  interface Registered {
    name: string;
    config: { inputSchema?: Record<string, z.ZodType> };
  }

  const registered: Registered[] = [];
  const fakeServer = {
    registerTool(name: string, config: Registered["config"]) {
      registered.push({ name, config });
    },
  };
  registerTools(fakeServer as never, {});

  const schemaOf = (name: string) => {
    const t = registered.find((r) => r.name === name);
    expect(t, `${name} 未注册`).toBeDefined();
    return z.object(t!.config.inputSchema!);
  };

  it("四个 websearch tool 都注册了", () => {
    for (const name of [
      "websearch_providers_list",
      "websearch_provider_upsert",
      "websearch_set_default",
      "websearch_provider_delete",
    ]) {
      expect(registered.map((r) => r.name)).toContain(name);
    }
  });

  it("baseUrl 被拒时给出**能行动的**理由,而不是一句 Invalid input", () => {
    const schema = schemaOf("websearch_provider_upsert");
    const cases: Array<[string, string]> = [
      ["https://evil.tld", "白名单"],
      ["https://api.deepseek.com.evil.tld", "白名单"],
      ["http://api.deepseek.com", "https"],
      ["https://u:p@api.deepseek.com", "凭据"],
      ["https://api.deepseek.com?x=1", "query"],
      ["不是地址", "绝对地址"],
    ];
    for (const [url, want] of cases) {
      const r = schema.safeParse({ provider: "p", baseUrl: url, makeDefault: false });
      expect(r.success, url).toBe(false);
      const msg = r.error!.issues.map((i) => i.message).join(" | ");
      expect(msg, url).toContain(want);
      expect(msg, url).not.toBe("Invalid input");
    }
  });

  it("白名单内的合法 baseUrl 放行", () => {
    const schema = schemaOf("websearch_provider_upsert");
    for (const url of ["https://api.deepseek.com", "https://aigateway.variflight.com/api"]) {
      expect(schema.safeParse({ provider: "p", baseUrl: url, makeDefault: false }).success, url).toBe(true);
    }
  });

  it("toolType 只接受 web_search / web_search_YYYY_MM_DD", () => {
    const schema = schemaOf("websearch_provider_upsert");
    const parse = (toolType: string) =>
      schema.safeParse({ provider: "p", toolType, makeDefault: false }).success;
    expect(parse("web_search")).toBe(true);
    expect(parse("web_search_2025_08_26")).toBe(true);
    for (const bad of ["bash", "web_search; drop", "", "websearch"]) expect(parse(bad), bad).toBe(false);
  });

  it("超时上下界与库的 CHECK 一致(300s / 120s 封顶)", () => {
    const schema = schemaOf("websearch_provider_upsert");
    const parse = (o: Record<string, number>) =>
      schema.safeParse({ provider: "p", makeDefault: false, ...o }).success;
    expect(parse({ totalTimeoutMs: 300_000 })).toBe(true);
    expect(parse({ totalTimeoutMs: 300_001 })).toBe(false);
    expect(parse({ totalTimeoutMs: 9_999 })).toBe(false);
    expect(parse({ idleTimeoutMs: 120_000 })).toBe(true);
    expect(parse({ idleTimeoutMs: 120_001 })).toBe(false);
    expect(parse({ dailySearchLimit: -1 })).toBe(false);
  });
});
