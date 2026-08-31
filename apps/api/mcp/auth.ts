// 管理面认证:静态 bearer token(docs/security.md §4)。
//
// 形态取舍(所有者裁定:solo 维护,不上 OAuth):
//   - token 是高熵随机串,**服务端只存 sha256**(secret McpAuthTokenHash)。
//     库与配置里都没有可直接使用的凭据。
//   - 无 cookie ⇒ 无 CSRF 面;认证不依赖任何可伪造的头。
//   - 失败一律 401 + 固定文案,**不回显细节**(是没带、格式不对、还是值不对,
//     对调用方是同一句话)—— 差异化的错误文案是在帮猜 token 的人做二分。
import { createHash } from "node:crypto";
import { timingSafeEqualHex } from "../shared/crypto";

/** 认证结论。`reason` 只进审计与服务端日志,永不出服务端。 */
export type AuthVerdict = { ok: true } | { ok: false; reason: string };

/** `Authorization: Bearer <token>` → token;取不到返回 null。 */
export function parseBearer(header: string | string[] | undefined): string | null {
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw !== "string") return null;
  const m = /^Bearer[ \t]+(\S+)$/i.exec(raw.trim());
  return m ? m[1] : null;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * 校验 Authorization 头。
 *
 * `expectedHash` 是 secret 里的期望摘要;取不到(未配置)时**一律拒绝**——
 * 「没配 token 就放行」是最容易在部署时把管理面裸奔出去的默认值。
 */
export function verifyAuth(
  header: string | string[] | undefined,
  expectedHash: string | undefined,
): AuthVerdict {
  const expected = expectedHash?.trim().toLowerCase();
  if (!expected || !/^[0-9a-f]{64}$/.test(expected)) {
    return { ok: false, reason: "McpAuthTokenHash 未配置或不是 64 位 hex sha256" };
  }
  const token = parseBearer(header);
  if (token === null) return { ok: false, reason: "缺少 Bearer 凭据" };
  // 比的是定长摘要:长度分支不泄露 token 长度,取值比较是常数时间
  if (!timingSafeEqualHex(sha256Hex(token), expected)) {
    return { ok: false, reason: "凭据不匹配" };
  }
  return { ok: true };
}

/** 401 响应体。固定文案,不带任何可用于二分的细节。 */
export const UNAUTHORIZED_BODY = JSON.stringify({
  jsonrpc: "2.0",
  id: null,
  error: { code: -32001, message: "unauthorized" },
});
