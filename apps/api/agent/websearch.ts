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
import { readBodyCapped } from "../shared/http-body";
import { redactSecret, safeErrorText } from "../shared/redact";
import { checkBaseUrl } from "../shared/websearch-hosts";
import type { ActiveWebSearchConfig } from "./websearch-config";

/** 上游整段响应的字节上限。见 `runWebSearch` 里 `oversize` 的注释。 */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
/** 累积正文的字符上限;再往上没有意义(工具结果最终会被 `capText` 砍到 8000)。 */
const MAX_ANSWER_CHARS = 64 * 1024;
/** 最多回多少条来源。导出只为 Tools 面板的输出形态说明引用它(R-TOOLS),不是给别人改的。 */
export const MAX_CITATIONS = 10;

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
      | "redirected"
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
 *  `https://gw.example/api` → `/api/v1/responses`)
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

  /**
   * 是**我们**掐断的吗?是的话这里放着要抛的那个错误。
   *
   * 【为什么存 Error 而不是一个 "idle" | "total" 的字符串标记】(codex 复审 P1)
   * 那个写法过不了 `tsc --noEmit`(TS2367):TypeScript **不追踪闭包里的赋值**,
   * 于是它按「初始值 null + try 块里那次直接赋值」把变量窄化成 `"oversize" | null`,
   * 再和 `"idle"` / `"total"` 比较就成了「两个类型没有交集」的错误。
   * 存错误对象之后判据变成一次真假判断,不再有字符串比较,narrowing 怎么算都不出错;
   * 顺带去掉了「先记一个标记、再在 catch 里照标记重新拼一遍消息」的重复。
   *
   * 【为什么 `dev.ps1 check` 没拦住】`encore check` 与 `bun --bun vitest` 都不跑
   * 全量 tsc(实测两者皆绿而 `tsc --noEmit` 红)。已记 rounds/BACKLOG.md。
   */
  let abortReason: WebSearchError | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      abortReason = new WebSearchError(
        "idle_timeout",
        `空闲超时:${Math.round(cfg.idleTimeoutMs / 1000)}s 内上游未推送任何数据`,
      );
      ctrl.abort();
    }, cfg.idleTimeoutMs);
  };
  const totalTimer = setTimeout(() => {
    abortReason = new WebSearchError(
      "total_timeout",
      `总时长超时:超过 ${Math.round(cfg.totalTimeoutMs / 1000)}s 上限`,
    );
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
      // 【必须关掉自动跟随重定向】(codex 初审 P1)`fetch` 默认 `follow`,
      // 而白名单只校验了**原始** URL —— 白名单内端点上的一个开放重定向,
      // 就能把这次请求送到白名单外、甚至内网地址(169.254.169.254 之类),
      // 目标域白名单当场失效。**bun 实测更糟**:同源重定向下
      // `Authorization: Bearer …` 会**原样跟着跳过去**。
      // `manual` 在 bun/undici 下返回真实的 3xx(status 可读、type=default),
      // 于是下面那个分支能给出确定的错误;`error` 只会抛一个笼统的 TypeError。
      redirect: "manual",
    });

    // 3xx 要在 `!res.ok` 之前单独判:两者都会走到这里,但原因完全不同,
    // 混在一起会让「网关配了个重定向」看起来像一次普通的上游报错。
    if (res.status >= 300 && res.status < 400) {
      throw new WebSearchError(
        "redirected",
        `上游返回 ${res.status} 重定向,已拒绝跟随(目标域白名单只对原始 URL 生效)`,
      );
    }

    if (!res.ok) {
      // 错误体同样要封顶:一个 4xx 也可以回几百 MB(codex 初审 P2 的同类问题)
      const body = await readTextCapped(res, resetIdle).catch(() => "");
      throw new WebSearchError(
        "http_error",
        `上游 HTTP ${res.status}: ${redactUpstream(body, cfg.apiKey).slice(0, 300)}`,
      );
    }

    // 网关若忽略 stream 参数、回一个普通 JSON,按非流式解析(优雅降级,与参考实现一致)。
    // 【不能用 `res.json()`】(codex 初审 P2)它把整个响应体缓冲下来再解析,
    // 完全绕开 MAX_RESPONSE_BYTES —— 那条闸此前只存在于下面的 SSE 读取循环里。
    // 一个出故障或被攻陷的白名单内 provider,可以在超时窗口内回一个巨大的 JSON
    // 把容器内存吃光。走同一个带计数的读取器,上界对两条路径一致。
    const ctype = res.headers.get("content-type") ?? "";
    if (!ctype.includes("text/event-stream")) {
      const raw = await readTextCapped(res, resetIdle);
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new WebSearchError("upstream_failed", "上游返回的既不是事件流也不是合法 JSON");
      }
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
        // 只抛,不在这里 abort:**连接的收尾统一在 `finally` 里做**(见那里的注释)。
        // 上一版这里写过一句「`ctrl` 随作用域结束」——那是错的,离开作用域不取消任何东西。
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
      // 有 abortReason = 是我们的计时器掐的;没有 = 外部 signal 取消
      // (会话被回收 / 本轮取消),那种情况原样抛给调用方
      if (abortReason) throw abortReason;
      throw err;
    }
    // 网络层异常(DNS / TLS / 连接重置)。`safeErrorText` 打通用凭据形态,
    // `redactUpstream` 再补一道本次 key 的精确替换(自定义网关的 key 常不带 sk- 前缀)。
    throw new WebSearchError(
      "upstream_failed",
      `外呼失败: ${redactUpstream(safeErrorText(err), cfg.apiKey)}`,
    );
  } finally {
    // 【无论怎么离开这个函数,都要放掉底层连接】(codex 复审第 3 轮 P2)
    //
    // 上一轮把超限分支里的 `ctrl.abort()` 删掉时,注释写的是「`ctrl` 随作用域结束」——
    // **那是错的**:`AbortController` 被 GC 不会取消 fetch,读到一半就抛出去的话,
    // reader 还锁着、连接还开着,直到服务端自己关或进程退出。白名单内的 provider
    // 出故障狂推数据时,每次搜索都能积一条这样的连接。
    //
    // 收在 `finally` 而不是逐个分支补 abort:分支会长新的(将来多一种中途失败就多一处漏),
    // 而「离开函数 = 连接一定被放掉」是个不会漏的结构性保证。
    // 成功路径上流已经读完,这次 abort 是无害的空操作。
    ctrl.abort();
    if (idleTimer) clearTimeout(idleTimer);
    clearTimeout(totalTimer);
    if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
  }
}

