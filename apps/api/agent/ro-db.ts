// 第 2 层沙箱的落点:pi 业务工具的**唯一**取数通道(docs/security.md §1 第 2 层)。
//
// 契约:本模块之外,`agent/tools.ts` 里的工具实现不得 import 任何别的 db 句柄。
// 工具能碰到的东西到此为止 —— 三张 notes 表,只读。
//
// 【为什么不是独立连接串】见 migrations/006_sandbox_quota.up.sql 顶部的裁定说明:
// agent_ro 是真角色、权限由库强制,只是不给登录能力,改由应用连接在事务内临时降权。
//
// 【为什么必须是 SET LOCAL 而不是 SET】Encore 的连接是池化的。`SET ROLE` 会留在连接上,
// 归还池子后下一个请求 —— 包括 mcp 管理面的写请求 —— 会继承这个降权状态,表现是
// 管理面偶发 permission denied,且复现依赖池子的调度顺序。`SET LOCAL` 随事务结束复位,
// 不存在这条泄漏路径。
import type { Transaction } from "encore.dev/storage/sqldb";
import { safeErrorText } from "../shared/redact";
import { db } from "./db";

/**
 * 工具查询的语句超时。第 4 层(资源滥用)的一部分:一次被诱导出来的病态查询
 * 不该把连接占到访客放弃为止。三张表都很小,5s 是宽裕的上界而不是预算。
 */
const TOOL_STATEMENT_TIMEOUT = "5s";

/**
 * 以 `agent_ro` 身份跑一段只读查询。
 *
 * 三条 SET 的顺序是有讲究的:
 *   1. `SET TRANSACTION READ ONLY` 必须排在事务里**第一条查询之前**(Postgres 的硬性
 *      要求),所以它排第一。它挡的是「工具实现自己写错了 SQL」这一类,与角色权限
 *      是两道独立的闸 —— 角色那道挡的是「即使 SQL 想写也无权写」。
 *   2. `statement_timeout` 在降权之前设:它是 USERSET 级 GUC,降权后照样能设,
 *      但放前面读起来更像「先把护栏立好再放行」。
 *   3. `SET LOCAL ROLE` 最后,此后的每一条语句都以 agent_ro 的权限执行。
 *
 * 调用方拿到的是 `Transaction`,只应在其上做 SELECT。写操作会被 Postgres 拒绝
 * (agent/tools.test.ts 有一条针对性用例),这是设计,不是意外。
 */
export async function queryAsAgentRo<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  const tx = await db.begin();
  try {
    await tx.rawExec("SET TRANSACTION READ ONLY");
    await tx.rawExec(`SET LOCAL statement_timeout = '${TOOL_STATEMENT_TIMEOUT}'`);
    await tx.rawExec("SET LOCAL ROLE agent_ro");
    const out = await fn(tx);
    await tx.commit();
    return out;
  } catch (err) {
    // 回滚失败不能盖掉原始错误;原始错误才是调用方要看的那个
    await tx.rollback().catch((e) => console.error(`agent_ro tx rollback failed: ${safeErrorText(e)}`));
    throw err;
  }
}
