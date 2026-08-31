// 运行期 LLM 配置的**只读**来源(R6)。
//
// 【与 R1–R5 的区别:secret 里不再有 LLM key】
// 原先 provider / model 硬编码在 runtime.ts,key 来自 Encore secret `DeepSeekApiKey`。
// 所有者 2026-08-31 裁定彻底移除那个引导键:运行期的 LLM 凭据**只有 `llm_config` 一个来源**。
// 代价已认——新环境首次部署后必须先经 MCP 写入 provider,agent 才能对话;
// 没写就是明确的 503,而不是一个含糊的模型错误。部署清单见 docs/deploy-environments.md。
//
// 【为什么 agent 直接读 mcp 写的表】沿用 R4 定下的服务间耦合口径
// (docs/architecture.md):trace 服务读 agent 拥有的表也是这么做的——
// **只读、不拥有 schema、不 import 对方目录**。反过来让 mcp 暴露一个内部端点给
// agent 调,才是把两个面连起来(docs/security.md §4 要求它们互不触碰)。
import { secret } from "encore.dev/config";
import { createHash } from "node:crypto";
import { decryptSecret } from "../shared/crypto";
import { db } from "./db";

// CLAUDE.md 规则 5:secret() 只能在 service 目录内声明。mcp 服务另有一份同名声明,
// 指向的是同一个 app 级 secret,不是第二把密钥。
const configEncryptionKey = secret("ConfigEncryptionKey");

/** 没有默认 provider(或密钥/密文坏了);ask.ts 据此回 503 而不是 500。 */
export class LlmNotConfiguredError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LlmNotConfiguredError";
  }
}

export interface ActiveLlmConfig {
  provider: string;
  baseUrl: string | null;
  modelId: string;
  /** 可选自定义模型目录,形状同 pi 的 ProviderConfigInput["models"] */
  models: unknown[] | null;
  /** 明文 key。**只在进程内流动**:不进日志、不进事件流、不出任何端点 */
  apiKey: string;
  /**
   * 配置指纹。变了就代表要重新向 ModelRuntime 注册一次 —— 「切换默认模型后
   * 新会话生效」(验收 ⑥)靠的就是每次冷启动比一下这个值。
   * 由**全部生效字段**算出(含 key),漏算任何一个都会出现「改了不生效」。
   */
  fingerprint: string;
}

interface Row {
  provider: string;
  baseUrl: string | null;
  modelId: string;
  models: unknown;
  apiKeyEnc: Uint8Array;
}

/**
 * 读当前生效的 provider 配置。每次**冷启动会话**调一次(热路径不调),
 * 所以不做进程内缓存 —— 缓存会让「改了配置要等多久生效」变成一个说不清的问题。
 */
export async function loadActiveLlmConfig(): Promise<ActiveLlmConfig> {
  const row = await db.rawQueryRow<Row>(
    `SELECT provider, base_url AS "baseUrl", model_id AS "modelId", models,
            api_key_enc AS "apiKeyEnc"
       FROM llm_config
      WHERE is_default`,
  );
  if (!row) {
    throw new LlmNotConfiguredError(
      "没有默认 LLM provider;经 MCP 管理面 llm_provider_upsert 配置一个后重试",
    );
  }

  let apiKey: string;
  try {
    apiKey = decryptSecret(configEncryptionKey(), row.apiKeyEnc);
  } catch (err) {
    // 不把解密失败的细节带给调用方:对访客一律是「服务未就绪」,
    // 具体原因(密钥换了 / 密文被改 / secret 没配)只进服务端日志
    throw new LlmNotConfiguredError(
      `provider ${row.provider} 的密钥无法解密(ConfigEncryptionKey 是否与写入时一致?)`,
      { cause: err },
    );
  }

  const models = Array.isArray(row.models) ? (row.models as unknown[]) : null;
  return {
    provider: row.provider,
    baseUrl: row.baseUrl,
    modelId: row.modelId,
    models,
    apiKey,
    fingerprint: fingerprintOf(row.provider, row.baseUrl, row.modelId, models, apiKey),
  };
}

function fingerprintOf(
  provider: string,
  baseUrl: string | null,
  modelId: string,
  models: unknown[] | null,
  apiKey: string,
): string {
  return createHash("sha256")
    .update(JSON.stringify([provider, baseUrl, modelId, models, apiKey]))
    .digest("hex");
}