/**
 * 读完整个响应体,但**带字节上界**。
 *
 * `res.text()` / `res.json()` 都是"先全缓冲再说",一个回几百 MB 的上游能直接把
 * 容器内存吃光 —— 而 `MAX_RESPONSE_BYTES` 此前只管到 SSE 那条路径(codex 初审 P2)。
 * 非流式响应与错误体都走这里,两条路径的上界因而是同一个数。
 *
 * `onChunk` 用来重置空闲计时器(codex 复审 P2)。空闲计时器在 `fetch` **之前**就起了,
 * 而这条路径此前一个字都不重置它 —— 一个响应头很快、body 却要流上一分钟的上游
 * (非流式 JSON 或一个大错误体),会在**持续有数据**的情况下被空闲超时掐掉。
 * SSE 那条路径本来就每块重置,两条路径的判据必须一致。
 *
 * 实现在 `shared/http-body.ts`(R-IMAGEGEN 抽出,两个外呼工具共用);这里只给上界与错误类型。
 */
function readTextCapped(res: Response, onChunk?: () => void): Promise<string> {
  return readBodyCapped(res, {
    maxBytes: MAX_RESPONSE_BYTES,
    oversize: (max) => new WebSearchError("oversize", `上游响应超过 ${max} 字节上限`),
    onChunk,
  });
}

/**
 * 上游文本 → 可以安全放进**错误对象**的文本:通用凭据形态 + 本次 key 的精确替换。
 * 理由与两道判据写在 `shared/redact.ts` 的 `redactSecret`(R-IMAGEGEN 抽出,两个外呼工具共用)。
 */
function redactUpstream(text: string, apiKey: string): string {
  return redactSecret(text, apiKey);
}

/** 空结果要是**失败**而不是一句「没搜到」:后者会被模型当成「确实不存在」。 */
function finish(text: string, citations: Citation[]): WebSearchOutcome {
  if (text === "") throw new WebSearchError("empty", "上游未返回任何正文");
  return { text, citations };
}
