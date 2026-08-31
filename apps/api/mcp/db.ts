// mcp 服务复用 agent 库(表在 agent/migrations/003_mcp_admin.up.sql)。
// 与 notes/db.ts 同理:deploy/migrate.sh 只配置了 agent 一个库,多一个会被它拒掉。
//
// 本服务用的是**全权 DB 角色**(app);pi agent 侧走 R7 的 agent_ro 只读角色,
// 对本服务写的表一律无权限(docs/security.md §4「两个面互不触碰」)。
import { SQLDatabase } from "encore.dev/storage/sqldb";

export const db = SQLDatabase.named("agent");
