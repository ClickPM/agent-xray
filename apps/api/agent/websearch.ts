// R-WEBSEARCH:`web_search` 工具的外呼实现 —— 第 1 个**外呼组**工具
// (docs/security.md §1「工具分两组」的六条附加约束就落在本文件)。
//
// 【协议】OpenAI 系 **Responses API** 的服务端内置搜索:
//   POST {baseUrl}/v1/responses
//   { model, tools: [{ type: "web_search" }], input, stream: true }
// 读回 SSE:`response.output_text.delta` 累积正文,`response.completed` 带完整响应,
// `response.failed` / `response.incomplete` 是失败。搜索在**服务端**执行,
// 本进程不抓任何网页、不解析 HTML、不跟随任何链接。
//
// 【DeepSeek 与自建 AI 网关(CPA)是同一套协议】差异只有三个配置字段:
// baseUrl / modelId / toolType(DeepSeek 另接受带日期的 `web_search_2025_08_26`)。
// 所以这里是一份实现,不是两条代码路径 —— 「兼容 DeepSeek」在本文件里不需要任何分支。
//
// 【本文件不读库、不解密】配置由 `websearch-config.ts` 取好后作参数传进来。
// 这条边界让本文件可以被纯函数式地测试(注入 fetch),也让「凭据从哪来」只有一个答案。
import { safeErrorText, scrubString } from "../shared/redact";
import { checkBaseUrl } from "../shared/websearch-hosts";
import type { ActiveWebSearchConfig } from "./websearch-config";

/** 上游整段响应的字节上限。见 `runWebSearch` 里 `oversize` 的注释。 */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
/** 累积正文的字符上限;再往上没有意义(工具结果最终会被 `capText` 砍到 8000)。 */
const MAX_ANSWER_CHARS = 64 * 1024;
/** 最多回多少条来源。 */
const MAX_CITATIONS = 10;

// ───────────────────── 进度上报(右栏三视图的可见性)─────────────────────
//
// 【为什么外呼工具必须上报进度】本站的卖点是右栏那三个视图。一次搜索最长 180s,
// 不上报的话 Timeline 上就是一行 `tool_execution_start · web_search` 干等三分钟 ——
// 「agent 正在做什么」这个问题在最需要答案的那三分钟里恰好没有答案。
//
// 【为什么走 pi 的 onUpdate 而不是自己往 trace-bus 上推】`tool_execution_update`
// 是 pi 的 34 个扩展事件之一,已经在 `events.ts` 的白名单里(派生 partialResultPreview),
// 前端三视图也已经泛型地渲染它。自造一路事件等于在「34 种扩展事件」这个招牌上
// 挂一个不属于 pi 的东西,还要动前端 —— 两条都不划算。

/** 两次同 phase 上报之间的最小间隔。 */
const MIN_PROGRESS_INTERVAL_MS = 1_000;
/**
 * 单次搜索最多上报多少条。
 *
 * **这条闸不能省**:`response.output_text.delta` 是逐 token 推的,一次综述几千条。
 * 每一条 `tool_execution_update` 都要落库 + 走 SSE,而单会话回放上限是 5000 条
 * (`MAX_REPLAY_EVENTS`)—— 不封顶的话一次搜索就能把整个会话的轨迹冲掉。
 */
const MAX_PROGRESS_EVENTS = 30;

export type WebSearchPhase = "request" | "accepted" | "searching" | "composing";

export interface WebSearchProgress {
  phase: WebSearchPhase;
  /** 一句人话,直接进 Timeline 的行详情 */
  detail: string;
}

/** 外呼失败的统一类型。`kind` 只进服务端日志,给模型的永远是固定文案。 */
export class WebSearchError extends Error {
  constructor(
    readonly kind:
      | "not_allowed_host"
      | "bad_base_url"
      | "http_error"
      | "upstream_failed"
      | "idle_timeout"
      | "total_timeout"
      | "oversize"
      | "empty",
    message: string,
  ) {
    super(message);
    this.name = "WebSearchError";
  }
}

/**
 * 校验 baseUrl 并解析出目标 URL。判据在 `shared/websearch-hosts.ts`
 * (mcp 侧写入时用的是同一份实现;两处校验缺一不可,理由见那个文件)。
 *
 * 这里只负责把结果包成 `WebSearchError` —— 调用侧的失败要带 `kind` 进服务端日志,
 * 而写入侧要的是一句给所有者看的校验文案,两种形态不能共用一个抛点。
 */
