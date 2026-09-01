// 访客 cookie 的**纯函数**部分(R-VISITOR)。约束来源:docs/security.md §6 的 R-VISITOR 补记。
//
// 放 shared/ 的理由与 sse.ts 相同:agent(发放/续期/归属过滤)与 trace(只判归属)两个服务
// 都要认这个 cookie,而两者不互相 import 内部实现。**本模块不碰数据库、不声明 secret**
// (CLAUDE.md 规则 5),库那一半在 apps/api/agent/visitor.ts。
//
// 【这个 cookie 与 metrics 的访客哈希不是一回事】`visits.visitor` 是按天轮换的
// sha256(salt‖day‖IP网段‖UA摘要),只服务于聚合统计;这里的 token 只回答「这些会话是谁的」,
// 不含任何 IP/UA 派生量,两者没有可以对上的字段(docs/security.md §6)。
import { createHash, randomBytes } from "node:crypto";

export const VISITOR_COOKIE = "xr_visitor";

/** 24h 滑动窗口(docs/security.md §6:每次带 cookie 的 agent 侧请求都会重发并推后)。 */
export const VISITOR_TTL_SECONDS = 24 * 60 * 60;

/** token 字节数;base64url 后 43 字符。 */
const TOKEN_BYTES = 32;

/**
 * cookie 值的形状白名单。
 *
 * **必须在查库之前挡一道**:cookie 是调用方完全可控的字符串,而它下一步要进 sha256 再进
 * 一次索引查询。不设上界的话,一个 1MB 的 cookie 值就是一次 1MB 的哈希 + 一次超长参数绑定。
 * 这与 §6 上半「哈希的每一个输入分量都必须有界」是同一条教训,只是那边挡的是 `/t` 的 IP/UA。
 * 范围放宽到 16–64 字符是给将来换 token 长度留的余量,不是给调用方自由。
 */
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** 新访客 token(只在会话被创建时发放,见 docs/security.md §6「发放时机」)。 */
export function newVisitorToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * cookie 明文 → 库里存的摘要。
 *
 * 库里**只有摘要**:泄漏一份 `visitors` 表拿不到任何可以冒充访客的凭据
 * (与 §3 管理面 token 同一套理由)。这里不需要加盐 —— token 本身就是 32 字节随机数,
 * 不存在字典/彩虹表可言,加盐只会让「按 token 查行」变成全表扫描。
 */
export function hashVisitorToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** 头值归一:node 的 `req.headers` 与 Encore 的 `currentRequest().headers` 形态不同。 */
function headerValue(raw: string | string[] | undefined): string | undefined {
  if (raw === undefined) return undefined;
  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * 从 `Cookie` 头里取出本站的访客 token;不存在或形状不合法一律 null。
 *
 * 手写而不引 cookie 解析库:要认的只有一个键,而多一个依赖就多一份供应链面(§7)。
 * 同名 cookie 出现多次时取**第一个**能通过形状校验的 —— 浏览器在 Domain/Path 不同的
 * 同名 cookie 之间就是这么发的,取到一个认不出的就放弃会让访客莫名其妙丢身份。
 */
export function readVisitorCookie(raw: string | string[] | undefined): string | null {
  const header = headerValue(raw);
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== VISITOR_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    if (TOKEN_RE.test(value)) return value;
  }
  return null;
}

/**
 * 请求是否经 HTTPS 到达 —— 决定 cookie 带不带 `Secure`。
 *
 * 【为什么不写死】备案期站点跑在 HTTP 上,写死 `Secure` 会让浏览器**静默丢弃**整个
 * cookie(表现是每次请求都是新访客、会话列表永远空);写死不带,又会在拿到证书之后
 * 留一个明文可截的身份 cookie。跟着反代告知的协议走,两个阶段都对。
 *
 * 【前提】Caddy 前面没有别的代理 —— 与 §6 上半 XFF 那条是同一个前提。这个头是
 * 调用方可伪造的,但伪造它的唯一效果是**给自己**的 cookie 去掉 Secure,伤不到别人。
 */
export function isSecureRequest(raw: string | string[] | undefined): boolean {
  const proto = headerValue(raw);
  if (!proto) return false;
  return proto.split(",")[0].trim().toLowerCase() === "https";
}

// ─────────────────────────────────────────────────────────────────────────────
// 【Path=/ 的连带义务 —— 新增 `expose: true` 端点时必须读这一段】(codex 复审 P1)
//
// `Path=/` 意味着浏览器会把这个 cookie 送到**每一个同源路径**上,包括那些根本不看它的
// 端点(`/api/notes/*`、`/api/about`、`/health`、`/rss.xml`、正文配图……)。而 Encore 默认
// 把请求头、响应头与处理函数返回值原样写进 trace —— 于是一个**可冒充身份的凭据**会从
// 那些无关端点漏进 trace(docs/security.md §6)。
//
// 因此本仓库的不变量是:**每一个 `expose: true` 的端点都必须带 `sensitive: true`**,
// 无论它是否使用访客身份。当前 16 个 expose 端点已全部覆盖(agent 5 · trace 1 · notes 5 ·
// about 1 · metrics 1 · mcp 1 · system 1)。新增端点漏掉这个标记不会报错、不会失败,
// 只会安静地把凭据抄进 trace —— 这正是它需要被写成一条不变量而不是逐处判断的原因。
// 判据(两条数字必须相等)写在 docs/security.md §6,注意 grep 要锚定行首:
// 直接搜 "expose: true" 会把**本段注释自己**算进去。
//
// 【为什么不改成 `Path=/api` 收窄范围】收不掉。codex 点到的那几条(`/api/notes/series`、
// `/api/about`)本来就在 `/api` 下面,换 Path 一条都挡不住;而它会让直连 `:4000` 的
// 本地调试(curl 的 cookie jar)悄悄失效,并把 cookie 与反代前缀绑死 —— 前缀一改,
// 表现是「所有人都变成新访客」而不是任何一处报错。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `Set-Cookie` 头。
 *
 * `SameSite=Lax` 是访客侧 CSRF 的**全部**防线,够用:带副作用的端点只有
 * `POST /agent/ask` 与 `DELETE /agent/sessions/:id`,都不是 GET,Lax 下跨站请求不带 cookie。
 * `HttpOnly` 压掉「XSS 直接偷身份」这条路。
 */
export function buildSetCookie(token: string, secure: boolean): string {
  const parts = [
    `${VISITOR_COOKIE}=${token}`,
    "Path=/",
    `Max-Age=${VISITOR_TTL_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
