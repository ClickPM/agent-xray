// skill 目录的 zip 下载(R-SKILLS,画板 2g 的「下载 zip」按钮)。
//
// 【为什么路径是 /assets/skills/… 而对外 URL 是 /skills/<name>.zip】
// 对外地址按设计稿是站根下的 `/skills/<name>.zip`。但 Encore 路由里 `/skills/:file` 会与
// 既有的 `/skills/:name`(详情)撞车 —— 同一层两个通配。于是 API 侧换个不冲突的前缀,
// 由 Caddy(生产)与 next.config.ts(开发)按**扩展名**把 `/skills/<a>.zip` 重写到这里:
// 详情页地址 `/skills/<name>` 不带扩展名,不会被误分流。与 notes 配图(/assets/notes)同一手法。
//
// 【zip 是写入时打好存库的】(mcp 的 skills_upsert)这里只吐字节,不落盘、不读文件系统、
// 不在请求路径上打包。docs/security.md §4 R-SKILLS 补记。
import { api } from "encore.dev/api";
import type { IncomingMessage, ServerResponse } from "node:http";
import { safeErrorText } from "../shared/redact";
import { SKILL_NAME_RE } from "../shared/skill-pack";
import * as store from "./store";

/**
 * 一天缓存 + 强 ETag 复验,**不用 `immutable`**:理由同 notes 供图 ——
 * 同名 skill 重发是所有者纠错的唯一手段,`immutable` 会让已缓存的浏览器一年内不回来复验。
 */
const CACHE_CONTROL = "public, max-age=86400";

/** 本端点看的那几样,单独列成接口是为了让测试不用伪造整个 IncomingMessage */
export interface ZipRequest {
  url?: string;
  method?: string;
  headers: { "if-none-match"?: string | string[] };
}

function notFound(resp: ServerResponse): void {
  resp.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
  resp.end(JSON.stringify({ error: "not found" }));
}

/** raw 端点的全部逻辑;端点函数只是把它挂到路由上 */
export async function handleZip(req: ZipRequest, resp: ServerResponse): Promise<void> {
  // 路径参数从 URL 自己剥:文件名带 `.zip` 后缀,Encore 的路径参数本身能拿到整段,
  // 但这里同时要做形状校验,统一在一处处理(notes/assets.ts 是同一个模式)。
  const url = new URL(req.url ?? "/", "http://localhost");
  const file = decodeURIComponent(url.pathname.split("/").pop() ?? "");
  if (!file.endsWith(".zip")) {
    notFound(resp);
    return;
  }
  const name = file.slice(0, -4);
  if (!SKILL_NAME_RE.test(name)) {
    notFound(resp);
    return;
  }

  let row: store.ZipRow | null;
  try {
    row = await store.getZip(name);
  } catch (err) {
    console.error(`skill zip lookup failed: ${safeErrorText(err)}`);
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
    "Content-Type": "application/zip",
    // 文件名就是校验过的 skill 名 + .zip,不可能带引号或控制字符
    "Content-Disposition": `attachment; filename="${name}.zip"`,
    "Cache-Control": CACHE_CONTROL,
    ETag: etag,
    // 库里的字节是服务端自己打的 zip;这一条是最后一层:浏览器不会按嗅探结果把它当别的东西打开
    "X-Content-Type-Options": "nosniff",
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
}

export const zip = api.raw(
  {
    expose: true,
    method: ["GET", "HEAD"], path: "/assets/skills/:file",
    // 【R-VISITOR】这条端点是**浏览器直接访问**的(下载链接),而访客 cookie 的 Path 是 `/` ——
    // 它会被一并带过来,尽管这里根本不看它。不设 sensitive 的话,一个可冒充身份的凭据会随
    // 每一次下载进 trace(docs/security.md §6)。本端点的 payload(zip 字节)进 trace 也无调试价值。
    sensitive: true,
  },

  async (req: IncomingMessage, resp: ServerResponse) => {
    await handleZip(req, resp);
  },
);