export function parseAllowedBaseUrl(baseUrl: string): URL {
  const checked = checkBaseUrl(baseUrl);
  if (!checked.ok) {
    const kind = checked.reason.startsWith("host ") ? "not_allowed_host" : "bad_base_url";
    throw new WebSearchError(kind, `baseUrl 不可用:${checked.reason}`);
  }
  return checked.url;
}

/**
 * 兼容 baseUrl 的两种常见写法:以 `/v1` 结尾,或只写服务根路径。
 * (`https://api.deepseek.com` → `/v1/responses`;
 *  `https://aigateway.variflight.com/api` → `/api/v1/responses`)
 */
export function responsesUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return /\/v1$/i.test(trimmed) ? `${trimmed}/responses` : `${trimmed}/v1/responses`;
}

interface Citation {
  url: string;
  title: string;
}

/** Responses API 输出抽取:`output[]` 里 message 项的 `content[].text` 拼接。 */
export function extractText(data: unknown): string {
  const d = data as { output_text?: unknown; output?: unknown };
  if (typeof d?.output_text === "string" && d.output_text.trim()) return d.output_text.trim();
  const out = Array.isArray(d?.output) ? d.output : [];
  const parts: string[] = [];
  for (const item of out) {
    const it = item as { type?: unknown; content?: unknown };
    if (it?.type === "message" && Array.isArray(it.content)) {
      for (const c of it.content) {
        const text = (c as { text?: unknown })?.text;
        if (typeof text === "string") parts.push(text);
      }
    }
  }
  return parts.join("\n").trim();
}

/**
 * 抽 `url_citation` 注解里的真实来源 URL。
 *
 * 【为什么值得多这十几行】网关综述出来的 prose 里,来源常常只是「据某站报道」这种
 * 没法核对的说法。真实 URL 就在同一份响应的 `annotations` 里,取出来之后:
 * 模型能在回答里给出可点的链接,轨迹面板上也看得见这一轮到底读了什么。
 * 纯读取,不发起任何额外请求 —— 与「不抓网页」那条不冲突。
 */
export function extractCitations(data: unknown): Citation[] {
  const out = Array.isArray((data as { output?: unknown })?.output)
    ? ((data as { output: unknown[] }).output as unknown[])
    : [];
  const seen = new Set<string>();
  const cites: Citation[] = [];
  for (const item of out) {
    const content = (item as { content?: unknown })?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      const anns = (c as { annotations?: unknown })?.annotations;
      if (!Array.isArray(anns)) continue;
      for (const a of anns) {
        const ann = a as { type?: unknown; url?: unknown; title?: unknown };
        if (ann?.type !== "url_citation" || typeof ann.url !== "string") continue;
        // 来源 URL 会被原样写进工具结果 → 模型上下文 → 轨迹面板。只收 http(s):
        // 一条 `javascript:` 的"来源"在前端是一个可点的注入面。
        if (!/^https?:\/\//i.test(ann.url)) continue;
        if (seen.has(ann.url)) continue;
        seen.add(ann.url);
        cites.push({ url: ann.url, title: typeof ann.title === "string" ? ann.title : "" });
        if (cites.length >= MAX_CITATIONS) return cites;
      }
    }
  }
  return cites;
}

export interface WebSearchOutcome {
  text: string;
  citations: Citation[];
}

/**
 * 一次联网搜索。
 *
 * 【访客控得到什么】只有 `query`,而它只落进请求体的 `input` 字段。
 * URL / method / headers / model / tools 全部来自服务端配置(docs/security.md §1
 * 外呼组约束 1)。本函数没有任何参数能影响「打给谁」。
 *
 * 【双计时器】收到任何数据块就重置空闲计时;总时长是硬上限。
 * 单一硬超时在这里是不够用的:网关侧「搜索 + 综述」常越过 90s,而一个真的卡死的
 * 连接又不该占满 180s —— 两个计时器各管一件事。
 *
 * `fetchImpl` 只为测试注入而存在,生产路径永远是全局 `fetch`。
 */
