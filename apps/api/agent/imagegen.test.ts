// R-IMAGEGEN:生图工具的单元测试。经 `dev.ps1 test`(encore test)运行,CLAUDE.md 规则 2。
//
// 这里的用例不是"覆盖率",是**验收项本身**(任务卡 #3–#9、#12、#13):域白名单挡得住、
// 访客控不到网络原语、两种协议都解析正确、双计时器与两道字节上界、不是图片就不存、
// 凭据不外泄、限额原子、agent_image 写面限死、按归属供图。
//
// **全程注入 fetch,不打任何真实网络**(与 websearch.test.ts 同一口径)。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Transaction } from "encore.dev/storage/sqldb";
import { db } from "./db";
import { getGeneratedImage, insertGeneratedImageAsAgent } from "./image-db";
import {
  buildImageRequestBody,
  decodeImagePayload,
  extractImagePayload,
  ImageGenError,
  imageEndpointUrl,
  MAX_IMAGE_BYTES,
  MAX_RESPONSE_BYTES,
  parseAllowedImageBaseUrl,
  runImageGen,
  type ImageGenProgress,
} from "./imagegen";
import type { ActiveImageGenConfig } from "./imagegen-config";
import { publicImageUrl } from "./images";
import { reserveImage } from "./quota";
import { createSession } from "./store";
import { buildSessionTools, GENERATE_IMAGE_TOOL, imageAltText, type EnabledTools } from "./tools";
import { checkBaseUrl as checkSearchBaseUrl } from "../shared/websearch-hosts";

/** 一把一眼能认出来的假 key:凡是它出现在不该出现的地方,断言就该红。 */
const FAKE_KEY = "sk-test-SECRET-IMAGE-KEY-7c2e";

/** 1×1 透明 PNG(标准夹具,浏览器实测可渲染)。 */
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
/** 1×1 gif。 */
const GIF_B64 = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
/** 一段 HTML —— 「声称是图片」的可执行文档,魔数认不出来就该拒。 */
const HTML_B64 = Buffer.from("<html><script>alert(1)</script></html>").toString("base64");

function cfg(over: Partial<ActiveImageGenConfig> = {}): ActiveImageGenConfig {
  return {
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    modelId: "gpt-image-2",
    apiStyle: "images",
    imageSize: null,
    totalTimeoutMs: 5_000,
    idleTimeoutMs: 2_000,
    dailyImageLimit: 0,
    apiKey: FAKE_KEY,
    fingerprint: "fp-test",
    ...over,
  };
}

/** 等一个可被 abort 打断的时长;abort 时以 AbortError 拒绝(模拟真实 fetch 的行为)。 */
function abortable(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const fail = () => {
      clearTimeout(timer);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", fail);
      resolve();
    }, ms);
    if (signal?.aborted) fail();
    else signal?.addEventListener("abort", fail, { once: true });
  });
}

interface FetchOpts {
  status?: number;
  /** 响应头到达前的等待(模拟上游出图时间) */
  headerDelayMs?: number;
  /** 分块之间的间隔 */
  gapMs?: number;
  /** 放完 chunks 之后不关流,挂到被 abort —— 测响应体阶段的空闲超时 */
  neverEnd?: boolean;
  contentType?: string;
}

/** 记录下来的请求,供「访客控不到网络原语」断言。 */
interface SeenRequest {
  url: string;
  init: RequestInit;
}

/**
 * 造一个受 `signal` 控制的假 fetch:响应头延迟 / 分块 / 挂起都能配。
 * 被注入的 fetch 不是真的 fetch,`ctrl.abort()` 不会自动掐断手工造的流,这里让每一步等待
 * 都在 abort 时 reject,与真实 fetch 的可观察行为一致(websearch.test.ts 同款)。
 */
function fakeFetch(chunks: string[], opts: FetchOpts = {}, seen: SeenRequest[] = []): typeof fetch {
  const { status = 200, headerDelayMs = 0, gapMs = 0, neverEnd = false, contentType = "application/json" } = opts;
  return (async (url: string, init?: RequestInit) => {
    seen.push({ url, init: init ?? {} });
    const signal = init?.signal ?? undefined;
    if (headerDelayMs > 0) await abortable(headerDelayMs, signal);
    const encoder = new TextEncoder();
    let i = 0;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (i >= chunks.length) {
          if (!neverEnd) return controller.close();
          await abortable(60_000, signal);
          return;
        }
        if (gapMs > 0) await abortable(gapMs, signal);
        controller.enqueue(encoder.encode(chunks[i++]));
      },
    });
    return new Response(stream, { status, headers: { "content-type": contentType } });
  }) as unknown as typeof fetch;
}

