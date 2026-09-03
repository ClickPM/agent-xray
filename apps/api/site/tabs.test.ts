// R-TABS:顶部导航 tab 呈现开关的**读面**测试(写面在 mcp/mcp.test.ts)。
//
// 覆盖面按「错了会静默」排序:
//   - 迁移种子 ↔ 登记表一致 —— 漏一条种子的表现是「那个 tab 关不掉」,不报错
//   - 缺行兜底成可见 —— 反过来兜成不可见的话,一次漏写的迁移会表现成「上线后少了一整块」
//   - 库里的未知 key 被丢弃 —— 否则手工改库就能决定站点上出现什么
import { afterEach, describe, expect, it } from "vitest";
import { SITE_TABS, SITE_TAB_KEYS, isSiteTabKey } from "../shared/site-tabs";
import { db } from "./db";
import * as store from "./store";

/** 复原成迁移种子的样子:登记表里的每个 key 一行(011 三行 + 012 的 skills)、全可见、没有多余的 key。 */
async function reseed(): Promise<void> {
  await db.exec`DELETE FROM site_tab_config`;
  for (const key of SITE_TAB_KEYS) {
    await db.rawExec(`INSERT INTO site_tab_config (key, visible) VALUES ($1, TRUE)`, key);
  }
}

describe("tab 呈现开关的读面(site/store,R-TABS)", () => {
  afterEach(reseed);

  it("迁移 011 种下的 key 集合 == shared/site-tabs 的登记表", async () => {
    // 这条**必须在任何改动之前**读:它验的是迁移的产物,不是本文件写进去的东西。
    // 少一条种子不会报错 —— 读面按缺行兜底成可见,表现只是「那个 tab 关不掉」。
    const rows = await db.rawQueryAll<{ key: string }>(`SELECT key FROM site_tab_config ORDER BY key`);
    expect(rows.length, "site_tab_config 里没有种子行(迁移 011 没跑?)").toBeGreaterThan(0);
    expect(rows.map((r) => r.key).sort()).toEqual([...SITE_TAB_KEYS].sort());
  });

  it("默认全部可见,顺序取登记表而不是库", async () => {
    const tabs = await store.listTabs();
    expect(tabs.map((t) => t.key)).toEqual([...SITE_TAB_KEYS]);
    expect(tabs.every((t) => t.visible)).toBe(true);
  });

  it("库里置 false 就不可见", async () => {
    await db.rawExec(`UPDATE site_tab_config SET visible = FALSE WHERE key = 'runtime'`);
    const tabs = await store.listTabs();
    expect(tabs.find((t) => t.key === "runtime")?.visible).toBe(false);
    // 只影响被改的那一个(R-SKILLS 起登记表是四格)
    expect(tabs.filter((t) => t.visible).map((t) => t.key)).toEqual(["notes", "skills", "about"]);
  });

  it("登记表里有、库里缺行 → 按可见兜底(漏写的迁移不该让一整块内容消失)", async () => {
    await db.rawExec(`DELETE FROM site_tab_config WHERE key = 'about'`);
    const tabs = await store.listTabs();
    expect(tabs.map((t) => t.key)).toEqual([...SITE_TAB_KEYS]);
    expect(tabs.find((t) => t.key === "about")?.visible).toBe(true);
  });

  it("库里有、登记表里没有的 key 被丢弃(手工改库长不出新 tab)", async () => {
    await db.rawExec(`INSERT INTO site_tab_config (key, visible) VALUES ('admin', TRUE)`);
    const tabs = await store.listTabs();
    expect(tabs.map((t) => t.key)).toEqual([...SITE_TAB_KEYS]);
    expect(isSiteTabKey("admin")).toBe(false);
  });

  it("登记表的 key 满足库里那条 CHECK 的形状", () => {
    // 反过来说:将来加一个带大写或连字符的 key,会在迁移种子那一步被 Postgres 拒掉,
    // 而那时人已经写完前后端两处登记表了 —— 在这里先拦住。
    for (const t of SITE_TABS) {
      expect(t.key, `${t.key} 不满足 ^[a-z][a-z0-9_]{0,31}$`).toMatch(/^[a-z][a-z0-9_]{0,31}$/);
    }
  });
});
