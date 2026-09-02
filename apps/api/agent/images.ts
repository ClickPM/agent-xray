// 生成图片的供图端点(R-IMAGEGEN):`GET /agent/images/<uuid>.<ext>`。
//
// 【与 notes 配图端点的差别】那边是公开内容(所有者发布的),这边是**访客的会话内容**:
// 按 `generated_images ⋈ sessions` 的 `visitor_id` 判归属,不是本访客的一律 404
// (docs/security.md §6 R-IMAGEGEN 补记)。地址里的 UUID 不可枚举,但「不可枚举」不是授权。
//
// 【对外地址是 /api/agent/images/…】前端所有 API 调用都走 `/api` 前缀(dev 由 next.config.ts
// 的 rewrite 剥掉,生产由 Caddyfile 的 `handle /api/*` 剥掉),所以工具写进 markdown 的地址
// 带 `/api`,而 Encore 这边的路由不带。两处是一个契约,改反代前缀要一起改。
import { api } from "encore.dev/api";
import type { IncomingMessage, ServerResponse } from "node:http";
import { IMAGE_EXTENSIONS, imageTypeOfExtension, type ImageContentType } from "../shared/image-magic";
import { safeErrorText } from "../shared/redact";
import { getGeneratedImage } from "./image-db";
import { headersOfRaw, resolveVisitor } from "./visitor";

/** 工具写进 markdown 的公开地址前缀(见文件头「对外地址」)。 */
export const PUBLIC_IMAGE_PATH_PREFIX = "/api/agent/images";

/** 一张图的公开地址:`/api/agent/images/<uuid>.<ext>`,扩展名由存下来的类型决定。 */
export function publicImageUrl(id: string, contentType: ImageContentType): string {
  return `${PUBLIC_IMAGE_PATH_PREFIX}/${id}.${IMAGE_EXTENSIONS[contentType]}`;
}

const FILE_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([a-z0-9]{3,4})$/i;

/**
 * `private, no-cache` 是这条端点与 notes 配图的第二个差别:它的响应依赖 cookie。
 *
 *   - `private`:中间缓存(将来的 CDN / 云 LB)不许把一个访客的图交给另一个访客;
 *   - `no-cache`:**浏览器每次都要回服务端复验**(codex 复审第 2 轮 P2)。上一版给了
 *     `max-age=86400` —— 而 `private` 只挡共享缓存、**不按 cookie 分区**:同一个浏览器里访客
 *     cookie 过期 / 被清 / 换成新身份之后,只要还知道地址,浏览器会直接复用缓存,归属查询根本不跑,
 *     端点声明的「只有生成者看得到」在这一天里是漏的。改成每次复验后,归属仍在就是一次 304
 *     (强 ETag),不在就是 404 —— 代价是每张图每次页面加载多一次轻量往返,一个会话里的图就那几张。
 */
const CACHE_CONTROL = "private, no-cache";

function notFound(resp: ServerResponse, setCookie?: string): void {
  const headers: Record<string, string> = { "Content-Type": "application/json; charset=utf-8" };
  if (setCookie) headers["Set-Cookie"] = setCookie;
  resp.writeHead(404, headers);
  resp.end(JSON.stringify({ error: "not found" }));
}

export const image = api.raw(
  {
    expose: true,
    method: ["GET", "HEAD"], path: "/agent/images/:file",
    // 访客 cookie 是可冒充身份的凭据,不能进 trace(docs/security.md §6);
    // 图片字节进 trace 也没有任何调试价值
    sensitive: true,
  },
  async (req: IncomingMessage, resp: ServerResponse) => {
    // 路径参数从 URL 自己剥(与 notes/assets.ts、rss.ts 同一模式):要做形状校验,统一在一处
    const url = new URL(req.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);
    // /agent/images/<uuid>.<ext>
    // 畸形的百分号编码(`%zz`)会让 decodeURIComponent 抛 URIError;对本端点它就是「不是一个合法文件名」,
    // 回 404 而不是让异常冒成 500(自查发现,notes/assets.ts 同款写法留给 BACKLOG)
    let file: string;
    try {
      file = decodeURIComponent(parts[2] ?? "");
    } catch {
      notFound(resp);
      return;
    }
    const m = FILE_RE.exec(file);
    const wantType = m ? imageTypeOfExtension(m[2]) : null;
    if (!m || !wantType) {
      notFound(resp);
      return;
    }
    const id = m[1].toLowerCase();

    // 只**认领**已有身份,从不发新的(读路径不该有副作用;visitor.ts 文件头)。
    // 没有身份 = 不拥有任何图,与「不存在」同一个回答。
    let visitor;
    try {
      visitor = await resolveVisitor(headersOfRaw(req));
    } catch (err) {
      console.error(`resolve visitor failed: ${safeErrorText(err)}`);
      resp.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      resp.end(JSON.stringify({ error: "internal error" }));
      return;
    }
    if (!visitor) {
      notFound(resp);
      return;
    }

    let row;
    try {
      row = await getGeneratedImage(id, visitor.id);
    } catch (err) {
      console.error(`generated image lookup failed: ${safeErrorText(err)}`);
      resp.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      resp.end(JSON.stringify({ error: "internal error" }));
      return;
    }
    // 扩展名与存下来的类型对不上也是 404:地址是工具按类型拼的,对不上只能是有人在猜
    if (!row || row.contentType !== wantType) {
      notFound(resp, visitor.setCookie);
      return;
    }

    const etag = `"${row.etag}"`;
    const headers: Record<string, string> = {
      "Content-Type": row.contentType,
      "Cache-Control": CACHE_CONTROL,
      ETag: etag,
      // 入库前已过魔数校验(shared/image-magic.ts),这一条是最后一层:
      // 即便那道被绕过,浏览器也不会按嗅探结果把它当 HTML 执行
      "X-Content-Type-Options": "nosniff",
      // 滑动续期:成功路径把 cookie 带回去(docs/security.md §6「24h 是滑动窗口」)
      "Set-Cookie": visitor.setCookie,
    };

    const inm = req.headers["if-none-match"];
    const inmValue = Array.isArray(inm) ? inm[0] : inm;
    if (inmValue && inmValue.split(",").some((t: string) => t.trim() === etag)) {
      resp.writeHead(304, headers);
      resp.end();
      return;
    }

    resp.writeHead(200, { ...headers, "Content-Length": String(row.bytes.length) });
    if (req.method === "HEAD") {
      resp.end();
      return;
    }
    resp.end(row.bytes);
  },
);
