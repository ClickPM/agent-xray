// 第 2 层沙箱里**唯一一段刻意可写的通道**(docs/security.md §1 第 2 层的 R-TITLE 补记)。
//
// 契约与 `ro-db.ts` 对称,只是方向相反:
//   ro-db.ts    → agent_ro,`READ ONLY` 事务,只能读 notes 三张表;
//   本文件      → agent_title,可写事务,只能改 sessions 的 title / title_source 两列。
//
// 「只能改标题」由 Postgres 的**列级授权**强制(迁移 009),不靠调用方自觉:
// 就算这里的 SQL 写成 `UPDATE sessions SET visitor_id = …`,库也会回 permission denied。
// 代码这一侧负责的是另一半 —— **改哪一行**:sessionId 由 `agent/tools.ts` 在建会话时
// 闭包绑定,模型给不出这个参数(工具入参只有一个 title)。
import { safeErrorText } from "../shared/redact";
import { db } from "./db";

/**
 * 语句超时。与 ro-db 同一个理由(第 4 层:资源滥用),值取一致 ——
 * 这是一条单行索引更新,5s 是宽裕的上界而不是预算。
 */
const TITLE_STATEMENT_TIMEOUT = "5s";

/**
 * 以 `agent_title` 身份把标题写进**指定的那一行会话**。
 *
 * 返回 true 表示确实改了一行;false 覆盖两种情况,调用方不必区分:
 *   - 这个会话已经被命名过(`title_source = 'agent'`)——「只命名一次」的第二道闸,
 *     第一道是「已命名的会话冷启动时根本不注册这个工具」(runtime.ts);
 *   - 会话行已经不存在(访客在另一个标签页把它删了)。
 *
 * 【三条 SET 少一条都不行,但也别多加】
 *   1. `SET LOCAL statement_timeout` —— 第 4 层的一部分,在降权之前设(USERSET GUC,
 *      降权后照样能设,放前面是为了「先立护栏再放行」的读法与 ro-db 一致)。
 *   2. `SET LOCAL ROLE agent_title` —— 此后每条语句都以该角色的权限执行。
 *      **必须是 `SET LOCAL`**:Encore 的连接是池化的,裸 `SET ROLE` 会留在连接上,
 *      归还池子后下一个请求(包括 MCP 管理面的写请求)会继承降权状态,
 *      表现是管理面偶发 permission denied 且复现依赖池子的调度顺序。
 *   3. **不加 `SET TRANSACTION READ ONLY`** —— ro-db 有这一条,这里加了就什么都写不成。
 *      两个文件长得像,改的时候别顺手把那一行抄过来。
 */
export async function setSessionTitleAsAgent(sessionId: string, title: string): Promise<boolean> {
  const tx = await db.begin();
  try {
    await tx.rawExec(`SET LOCAL statement_timeout = '${TITLE_STATEMENT_TIMEOUT}'`);
    await tx.rawExec("SET LOCAL ROLE agent_title");
    const row = await tx.rawQueryRow<{ id: string }>(
      `UPDATE sessions
          SET title = $2, title_source = 'agent'
        WHERE id = $1::uuid AND title_source = 'derived'
        RETURNING id`,
      sessionId,
      title,
    );
    await tx.commit();
    return row !== null;
  } catch (err) {
    // 回滚失败不能盖掉原始错误;原始错误才是调用方要看的那个
    await tx
      .rollback()
      .catch((e) => console.error(`agent_title tx rollback failed: ${safeErrorText(e)}`));
    throw err;
  }
}
