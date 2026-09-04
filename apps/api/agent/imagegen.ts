// R-IMAGEGEN:`generate_image` 工具的外呼实现 —— 第 2 个**外呼组**工具
// (docs/security.md §1「工具分两组」的六条附加约束在生图侧的落点)。
//
// 【协议】OpenAI 系两种形态,由 provider 配置的 `api_style` 决定(不是两个工具,理由见任务卡):
//   images —— POST {baseUrl}/v1/images/generations   { model, prompt, n:1, size? }
//             图在 data[0].b64_json(纯 base64)
//   chat   —— POST {baseUrl}/v1/chat/completions      { model, messages:[{role:"user", content}] }
//             图在 choices[0].message.images[0].image_url.url(data:image/…;base64, 内联)
// 两条路径共享的部分才是安全性质所在:域白名单 / 重定向拒绝 / 双计时器 / 字节上界 /
// 凭据脱敏 / 「不是图片就不要」的魔数判定。**只收内联数据**:上游只回 `url` 时报失败,
// 本进程不去抓那个链接 —— 「让服务器取一个上游给的地址」与 SSRF 是同一类事。
//
// 【与 websearch.ts 的一处刻意不同】空闲计时器**在响应头到达后才起**。生图是非流式的,
// 上游出图前一个字节都不发(常见 20–90s),若从发请求那一刻就计空闲,每次正常的生图
// 都会在 30s 上被自己掐死;等头那段只受总时长约束,期间每 10s 上报一次「生成中」。
//
// 【本文件不读库、不解密、不写库】配置由 `imagegen-config.ts` 取好后作参数传进来,
// 图片字节由 `tools.ts` 拿去经 `image-db.ts` 落库。这里可以被纯函数式地测试(注入 fetch)。
import { readBodyCapped } from "../shared/http-body";
import { sniffImageType, type ImageContentType } from "../shared/image-magic";
import { checkImageBaseUrl } from "../shared/imagegen-hosts";
import { redactSecret, safeErrorText } from "../shared/redact";
import type { ActiveImageGenConfig, ImageApiStyle } from "./imagegen-config";

/**
 * 上游整段响应的字节上限。一张 8 MiB 的图经 base64 是 ~10.7 MiB,再加 JSON 外壳;
 * 16 MiB 留足余量而不至于让一个坏上游把容器内存吃光(mem_limit 1g)。
 */
export const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
/**
 * 解码后图片的字节上限。**必须与迁移 010 的 `byte_size` CHECK 同值**(imagegen.test.ts 从
 * information_schema 读那条 CHECK 比对)。代码这道是「不把大东西读进内存」,库那道是
 * 「就算代码漏了也进不了库」。
 */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// ───────────────────── 进度上报(右栏三视图的可见性)─────────────────────
//
// 理由与 websearch.ts 同段注释一致:一次生图最长 180s,不上报的话 Timeline 上就是一行
// `tool_execution_start · generate_image` 干等三分钟。走 pi 的 onUpdate → `tool_execution_update`
// (34 事件之一,已在 events.ts 白名单里),前端零改动。

/** 两次同 phase 上报之间的最小间隔。 */
const MIN_PROGRESS_INTERVAL_MS = 1_000;
/** 单次生图最多上报多少条(单会话回放上限 5000,一次外呼不该把轨迹冲掉)。 */
const MAX_PROGRESS_EVENTS = 30;
/** 等响应头期间的「生成中」心跳间隔。30 条封顶 × 10s = 300s,正好盖住 CHECK 的总时长上界。 */
const GENERATING_TICK_MS = 10_000;

export type ImageGenPhase = "request" | "generating" | "accepted" | "receiving" | "decoding";

export interface ImageGenProgress {
  phase: ImageGenPhase;
  /** 一句人话,直接进 Timeline 的行详情。**不含 host / model / key**(R-TOOLS:配置面不公开) */
  detail: string;
}

/** 外呼失败的统一类型。`kind` 只进服务端日志,给模型的永远是固定文案。 */
export class ImageGenError extends Error {
  constructor(
    readonly kind:
      | "not_allowed_host"
      | "bad_base_url"
      | "redirected"
      | "http_error"
      | "upstream_failed"
      | "idle_timeout"
      | "total_timeout"
      | "oversize"
      | "empty"
      | "bad_image",
    message: string,
  ) {
    super(message);
    this.name = "ImageGenError";
  }
}

/**
 * 校验 baseUrl 并解析出目标 URL。判据在 `shared/imagegen-hosts.ts`(mcp 侧写入时用的是同一份;
 * 两处校验缺一不可,理由见 `shared/outbound-hosts.ts`)。
 */