export async function runWebSearch(
  query: string,
  cfg: ActiveWebSearchConfig,
  opts: {
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
    /** 阶段上报;调用方接到 pi 的 `onUpdate` 上,见文件中部「进度上报」段 */
    onProgress?: (p: WebSearchProgress) => void;
  } = {},
): Promise<WebSearchOutcome> {
  // 调用前再校验一次:配置可能是白名单收紧之前写进库的
  parseAllowedBaseUrl(cfg.baseUrl);
  const doFetch = opts.fetchImpl ?? fetch;

  // 节流后的进度上报:phase 变化立刻放行,同 phase 内按 MIN_PROGRESS_INTERVAL_MS
  // 限流,整次搜索封顶 MAX_PROGRESS_EVENTS 条。
  let emitted = 0;
  let lastPhase: WebSearchPhase | null = null;
  let lastAt = 0;
  const progress = (phase: WebSearchPhase, detail: string) => {
    if (!opts.onProgress || emitted >= MAX_PROGRESS_EVENTS) return;
    const now = Date.now();
    if (phase === lastPhase && now - lastAt < MIN_PROGRESS_INTERVAL_MS) return;
    lastPhase = phase;
    lastAt = now;
    emitted += 1;
    // 上报本身绝不能掀掉搜索:onUpdate 由 pi 提供,它抛了不是我们的问题
    try {
      opts.onProgress({ phase, detail });
    } catch {
      /* ignore */
    }
  };

  progress("request", `向 ${new URL(cfg.baseUrl).hostname} 发起搜索请求(model=${cfg.modelId})`);

  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (opts.signal) {
    if (opts.signal.aborted) ctrl.abort();
    else opts.signal.addEventListener("abort", onAbort, { once: true });
  }

  let abortCause: "idle" | "total" | "oversize" | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      abortCause = "idle";
      ctrl.abort();
    }, cfg.idleTimeoutMs);
  };
  const totalTimer = setTimeout(() => {
    abortCause = "total";
    ctrl.abort();
  }, cfg.totalTimeoutMs);
  resetIdle();

  try {
    const res = await doFetch(responsesUrl(cfg.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model: cfg.modelId,
        tools: [{ type: cfg.toolType }],
        input: `联网搜索并给出带来源的简明答案。${query}`,
        stream: true,
      }),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new WebSearchError(
        "http_error",
        `上游 HTTP ${res.status}: ${redactUpstream(body, cfg.apiKey).slice(0, 300)}`,
      );
    }

    // 网关若忽略 stream 参数、回一个普通 JSON,按非流式解析(优雅降级,与参考实现一致)
    const ctype = res.headers.get("content-type") ?? "";
    if (!ctype.includes("text/event-stream")) {
      const data = await res.json();
      return finish(extractText(data), extractCitations(data));
    }
    if (!res.body) throw new WebSearchError("upstream_failed", "流式响应无 body");
    progress("accepted", "上游已接单,开始接收事件流");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let answer = "";
    let finalResponse: unknown = null;
    let failed: string | null = null;
    let receivedBytes = 0;
    let searchStages = 0;

    const handleEvent = (jsonStr: string) => {
      if (!jsonStr || jsonStr === "[DONE]") return;
      let evt: { type?: unknown; delta?: unknown; response?: unknown };
      try {
        evt = JSON.parse(jsonStr);
      } catch {
        return; // 半条 / 非 JSON 的 data 行直接忽略,不让一行坏数据掀掉整次搜索
      }
      switch (evt?.type) {
        case "response.output_text.delta":
          if (typeof evt.delta === "string" && answer.length < MAX_ANSWER_CHARS) {
            answer += evt.delta;
          }
          // 综述阶段:逐 token 推,靠 progress() 的节流压成每秒至多一条
          progress("composing", `正在综述回答(已 ${answer.length} 字)`);
          break;
        case "response.completed":
          finalResponse = evt.response ?? null;
          break;
        case "response.failed":
          failed =
            (evt.response as { error?: { message?: string } } | undefined)?.error?.message ??
            "服务端处理失败";
          break;
        case "response.incomplete":
          failed = `响应不完整: ${
            (evt.response as { incomplete_details?: { reason?: string } } | undefined)
              ?.incomplete_details?.reason ?? "unknown"
          }`;
          break;
        default:
          // 检索阶段的事件名各家略有出入(`response.web_search_call.in_progress` /
          // `.searching` / `.completed`,以及包着 `web_search_call` 的
          // `response.output_item.added`)。这里**不枚举**具体名字:枚举错一个
          // 就是少一段可见性,而判据只需要「这条事件跟检索有关」。
          // 事件名是上游给的字符串,只用来选一句我们自己的文案,不外显。
          if (typeof evt?.type === "string" && evt.type.includes("web_search")) {
            searchStages += 1;
            progress("searching", `网关正在检索(第 ${searchStages} 个检索事件)`);
          }
          break; // 其余事件(created / in_progress / reasoning…)不消费
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      resetIdle(); // 收到数据块 = 服务端存活
      // 【为什么要有字节上限】空闲计时器只管「有没有数据」,不管「数据有多少」:
      // 一个每秒推一个字节的上游可以合法地占满整个 total 窗口,而一个疯狂推流的
      // 上游能在 180s 里把内存吃光。这条闸管的是后者。
      receivedBytes += value?.byteLength ?? 0;
      if (receivedBytes > MAX_RESPONSE_BYTES) {
        abortCause = "oversize";
        ctrl.abort();
        throw new WebSearchError("oversize", `上游响应超过 ${MAX_RESPONSE_BYTES} 字节上限`);
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (t.startsWith("data:")) handleEvent(t.slice(5).trim());
      }
    }
    // 流干净结束但最后一行没带换行符时,buffer 里还剩一条完整事件
    if (buffer.trim().startsWith("data:")) handleEvent(buffer.trim().slice(5).trim());

    // 上游的错误文案同样是外部文本,同样过一遍 —— 它进的是错误对象,不只是日志
    if (failed) throw new WebSearchError("upstream_failed", redactUpstream(failed, cfg.apiKey));
    if (finalResponse) {
      const text = extractText(finalResponse);
      return finish(text !== "" ? text : answer.trim(), extractCitations(finalResponse));
    }
    return finish(answer.trim(), []);
  } catch (err) {
    if (err instanceof WebSearchError) throw err;
    if ((err as { name?: string })?.name === "AbortError") {
      if (abortCause === "idle") {
        throw new WebSearchError(
          "idle_timeout",
          `空闲超时:${Math.round(cfg.idleTimeoutMs / 1000)}s 内上游未推送任何数据`,
        );
      }
      if (abortCause === "total") {
        throw new WebSearchError(
          "total_timeout",
          `总时长超时:超过 ${Math.round(cfg.totalTimeoutMs / 1000)}s 上限`,
        );
      }
      if (abortCause === "oversize") {
        throw new WebSearchError("oversize", `上游响应超过 ${MAX_RESPONSE_BYTES} 字节上限`);
      }
      // abortCause 为空 = 是外部 signal 取消的(会话被回收),原样抛给调用方
      throw err;
    }
    // 网络层异常(DNS / TLS / 连接重置)。`safeErrorText` 打通用凭据形态,
    // `redactUpstream` 再补一道本次 key 的精确替换(自定义网关的 key 常不带 sk- 前缀)。
    throw new WebSearchError(
      "upstream_failed",
      `外呼失败: ${redactUpstream(safeErrorText(err), cfg.apiKey)}`,
    );
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    clearTimeout(totalTimer);
    if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
  }
}

