// mcp 服务的 secret 声明(CLAUDE.md 规则 5:secret() 只能在 service 目录内声明)。
//
// 两个 secret 都**只存派生值 / 密钥,不存可直接使用的凭据**:
//   McpAuthTokenHash   —— bearer token 的 sha256(hex,小写)。服务端拿不到原 token,
//                          泄漏这一份也无法登录(docs/security.md §4「服务端只存哈希」)。
//   ConfigEncryptionKey —— llm_config.api_key_enc 的 AES-256-GCM 密钥(32 字节 base64)。
//                          agent 服务另有一份同名声明:同一个 app 级 secret,
//                          两处各自声明是规则 5 的要求,不是两把密钥。
import { secret } from "encore.dev/config";

export const mcpAuthTokenHash = secret("McpAuthTokenHash");
export const configEncryptionKey = secret("ConfigEncryptionKey");
