// site 服务复用 agent 库(表在 agent/migrations/011_site_tabs.up.sql)。
// 不新开 SQLDatabase:与 about / notes / trace 同理,deploy/migrate.sh 只认 agent 一个库。
import { SQLDatabase } from "encore.dev/storage/sqldb";

export const db = SQLDatabase.named("agent");