const imagesResponse = (b64: string) => JSON.stringify({ created: 1, data: [{ b64_json: b64 }] });
const chatResponse = (dataUrl: string) =>
  JSON.stringify({
    choices: [{ message: { role: "assistant", content: "", images: [{ type: "image_url", image_url: { url: dataUrl } }] } }],
  });

// ───────────────────── 目标域白名单(验收 #3)─────────────────────

describe("生图的目标域白名单(docs/security.md §1 外呼组约束 2)", () => {
  it("放行内置白名单里的 https 地址", () => {
    expect(parseAllowedImageBaseUrl("https://api.openai.com/v1").hostname).toBe("api.openai.com");
    expect(parseAllowedImageBaseUrl("https://aigateway.variflight.com/api").pathname).toBe("/api");
  });

  it.each([
    ["非白名单 host", "https://evil.tld/v1"],
    ["白名单 host 的后缀伪装", "https://api.openai.com.evil.tld"],
    ["明文 http(key 会走在网线上)", "http://api.openai.com"],
    ["内嵌凭据", "https://u:p@api.openai.com"],
    ["带 query", "https://api.openai.com/v1?x=1"],
    ["带 fragment", "https://api.openai.com/v1#x"],
    ["不是绝对地址", "api.openai.com"],
    ["非 http 协议", "javascript:alert(1)"],
  ])("拒绝 %s", (_name, url) => {
    expect(() => parseAllowedImageBaseUrl(url)).toThrow(ImageGenError);
  });

  it("**与搜索白名单是两份清单**:搜索能用的 api.deepseek.com 在生图这边不放行", () => {
    expect(checkSearchBaseUrl("https://api.deepseek.com").ok).toBe(true);
    expect(() => parseAllowedImageBaseUrl("https://api.deepseek.com")).toThrow(ImageGenError);
  });

  it("runImageGen 在发请求**之前**就拒掉非白名单端点", async () => {
    const seen: SeenRequest[] = [];
    await expect(
      runImageGen("x", cfg({ baseUrl: "https://evil.tld" }), { fetchImpl: fakeFetch([imagesResponse(PNG_B64)], {}, seen) }),
    ).rejects.toMatchObject({ kind: "not_allowed_host" });
    expect(seen).toHaveLength(0);
  });
});

describe("imageEndpointUrl 兼容两种 baseUrl 写法", () => {
  it("以 /v1 结尾时直接拼,否则补 /v1;两种形态各自的路径", () => {
    expect(imageEndpointUrl("https://api.openai.com/v1", "images")).toBe("https://api.openai.com/v1/images/generations");
    expect(imageEndpointUrl("https://api.openai.com/v1/", "chat")).toBe("https://api.openai.com/v1/chat/completions");
    expect(imageEndpointUrl("https://gw.example/api", "images")).toBe("https://gw.example/api/v1/images/generations");
  });
});

// ───────────────────── 访客控不到网络原语(验收 #4)─────────────────────

