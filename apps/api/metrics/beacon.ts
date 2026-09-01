// R8 pageview 打点:`POST /t`(对外 `/api/t`,走既有 `/api/*` 反代,无需新增
// Caddy 路由)。自托管统计,无第三方脚本、无 cookie —— `docs/security.md` §6。
//
// 【这个端点的三条性质,改动前先读】
//   1. **无认证的公开写入口**。所以进库的每一列都必须是服务端派生的闭集值:
//      path 走白名单归一 + 库内存在性校验(path.ts),visitor 是加盐哈希,
//      ua 是闭集摘要。客户端唯一能给的原始输入是一个 path 字符串,而它不落库。
//   2. **原始 IP 与原始 UA 一个字节都不落库**,也不进日志(§6)。它们只在
//      visitor.ts 的函数栈里出现过。
//   3. **打点失败绝不能变成访客可见的错误**。库挂了、盐没配、路径不认识,
//      对访客一律是 204 —— 统计是旁路,不值得让任何一次页面访问看到红字。
import { api } from "encore.dev/api";
import type { IncomingMessage, ServerResponse } from "node:http";
import { safeErrorText } from "../shared/redact";
import { siteDay } from "../shared/site-time";
import { resolvePath } from "./path";
import { metricsIpSalt } from "./secrets";
import { recordVisit } from "./store";
import { clientIp, uaDigest, visitorHash } from "./visitor";

/**
 * 请求体上限。beacon 的体是一个 `{"path":"…"}`,几十字节;这里给 1 KiB。
 *
 * **必须与下面 `api.raw` 选项里的 `bodyLimit` 保持同一个数,改一处要改两处** ——
 * 那个字段被 Encore 在编译期静态解析,只接受整数字面量,写成本常量会报
 * `expected integer literal`(mcp/endpoint.ts 踩过,实测)。
 */
const MAX_BODY_BYTES = 1024;

/** 盐缺失只在进程内报一次:每次 pageview 刷一行 error 日志本身就是一种拒绝服务。 */
let saltWarned = false;

function noContent(resp: ServerResponse): void {
  // 打点响应不该被任何一层缓存(尤其是「同一路径同一响应」这种直觉性缓存规则)
  resp.writeHead(204, { "Cache-Control": "no-store" });
  resp.end();
}

/** 读取并解析 JSON 请求体;超限直接抛,不把内存交给调用方决定。 */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new Error("request body too large");
    chunks.push(buf);
  }
  if (size === 0) throw new Error("empty request body");
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** 盐取值不能让端点炸掉:`secret()` 在值缺失时**抛错**,而这里的正确行为是静默不记。 */
function safeSalt(): string | undefined {
  try {
    const v = metricsIpSalt().trim();
    return v === "" ? undefined : v;
  } catch {
    return undefined;
  }
}

export const track = api.raw(
  {
    expose: true,
    method: "POST",
    path: "/t",
    // 必须等于上面的 MAX_BODY_BYTES(此处只能写整数字面量)
    bodyLimit: 1024,
    // 【必须有】请求头里带着访客的 X-Forwarded-For。不设的话 Encore 会把请求头
    // 原样写进 trace —— 那等于在 §6 承诺「不存原始 IP」的同时,把原始 IP 抄进
    // 了另一个地方。与 mcp/endpoint.ts 设它的理由同源(那边是管理 token)。
    sensitive: true,
  },
  async (req: IncomingMessage, resp: ServerResponse) => {
    // 【状态码只有两种:204 与 400】
    // 除了「请求体读不出来」(那是接线错误,回 400 才能在开发期被发现),
    // 其余一切 —— 路径不认识、盐没配、库挂了 —— 一律 204。文件头第 3 条:
    // 访客不该因为统计写不进去而看到任何异常。
    //
    // 落库是 await 的(不是 fire-and-forget):这条请求由 sendBeacon 发出,
    // 客户端本来就不看响应,而一个游离的 promise 只会让写失败无处可报。
    let raw: unknown;
    try {
      raw = await readJsonBody(req);
    } catch {
      // 请求体原文不进日志:它是外部输入,而这条路径每天可能被扫描器打很多次
      resp.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      resp.end(JSON.stringify({ error: "invalid request body" }));
      return;
    }

    const path = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>).path : undefined;
    if (typeof path !== "string") {
      // 形状不对不算错误,按「记不了就不记」处理
      noContent(resp);
      return;
    }

    const salt = safeSalt();
    if (!salt) {
      if (!saltWarned) {
        saltWarned = true;
        console.error(
          "MetricsIpSalt 未配置:pageview 打点已停用(不会退化成不加盐哈希,docs/security.md §6)",
        );
      }
      noContent(resp);
      return;
    }

    try {
      const userAgent = headerValue(req.headers["user-agent"]);
      const day = siteDay(new Date());
      await recordVisit({
        day,
        path: await resolvePath(path),
        // 原始 IP / UA 就在这一行里被消费掉,不再向外传递
        visitor: visitorHash(salt, day, clientIp(req.headers, req.socket?.remoteAddress), userAgent),
        ua: uaDigest(userAgent),
      });
    } catch (err) {
      console.error(`pageview 打点失败: ${safeErrorText(err)}`);
    }
    noContent(resp);
  },
);

function headerValue(v: string | string[] | undefined): string {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" ? s : "";
}