export function parseAllowedImageBaseUrl(baseUrl: string): URL {
  const checked = checkImageBaseUrl(baseUrl);
  if (!checked.ok) {
    const kind = checked.reason.startsWith("host ") ? "not_allowed_host" : "bad_base_url";
    throw new ImageGenError(kind, `baseUrl 不可用:${checked.reason}`);
  }
  return checked.url;
}

/**
 * 兼容 baseUrl 的两种常见写法:以 `/v1` 结尾,或只写服务根路径(与 websearch 的 responsesUrl 同款)。
 * (`https://api.openai.com/v1` → `/v1/images/generations`;`https://gw.example/api` → `/api/v1/…`)
 */
export function imageEndpointUrl(baseUrl: string, style: ImageApiStyle): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  const root = /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`;
  return style === "chat" ? `${root}/chat/completions` : `${root}/images/generations`;
}

/**
 * 请求体。**访客控得到的只有 `prompt`**,且它只落进一个字段;model / n / size 全部来自配置
 * (docs/security.md §1 外呼组约束 1)。导出只为测试能断言这一点。
 */
export function buildImageRequestBody(prompt: string, cfg: ActiveImageGenConfig): Record<string, unknown> {
  if (cfg.apiStyle === "chat") {
    return { model: cfg.modelId, messages: [{ role: "user", content: prompt }] };
  }
  // 与参考插件一致:size 为空或 auto 时不发这个字段,用上游默认
  const size = cfg.imageSize && cfg.imageSize !== "auto" ? cfg.imageSize : undefined;
  return { model: cfg.modelId, prompt, n: 1, ...(size !== undefined && { size }) };
}

export type ImagePayload =
  /** 内联的 base64(可能带 data: 前缀) */
  | { kind: "inline"; data: string }
  /** 上游只给了链接。我们**不抓**,报失败(外呼组约束 1:api 进程内的工具不碰任何 URL;唯一例外是沙箱执行组 egress 档的 web-fetch skill,在独立容器里 —— docs/security.md R-WEBFETCH 补记) */
  | { kind: "url" };

/**
 * 从上游 JSON 里取第一张图。两种形态各自的字段路径写死,不做「猜字段」:
 * 猜错的代价是把一段不是图的东西当图存进库。
 */
export function extractImagePayload(data: unknown, style: ImageApiStyle): ImagePayload | null {
  if (style === "images") {
    const first = (data as { data?: unknown[] })?.data?.[0] as
      | { b64_json?: unknown; url?: unknown }
      | undefined;
    if (typeof first?.b64_json === "string" && first.b64_json !== "") {
      return { kind: "inline", data: first.b64_json };
    }
    if (typeof first?.url === "string" && first.url !== "") return { kind: "url" };
    return null;
  }
  const msg = (data as { choices?: Array<{ message?: unknown }> })?.choices?.[0]?.message as
    | { images?: unknown; content?: unknown }
    | undefined;
  const candidates: unknown[] = [];
  if (Array.isArray(msg?.images)) candidates.push(...msg.images);
  // 有的兼容网关把图放进 content 的多段里(type: image_url),一并认
  if (Array.isArray(msg?.content)) {
    candidates.push(...msg.content.filter((c) => (c as { type?: unknown })?.type === "image_url"));
  }
  for (const c of candidates) {
    const url = (c as { image_url?: { url?: unknown } })?.image_url?.url;
    if (typeof url !== "string" || url === "") continue;
    return url.startsWith("data:") ? { kind: "inline", data: url } : { kind: "url" };
  }
  return null;
}

export interface DecodedImage {
  bytes: Buffer;
  contentType: ImageContentType;
}

/**
 * base64(可带 data: 前缀)→ 字节 + 魔数判定的类型。
 *
 * 三道闸,顺序有讲究:
 *   1. **先按 base64 长度估算大小再解码**:一段 100 MiB 的 base64 不该先被 `Buffer.from` 整个展开;
 *   2. base64 必须合法(标准字母表、长度对齐)—— `Buffer.from` 会静默吞掉非法字符,解出半张图;
 *   3. **上游声明的 mime 不作数,以魔数为准**(shared/image-magic.ts):认不出来就不是图,
 *      而供图端点会把类型原样出成响应头,一个「声称是 png 的 HTML」就是存储型 XSS。
 */
export function decodeImagePayload(raw: string): DecodedImage {
  let b64 = raw;
  if (raw.startsWith("data:")) {
    const m = /^data:[^;,]*;base64,(.*)$/s.exec(raw);
    if (!m) throw new ImageGenError("bad_image", "上游返回的 data URL 不是 base64 形态");
    b64 = m[1];
  }
  b64 = b64.replace(/\s+/g, "");
  if (b64 === "") throw new ImageGenError("empty", "上游返回的图片数据为空");
  // base64 每 4 字符 3 字节;先按长度挡,免得先分配再发现太大
  if (Math.floor((b64.length * 3) / 4) > MAX_IMAGE_BYTES + 3) {
    throw new ImageGenError("oversize", `上游返回的图片超过 ${MAX_IMAGE_BYTES} 字节上限`);
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4 !== 0) {
    throw new ImageGenError("bad_image", "上游返回的图片数据不是合法的 base64");
  }
  const bytes = Buffer.from(b64, "base64");
  if (bytes.length === 0) throw new ImageGenError("empty", "上游返回的图片数据为空");
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new ImageGenError("oversize", `上游返回的图片超过 ${MAX_IMAGE_BYTES} 字节上限`);
  }
  const contentType = sniffImageType(bytes);
  if (!contentType) {
    throw new ImageGenError("bad_image", "上游返回的不是可识别的图片(只接受 png / jpeg / webp / gif)");
  }
  return { bytes, contentType };
}

/**
 * 一次生图。
 *
 * 【访客控得到什么】只有 `prompt`,而它只落进请求体的一个字段(见 `buildImageRequestBody`)。
 * URL / method / headers / model / size 全部来自服务端配置。本函数没有任何参数能影响「打给谁」。
 *
 * 【双计时器】总时长从发请求起计;空闲计时器**从响应头到达起**计,收到任何数据块就重置。
 * 等头期间每 10s 上报一次「生成中」,让 Timeline 在最需要答案的那一分钟里有答案。
 *
 * `fetchImpl` 只为测试注入而存在,生产路径永远是全局 `fetch`。
 */
export async function runImageGen(
  prompt: string,
  cfg: ActiveImageGenConfig,
  opts: {
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
    /** 阶段上报;调用方接到 pi 的 `onUpdate` 上 */
    onProgress?: (p: ImageGenProgress) => void;
    /** 「生成中」心跳间隔。只为测试注入而存在,生产路径永远是 GENERATING_TICK_MS */
    generatingTickMs?: number;
  } = {},
): Promise<DecodedImage> {
  // 调用前再校验一次:配置可能是白名单收紧之前写进库的
  parseAllowedImageBaseUrl(cfg.baseUrl);
  const doFetch = opts.fetchImpl ?? fetch;

  // 节流后的进度上报:phase 变化立刻放行,同 phase 内按 MIN_PROGRESS_INTERVAL_MS 限流,
  // 整次生图封顶 MAX_PROGRESS_EVENTS 条。
  let emitted = 0;
  let lastPhase: ImageGenPhase | null = null;
  let lastAt = 0;
  const progress = (phase: ImageGenPhase, detail: string) => {
    if (!opts.onProgress || emitted >= MAX_PROGRESS_EVENTS) return;
    const now = Date.now();
    if (phase === lastPhase && now - lastAt < MIN_PROGRESS_INTERVAL_MS) return;
    lastPhase = phase;
    lastAt = now;
    emitted += 1;
    // 上报本身绝不能掀掉生图:onUpdate 由 pi 提供,它抛了不是我们的问题
    try {
      opts.onProgress({ phase, detail });
    } catch {
      /* ignore */
    }
  };

  // 【文案里不带 host / model】R-TOOLS 裁定 provider 与 model 名是配置面,不公开;
  // 而这段文字会进 tool_execution_update → 公开的 /trace/stream
  progress("request", `向生图网关发起请求(${cfg.apiStyle === "chat" ? "对话式" : "图片接口"}形态)`);

  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (opts.signal) {
    if (opts.signal.aborted) ctrl.abort();
    else opts.signal.addEventListener("abort", onAbort, { once: true });
  }

  // 是**我们**掐断的吗?是的话这里放着要抛的那个错误(存对象而不是字符串标记的理由见 websearch.ts)
  let abortReason: ImageGenError | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      abortReason = new ImageGenError(
        "idle_timeout",
        `空闲超时:响应体传输中断超过 ${Math.round(cfg.idleTimeoutMs / 1000)}s`,
      );
      ctrl.abort();
    }, cfg.idleTimeoutMs);
  };
  const totalTimer = setTimeout(() => {
    abortReason = new ImageGenError(
      "total_timeout",
      `总时长超时:超过 ${Math.round(cfg.totalTimeoutMs / 1000)}s 上限`,
    );
    ctrl.abort();
  }, cfg.totalTimeoutMs);
  // 等响应头期间的心跳:生图上游出图前一个字节都不发,这段时间 Timeline 不能空着
  const startedAt = Date.now();
  const ticker = setInterval(() => {
    progress("generating", `上游生成中(已等待 ${Math.round((Date.now() - startedAt) / 1000)}s)`);
  }, opts.generatingTickMs ?? GENERATING_TICK_MS);

  let receivedBytes = 0;
  const onChunk = (n: number) => {
    resetIdle(); // 收到数据块 = 服务端存活
    receivedBytes += n;
    progress("receiving", `接收图片数据(已 ${Math.round(receivedBytes / 1024)} KB)`);
  };
  const readCapped = (res: Response) =>
    readBodyCapped(res, {
      maxBytes: MAX_RESPONSE_BYTES,
      oversize: (max) => new ImageGenError("oversize", `上游响应超过 ${max} 字节上限`),
      onChunk,
    });

  try {
    const res = await doFetch(imageEndpointUrl(cfg.baseUrl, cfg.apiStyle), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
        Accept: "application/json",
      },
      body: JSON.stringify(buildImageRequestBody(prompt, cfg)),
      signal: ctrl.signal,
      // 【必须关掉自动跟随重定向】白名单只校验了**原始** URL,一个开放重定向就能把请求
      // (连同 Authorization 头,bun 实测会跟着跳)送到白名单外。理由与 websearch.ts 同段
      redirect: "manual",
    });
    // 响应头到了:心跳停,空闲计时器从这一刻起
    clearInterval(ticker);
    resetIdle();
    progress("accepted", "上游已回复,开始接收图片数据");

    if (res.status >= 300 && res.status < 400) {
      throw new ImageGenError(
        "redirected",
        `上游返回 ${res.status} 重定向,已拒绝跟随(目标域白名单只对原始 URL 生效)`,
      );
    }
    if (!res.ok) {
      // 错误体同样要封顶;上游会把请求头回显进错误体,所以在构造错误的地方就抹掉本次 key。
      // 【读错误体时的超时 / 超限必须原样往外抛】(codex 初审 P2)上一版是 `.catch(() => "")`:
      // 上游给了个 5xx 的头然后挂住不发 body,计时器掐断 → 这里吞成空串 → 报成 `http_error`,
      // 模型拿到的是「生图失败」而不是「生图超时」的后路指引,日志里的 kind 也是错的;
      // 一个 4xx 却回几百 MB 的错误体同样会被报成普通 HTTP 错误而不是 `oversize`。
      // 只把「读体本身的普通失败」(连接被上游关掉之类)当成空 body。
      const body = await readCapped(res).catch((err) => {
        if (err instanceof ImageGenError || (err as { name?: string })?.name === "AbortError") throw err;
        return "";
      });
      throw new ImageGenError(
        "http_error",
        `上游 HTTP ${res.status}: ${redactSecret(body, cfg.apiKey).slice(0, 300)}`,
      );
    }

    const raw = await readCapped(res);
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new ImageGenError("upstream_failed", "上游返回的不是合法 JSON");
    }
    const upstreamError = (data as { error?: unknown })?.error;
    if (upstreamError) {
      const text =
        typeof upstreamError === "string"
          ? upstreamError
          : ((upstreamError as { message?: unknown })?.message as string | undefined) ??
            JSON.stringify(upstreamError);
      throw new ImageGenError("upstream_failed", redactSecret(String(text), cfg.apiKey).slice(0, 300));
    }

    const payload = extractImagePayload(data, cfg.apiStyle);
    if (!payload) throw new ImageGenError("empty", "响应里没有图片数据");
    if (payload.kind === "url") {
      // 不抓链接:与「工具不接受 URL 入参」是同一条约束,只是方向反过来
      throw new ImageGenError(
        "upstream_failed",
        "上游只返回了图片链接而不是内联数据;本站不抓取链接,请让 provider 返回 b64_json / data URL",
      );
    }
    progress("decoding", "校验并解码图片");
    return decodeImagePayload(payload.data);
  } catch (err) {
    if (err instanceof ImageGenError) throw err;
    if ((err as { name?: string })?.name === "AbortError") {
      // 有 abortReason = 是我们的计时器掐的;没有 = 外部 signal 取消(会话被回收 / 本轮取消)
      if (abortReason) throw abortReason;
      throw err;
    }
    // 网络层异常(DNS / TLS / 连接重置)。`safeErrorText` 打通用凭据形态,
    // `redactSecret` 再补一道本次 key 的精确替换
    throw new ImageGenError("upstream_failed", `外呼失败: ${redactSecret(safeErrorText(err), cfg.apiKey)}`);
  } finally {
    // 【无论怎么离开这个函数,都要放掉底层连接】(R-WEBSEARCH codex 复审第 3 轮 P2 的教训:
    // `AbortController` 被 GC 不会取消 fetch)。成功路径上流已读完,这次 abort 是无害空操作。
    ctrl.abort();
    clearInterval(ticker);
    if (idleTimer) clearTimeout(idleTimer);
    clearTimeout(totalTimer);
    if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
  }
}