describe("访客控不到网络原语", () => {
  it("images 形态:URL / headers / model / n / size 全部来自配置,prompt 只进 body 的 prompt", async () => {
    const seen: SeenRequest[] = [];
    await runImageGen("一只猫 https://evil.tld", cfg({ imageSize: "1536x1024" }), {
      fetchImpl: fakeFetch([imagesResponse(PNG_B64)], {}, seen),
    });
    expect(seen).toHaveLength(1);
    const [req] = seen;
    expect(req.url).toBe("https://api.openai.com/v1/images/generations");
    expect(req.init.method).toBe("POST");
    expect(req.init.redirect).toBe("manual");
    const headers = req.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${FAKE_KEY}`);
    const body = JSON.parse(String(req.init.body));
    expect(body).toEqual({ model: "gpt-image-2", prompt: "一只猫 https://evil.tld", n: 1, size: "1536x1024" });
  });

  it("images 形态:size 为空或 auto 时不发 size 字段(用上游默认)", () => {
    expect(buildImageRequestBody("p", cfg({ imageSize: null }))).toEqual({ model: "gpt-image-2", prompt: "p", n: 1 });
    expect(buildImageRequestBody("p", cfg({ imageSize: "auto" }))).toEqual({ model: "gpt-image-2", prompt: "p", n: 1 });
  });

  it("chat 形态:prompt 只进 messages[0].content,没有 size,URL 换成 chat/completions", async () => {
    const seen: SeenRequest[] = [];
    await runImageGen("画一只猫", cfg({ apiStyle: "chat", imageSize: "1024x1024" }), {
      fetchImpl: fakeFetch([chatResponse(`data:image/png;base64,${PNG_B64}`)], {}, seen),
    });
    expect(seen[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(JSON.parse(String(seen[0].init.body))).toEqual({
      model: "gpt-image-2",
      messages: [{ role: "user", content: "画一只猫" }],
    });
  });
});

// ───────────────────── 两种协议的解析(验收 #5)─────────────────────

describe("响应解析:两种协议", () => {
  it("images 形态取 data[0].b64_json,魔数决定类型", async () => {
    const out = await runImageGen("p", cfg(), { fetchImpl: fakeFetch([imagesResponse(PNG_B64)]) });
    expect(out.contentType).toBe("image/png");
    expect(out.bytes.equals(Buffer.from(PNG_B64, "base64"))).toBe(true);
  });

  it("chat 形态取 message.images[0].image_url.url 的 data URL;上游声明的 mime 不作数", async () => {
    // 声明 jpeg、实际是 gif:以魔数为准
    const out = await runImageGen("p", cfg({ apiStyle: "chat" }), {
      fetchImpl: fakeFetch([chatResponse(`data:image/jpeg;base64,${GIF_B64}`)]),
    });
    expect(out.contentType).toBe("image/gif");
  });

  it("chat 形态也认 content[] 里的 image_url 段", () => {
    const data = {
      choices: [{ message: { content: [{ type: "text", text: "给你" }, { type: "image_url", image_url: { url: `data:image/png;base64,${PNG_B64}` } }] } }],
    };
    expect(extractImagePayload(data, "chat")).toEqual({ kind: "inline", data: `data:image/png;base64,${PNG_B64}` });
  });

  it("**只回链接不回内联数据 → 失败,且不发第二个请求**(不抓链接)", async () => {
    const seen: SeenRequest[] = [];
    await expect(
      runImageGen("p", cfg(), {
        fetchImpl: fakeFetch([JSON.stringify({ data: [{ url: "https://cdn.example/x.png" }] })], {}, seen),
      }),
    ).rejects.toMatchObject({ kind: "upstream_failed" });
    expect(seen).toHaveLength(1);
    // chat 形态的 http(s) 链接同样只算「链接」
    expect(extractImagePayload(chatResponseObj("https://cdn.example/x.png"), "chat")).toEqual({ kind: "url" });
  });

  it("响应里没有图片数据 → empty;不是 JSON → upstream_failed;error 字段 → upstream_failed", async () => {
    await expect(runImageGen("p", cfg(), { fetchImpl: fakeFetch([JSON.stringify({ data: [] })]) })).rejects.toMatchObject({ kind: "empty" });
    await expect(runImageGen("p", cfg(), { fetchImpl: fakeFetch(["<html>oops"]) })).rejects.toMatchObject({ kind: "upstream_failed" });
    await expect(
      runImageGen("p", cfg(), { fetchImpl: fakeFetch([JSON.stringify({ error: { message: "content policy" } })]) }),
    ).rejects.toMatchObject({ kind: "upstream_failed" });
  });

  it("**不跟随重定向**:白名单只校验原始 URL", async () => {
    await expect(
      runImageGen("p", cfg(), { fetchImpl: fakeFetch([""], { status: 302 }) }),
    ).rejects.toMatchObject({ kind: "redirected" });
  });
});

function chatResponseObj(url: string) {
  return { choices: [{ message: { images: [{ image_url: { url } }] } }] };
}

// ───────────────────── 不是图片就不存(验收 #7)─────────────────────

describe("解码与魔数(不是图片就不存)", () => {
  it("四种图片类型都认得出来", () => {
    expect(decodeImagePayload(PNG_B64).contentType).toBe("image/png");
    expect(decodeImagePayload(GIF_B64).contentType).toBe("image/gif");
    expect(decodeImagePayload(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]).toString("base64")).contentType).toBe("image/jpeg");
    const webp = Buffer.from("UklGRiYAAABXRUJQVlA4IBoAAAAwAQCdASoBAAEAAgA0JaQAA3AA/vuUAAA=", "base64");
    expect(decodeImagePayload(webp.toString("base64")).contentType).toBe("image/webp");
  });

  it("一段 HTML 冒充图片 → bad_image(魔数认不出来)", () => {
    expect(() => decodeImagePayload(HTML_B64)).toThrow(expect.objectContaining({ kind: "bad_image" }));
    expect(() => decodeImagePayload(`data:image/png;base64,${HTML_B64}`)).toThrow(expect.objectContaining({ kind: "bad_image" }));
  });

  it("base64 非法(坏字符 / 长度不对齐)→ bad_image,不会解出半张图", () => {
    expect(() => decodeImagePayload("iVBOR!!!")).toThrow(expect.objectContaining({ kind: "bad_image" }));
    expect(() => decodeImagePayload("iVBORw0K1")).toThrow(expect.objectContaining({ kind: "bad_image" }));
    expect(() => decodeImagePayload("data:image/png,notbase64")).toThrow(expect.objectContaining({ kind: "bad_image" }));
  });

  it("空数据 → empty;换行折行的 base64 照样能解", () => {
    expect(() => decodeImagePayload("")).toThrow(expect.objectContaining({ kind: "empty" }));
    const wrapped = PNG_B64.replace(/(.{20})/g, "$1\n");
    expect(decodeImagePayload(wrapped).contentType).toBe("image/png");
  });

  it("**解码后超过 8 MiB 拒绝,且在分配内存之前就按 base64 长度挡**", () => {
    // 9 MiB 的 base64 长度(全是合法字符),不真的造那么大的 Buffer
    const b64 = "A".repeat(Math.ceil(((MAX_IMAGE_BYTES + 1024 * 1024) * 4) / 3 / 4) * 4);
    expect(() => decodeImagePayload(b64)).toThrow(expect.objectContaining({ kind: "oversize" }));
  });

  it("**代码常量与迁移 010 的 byte_size CHECK 同值**(重复常量由测试钉住)", async () => {
    const rows = await db.rawQueryAll<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'generated_images'::regclass AND contype = 'c'`,
    );
    const sizeCheck = rows.map((r) => r.def).find((d) => d.includes("byte_size"));
    expect(sizeCheck, "generated_images 上没有 byte_size 的 CHECK").toBeDefined();
    const m = /<=\s*(\d+)/.exec(sizeCheck!);
    expect(m, sizeCheck).not.toBeNull();
    expect(Number(m![1])).toBe(MAX_IMAGE_BYTES);
  });
});

