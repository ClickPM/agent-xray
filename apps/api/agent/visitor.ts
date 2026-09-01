// 访客身份的**库那一半**(R-VISITOR)。纯函数部分在 `shared/visitor-cookie.ts`,
// 约束来源是 docs/security.md §6 的 R-VISITOR 补记。
//
// 两个入口的分工是本轮的一条安全边界,不要合并:
//   resolveVisitor —— 只**认领**已有 cookie,从不发新的。读路径(会话列表/单查/轨迹)用它。
//   ensureVisitor  —— 认领不到就发一个新的。**只在会话真的会被创建时**调用。
// 反过来(读路径也发)的话,`GET /agent/sessions` 就成了一个无认证的建行入口,
// 一个 for 循环能把 visitors 灌成任意大 —— 与 §6 上半 `/t` 那条是同一个教训。
import { currentRequest } from "encore.dev";
import { db } from "./db";
import {
  buildSetCookie,
  hashVisitorToken,
  isSecureRequest,
  newVisitorToken,
  readVisitorCookie,
  VISITOR_TTL_SECONDS,
} from "../shared/visitor-cookie";

export interface Visitor {
  /** `sessions.visitor_id` 用的内部 id;**永不出服务端** */
  id: string;
  /**
   * 一整条 `Set-Cookie` 头。滑动窗口靠每次响应重发它续期,所以**每条路径都要带回去**。
   * 类型化端点经 `Header<string, "Set-Cookie">` 字段回,`api.raw` 直接写响应头 ——
   * 两边同一个字符串,cookie 属性只有 `buildSetCookie` 一个来源。
   */
  setCookie: string;
  /** cookie 明文。只在服务端内部用(测试断言、日志一律不打) */
  token: string;
  /** 本次请求是否经 HTTPS 到达(决定 cookie 带不带 `Secure`) */
  secure: boolean;
}

/** node:http 与 Encore 两种请求形态共用的头访问口径。 */
export interface RequestHeaders {
  cookie: string | string[] | undefined;
  proto: string | string[] | undefined;
}

/** 大小写不敏感取头:node 给的是小写键,Encore 的 `currentRequest()` 不保证。 */
function pick(
  headers: Record<string, string | string[]> | undefined,
  name: string,
): string | string[] | undefined {
  if (!headers) return undefined;
  const direct = headers[name];
  if (direct !== undefined) return direct;
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name) return v;
  }
  return undefined;
}

/** `api.raw` 端点:直接从 node 的请求头取。 */
export function headersOfRaw(raw: { headers: Record<string, string | string[] | undefined> }): RequestHeaders {
  const headers = raw.headers as Record<string, string | string[]>;
  return { cookie: pick(headers, "cookie"), proto: pick(headers, "x-forwarded-proto") };
}

/**
 * 类型化端点:走 `currentRequest()`。
 *
 * 【为什么不用 Encore 的 `Cookie<>` 请求字段】那会把 cookie 变成 API 契约的一部分,
 * 进而进入 `encore gen client` 的产物 —— 浏览器根本不该、也不能由 JS 去传这个
 * HttpOnly cookie。读请求头是唯一不污染对外接口形状的做法。
 */
export function headersOfTyped(): RequestHeaders {
  const req = currentRequest();
  const headers = req?.type === "api-call" ? req.headers : undefined;
  return { cookie: pick(headers, "cookie"), proto: pick(headers, "x-forwarded-proto") };
}

/**
 * 认领已有访客并**滑动续期**:一条 UPDATE 同时完成「这个 token 还有效吗」与
 * 「把有效期推到 now()+24h」。
 *
 * `expires_at > now()` 是唯一判据 —— 浏览器那边 cookie 还在不在不作数(它由客户端保管,
 * 改得动;库里这一列改不动)。过期行认领不到,访客下一次创建会话时拿到全新身份,
 * 此前的会话对他不再可见。
 *
 * 认领失败返回 null,**不发新 cookie**:读路径不该有副作用(见文件头)。
 */
export async function resolveVisitor(headers: RequestHeaders): Promise<Visitor | null> {
  const token = readVisitorCookie(headers.cookie);
  if (!token) return null;
  const row = await db.rawQueryRow<{ id: string }>(
    `UPDATE visitors
        SET last_seen_at = now(),
            expires_at   = now() + make_interval(secs => $2::double precision)
      WHERE token_hash = $1 AND expires_at > now()
      RETURNING id`,
    hashVisitorToken(token),
    VISITOR_TTL_SECONDS,
  );
  if (!row) return null;
  const secure = isSecureRequest(headers.proto);
  return { id: row.id, setCookie: buildSetCookie(token, secure), token, secure };
}

/**
 * 认领不到就发一个新身份。**只在会话真的会被创建的路径上调用**(见文件头)。
 *
 * 新 token 是 32 字节随机数,库里只落它的 sha256(`shared/visitor-cookie.ts`)。
 */
export async function ensureVisitor(headers: RequestHeaders): Promise<Visitor> {
  const existing = await resolveVisitor(headers);
  if (existing) return existing;

  const token = newVisitorToken();
  const row = await db.rawQueryRow<{ id: string }>(
    `INSERT INTO visitors (token_hash, expires_at)
     VALUES ($1, now() + make_interval(secs => $2::double precision))
     RETURNING id`,
    hashVisitorToken(token),
    VISITOR_TTL_SECONDS,
  );
  const secure = isSecureRequest(headers.proto);
  return { id: row!.id, setCookie: buildSetCookie(token, secure), token, secure };
}
