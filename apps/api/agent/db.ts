// agent 服务数据库:sessions / messages / trace_events(迁移见 ./migrations)。
// 其他服务(R4 trace 回放)经 SQLDatabase.named("agent") 引用,不重复声明。
import { SQLDatabase } from "encore.dev/storage/sqldb";

export const db = new SQLDatabase("agent", {
  migrations: "./migrations",
});
