// about 服务复用 agent 库(表在 agent/migrations/003_mcp_admin.up.sql,
// 「公开仓库 / 语言构成」两列在 005_about_showcase.up.sql)。
// 不新开 SQLDatabase:deploy/migrate.sh 只认 agent 一个库。
import { SQLDatabase } from "encore.dev/storage/sqldb";

export const db = SQLDatabase.named("agent");
