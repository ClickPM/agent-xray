// metrics 服务复用 agent 库(表在 agent/migrations/004_metrics.up.sql)。
// 与 notes/db.ts、mcp/db.ts 同理:deploy/migrate.sh 只配置了 agent 一个库,
// 多一个 migrations 目录会被它直接拒掉。
import { SQLDatabase } from "encore.dev/storage/sqldb";

export const db = SQLDatabase.named("agent");