/**
 * 上游文本 → 可以安全放进**错误对象**的文本。
 *
 * 【为什么不能只靠调用点的 `safeErrorText`】那只保证「写进日志的那一行」是干净的,
 * 而一个带着明文 key 的 `Error` 对象本身会被传递、被别处 catch、被将来某个人
 * 直接 `console.error(err)`。凭据不该活到那一步 —— **在构造错误的地方就抹掉**。
 * (单测:上游把我们的 Authorization 头原样回显进 400 的响应体,实测复现过。)
 *
 * 两道叠着用,顺序无所谓:
 *   - `scrubString` —— 通用形态(sk-/rk-/pk-/sess- 前缀串、`Bearer …`),
 *     连"上游回显的是**别人**的 key"也一起打掉;
 *   - 精确替换本次用的 key —— 形态不符合上面那几个模式的自定义网关 key
 *     (纯十六进制、UUID…)只有这一道能兜住。
 */
function redactUpstream(text: string, apiKey: string): string {
  const scrubbed = scrubString(text);
  return apiKey.length >= 8 ? scrubbed.split(apiKey).join("[redacted]") : scrubbed;
}

/** 空结果要是**失败**而不是一句「没搜到」:后者会被模型当成「确实不存在」。 */
function finish(text: string, citations: Citation[]): WebSearchOutcome {
  if (text === "") throw new WebSearchError("empty", "上游未返回任何正文");
  return { text, citations };
}
