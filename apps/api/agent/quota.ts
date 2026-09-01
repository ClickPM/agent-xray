// R7 第 4 层沙箱的出网侧闸门:每日 token/费用计数与单会话轮数上限
// (docs/security.md §1 第 4 层)。
//
// 【限额值与用量的分工】限额**值**在 R6 建的 `llm_config` 默认行上
// (daily_token_limit / daily_cost_limit_cents / max_turns_per_session,0 = 不限),
// 由所有者经 MCP 改;**用量**在 R7 建的 `daily_quota` 上,由每一轮对话累加。
// 两张表分开是因为变更节奏完全不同 —— 把计数塞进配置表会让「改配置」和「跑对话」
// 抢同一行。
//
// 【为什么单会话轮数不另建表】一轮 = 一条 user 消息,`messages` 里已经是事实来源。
// 再存一个计数器就多一处会和消息表对不上的状态。
import { db } from "./db";

/**
 * 日界表达式。**读写两侧必须用同一句**,写死 Asia/Shanghai:
 * 所有者在境内,「今天的额度」应当在本地零点重置而不是早上八点;
 * 而容器里的 TZ 通常是 UTC,依赖服务器时区等于让日界随部署环境漂移。
 */
const TODAY = "(now() AT TIME ZONE 'Asia/Shanghai')::date";

/** 一美分 = 一万个 micro-USD(daily_quota.cost_micros 的单位)。 */
const MICROS_PER_CENT = 10_000;

export type QuotaReason = "daily_tokens" | "daily_cost" | "turn_limit";

export interface QuotaDenial {
  reason: QuotaReason;
  /** 给访客看的固定文案由前端按 code 决定,这里只留服务端日志用的一句 */
  detail: string;
}

interface QuotaRow {
  dailyTokenLimit: number;
  dailyCostLimitCents: number;
  maxTurnsPerSession: number;
  tokens: number;
  costMicros: number;
  turns: number;
}

/**
 * 一次查询取齐「限额 + 今日用量 + 本会话已用轮数」。
 *
 * BIGINT 列一律 `::double precision`:驱动对 int8 的回传形态在不同运行时下不一致
 * (字符串 / BigInt),而这些计数远在 2^53 以内,用 double 读回来就是普通 number。
 * 与 store.ts 的 `ms()` 是同一个理由、同一套写法。
 *
 * 全新会话传的是一个库里还没有行的 uuid,子查询自然回 0,不需要分支。
 */
async function loadQuotaRow(sessionId: string): Promise<QuotaRow | null> {
  return db.rawQueryRow<QuotaRow>(
    `SELECT l.daily_token_limit::double precision       AS "dailyTokenLimit",
            l.daily_cost_limit_cents::double precision  AS "dailyCostLimitCents",
            l.max_turns_per_session::double precision   AS "maxTurnsPerSession",
            COALESCE(q.tokens, 0)::double precision      AS "tokens",
            COALESCE(q.cost_micros, 0)::double precision AS "costMicros",
            (SELECT COUNT(*) FROM messages m
              WHERE m.session_id = $1::uuid AND m.role = 'user')::double precision AS "turns"
       FROM llm_config l
       LEFT JOIN daily_quota q ON q.day = ${TODAY}
      WHERE l.is_default`,
    sessionId,
  );
}

/**
 * 提问前的限额判定。返回 null = 放行。
 *
 * 【为什么每日限额只拦新会话】docs/security.md §1 第 4 层的原文就是
 * 「超限拒绝新会话;单会话 turn 上限」—— 已经在对话中的访客不会被中途掐断,
 * 兜住总量的是 turn 上限。可以量化的溢出上界:限额触发之后,最多还有
 * MAX_ACTIVE_SESSIONS 个会话各自把 max_turns_per_session 的剩余轮数跑完。
 * 想收紧就把 max_turns_per_session 调小,而不是改这里的语义。
 *
 * 【「新会话」的判据是库里有没有轮次,不是请求里带没带 sessionId】
 * (codex 初审 P1)`POST /agent/sessions` 是**公开**端点,建的是一个空会话。
 * 按「请求带了 id 就算续接」判定的话,先批量预建会话、再逐个带 id 提问,
 * 每一次都是「续接」—— 每日限额被整体绕过。以 `turns === 0` 为判据,
 * 预建的空会话与全新会话落在同一格,这条路自然被堵上;而真正在对话中的
 * 会话(turns ≥ 1)仍然不会被中途掐断,原口径不变。
 *
 * 【没有默认 provider 时不拦】那种情况下 `acquireSession` 会抛
 * LlmNotConfiguredError → 503,让它去说话;在这里拦只会把「没配模型」
 * 报成「额度用完」,把部署方引到错误的方向。
 */
export async function checkQuota(sessionId: string): Promise<QuotaDenial | null> {
  const row = await loadQuotaRow(sessionId);
  if (!row) return null;

  // 本会话还没有过任何一轮 = 这是在「开一段新对话」,每日限额对它生效
  if (row.turns === 0) {
    if (row.dailyTokenLimit > 0 && row.tokens >= row.dailyTokenLimit) {
      return {
        reason: "daily_tokens",
        detail: `daily token limit reached (${row.tokens}/${row.dailyTokenLimit})`,
      };
    }
    if (row.dailyCostLimitCents > 0 && row.costMicros >= row.dailyCostLimitCents * MICROS_PER_CENT) {
      return {
        reason: "daily_cost",
        detail: `daily cost limit reached (${row.costMicros} micros / ${row.dailyCostLimitCents} cents)`,
      };
    }
  }

  if (row.maxTurnsPerSession > 0 && row.turns >= row.maxTurnsPerSession) {
    return {
      reason: "turn_limit",
      detail: `session turn limit reached (${row.turns}/${row.maxTurnsPerSession})`,
    };
  }
  return null;
}

/**
 * 一轮结束后累加用量。
 *
 * 幂等性不做保证也**不需要**:计数器是尽力而为的资源闸,不是账单。调用点只有
 * `/agent/ask` 收尾一处,失败只记日志不重试 —— 为了记一笔用量把已经完成的一轮
 * 报成失败,是本末倒置。
 *
 * `tokens` 取 pi 的 `Usage.totalTokens`(含 input/output/cache,provider 报什么记什么),
 * `costMicros` 取 `Usage.cost.total`(美元)换算成百万分之一美元 —— 见迁移 004 里
 * 「为什么费用存 micros」。
 */
export async function recordUsage(tokens: number, costMicros: number): Promise<void> {
  // 用 rawExec 而不是模板字符串:`TODAY` 是一段 **SQL 表达式**,走模板插值会被当成
  // 参数绑定,变成把字符串 "(now() AT TIME ZONE …)" 塞进 day 列。
  await db.rawExec(
    `INSERT INTO daily_quota (day, tokens, cost_micros, turns)
     VALUES (${TODAY}, $1, $2, 1)
     ON CONFLICT (day) DO UPDATE
       SET tokens = daily_quota.tokens + EXCLUDED.tokens,
           cost_micros = daily_quota.cost_micros + EXCLUDED.cost_micros,
           turns = daily_quota.turns + 1,
           updated_at = now()`,
    Math.max(0, Math.round(tokens)),
    Math.max(0, Math.round(costMicros)),
  );
}

/** 美元 → 百万分之一美元。provider 不报价(自定义中转端点常见)时 cost 为 0。 */
export function usdToMicros(usd: number): number {
  return Number.isFinite(usd) ? Math.round(usd * 1_000_000) : 0;
}
