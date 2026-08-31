// notes 服务复用 agent 库(表在 agent/migrations/002_notes.up.sql)。
// 不新开 SQLDatabase:deploy/migrate.sh 只配置了 agent 一个库,多一个会被它拒掉。
import { SQLDatabase } from "encore.dev/storage/sqldb";

export const db = SQLDatabase.named("agent");
