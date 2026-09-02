// 联网搜索的**目标域白名单**(docs/security.md §1 外呼组约束 2)。
//
// 【为什么在 shared/】它有两个消费方,而它们**不许互相 import**
// (docs/security.md §4「两个面互不触碰」;`agent/llm-config.ts` 的注释同款口径):
//   - `agent/websearch.ts` —— 每次外呼前校验一次(库里可能躺着白名单收紧之前写下的行)
//   - `mcp/tools.ts`       —— 所有者写入 baseUrl 时校验一次(拒得早、看得见)
// 与 `shared/redact.ts` 当初从 agent 抽出来是同一个理由:同一份判据必须是同一份实现,
// 而不是两边各写一遍、然后慢慢漂移。**两处校验缺一不可**,不是重复:
// 写入侧防手误,调用侧防「先写进去、后收紧白名单」。
//
// 【为什么在代码里而不是库里】库(经 MCP)是所有者可写的面。白名单也放进去的话,
// 「管理 token 泄漏」就直接升级成「服务器可被当作任意 HTTP 代理」—— 而白名单
// 存在的全部意义就是让那件事做不到。库里只能在白名单**之内**挑一个。

/** 内置项。改它要发版。 */
const BUILTIN_ALLOWED_HOSTS = ["api.deepseek.com", "aigateway.variflight.com"] as const;

/** 可选**追加**项(逗号分隔)。 */
const EXTRA_HOSTS_ENV = "XRAY_WEBSEARCH_EXTRA_HOSTS";

/**
 * 生效的白名单 = 内置项 ∪ env 追加项。
 *
 * 【env 只做加法,不能替换】一个被写错 / 被清空的环境变量拿不掉内置约束 ——
 * 「配置错误」的后果应当是「少了一个可用端点」,而不能是「白名单没了」。
 *
 * 【读 `process.env` 在这里是允许的】docs/security.md §1 的「不读 process.env」
 * 约束的是**工具体**;本模块在加载期求值一次,也就是注册环节 —— 与 `tools.ts` 里
 * `XRAY_UNLOCK_DANGEROUS_TOOLS` 的双闸读同一位置、同一理由:工具执行时的行为
 * 不随进程环境变化,可测、可复现。
 */
const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  ...BUILTIN_ALLOWED_HOSTS,
  ...(process.env[EXTRA_HOSTS_ENV] ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h !== ""),
]);

/** 白名单快照(排序,便于写进错误文案与 MCP 的工具说明)。 */
export function allowedHosts(): string[] {
  return [...ALLOWED_HOSTS].sort();
}

export type BaseUrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

/**
 * 校验一个 websearch baseUrl。
 *
 * 【为什么回结果对象而不是抛】两个调用方要的错误形态不同:agent 侧要包成
 * `WebSearchError`(带 kind,进服务端日志),mcp 侧要变成一句给所有者看的
 * zod 校验文案。在这里选一种就得让另一边去 catch-and-rethrow。
 *
 * 四条,少一条都不行:
 *   - **必须 https**。API key 走 `Authorization` 头,明文 http 等于把它发在网线上
 *   - **host 精确相等**,不做后缀匹配。`endsWith("deepseek.com")` 会放行
 *     `api.deepseek.com.evil.tld` —— 这是这类白名单最常见的写法错误
 *   - **不许内嵌凭据**(`user:pass@host`):那不是我们的凭据通路,
 *     而且会让「这个地址指向谁」变得依赖解析细节
 *   - **不许带 query / fragment**:URL 由我们自己拼路径(`…/v1/responses`),
 *     baseUrl 上挂 `?` 之后拼出来的东西不再是一个可预测的地址
 */
export function checkBaseUrl(baseUrl: string): BaseUrlCheck {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return { ok: false, reason: "不是合法的绝对地址" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: `必须是 https(当前 ${url.protocol.replace(":", "")})` };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "不允许内嵌凭据" };
  }
  if (url.search !== "" || url.hash !== "") {
    return { ok: false, reason: "不允许带 query 或 fragment" };
  }
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    return {
      ok: false,
      reason: `host ${url.hostname} 不在目标域白名单内(可用:${allowedHosts().join(" / ")})`,
    };
  }
  return { ok: true, url };
}