// ───────────────────── 双计时器与体积上界(验收 #6)─────────────────────

describe("超时与体积上界", () => {
  it("**等响应头期间不受空闲超时约束**:idle 短于出图时间也不会被自己掐死", async () => {
    // idle 100ms < 出图 400ms < total 5s:若空闲计时器从发请求就起,这条必然 idle_timeout
    const out = await runImageGen("p", cfg({ idleTimeoutMs: 100, totalTimeoutMs: 5_000 }), {
      fetchImpl: fakeFetch([imagesResponse(PNG_B64)], { headerDelayMs: 400 }),
    });
    expect(out.contentType).toBe("image/png");
  });

  it("等响应头期间只受总时长约束:上游一直不出图 → total_timeout", async () => {
    await expect(
      runImageGen("p", cfg({ idleTimeoutMs: 100, totalTimeoutMs: 300 }), {
        fetchImpl: fakeFetch([imagesResponse(PNG_B64)], { headerDelayMs: 5_000 }),
      }),
    ).rejects.toMatchObject({ kind: "total_timeout" });
  });

  it("响应头之后空闲超时生效:上游给了头却不再推数据", async () => {
    await expect(
      runImageGen("p", cfg({ idleTimeoutMs: 200, totalTimeoutMs: 5_000 }), {
        fetchImpl: fakeFetch(['{"data":[{"b64_json":"'], { neverEnd: true }),
      }),
    ).rejects.toMatchObject({ kind: "idle_timeout" });
  });

  it("响应体分块慢慢来,不该被空闲超时误杀(每块都重置)", async () => {
    const body = imagesResponse(PNG_B64);
    const chunks = body.match(/.{1,40}/g)!;
    const out = await runImageGen("p", cfg({ idleTimeoutMs: 150, totalTimeoutMs: 10_000 }), {
      fetchImpl: fakeFetch(chunks, { gapMs: 60 }),
    });
    expect(out.contentType).toBe("image/png");
  });

  it("外部 signal 取消时原样抛 AbortError(会话被回收的路径)", async () => {
    const ac = new AbortController();
    const p = runImageGen("p", cfg(), {
      signal: ac.signal,
      fetchImpl: fakeFetch([imagesResponse(PNG_B64)], { headerDelayMs: 5_000 }),
    });
    setTimeout(() => ac.abort(), 50);
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });

  it("响应体超过 16 MiB 中断(oversize)", async () => {
    const chunk = "x".repeat(1024 * 1024);
    const chunks = Array.from({ length: 17 }, () => chunk);
    await expect(
      runImageGen("p", cfg({ totalTimeoutMs: 30_000, idleTimeoutMs: 10_000 }), { fetchImpl: fakeFetch(chunks) }),
    ).rejects.toMatchObject({ kind: "oversize" });
    expect(MAX_RESPONSE_BYTES).toBe(16 * 1024 * 1024);
  });

  it("**离开函数时一定放掉底层连接**:传给 fetch 的 signal 最终都是 aborted", async () => {
    for (const chunks of [[imagesResponse(PNG_B64)], ["<not json>"]]) {
      const seen: SeenRequest[] = [];
      await runImageGen("p", cfg(), { fetchImpl: fakeFetch(chunks, {}, seen) }).catch(() => undefined);
      expect(seen[0].init.signal?.aborted).toBe(true);
    }
  });
});

