// 顶部导航 tab 呈现开关的**只读**读取(R-TABS)。
//
// 写面在 mcp 服务的 `site_tab_set`,读面在这里 —— 与 about(读)/ mcp(写)、
// trace(读)/ agent(写)是同一个分工(`docs/security.md` §4「两个面互不触碰」)。
// 本服务不建表、不加迁移、不写库。
import { SITE_TABS } from "../shared/site-tabs";
import { db } from "./db";

export interface SiteTabState {
  key: string;
  visible: boolean;
}

/**
 * 登记表 × 库里的开关,合成前端要的那份清单。
 *
 * 两条兜底方向刻意不同,理由都写在这里:
 *
 *  · **登记表里有、库里没有行 → 当作可见**。缺行只有一个成因:那个 tab 的种子迁移没跑到
 *    (新增 tab 时忘了写 INSERT,或库落后于代码)。此时「照常显示」是对的 ——
 *    一个从没被配置过的 tab 不该因为配置缺席就从站点上消失,那会让一次漏写的迁移
 *    表现成「上线后有一整块内容不见了」,而且现场没有任何报错指向原因。
 *
 *  · **库里有、登记表里没有的行 → 丢弃**。它要么是手工改库写进去的,要么是某个已删除
 *    tab 的遗留行。让库里的一个字符串决定站点上出现什么,正是 `tool_config`
 *    「未知名字不会凭名字长出工具」挡掉的那件事。
 *
 * 顺序取登记表的顺序(不是库的),前端据此渲染;库里的行序不参与任何决定。
 */
export async function listTabs(): Promise<SiteTabState[]> {
  const rows = await db.rawQueryAll<{ key: string; visible: boolean }>(
    `SELECT key, visible FROM site_tab_config`,
  );
  const byKey = new Map(rows.map((r) => [r.key, r.visible]));
  return SITE_TABS.map((t) => ({ key: t.key, visible: byKey.get(t.key) ?? true }));
}
