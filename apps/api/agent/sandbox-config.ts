// 沙箱执行组的运行期配置(R-SKILLS-2),与 `websearch-config.ts` 同构、更简单:
// mcp 服务写 `sandbox_config`(`sandbox_config_get` / `sandbox_config_set`),agent 服务只读,不 import 对方目录。
//
// 与 websearch-config 的两处相同:
//   1. **读不到不是错误**:沙箱执行是可选能力,读不到 = 「skill_run 这轮不注册」,站点照常工作。
//   2. **返回值里带着指纹**:两个上限被 `makeSkillRunTool` 定格在闭包里,改了要靠指纹变化触发会话重建
//      (R6 定下的统一规则),漏算任何一个字段都是「改了不生效」。
// 与它的一处不同:**没有凭据**。这一组不持任何 key,所以也没有解密这一步。
import { createHash } from "node:crypto";
import { db } from "./db";

export interface SandboxConfig {
  /** 0 = 不限 */
  dailyRunLimit: number;
  /** 单次运行总时长上限(含在执行容器里排队),库级 CHECK 5000–120000 */
  totalTimeoutMs: number;
  fingerprint: string;
}

interface Row {
  dailyRunLimit: number;
  totalTimeoutMs: number;
}

/**
 * 读当前的沙箱配置;没有行时回 `null`(迁移 013 种了单行,正常情况下不会)。
 * 不缓存:只在注册环节被调,不在工具体内。
 */
export async function loadSandboxConfig(): Promise<SandboxConfig | null> {
  const row = await db.rawQueryRow<Row>(
    // INT 列 ::double precision 读回,与 quota.ts / websearch-config.ts 同一套写法
    `SELECT daily_run_limit::double precision  AS "dailyRunLimit",
            total_timeout_ms::double precision AS "totalTimeoutMs"
       FROM sandbox_config
      WHERE id = 1`,
  );
  if (!row) return null;
  return {
    dailyRunLimit: row.dailyRunLimit,
    totalTimeoutMs: row.totalTimeoutMs,
    fingerprint: createHash("sha256")
      .update(JSON.stringify([row.dailyRunLimit, row.totalTimeoutMs]))
      .digest("hex"),
  };
}