// ───────────────────── 凭据不外泄(验收 #8)─────────────────────

describe("凭据不外泄(docs/security.md §3)", () => {
  it("上游 4xx 回显了我们的 Authorization 头,错误文本里也不能有明文 key", async () => {
    const echo = JSON.stringify({ error: `bad auth header: Bearer ${FAKE_KEY}` });
    const err = await runImageGen("p", cfg(), { fetchImpl: fakeFetch([echo], { status: 401 }) }).catch((e) => e);
    expect(err).toBeInstanceOf(ImageGenError);
    expect(err.kind).toBe("http_error");
    expect(err.message).not.toContain(FAKE_KEY);
    expect(err.message).toContain("401");
  });

  it("不带 sk- 前缀的自定义网关 key 也要被抹掉(通用模式兜不住这类)", async () => {
    const hexKey = "9f3a2c1d8e7b6a5f4e3d2c1b0a9f8e7d";
    const err = await runImageGen("p", cfg({ apiKey: hexKey }), {
      fetchImpl: fakeFetch([`upstream saw ${hexKey}`], { status: 500 }),
    }).catch((e) => e);
    expect(err.message).not.toContain(hexKey);
    expect(err.message).toContain("[redacted]");
  });

  it("上游 error 字段里的 key 同样被抹掉(它进的是错误对象)", async () => {
    const err = await runImageGen("p", cfg(), {
      fetchImpl: fakeFetch([JSON.stringify({ error: { message: `key ${FAKE_KEY} invalid` } })]),
    }).catch((e) => e);
    expect(err.kind).toBe("upstream_failed");
    expect(err.message).not.toContain(FAKE_KEY);
  });

  it("进度文案里不含 key / host / model(R-TOOLS:配置面不公开)", async () => {
    const seen: ImageGenProgress[] = [];
    await runImageGen("p", cfg(), { fetchImpl: fakeFetch([imagesResponse(PNG_B64)]), onProgress: (p) => seen.push(p) });
    for (const p of seen) {
      const text = `${p.phase} ${p.detail}`;
      expect(text).not.toContain(FAKE_KEY);
      expect(text).not.toContain("api.openai.com");
      expect(text).not.toContain("gpt-image-2");
    }
  });
});

// ───────────────────── 阶段上报 ─────────────────────

describe("阶段上报(右栏三视图的可见性)", () => {
  it("发起 / 生成中 / 已回复 / 接收中 / 解码 按序出现,且总数受封顶约束", async () => {
    const seen: ImageGenProgress[] = [];
    const body = imagesResponse(PNG_B64);
    await runImageGen("p", cfg({ totalTimeoutMs: 10_000 }), {
      fetchImpl: fakeFetch(body.match(/.{1,10}/g)!, { headerDelayMs: 220 }),
      onProgress: (p) => seen.push(p),
      generatingTickMs: 50,
    });
    const phases = seen.map((p) => p.phase);
    expect(phases[0]).toBe("request");
    expect(phases).toContain("generating");
    expect(phases).toContain("accepted");
    expect(phases).toContain("receiving");
    expect(phases[phases.length - 1]).toBe("decoding");
    // generating 必须在 accepted 之前:响应头一到心跳就停
    expect(phases.lastIndexOf("generating")).toBeLessThan(phases.indexOf("accepted"));
    expect(seen.find((p) => p.phase === "generating")!.detail).toContain("已等待");
    expect(seen.length).toBeLessThanOrEqual(30);
  });

  it("onProgress 自己抛异常不影响结果", async () => {
    const out = await runImageGen("p", cfg(), {
      fetchImpl: fakeFetch([imagesResponse(PNG_B64)]),
      onProgress: () => {
        throw new Error("上报炸了");
      },
    });
    expect(out.contentType).toBe("image/png");
  });
});

