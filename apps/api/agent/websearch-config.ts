// 运行期 websearch 配置的**只读**来源(R-WEBSEARCH),与 `llm-config.ts` 同构:
// mcp 服务写 `websearch_config`,agent 服务只读、只解密,不 import 对方目录
// (R4 定下的服务间耦合口径,docs/architecture.md)。
//
// 【与 llm-config 的两处刻意不同】
//   1. **读不到配置不是错误**。LLM 读不到 = 站点不能对话,所以那边抛
//      `LlmNotConfiguredError` 让 `/agent/ask` 回 503。搜索是可选能力:读不到就是
//      「这个工具这轮不注册」,站点照常工作。所以本模块返回 `null` 而不是抛。
//   2. **返回值里带着超时与限额**。它们是外呼组的硬约束(docs/security.md §1),
//      必须与凭据一起、在同一次读里取出来 —— 分两次读会出现「用着新端点、
//      配着旧超时」的中间态。
import { createHash } from "node:crypto";
import { decryptSecret } from "../shared/crypto";
import { safeErrorText } from "../shared/redact";
import { db } from "./db";
import { configEncryptionKey } from "./secrets";

export interface ActiveWebSearchConfig {
  provider: string;
  /** 已去掉尾部斜杠的绝对 http(s) 地址;host 必在白名单内(调用前再校验一次) */
  baseUrl: string;
  modelId: string;
  /** Responses API 的内置工具类型名(web_search / web_search_YYYY_MM_DD) */
  toolType: string;
  totalTimeoutMs: number;
  idleTimeoutMs: number;
  /** 0 = 不限 */
  dailySearchLimit: number;
  /** 明文 key。**只在进程内流动**:不进日志、不进事件流、不出任何端点 */
  apiKey: string;
  /**
   * 配置指纹。并进 `RuntimeConfig.fingerprint` 之后,改 websearch 配置会让会话
   * 在下一轮被重建到新配置上 —— 走 R6 定下的那条统一规则,不另造生效机制。
   * 由**全部生效字段**算出(含 key),漏算任何一个都会出现「改了不生效」。
   */
  fingerprint: string;
}

interface Row {
  provider: string;
  baseUrl: string;
  modelId: string;
  toolType: string;
  totalTimeoutMs: number;
  idleTimeoutMs: number;
  dailySearchLimit: number;
  apiKeyEnc: Uint8Array;
}

/**
 * 读当前生效的 websearch 配置;没配 / 密文解不开都回 `null`(并记日志)。
 *
 * 【为什么解密失败也回 null 而不是抛】调用方是 `loadEnabledTools`,它在**每一次
 * 冷启动会话**的路径上。让解密失败冒泡上去,后果是「websearch 的密钥坏了」直接
 * 变成「整个站点不能对话」—— 而这两件事的严重程度差着一个数量级。
 * 坏掉的表现应当是「搜索这一个工具消失了,日志里有一行明确的原因」。
 *
 * 【为什么不缓存】与 `loadActiveLlmConfig` 同一个理由:缓存会让「改了配置要等多久
 * 生效」变成一个说不清的问题。本函数只在冷启动会话时被调用,不在热路径上。
 */
export async function loadActiveWebSearchConfig(): Promise<ActiveWebSearchConfig | null> {
  const row = await db.rawQueryRow<Row>(
    // INT 列用 ::double precision 读回:与 quota.ts / store.ts 同一套写法,
    // 免得驱动在不同运行时下把整数回成字符串。
    `SELECT provider, base_url AS "baseUrl", model_id AS "modelId",
            tool_type AS "toolType",
            total_timeout_ms::double precision   AS "totalTimeoutMs",
            idle_timeout_ms::double precision    AS "idleTimeoutMs",
            daily_search_limit::double precision AS "dailySearchLimit",
            api_key_enc AS "apiKeyEnc"
       FROM websearch_config
      WHERE is_default`,
  );
  if (!row) return null;

  let apiKey: string;
  try {
    apiKey = decryptSecret(configEncryptionKey(), row.apiKeyEnc);
  } catch (err) {
    // 具体原因(密钥换了 / 密文被改 / secret 没配)只进服务端日志且过 safeErrorText
    console.error(
      `websearch provider ${row.provider} 的密钥无法解密,本轮不注册 web_search: ${safeErrorText(err)}`,
    );
    return null;
  }

  return {
    provider: row.provider,
    baseUrl: row.baseUrl,
    modelId: row.modelId,
    toolType: row.toolType,
    totalTimeoutMs: row.totalTimeoutMs,
    idleTimeoutMs: row.idleTimeoutMs,
    dailySearchLimit: row.dailySearchLimit,
    apiKey,
    fingerprint: fingerprintOf(row, apiKey),
  };
}

function fingerprintOf(row: Row, apiKey: string): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        row.provider,
        row.baseUrl,
        row.modelId,
        row.toolType,
        row.totalTimeoutMs,
        row.idleTimeoutMs,
        row.dailySearchLimit,
        apiKey,
      ]),
    )
    .digest("hex");
}
