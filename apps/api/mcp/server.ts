// 无状态 MCP server 的装配(ROUNDS.md R6;协议目标版本 2026-07-28)。
//
// 【为什么是 @modelcontextprotocol/server 而不是 @modelcontextprotocol/sdk】
// 2026-07-28 那次修订把 MCP 从「有握手 + 有会话」改成了无状态请求/响应:去掉
// `initialize`、去掉 `Mcp-Session-Id`,协议版本与客户端能力改由每请求的 `_meta` 携带,
// 新增必须实现的 `server/discover`。**旧包 `@modelcontextprotocol/sdk` 至今(1.30.0,
// latest)的 LATEST_PROTOCOL_VERSION 仍是 2025-11-25,里面没有 server/discover**;
// 支持 2026-07-28 的是 SDK v2,以全新包名发布(`@modelcontextprotocol/server` /
// `@modelcontextprotocol/client`,2.0.0)。开工实测记在 rounds/round-06。
//
// 【向下协商怎么来的】`createMcpHandler` 的 `legacy` 默认就是 `'stateless'`:
// 2025 时代的请求(带 initialize 握手的那套)由同一个 factory 起一个一次性实例服务,
// 每请求一个、不留会话状态。所有者裁定「客户端支持仍在铺开,保留向下协商」,
// 所以这里**不设** `legacy: 'reject'`。
//
// 【不实现 subscriptions/listen】管理面没有订阅需求(ROUNDS.md R6),
// 少一条长连接就少一份「连接生命周期在 Encore 网关下探测不到」的老问题
// (见 apps/api/trace/README.md)。
import { createMcpHandler, McpServer, type McpHttpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { safeErrorText } from "../shared/redact";
import { registerTools } from "./tools";

const SERVER_NAME = "agent-xray-admin";
const SERVER_VERSION = "1.0.0";

const INSTRUCTIONS =
  "Agent X-Ray 站点的管理面。用这些工具维护 Notes 内容(分类/系列/文章/配图)、About 页内容、" +
  "LLM provider 配置与 agent 业务工具的启停。\n" +
  "约定:文章正文是标准 markdown(GFM),服务端只校验不改写;配图先 notes_asset_put 上传," +
  "正文里用 /notes/<seriesSlug>/<文件名> 引用。LLM key 任何读回都是掩码。";

/** 反代在前,socket 地址永远是反代;审计线索取 XFF 首段(见 audit.ts 的同名逻辑)。 */
function remoteOfRequest(request: Request | undefined): string | undefined {
  if (!request) return undefined;
  const first = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (first) return first.slice(0, 64);
  return request.headers.get("x-real-ip")?.trim().slice(0, 64) || undefined;
}

/**
 * 每请求一个 server 实例(无状态的字面含义)。工具注册是纯装配、无 IO,
 * 每请求重做一次的成本可忽略;换来的是「实例之间不共享任何东西」这件确定的事。
 */
function buildHandler(): McpHttpHandler {
  return createMcpHandler(
    (rctx) => {
      const server = new McpServer(
        { name: SERVER_NAME, version: SERVER_VERSION },
        { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
      );
      registerTools(server, { remote: remoteOfRequest(rctx.requestInfo) });
      return server;
    },
    {
      // 管理面的工具都是「一次库操作后返回」,没有中途通知要发;
      // 固定单条 JSON 响应可以完全避开 SSE —— 而 SSE 在 Encore 网关下的
      // 断连探测问题是本仓库已知的老坑(trace/README.md)。
      // 注:2025 时代的向下兼容分支仍可能出 SSE,那条路径由 SDK 自己管。
      responseMode: "json",
      // 【必须显式关掉,不能只在文档里说「不实现」】
      // `subscriptions/listen` 是 createMcpHandler **自带**的(默认上限 1024 条),
      // 而 Claude Code 一连上来就会调它(2026-08-31 实测抓包:server/discover →
      // subscriptions/listen → tools/list)。开着的话每次连接都在这个端点上留下一条
      // 长连 SSE —— 而本仓库已经确认 Encore 网关**不把客户端断开传导进来**
      // (apps/api/trace/README.md),那些流没有任何东西能收尾,只会累积。
      // 管理面本就没有订阅需求(ROUNDS.md R6),0 让它在开流之前就被拒
      // (SDK 用的是 `?? 默认值`,0 会被保留而不是回落成 1024;
      //  判据是 `open.size >= maxSubscriptions`,恒真)。
      maxSubscriptions: 0,
      onerror: (err) => console.error(`mcp handler error: ${safeErrorText(err)}`),
    },
  );
}

let nodeHandler: ReturnType<typeof toNodeHandler> | undefined;

/** 惰性装配:进程起来时不必为一个可能永远不被访问的管理端点付构造成本。 */
export function getNodeHandler(): ReturnType<typeof toNodeHandler> {
  if (!nodeHandler) {
    nodeHandler = toNodeHandler(buildHandler(), {
      onerror: (err) => console.error(`mcp node adapter error: ${safeErrorText(err)}`),
    });
  }
  return nodeHandler;
}