// ───────────────────── 每日张数限额(验收 #9)─────────────────────

describe("第 4 层 · 每日生图张数(docs/security.md §1 第 4 层)", () => {
  const TODAY = "(now() AT TIME ZONE 'Asia/Shanghai')::date";
  const resetToday = () => db.rawExec(`DELETE FROM daily_quota WHERE day = ${TODAY}`);

  it("limit=0 表示不限", async () => {
    await resetToday();
    for (let i = 0; i < 5; i++) expect(await reserveImage(0)).toBe(true);
    await resetToday();
  });

  it("第 N+1 次占额失败,且失败不再累加计数;与搜索计数互不影响", async () => {
    await resetToday();
    expect(await reserveImage(2)).toBe(true);
    expect(await reserveImage(2)).toBe(true);
    expect(await reserveImage(2)).toBe(false);
    const row = await db.rawQueryRow<{ images: number; searches: number }>(
      `SELECT images::double precision AS images, searches::double precision AS searches
         FROM daily_quota WHERE day = ${TODAY}`,
    );
    expect(row?.images).toBe(2);
    expect(row?.searches).toBe(0);
    await resetToday();
  });

  it("并发占额不超发(靠库的一条原子 UPSERT)", async () => {
    await resetToday();
    const results = await Promise.all(Array.from({ length: 12 }, () => reserveImage(4)));
    expect(results.filter(Boolean)).toHaveLength(4);
    await resetToday();
  });
});

// ───────────────────── agent_image 写面 + 按归属供图(验收 #12 / #13)─────────────────────

async function newVisitor(tag: string): Promise<string> {
  const row = await db.rawQueryRow<{ id: string }>(
    `INSERT INTO visitors (token_hash, expires_at) VALUES ($1, now() + interval '1 day') RETURNING id`,
    `hash-${tag}-${Math.random()}`,
  );
  return row!.id;
}

/** 直接以 agent_image 身份跑一条语句;不经 image-db.ts,为的是验角色本身的授权面。 */
async function asAgentImage(fn: (tx: Transaction) => Promise<unknown>): Promise<void> {
  const tx = await db.begin();
  try {
    await tx.rawExec("SET LOCAL ROLE agent_image");
    await fn(tx);
    await tx.commit();
  } catch (err) {
    await tx.rollback().catch(() => undefined);
    throw err;
  }
}

