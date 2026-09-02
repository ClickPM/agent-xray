// agent 服务的 secret 声明(CLAUDE.md 规则 5:secret() 只能在 service 目录内声明)。
//
// 抽成单独文件是 R-WEBSEARCH 的需要:`ConfigEncryptionKey` 现在有两个消费方
// (`llm-config.ts` 解 llm_config.api_key_enc、`websearch-config.ts` 解
// websearch_config.api_key_enc)。同一个 service 里把 `secret("ConfigEncryptionKey")`
// 写两遍是没必要的重复,而让其中一个去 import 另一个的内部常量,
// 等于让「读 LLM 配置」的模块变成密钥的分发点。
//
// mcp 服务另有一份同名声明(`mcp/secrets.ts`):指向的是同一个 app 级 secret,
// 两处各自声明是规则 5 的要求,不是两把密钥。
import { secret } from "encore.dev/config";

export const configEncryptionKey = secret("ConfigEncryptionKey");
