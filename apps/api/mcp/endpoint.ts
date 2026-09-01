// 管理面唯一入口:`api.raw` 单端点 `/mcp`(对外 `/api/mcp`,走既有 `/api/*` 反代,
// 无需新增 Caddy 路由)。
//
// 请求顺序是刻意的:**先认证,再把请求交给 MCP handler**。
// 认证放在 SDK 之前而不是做成 MCP 的某种中间件,是因为未认证的请求不该有机会
// 让服务端构造 server 实例、解析 JSON-RPC、命中任何工具 —— 它应该在最外层就被挡掉。
//
// GET / DELETE 也接进来(而不是让 Encore 404):2026-07-28 的服务器**应当**对这两个
// 2025 时代的会话操作回 405,SDK 的向下兼容分支就是这么做的;由 Encore 回 404
// 会让客户端把「这个端点不说现代协议」误判成「这个地址上没有 MCP」。
import { api } from "encore.dev/api";
import type { IncomingMessage, ServerResponse } from "node:http";
import { audit, remoteOf } from "./audit";
import { UNAUTHORIZED_BODY, verifyAuth } from "./auth";
import { mcpAuthTokenHash } from "./secrets";
import { getNodeHandler } from "./server";

/**
 * 带 `Origin` 的请求一律拒。
 *
 * 规范要求服务器校验 `Origin` 以防 DNS rebinding。本站的管理面没有浏览器客户端
 * ——所有者用的是 Claude Code 这类进程内 MCP 客户端,它们不发 Origin —— 所以
 * 「有 Origin 就是浏览器发起的,拒绝」是这里最省事也最严的策略,
 * 且不需要配置一份随部署环境漂移的域名白名单。
 * 将来真要接浏览器客户端,再在这里换成白名单(并同步 docs/security.md §4)。
 */
function hasOrigin(req: IncomingMessage): boolean {
  const o = req.headers.origin;
  const v = Array.isArray(o) ? o[0] : o;
  return typeof v === "string" && v.trim() !== "";
}

function deny(resp: ServerResponse, status: number, body: string): void {
  resp.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    // 规范的 authorization 章节是可选项,本站取静态 token(docs/security.md §4);
    // 仍按 RFC 6750 给出 challenge,客户端据此知道该带 bearer。
    "WWW-Authenticate": 'Bearer realm="agent-xray-admin"',
  });
  resp.end(body);
}

export const mcp = api.raw(
  {
    expose: true,
    method: ["POST", "GET", "DELETE"],
    path: "/mcp",
    // 附件上传的请求体额度:8 MiB。
    //
    // Encore 默认 2 MiB,而附件走 base64、膨胀 4/3 —— 不抬高的话一张 1.6 MB 的图
    // 会在**进 MCP handler 之前**被框架拒掉,报的还是与工具无关的错(codex 复审 P2)。
    // 必须与 `tools.ts` 的 `MAX_ASSET_BYTES`(4 MiB)配套,改一处要改两处。
    //
    // 【只能写字面量】Encore 在编译期静态解析这个字段:写成常量或 `8 * 1024 * 1024`
    // 都会报 `expected integer literal`(实测)。8388608 = 8 MiB。
    bodyLimit: 8388608,
    // 【必须有】(codex 复审 P1)不设的话 Encore 会把请求头原样写进 trace ——
    // 实测在本地 trace 里读到了 `authorization: Bearer <明文管理 token>`。
    // 服务端只存哈希这件事,会被一份带着原 token 的 trace 整个抵消
    // (docs/security.md §3「明文凭据不进日志」)。
    sensitive: true,
  },
  async (req, resp) => {
    const remote = remoteOf(req.headers);

    if (hasOrigin(req)) {
      await audit({ outcome: "denied", summary: "带 Origin 头的请求(疑似浏览器发起)", remote });
      // 403 是规范对 Origin 校验失败指定的状态码
      resp.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
      resp.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "forbidden" } }));
      return;
    }

    // secret 未配置时 verifyAuth 返回失败 —— 「没配 token 就放行」不是这里的默认值
    const verdict = verifyAuth(req.headers.authorization, safeSecret());
    if (!verdict.ok) {
      // 失败尝试是唯一能看出 token 被猜的地方,一条都不能少(docs/security.md §4)
      await audit({
        outcome: "denied",
        method: methodHint(req),
        summary: `认证失败:${verdict.reason}`,
        remote,
      });
      deny(resp, 401, UNAUTHORIZED_BODY);
      return;
    }

    await getNodeHandler()(req, resp);
  },
);

/**
 * secret 取值不能让整个端点炸掉。
 *
 * Encore 的 `secret()` 在**值缺失时抛错**;那会让一个未配置的部署对所有请求回 500,
 * 而不是回 401 —— 500 会把「服务端配置有问题」这条信息白送给探测者,
 * 也让所有者难以分辨「我 token 打错了」和「服务端没起来」。
 */
function safeSecret(): string | undefined {
  try {
    return mcpAuthTokenHash();
  } catch {
    console.error("McpAuthTokenHash secret 未配置:管理面将拒绝全部请求");
    return undefined;
  }
}

/**
 * 审计里的 method 线索。2026-07-28 把 JSON-RPC 的 method 镜像到了 `Mcp-Method` 头
 * (让网关不解析 body 也能路由),这里正好借它 —— **不读 body**:
 * body 只能被消费一次,读了就轮不到 MCP handler 了。
 */
function methodHint(req: IncomingMessage): string | undefined {
  const m = req.headers["mcp-method"];
  const v = Array.isArray(m) ? m[0] : m;
  return typeof v === "string" ? v.slice(0, 64) : undefined;
}