describe("agent_image 角色 · 写面由 Postgres 限死", () => {
  const PNG = Buffer.from(PNG_B64, "base64");
  let sessionId: string;

  beforeEach(async () => {
    await db.exec`DELETE FROM sessions`;
    await db.exec`DELETE FROM visitors`;
    sessionId = (await createSession(await newVisitor("a"))).id;
  });

  it("能 INSERT generated_images —— 这是它存在的全部理由;外键检查不需要它读 sessions", async () => {
    await expect(
      asAgentImage((tx) =>
        tx.rawExec(
          `INSERT INTO generated_images (id, session_id, content_type, bytes, byte_size, etag)
           VALUES (gen_random_uuid(), $1::uuid, 'image/png', $2, $3, 'e')`,
          sessionId,
          PNG,
          PNG.length,
        ),
      ),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["读 generated_images", `SELECT id FROM generated_images`],
    ["改 generated_images", `UPDATE generated_images SET etag = 'x'`],
    ["删 generated_images", `DELETE FROM generated_images`],
    ["读 sessions", `SELECT id FROM sessions`],
    ["写 sessions", `UPDATE sessions SET title = 'x'`],
    ["写 messages", `INSERT INTO messages (session_id, seq, role, content) VALUES (gen_random_uuid(), 0, 'user', 'x')`],
    ["读 llm_config", `SELECT provider FROM llm_config`],
    ["读 imagegen_config", `SELECT provider FROM imagegen_config`],
    ["读 daily_quota", `SELECT day FROM daily_quota`],
  ])("%s → permission denied", async (_name, sql) => {
    await expect(asAgentImage((tx) => tx.rawExec(sql))).rejects.toThrow(/permission denied/);
  });

  it("insertGeneratedImageAsAgent 写得进去;会话不存在时外键失败而不是静默", async () => {
    const id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    await insertGeneratedImageAsAgent({ id, sessionId, contentType: "image/png", bytes: PNG, etag: "e1" });
    const row = await db.rawQueryRow<{ n: number }>(`SELECT COUNT(*)::int AS n FROM generated_images WHERE id = $1::uuid`, id);
    expect(row?.n).toBe(1);
    await expect(
      insertGeneratedImageAsAgent({
        id: "aaaaaaaa-bbbb-4ccc-8ddd-000000000000",
        sessionId: "00000000-0000-4000-8000-000000000000",
        contentType: "image/png",
        bytes: PNG,
        etag: "e2",
      }),
    ).rejects.toThrow();
  });

  it("库级 CHECK:content_type 只收四种、byte_size 有上界", async () => {
    await expect(
      db.rawExec(
        `INSERT INTO generated_images (id, session_id, content_type, bytes, byte_size, etag)
         VALUES (gen_random_uuid(), $1::uuid, 'image/svg+xml', $2, $3, 'e')`,
        sessionId,
        PNG,
        PNG.length,
      ),
    ).rejects.toThrow();
    await expect(
      db.rawExec(
        `INSERT INTO generated_images (id, session_id, content_type, bytes, byte_size, etag)
         VALUES (gen_random_uuid(), $1::uuid, 'image/png', $2, $3, 'e')`,
        sessionId,
        PNG,
        MAX_IMAGE_BYTES + 1,
      ),
    ).rejects.toThrow();
  });
});

describe("按归属供图(docs/security.md §6 R-IMAGEGEN 补记)", () => {
  const PNG = Buffer.from(PNG_B64, "base64");

  beforeEach(async () => {
    await db.exec`DELETE FROM sessions`;
    await db.exec`DELETE FROM visitors`;
  });

  it("同一访客拿得到字节;另一访客与随机访客回 null;删会话后行级联消失", async () => {
    const owner = await newVisitor("owner");
    const other = await newVisitor("other");
    const sessionId = (await createSession(owner)).id;
    const id = "11111111-2222-4333-8444-555555555555";
    await insertGeneratedImageAsAgent({ id, sessionId, contentType: "image/png", bytes: PNG, etag: "etag-1" });

    const mine = await getGeneratedImage(id, owner);
    expect(mine?.contentType).toBe("image/png");
    expect(mine?.etag).toBe("etag-1");
    expect(mine?.bytes.equals(PNG)).toBe(true);
    expect(await getGeneratedImage(id, other)).toBeNull();
    expect(await getGeneratedImage(id, "00000000-0000-4000-8000-000000000000")).toBeNull();

    await db.rawExec(`DELETE FROM sessions WHERE id = $1::uuid`, sessionId);
    const left = await db.rawQueryRow<{ n: number }>(`SELECT COUNT(*)::int AS n FROM generated_images WHERE id = $1::uuid`, id);
    expect(left?.n).toBe(0);
  });

  it("公开地址的扩展名由存下来的类型决定", () => {
    expect(publicImageUrl("11111111-2222-4333-8444-555555555555", "image/png")).toBe(
      "/api/agent/images/11111111-2222-4333-8444-555555555555.png",
    );
    expect(publicImageUrl("x", "image/jpeg")).toBe("/api/agent/images/x.jpg");
  });
});

// ───────────────────── 工具本身:从 prompt 到那行 markdown ─────────────────────

describe("generate_image 工具(经真实构造路径 + 注入 fetch)", () => {
  const PNG = Buffer.from(PNG_B64, "base64");
  const realFetch = globalThis.fetch;
  let sessionId: string;
  let visitorId: string;

  beforeEach(async () => {
    await db.exec`DELETE FROM sessions`;
    await db.exec`DELETE FROM visitors`;
    await db.rawExec(`DELETE FROM daily_quota WHERE day = (now() AT TIME ZONE 'Asia/Shanghai')::date`);
    visitorId = await newVisitor("tool");
    sessionId = (await createSession(visitorId)).id;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  /** 只启用 generate_image 的最小启用集合(不碰 tool_config,避免与 sandbox.test 抢表)。 */
  const imageOnly = (over: Partial<ActiveImageGenConfig> = {}): EnabledTools => ({
    names: [GENERATE_IMAGE_TOOL],
    definitions: [],
    sessionScoped: [GENERATE_IMAGE_TOOL],
    imageGen: cfg(over),
    fingerprint: "ig-only",
  });

  const callTool = async (enabled: EnabledTools, prompt: unknown, updates: unknown[] = []) => {
    const built = buildSessionTools(enabled, { sessionId, needsTitle: false });
    expect(built.names).toEqual([GENERATE_IMAGE_TOOL]);
    const [tool] = built.definitions;
    const out = await tool.execute("t1", { prompt } as never, undefined, (u) => updates.push(u), {} as never);
    return { text: out.content.map((c) => ("text" in c ? c.text : "")).join(""), details: out.details as Record<string, unknown> };
  };

  it("入参只有 prompt,additionalProperties 关死(访客控不到网络原语)", () => {
    const [tool] = buildSessionTools(imageOnly(), { sessionId, needsTitle: false }).definitions;
    const params = tool.parameters as unknown as { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean };
    expect(Object.keys(params.properties)).toEqual(["prompt"]);
    expect(params.required).toEqual(["prompt"]);
    expect(params.additionalProperties).toBe(false);
  });

  it("成功:图进了本会话名下,结果是一行可渲染的 markdown,details 不含配置面", async () => {
    globalThis.fetch = fakeFetch([imagesResponse(PNG_B64)]);
    const updates: unknown[] = [];
    const { text, details } = await callTool(imageOnly(), "一只戴帽子的猫 [test] (x)", updates);
    const m = /!\[([^\]]*)\]\((\/api\/agent\/images\/[0-9a-f-]{36}\.png)\)/.exec(text);
    expect(m, text).not.toBeNull();
    expect(m![1]).toBe("一只戴帽子的猫 test x"); // 会破坏 markdown 结构的字符被去掉
    const id = m![2].split("/").pop()!.replace(/\.png$/, "");
    expect(details.imageId).toBe(id);
    expect(details).not.toHaveProperty("provider");
    expect(details).not.toHaveProperty("model");
    // 图片真的在库里、归本访客
    const row = await getGeneratedImage(id, visitorId);
    expect(row?.bytes.equals(PNG)).toBe(true);
    // 阶段上报到了 onUpdate,且最后一段是写入图库
    const phases = updates.map((u) => (u as { details: { phase: string } }).details.phase);
    expect(phases[0]).toBe("request");
    expect(phases[phases.length - 1]).toBe("saving");
    for (const u of updates) expect(JSON.stringify(u)).not.toContain(FAKE_KEY);
  });

  it("上游失败 → 固定文案、isError 路径(throw),不含上游细节;额度已扣不退", async () => {
    globalThis.fetch = fakeFetch([`{"error":"boom ${FAKE_KEY}"}`], { status: 500 });
    const err = await callTool(imageOnly({ dailyImageLimit: 5 }), "x").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("生图失败");
    expect(err.message).not.toContain("500");
    expect(err.message).not.toContain(FAKE_KEY);
    const row = await db.rawQueryRow<{ images: number }>(
      `SELECT images::double precision AS images FROM daily_quota WHERE day = (now() AT TIME ZONE 'Asia/Shanghai')::date`,
    );
    expect(row?.images).toBe(1);
  });

  it("额度用尽 → 固定的「今日生图次数已用完」文案,且不发请求", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    expect(await reserveImage(1)).toBe(true); // 把今天唯一的一次额度占掉
    const err = await callTool(imageOnly({ dailyImageLimit: 1 }), "x").catch((e) => e);
    expect(err.message).toContain("今日生图次数已用完");
    expect(calls).toBe(0);
  });

  it("超时 → 「生图超时」文案", async () => {
    globalThis.fetch = fakeFetch([imagesResponse(PNG_B64)], { headerDelayMs: 5_000 });
    const err = await callTool(imageOnly({ totalTimeoutMs: 200, idleTimeoutMs: 100 }), "x").catch((e) => e);
    expect(err.message).toContain("生图超时");
  });

  it("imageAltText:取首行、去结构字符、截 80 字、空则固定文案", () => {
    expect(imageAltText("第一行 [a](b) `c`\n第二行")).toBe("第一行 a b c");
    expect(imageAltText("   ")).toBe("生成的图片");
    expect(imageAltText("x".repeat(100))).toHaveLength(81);
    expect(imageAltText("a\tbc")).toBe("a b c");
  });
});
