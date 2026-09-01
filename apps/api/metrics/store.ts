// metrics 服务的库写入路径(R8)。聚合查询不在这里 —— 展示面是 MCP 管理面的
// 统计 tools,那些 SQL 在 `apps/api/mcp/store.ts`(与 trace 服务只读 agent 表
// 同一个先例:表的归属在一处,读它的服务各自写自己的 store)。
import { db } from "./db";

export interface VisitInput {
  /** 站点时区的自然日,`YYYY-MM-DD`(metrics/visitor.ts 的 siteDay) */
  day: string;
  /** 已归一的站内路径(metrics/path.ts 的 resolvePath) */
  path: string;
  /** 加盐哈希后的访客标识;**调用方保证这里永远不是原始 IP** */
  visitor: string;
  /** UA 摘要(闭集),不是原始 UA */
  ua: string;
}

/**
 * 记一次 pageview。
 *
 * 一行 = (day, path, visitor) 的计数行:同一个访客当天在同一页刷一万次也只是
 * `hits` 变大,不会多出一行(迁移 004 的注释里有完整理由)。
 *
 * `ua` 只在插入时写、冲突时不更新:visitor 的哈希输入里已经含了原始 UA,
 * UA 变了就是另一个 visitor、另一行 —— 也就是说同一行的 ua 恒定,
 * `DO UPDATE SET ua = …` 是个永远写回同一个值的空操作。
 */
export async function recordVisit(v: VisitInput): Promise<void> {
  await db.rawExec(
    `INSERT INTO visits (day, path, visitor, ua, hits, first_at, last_at)
     VALUES ($1::date, $2, $3, $4, 1, now(), now())
     ON CONFLICT (day, path, visitor)
     DO UPDATE SET hits = visits.hits + 1, last_at = now()`,
    v.day,
    v.path,
    v.visitor,
    v.ua,
  );
}
