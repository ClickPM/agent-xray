// 配置密文原语(R6)。`llm_config.api_key_enc` 用它加解密,`docs/security.md` §3
// 「LLM key 加密存储、任何读接口只返回掩码」的加密那一半就是这里。
//
// **密钥由调用方取好后传进来**,本模块不声明 `secret()`(CLAUDE.md 规则 5:
// secret 只能在 service 目录内声明)。mcp 服务与 agent 服务各自声明同一个
// `ConfigEncryptionKey` 再把值传进来 —— 两个服务都要用,不能让共享库去持有它。
//
// 算法:AES-256-GCM。密文布局 `nonce(12) ‖ ciphertext ‖ tag(16)`,整体入 BYTEA。
// 选 GCM 而不是 CBC 是因为要的是**认证**加密:库被改一个字节,解密就该失败,
// 而不是解出一段垃圾 key 再拿去打 provider。
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

const ALGO = "aes-256-gcm";
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** 密钥格式/长度不对时抛这个,调用方据此回「服务端未正确配置」而不是「解密失败」。 */
export class EncryptionKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncryptionKeyError";
  }
}

/**
 * base64 密钥 → 32 字节。
 *
 * 不接受任意长度再自行 KDF 拉伸:那会让「配了个 8 字符的弱口令」看起来一切正常。
 * 生成方式写在 docs/deploy-environments.md,口径是 32 字节随机数的 base64。
 */
export function parseEncryptionKey(keyB64: string): Buffer {
  const trimmed = keyB64.trim();
  if (trimmed === "") throw new EncryptionKeyError("ConfigEncryptionKey 未配置");
  let key: Buffer;
  try {
    key = Buffer.from(trimmed, "base64");
  } catch {
    throw new EncryptionKeyError("ConfigEncryptionKey 不是合法 base64");
  }
  if (key.length !== KEY_BYTES) {
    throw new EncryptionKeyError(
      `ConfigEncryptionKey 必须是 ${KEY_BYTES} 字节的 base64(当前 ${key.length} 字节)`,
    );
  }
  return key;
}

export function encryptSecret(keyB64: string, plaintext: string): Buffer {
  const key = parseEncryptionKey(keyB64);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGO, key, nonce);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([nonce, ct, cipher.getAuthTag()]);
}

/** 解密失败(密钥换了 / 密文被改)一律抛这个,不区分原因——区分等于给攻击者反馈。 */
export class DecryptError extends Error {
  constructor() {
    super("配置密文解密失败");
    this.name = "DecryptError";
  }
}

export function decryptSecret(keyB64: string, blob: Uint8Array): string {
  const key = parseEncryptionKey(keyB64);
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  if (buf.length <= NONCE_BYTES + TAG_BYTES) throw new DecryptError();
  const nonce = buf.subarray(0, NONCE_BYTES);
  const ct = buf.subarray(NONCE_BYTES, buf.length - TAG_BYTES);
  const tag = buf.subarray(buf.length - TAG_BYTES);
  try {
    const decipher = createDecipheriv(ALGO, key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    throw new DecryptError();
  }
}

/**
 * 凭据掩码(`sk-…3f9a`)。**这是唯一允许出服务端的 key 形态**,
 * 且必须在服务端算好 —— MCP 的 tool result 会直接进管理端模型上下文
 * (docs/security.md §3),掩码在客户端做等于没做。
 *
 * 短串一律只回 `…`:前 3 后 4 对一个 10 字符的 key 等于泄露七成。
 */
export function maskSecret(value: string): string {
  const s = value.trim();
  if (s.length < 12) return "…";
  return `${s.slice(0, 3)}…${s.slice(-4)}`;
}

/**
 * 定长摘要的等值比较(bearer token 校验用)。
 *
 * 长度不同直接 false —— `timingSafeEqual` 对长度不等会抛,不能靠它兜底。
 * 比的必须是**摘要**而不是原文:摘要定长,长度分支不泄露原文长度。
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
