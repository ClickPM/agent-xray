// 生成图片的库读写通道(R-IMAGEGEN;docs/security.md §1 第 2 层的 R-IMAGEGEN 补记)。
//
// 两个方向、两种身份,**别合并**:
//   insertGeneratedImageAsAgent —— agent 工具的写通道,`SET LOCAL ROLE agent_image`,
//                                  该角色只有 generated_images 的 INSERT(迁移 010);
//   getGeneratedImage           —— 供图端点的读通道,全权连接,但**按访客归属过滤**
//                                  (docs/security.md §6:不匹配一律当不存在)。
//
// 与 `title-db.ts` / `ro-db.ts` 同一形态:`SET LOCAL`(池化连接不能让降权泄漏给下一个请求)、
// `statement_timeout`、不叠 `READ ONLY`(这是一段刻意可写的事务)。
import { safeErrorText } from "../shared/redact";
import type { ImageContentType } from "../shared/image-magic";
import { db } from "./db";

/**
 * 语句超时。一条最多 8 MiB 的 BYTEA 插入,5s 在本机与单机 compose 上都是宽裕的上界;
 * 第 4 层「资源滥用」的一部分,与 ro-db / title-db 取一致。
 */
const IMAGE_STATEMENT_TIMEOUT = "5s";

export interface NewGeneratedImage {
  /** 由调用方生成(randomUUID):agent_image 没有 SELECT,RETURNING 用不了 */
  id: string;
  /** ≡ sessions.id,由工具闭包绑定,不是模型入参 */
  sessionId: string;
  contentType: ImageContentType;
  bytes: Buffer;
  /** sha256(hex),供图端点用它做 ETag */
  etag: string;
}

/**
 * 以 `agent_image` 身份把一张图追加到**指定的那个会话**名下。
 *
 * 能做的只有这一件事:该角色没有 SELECT / UPDATE / DELETE,对 sessions 也没有任何权限
 * (外键检查由 Postgres 以被引用表所有者的身份执行,不需要它能读 sessions)。
 * 会话不存在(访客刚在另一个标签页删了它)时外键失败 → 抛出 → 工具走 `guarded` 的固定文案。
 */
export async function insertGeneratedImageAsAgent(img: NewGeneratedImage): Promise<void> {
  const tx = await db.begin();
  try {
    await tx.rawExec(`SET LOCAL statement_timeout = '${IMAGE_STATEMENT_TIMEOUT}'`);
    await tx.rawExec("SET LOCAL ROLE agent_image");
    await tx.rawExec(
      `INSERT INTO generated_images (id, session_id, content_type, bytes, byte_size, etag)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)`,
      img.id,
      img.sessionId,
      img.contentType,
      img.bytes,
      img.bytes.length,
      img.etag,
    );
    await tx.commit();
  } catch (err) {
    // 回滚失败不能盖掉原始错误;原始错误才是调用方要看的那个
    await tx
      .rollback()
      .catch((e) => console.error(`agent_image tx rollback failed: ${safeErrorText(e)}`));
    throw err;
  }
}

export interface GeneratedImageRow {
  contentType: ImageContentType;
  bytes: Buffer;
  etag: string;
}

/**
 * 供图读路径,**按归属过滤**:只有生成这张图的那个访客拿得到字节。
 *
 * 不匹配(不存在 / 不是本访客的 / 会话已删)一律回 null —— 与 `store.getSession` 同一口径,
 * 供图端点据此回 404 而不是 403(403 等于确认「这个 id 是存在的」)。
 * `bytes` 归一成 Buffer,免得 `resp.end()` 在两种形态下走不同分支(notes/store.ts 的同款处理)。
 */
export async function getGeneratedImage(id: string, visitorId: string): Promise<GeneratedImageRow | null> {
  const row = await db.rawQueryRow<{ contentType: ImageContentType; bytes: Uint8Array; etag: string }>(
    `SELECT gi.content_type AS "contentType", gi.bytes, gi.etag
       FROM generated_images gi
       JOIN sessions s ON s.id = gi.session_id
      WHERE gi.id = $1::uuid AND s.visitor_id = $2::uuid`,
    id,
    visitorId,
  );
  if (!row) return null;
  return {
    contentType: row.contentType,
    etag: row.etag,
    bytes: Buffer.isBuffer(row.bytes) ? row.bytes : Buffer.from(row.bytes),
  };
}
