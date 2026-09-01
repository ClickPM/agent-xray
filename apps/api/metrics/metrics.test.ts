// R8 metrics 服务测试。经 `dev.ps1 test` 运行(CLAUDE.md 规则 2)。
//
// 覆盖面按「错了会静默」排序:
//   - 加盐哈希 —— 错了就是把可反推的东西落了库(docs/security.md §6)
//   - UA 摘要 —— 错了会把高熵指纹当摘要存进去
//   - 路径归一 —— 错了 `/t` 就成了一个任何人都能往库里灌任意行的入口
//   - 计数行 upsert —— 错了行数会随刷新次数增长(聚合口径的用例在 mcp/mcp.test.ts)
import { beforeEach, describe, expect, it } from "vitest";
import { siteDay, siteDayAgo } from "../shared/site-time";
import { db } from "./db";
import { OTHER_BUCKET, classifyPath, resolvePath } from "./path";
import { recordVisit } from "./store";
import { clientIp, uaDigest, visitorHash } from "./visitor";

const SALT = "test-salt-0123456789";
const CHROME_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const SAFARI_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

describe("访客标识(metrics/visitor)", () => {
  it("同一天同一 IP+UA 稳定,换任一维度就变", () => {
    const base = visitorHash(SALT, "2026-09-01", "1.2.3.4", CHROME_WIN);
    expect(visitorHash(SALT, "2026-09-01", "1.2.3.4", CHROME_WIN)).toBe(base);
    // 换天必须变 —— 这正是「跨天不可关联」这条隐私承诺的实现
    expect(visitorHash(SALT, "2026-09-02", "1.2.3.4", CHROME_WIN)).not.toBe(base);
    expect(visitorHash(SALT, "2026-09-01", "1.2.3.5", CHROME_WIN)).not.toBe(base);
    expect(visitorHash(SALT, "2026-09-01", "1.2.3.4", SAFARI_IOS)).not.toBe(base);
    // 换盐必须变,否则盐就是个摆设
    expect(visitorHash("other-salt", "2026-09-01", "1.2.3.4", CHROME_WIN)).not.toBe(base);
  });

  it("是 128 bit 的 hex,且不含任何原始输入", () => {
    const h = visitorHash(SALT, "2026-09-01", "203.0.113.7", CHROME_WIN);
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(h).not.toContain("203.0.113.7");
  });

  it("分隔符不能省:拼接歧义会让两组不同输入撞同一个值", () => {
    // ("ab","c") 与 ("a","bc") 在没有分隔符时会拼成同一个串
    expect(visitorHash(SALT, "2026-09-01", "ab", "c")).not.toBe(
      visitorHash(SALT, "2026-09-01", "a", "bc"),
    );
  });

  it("来源 IP 取 XFF 首段,其次 X-Real-IP,最后 socket", () => {
    expect(clientIp({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }, "127.0.0.1")).toBe("9.9.9.9");
    expect(clientIp({ "x-real-ip": "8.8.8.8" }, "127.0.0.1")).toBe("8.8.8.8");
    expect(clientIp({}, "127.0.0.1")).toBe("127.0.0.1");
    expect(clientIp({}, undefined)).toBe("unknown");
  });
});

