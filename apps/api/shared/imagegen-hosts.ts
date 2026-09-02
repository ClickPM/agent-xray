// 生图工具的**目标域白名单**(R-IMAGEGEN;docs/security.md §1 外呼组约束 2)。
//
// 与 `websearch-hosts.ts` 是同一份判据实现(`outbound-hosts.ts`)的第二个实例,**清单刻意分开**:
// 一个域被列进搜索白名单,不等于它自动可以当生图端点 —— 所有者要显式选。
// 所以这里不 import 搜索那份清单,也不存在「合并两份」的入口。
//
// 内置项:OpenAI 官方端点,以及本站自己的 AI 网关(它同时在搜索白名单里,两处各列一次是刻意的)。
// 所有者的 CLIProxyAPI 网关(域名随 IP 变)走 env 追加,与搜索那边的做法一致
// (R11 已把它加进 `XRAY_WEBSEARCH_EXTRA_HOSTS`,本轮同款再加一次 `XRAY_IMAGEGEN_EXTRA_HOSTS`)。
//
// 消费方:`agent/imagegen.ts`(每次外呼前)与 `mcp/tools.ts`(写入时);两处校验缺一不可。
import { makeHostAllowlist } from "./outbound-hosts";

export type { BaseUrlCheck } from "./outbound-hosts";

/** 内置项。改它要发版。 */
const BUILTIN_ALLOWED_HOSTS = ["api.openai.com", "aigateway.variflight.com"] as const;

/** 可选**追加**项(逗号分隔)。 */
const EXTRA_HOSTS_ENV = "XRAY_IMAGEGEN_EXTRA_HOSTS";

const allowlist = makeHostAllowlist({ builtin: BUILTIN_ALLOWED_HOSTS, extraEnv: EXTRA_HOSTS_ENV });

/** 白名单快照(排序,便于写进错误文案与 MCP 的工具说明)。 */
export const allowedImageHosts = allowlist.allowedHosts;

/** 校验一个 imagegen baseUrl;四条判据见 `outbound-hosts.ts`。 */
export const checkImageBaseUrl = allowlist.checkBaseUrl;
