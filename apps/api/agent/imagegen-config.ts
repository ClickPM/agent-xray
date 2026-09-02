// 运行期 imagegen 配置的**只读**来源(R-IMAGEGEN),与 `websearch-config.ts` 同构:
// mcp 服务写 `imagegen_config`,agent 服务只读、只解密,不 import 对方目录
// (R4 定下的服务间耦合口径,docs/architecture.md)。
//
// 与 websearch-config 的两条口径原样适用:
//   1. **读不到配置不是错误**,回 `null`(生图是可选能力,读不到 = 这个工具这轮不注册);
//   2. **超时、限额、协议形态与凭据在同一次读里取出来**,不留「用着新端点、配着旧超时」的中间态。
import { createHash } from "node:crypto";
import { decryptSecret } from "../shared/crypto";
import { safeErrorText } from "../shared/redact";
import { db } from "./db";
import { configEncryptionKey } from "./secrets";

/** 协议形态,与迁移 010 的 CHECK 同一闭集。决定 `imagegen.ts` 走哪条请求 / 解析路径。 */
export type ImageApiStyle = "images" | "chat";

export interface ActiveImageGenConfig {
  provider: string;
  /** 已去掉尾部斜杠的绝对 https 地址;host 必在白名单内(调用前再校验一次) */
  baseUrl: string;
  modelId: string;
  apiStyle: ImageApiStyle;
  /** `images` 形态的 size 字段;null / "auto" = 不发,用上游默认。`chat` 形态忽略 */
  imageSize: string | null;
  totalTimeoutMs: number;
  idleTimeoutMs: number;
  /** 0 = 不限 */
  dailyImageLimit: number;
  /** 明文 key。**只在进程内流动**:不进日志、不进事件流、不出任何端点 */
  apiKey: string;
  /**
   * 配置指纹。并进 `RuntimeConfig.fingerprint`(经 `EnabledTools.fingerprint`)之后,
   * 改 imagegen 配置会让会话在下一轮被重建到新配置上 —— R6 定下的统一规则。
   * 由**全部生效字段**算出(含 key),漏算任何一个都会出现「改了不生效」。
   */
  fingerprint: string;
}

interface Row {
  provider: string;
  baseUrl: string;
  modelId: string;
  apiStyle: ImageApiStyle;
  imageSize: string | null;
  totalTimeoutMs: number;
  idleTimeoutMs: number;
  dailyImageLimit: number;
  apiKeyEnc: Uint8Array;
}

/**
 * 读当前生效的 imagegen 配置;没配 / 密文解不开都回 `null`(并记日志)。
 *
 * 【为什么解密失败也回 null 而不是抛】调用方是 `loadEnabledTools`,在每一次冷启动会话的路径上。
 * 让解密失败冒泡,后果是「生图的密钥坏了」变成「整个站点不能对话」—— 两件事差着一个数量级。
 * 坏掉的表现应当是「生图这一个工具消失了,日志里有一行明确的原因」。
 *
 * 【为什么不缓存】与 `loadActiveLlmConfig` 同一个理由:缓存会让「改了配置要等多久生效」
 * 变成一个说不清的问题。本函数只在冷启动会话时被调用,不在热路径上。
 */
export async function loadActiveImageGenConfig(): Promise<ActiveImageGenConfig | null> {
  const row = await db.rawQueryRow<Row>(
    // INT 列用 ::double precision 读回:与 quota.ts / websearch-config.ts 同一套写法
    `SELECT provider, base_url AS "baseUrl", model_id AS "modelId",
            api_style AS "apiStyle", image_size AS "imageSize",
            total_timeout_ms::double precision  AS "totalTimeoutMs",
            idle_timeout_ms::double precision   AS "idleTimeoutMs",
            daily_image_limit::double precision AS "dailyImageLimit",
            api_key_enc AS "apiKeyEnc"
       FROM imagegen_config
      WHERE is_default`,
  );
  if (!row) return null;

  let apiKey: string;
  try {
    apiKey = decryptSecret(configEncryptionKey(), row.apiKeyEnc);
  } catch (err) {
    // 具体原因(密钥换了 / 密文被改 / secret 没配)只进服务端日志且过 safeErrorText
    console.error(
      `imagegen provider ${row.provider} 的密钥无法解密,本轮不注册 generate_image: ${safeErrorText(err)}`,
    );
    return null;
  }

  return {
    provider: row.provider,
    baseUrl: row.baseUrl,
    modelId: row.modelId,
    apiStyle: row.apiStyle,
    imageSize: row.imageSize,
    totalTimeoutMs: row.totalTimeoutMs,
    idleTimeoutMs: row.idleTimeoutMs,
    dailyImageLimit: row.dailyImageLimit,
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
        row.apiStyle,
        row.imageSize,
        row.totalTimeoutMs,
        row.idleTimeoutMs,
        row.dailyImageLimit,
        apiKey,
      ]),
    )
    .digest("hex");
}
