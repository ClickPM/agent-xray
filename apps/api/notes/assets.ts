// 正文配图的公开只读供图(R6)。所有者裁定 2026-08-31:**镜像内不烧任何 notes 内容**,
// 图片全部从 Postgres 读。
//
// 【为什么路径是 /assets/notes/… 而对外 URL 却还是 /notes/…】
// 对外 URL 必须保持 R5 的 `/notes/<系列>/<哈希>.webp` 不变(存量正文里的 markdown
// 就是这么写的,改 URL 等于要改写全部存量文章)。但 Encore 的路由里
// `/notes/:series/:file` 会和既有的 `/notes/series/:slug` 撞车 —— 同一层上一个是
// 字面量、一个是通配。于是 API 侧换个不冲突的前缀,由 Caddy(生产)与
// next.config.ts(开发)按**扩展名**把 `/notes/<a>/<b>.webp` 重写到这里:
// 扩展名是关键,`/notes/pi/01` 这种文章页地址不带扩展名,不会被误分流。
//
// 【为什么写在 notes 服务而不是 mcp】这是访客面的读路径。写面在 mcp(全权角色),
// 读面在 notes(与其他内容查询同处一处)—— docs/security.md §4「两个面互不触碰」。
import { api } from "encore.dev/api";
import type { IncomingMessage, ServerResponse } from "node:http";
import { safeErrorText } from "../shared/redact";
import * as store from "./store";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,95}$/i;

/**
 * 一天缓存 + ETag 复验。
 *
 * 【为什么不是 `immutable` 的一年】(codex review P2)`immutable` 的前提是
 * 「这个 URL 的内容永远不变」。文件名**按约定**是内容哈希,但 `notes_asset_put`
 * 明确支持同名覆盖(那是所有者纠错的唯一手段),约定不是强制 —— 一旦覆盖,
 * 已经缓存过的浏览器整整一年都不会回来复验,页面上还是旧图。
 * 改不成「强制文件名 = 内容哈希」:存量 56 张的名字是 R5 按**源文件**算的哈希,
 * 与上传字节的哈希对不上,强制等于把存量 URL 全废掉。
 * 于是退一步:TTL 收到一天,配合强 ETag,复验成本是一次 304。
 */
const CACHE_CONTROL = "public, max-age=86400";

function notFound(resp: ServerResponse): void {
  resp.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
  resp.end(JSON.stringify({ error: "not found" }));
}

export const asset = api.raw(
  { expose: true, method: ["GET", "HEAD"], path: "/assets/notes/:series/:file" },
  async (req: IncomingMessage, resp: ServerResponse) => {
    // 路径参数从 URL 自己剥:文件名带 `.webp` 这类后缀,Encore 的路径参数
    // 本身能拿到整段,但这里同时要做形状校验,统一在一处处理更省事
    // (rss.ts 的 /rss/:file 是同一个模式)。
    const url = new URL(req.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);
    // /assets/notes/<series>/<file>
    const series = decodeURIComponent(parts[2] ?? "");
    const file = decodeURIComponent(parts[3] ?? "");
    if (!SLUG_RE.test(series) || !NAME_RE.test(file)) {
      notFound(resp);
      return;
    }

    let row: store.AssetRow | null;
    try {
      row = await store.getAsset(series, file);
    } catch (err) {
      console.error(`notes asset lookup failed: ${safeErrorText(err)}`);
      resp.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      resp.end(JSON.stringify({ error: "internal error" }));
      return;
    }
    if (!row) {
      notFound(resp);
      return;
    }

    const etag = `"${row.etag}"`;
    const headers = {
      "Content-Type": row.contentType,
      "Cache-Control": CACHE_CONTROL,
      ETag: etag,
      // 库里存的是所有者上传的二进制。Content-Type 在上传时已经过白名单 + 魔数校验
      // (mcp/tools.ts),这一条是最后一层:即便将来那两道被绕过,浏览器也不会
      // 按嗅探结果把它当 HTML 执行。
      "X-Content-Type-Options": "nosniff",
    };

    // 条件请求:文件名即内容哈希,常态是浏览器第二次访问直接 304
    const inm = req.headers["if-none-match"];
    const inmValue = Array.isArray(inm) ? inm[0] : inm;
    if (inmValue && inmValue.split(",").some((t: string) => t.trim() === etag)) {
      resp.writeHead(304, headers);
      resp.end();
      return;
    }

    resp.writeHead(200, { ...headers, "Content-Length": String(row.bytes.length) });
    // HEAD 不带正文;写了会被 node 忽略,但显式返回更清楚
    if (req.method === "HEAD") {
      resp.end();
      return;
    }
    resp.end(row.bytes);
  },
);
