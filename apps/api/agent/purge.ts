// 保留期清理(R-VISITOR)。约束来源:docs/security.md §6 的 R-VISITOR 补记
// 「会话最后活跃满 3 天硬删」。
//
// 【为什么不是 Encore CronJob】自托管镜像里**没有东西会去触发它** —— cron 是由 Encore
// 平台按注册的时刻调用端点的,`encore build docker` 产出的镜像自己不带调度器
// (官方文档:cron 不在本地开发与 Preview 环境执行)。写了 `new CronJob(...)` 只会得到
// 一个看起来很正规、实际永不触发的假清理,比没有更糟。落点因此是进程内定时器:
// 单机 compose(CLAUDE.md 规则 10)只有一个 api 实例,不存在多实例重复跑的问题;
// 就算重复跑,两条 DELETE 也是幂等的。
//
// 【为什么是尽力而为】清理不在任何请求路径上,失败只记日志、下个钟点重来。
// 把它接进请求路径(比如「顺手在会话列表里清一下」)会让一次库抖动变成访客可见的失败。
import { db } from "./db";
import { safeErrorText } from "../shared/redact";

/** 会话保留期:最后活跃满这么久之后硬删(级联 messages / trace_events)。 */
export const SESSION_RETENTION_DAYS = 3;
/** 访客行保留期:过期(24h 滑动窗口到点)之后再留这么久。 */
export const VISITOR_RETENTION_DAYS = 3;

const PURGE_INTERVAL_MS = 60 * 60_000;
/** 首次执行的延迟:让进程先把启动路径跑完,也避免 `encore test` 短跑里被触发。 */
const FIRST_RUN_DELAY_MS = 60_000;

export interface PurgeResult {
  sessions: number;
  visitors: number;
}

/**
 * 一次清理。**两条 DELETE 的顺序无关紧要**,因为它们的条件不会互相抢:
 * `visitors.expires_at` 是「最后一次请求 + 24h」,恒 ≥ 该访客任一会话的 `last_active_at`,
 * 所以 visitors 那条的成立时刻总比 sessions 那条更晚 —— 级联不会提前带走还没到期的会话。
 *
 * 存量无归属会话(`visitor_id IS NULL`,本轮之前建的)也被第一条覆盖:它们的判据同样是
 * `last_active_at`,不需要为它们单写一条规则。
 */
export async function purgeExpired(): Promise<PurgeResult> {
  const sessions = await db.rawQueryRow<{ n: number }>(
    `WITH deleted AS (
       DELETE FROM sessions
        WHERE last_active_at < now() - make_interval(days => $1::int)
        RETURNING id
     )
     SELECT COUNT(*)::double precision AS n FROM deleted`,
    SESSION_RETENTION_DAYS,
  );
  const visitors = await db.rawQueryRow<{ n: number }>(
    `WITH deleted AS (
       DELETE FROM visitors
        WHERE expires_at < now() - make_interval(days => $1::int)
        RETURNING id
     )
     SELECT COUNT(*)::double precision AS n FROM deleted`,
    VISITOR_RETENTION_DAYS,
  );
  return { sessions: sessions?.n ?? 0, visitors: visitors?.n ?? 0 };
}

let timer: ReturnType<typeof setInterval> | undefined;

/**
 * 定时器由本模块在被 import 时自启(`sessions.ts` 有一条副作用 import)。
 *
 * `unref()` 是必需的而不是讲究:不加的话 `encore test` 跑完不会退出,得等一个钟点的
 * 定时器 —— 那是 CLAUDE.md 规则 2 那类「本地一跑就卡住」的坑。
 */
export function startPurgeTimer(): void {
  if (timer) return;
  const run = () => {
    purgeExpired()
      .then(({ sessions, visitors }) => {
        if (sessions > 0 || visitors > 0) {
          console.log(`purge: removed ${sessions} session(s), ${visitors} visitor(s)`);
        }
      })
      .catch((err) => console.error(`purge failed: ${safeErrorText(err)}`));
  };
  timer = setInterval(run, PURGE_INTERVAL_MS);
  timer.unref?.();
  const first = setTimeout(run, FIRST_RUN_DELAY_MS);
  first.unref?.();
}

startPurgeTimer();
