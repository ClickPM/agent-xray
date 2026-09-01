// 管理面审计(docs/security.md §4:认证失败与全部写操作入审计日志)。
//
// 两条硬约束:
//   1. **写审计失败不能吞**,但也不能因此让一次成功的写操作对客户端报错 ——
//      审计是旁路,业务结果已经落库了。折中:失败只记服务端日志(仍然可见),
//      并把「审计缺口」这件事本身打成 error 级。
//   2. 摘要一律过 shared/redact 的口径。工具入参里可能带 LLM key 明文
//      (llm_provider_upsert),原样写进 detail 等于把凭据抄了一份进库。
import { previewText, safeErrorText } from "../shared/redact";
import { db } from "./db";

export type AuditOutcome = "ok" | "denied" | "error";

export interface AuditEntry {
  outcome: AuditOutcome;
  /** JSON-RPC method;解析不出时省略 */
  method?: string;
  /** tools/call 的工具名 */
  tool?: string;
  /** 一行摘要,调用方保证已脱敏或可安全脱敏 */
  summary?: string;
  /** 远端标识(反代 X-Forwarded-For 首段 / socket 地址) */
  remote?: string;
  /** 结构化补充;写库前整体过 sanitizeValue */
  detail?: unknown;
}

/**
 * 写一条审计。永不 reject —— 调用方在成功路径与失败路径上都会调它,
 * 一个 await 的抛出会把已经完成的业务操作变成 500。
 */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    const detail = entry.detail === undefined ? null : JSON.stringify(entry.detail);
    await db.rawExec(
      `INSERT INTO mcp_audit (outcome, method, tool, summary, remote, detail)
       VALUES ($1, $2, $3, $4, $5, $6::text::jsonb)`,
      entry.outcome,
      entry.method ?? null,
      entry.tool ?? null,
      previewText(entry.summary ?? "", 500),
      entry.remote ?? null,
      // JSONB 写入口径:CLAUDE.md 规则 4(裸 ::jsonb 会把 JS 字符串再编码一次,
      // 且 COALESCE 里的裸 null 会写成 jsonb 'null' 而不是 SQL NULL)
      detail,
    );
  } catch (err) {
    console.error(
      `mcp audit write failed (outcome=${entry.outcome} tool=${entry.tool ?? "-"}): ` +
        safeErrorText(err),
    );
  }
}

/**
 * 请求来源标识。反代在前(Caddy),socket 地址永远是反代自己,所以先看
 * `X-Forwarded-For` 的**第一段**(最靠近客户端的那个)。
 * 头是可伪造的,但管理面只有一个使用者、且认证不依赖它 —— 这里只是审计线索。
 */
export function remoteOf(headers: Record<string, string | string[] | undefined>): string | undefined {
  const raw = headers["x-forwarded-for"];
  const xff = Array.isArray(raw) ? raw[0] : raw;
  const first = xff?.split(",")[0]?.trim();
  if (first) return first.slice(0, 64);
  const real = headers["x-real-ip"];
  const realStr = Array.isArray(real) ? real[0] : real;
  return realStr?.trim().slice(0, 64) || undefined;
}
