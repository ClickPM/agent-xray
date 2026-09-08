// source 服务复用 agent 库(表在 agent/migrations/016_source.up.sql)。
// 不新开 SQLDatabase:与 about / notes / site / skills 同理,deploy/migrate.sh 只认 agent 一个库。
import { SQLDatabase } from "encore.dev/storage/sqldb";

export const db = SQLDatabase.named("agent");
