// 联网搜索的**目标域白名单**(docs/security.md §1 外呼组约束 2)。
//
// 判据的实现在 `outbound-hosts.ts`(R-IMAGEGEN 起与生图白名单共用同一份),这里只剩清单:
// 内置项写死、env 只能追加。为什么两个白名单不合一、为什么在 shared/ 而不在 agent/、
// 为什么在代码里而不在库里 —— 都写在那个文件的头部,别在这里再抄一遍。
//
// 消费方:`agent/websearch.ts`(每次外呼前)与 `mcp/tools.ts`(写入时);两处校验缺一不可。
import { makeHostAllowlist } from "./outbound-hosts";

export type { BaseUrlCheck } from "./outbound-hosts";

/** 内置项。改它要发版。 */
const BUILTIN_ALLOWED_HOSTS = ["api.deepseek.com", "aigateway.variflight.com"] as const;

/** 可选**追加**项(逗号分隔)。 */
const EXTRA_HOSTS_ENV = "XRAY_WEBSEARCH_EXTRA_HOSTS";

const allowlist = makeHostAllowlist({ builtin: BUILTIN_ALLOWED_HOSTS, extraEnv: EXTRA_HOSTS_ENV });

/** 白名单快照(排序,便于写进错误文案与 MCP 的工具说明)。 */
export const allowedHosts = allowlist.allowedHosts;

/** 校验一个 websearch baseUrl;四条判据见 `outbound-hosts.ts`。 */
export const checkBaseUrl = allowlist.checkBaseUrl;