describe("UA 摘要(metrics/visitor)", () => {
  it("归到闭集,原始串不出现在结果里", () => {
    expect(uaDigest(CHROME_WIN)).toBe("Chrome/Windows");
    expect(uaDigest(SAFARI_IOS)).toBe("Safari/iOS");
    expect(uaDigest("Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0")).toBe("Firefox/Linux");
    // Edge / Opera 的 UA 里都含 "Chrome",顺序判错就会把它们全算成 Chrome
    expect(uaDigest("Mozilla/5.0 (Windows NT 10.0) Chrome/141.0 Safari/537.36 Edg/141.0")).toBe(
      "Edge/Windows",
    );
    expect(uaDigest("Mozilla/5.0 (Macintosh) Chrome/141.0 Safari/537.36 OPR/120.0")).toBe(
      "Opera/macOS",
    );
    // Safari 的 UA 里含 "Safari" 但不含 "Chrome/"
    expect(uaDigest("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.0 Safari/605.1.15")).toBe(
      "Safari/macOS",
    );
  });

  it("爬虫单独成族;空 UA 不炸", () => {
    // 爬虫名基本都是「厂商 + bot」连写,前置 \b 一个都匹配不上
    expect(uaDigest("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe("Bot/Other");
    expect(uaDigest("Mozilla/5.0 (compatible; bingbot/2.0)")).toBe("Bot/Other");
    expect(uaDigest("Mozilla/5.0 (compatible; YandexBot/3.0)")).toBe("Bot/Other");
    expect(uaDigest("Twitterbot/1.0")).toBe("Bot/Other");
    expect(uaDigest("curl/8.5.0")).toBe("Bot/Other");
    // 爬虫判定优先于浏览器族:HeadlessChrome 的 UA 里含 "Chrome/"
    expect(uaDigest("Mozilla/5.0 (X11; Linux) HeadlessChrome/141.0 Safari/537.36")).toBe("Bot/Other");
    expect(uaDigest("")).toBe("Other/Other");
    expect(uaDigest("   ")).toBe("Other/Other");
  });

  it("超长 UA 不会变成超长摘要(高熵指纹不落库)", () => {
    expect(uaDigest("x".repeat(10_000))).toBe("Other/Other");
  });
});

describe("路径归一 · 纯函数部分(metrics/path)", () => {
  const other = { kind: "other" };

  it("静态路由与末尾斜杠归一", () => {
    expect(classifyPath("/")).toEqual({ kind: "static", path: "/" });
    expect(classifyPath("/notes")).toEqual({ kind: "static", path: "/notes" });
    expect(classifyPath("/notes/")).toEqual({ kind: "static", path: "/notes" });
    expect(classifyPath("/about")).toEqual({ kind: "static", path: "/about" });
  });

  it("query 与 hash 被丢掉 —— 它们是访客可控的高基数输入", () => {
    expect(classifyPath("/about?utm_source=x&y=1")).toEqual({ kind: "static", path: "/about" });
    expect(classifyPath("/about#section")).toEqual({ kind: "static", path: "/about" });
  });

  it("系列页与文章页认形状", () => {
    expect(classifyPath("/notes/pi")).toEqual({ kind: "series", series: "pi" });
    expect(classifyPath("/notes/pi/01")).toEqual({ kind: "chapter", series: "pi", chapter: "01" });
  });

  it("非站内 / 非法形状一律 other", () => {
    expect(classifyPath("//evil.com/x")).toEqual(other);
    expect(classifyPath("https://evil.com/")).toEqual(other);
    expect(classifyPath("notes")).toEqual(other);
    expect(classifyPath("/notes/PI")).toEqual(other); // 大写不是合法 slug
    expect(classifyPath("/notes/pi/01/02")).toEqual(other);
    expect(classifyPath("/" + "a".repeat(300))).toEqual(other);
    expect(classifyPath("")).toEqual(other);
    // 非字符串输入(库外调用方传错)不能炸
    expect(classifyPath(undefined as unknown as string)).toEqual(other);
  });
});

describe("路径归一 · 库内存在性(metrics/path)", () => {
  beforeEach(async () => {
    await db.exec`DELETE FROM notes_chapters`;
    await db.exec`DELETE FROM notes_series`;
    await db.exec`DELETE FROM notes_categories`;
    await db.exec`INSERT INTO notes_categories (slug, name, dot, sort_order) VALUES ('cat', '分类', '#2563eb', 1)`;
    await db.exec`INSERT INTO notes_series (slug, category_slug, name) VALUES ('pi', 'cat', '系列')`;
    await db.exec`INSERT INTO notes_chapters
      (series_slug, slug, ordinal, label, title, content_md, content_hash, updated_at)
      VALUES ('pi', '01', 1, '01', '标题', '正文', 'h', now())`;
  });

  it("库里有的才记真实路径", async () => {
    expect(await resolvePath("/notes/pi")).toBe("/notes/pi");
    expect(await resolvePath("/notes/pi/01")).toBe("/notes/pi/01");
  });

  it("形状合法但库里没有 → 常量桶(否则 /t 就是个灌库入口)", async () => {
    expect(await resolvePath("/notes/nope")).toBe(OTHER_BUCKET);
    expect(await resolvePath("/notes/pi/nope")).toBe(OTHER_BUCKET);
    expect(await resolvePath("/wp-admin.php")).toBe(OTHER_BUCKET);
  });

  it("静态路由不查库", async () => {
    expect(await resolvePath("/")).toBe("/");
    expect(await resolvePath("/about?x=1")).toBe("/about");
  });
});

describe("计数行(metrics/store)", () => {
  beforeEach(async () => {
    await db.exec`DELETE FROM visits`;
  });

  it("同 (day, path, visitor) 累加 hits 而不是多加一行", async () => {
    const v = { day: siteDay(), path: "/", visitor: "v1", ua: "Chrome/Windows" };
    await recordVisit(v);
    await recordVisit(v);
    await recordVisit(v);
    const row = await db.queryRow<{ hits: number; n: number }>`
      SELECT hits, (SELECT COUNT(*)::int FROM visits) AS n FROM visits`;
    expect(row).toMatchObject({ hits: 3, n: 1 });
  });

  it("不同 path / 不同 visitor 各自成行", async () => {
    const day = siteDay();
    await recordVisit({ day, path: "/", visitor: "v1", ua: "Chrome/Windows" });
    await recordVisit({ day, path: "/about", visitor: "v1", ua: "Chrome/Windows" });
    await recordVisit({ day, path: "/", visitor: "v2", ua: "Safari/iOS" });
    const row = await db.queryRow<{ n: number }>`SELECT COUNT(*)::int AS n FROM visits`;
    expect(row?.n).toBe(3);
  });

  // 聚合口径(PV / 单日 UV / 路径分布 / UA 分布)的用例在 mcp/mcp.test.ts:
  // 那些 SQL 归 mcp 服务(统计的展示面是 MCP tools),测试跟着 SQL 走,
  // 免得 metrics 的测试文件去 import 另一个服务的内部实现。
});

describe("站点时区的自然日(shared/site-time)", () => {
  it("按 UTC+8 切天,不是 UTC", () => {
    // UTC 的 2026-08-31 23:00 在站点时区已经是 9 月 1 日
    expect(siteDay(new Date("2026-08-31T23:00:00Z"))).toBe("2026-09-01");
    expect(siteDay(new Date("2026-08-31T15:59:59Z"))).toBe("2026-08-31");
    expect(siteDay(new Date("2026-08-31T16:00:00Z"))).toBe("2026-09-01");
  });

  it("往回数天不跨月出错", () => {
    const at = new Date("2026-09-01T04:00:00Z"); // 站点时区 2026-09-01 12:00
    expect(siteDayAgo(0, at)).toBe("2026-09-01");
    expect(siteDayAgo(1, at)).toBe("2026-08-31");
    expect(siteDayAgo(29, at)).toBe("2026-08-03");
  });
});
