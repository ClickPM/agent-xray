-- R-TABS:顶部导航 tab 的呈现开关(所有者裁定 2026-09-03)。
--
-- 【为什么会有这张表】站点在公安网备案的内容审核窗口期里,所有者需要把 Runtime
-- (agent 工作台)那一格整个从站点上撤下来,审核过后再放回来 —— 而这件事**不能靠发版**:
-- 撤下与放回各要一次本机构建 + 传镜像 + 重建容器,窗口期里可能来回好几轮。
-- 与 `tool_config`(工具启停)、`llm_config`(provider)同一个形态:配置进库,经 MCP 改,即时生效。
--
-- 【边界:本表只管"呈现"】(所有者裁定 2026-09-03)
-- 隐藏一个 tab = 导航条不渲染它 + web 侧该 tab 的页面不可达(404 / 首页重定向)。
-- **后端 API 不受影响** —— `/agent/*`、`/trace/*`、`/notes/*`、`/rss.xml` 照常服务。
-- 想让 agent 真的停下来,现成的通路是 `tool_config_set` 与删掉默认 LLM provider,
-- 不是这张表。这条边界写进了 `site_tab_set` 的 description,别在实现里悄悄扩大它。
--
-- 建在 agent 库而不是新开 SQLDatabase:与 002/003/006/008/010 同理,deploy/migrate.sh 只认 agent 一个库。
--
-- 本迁移只有 CREATE / INSERT,没有删列、改类型、删数据(R11 起的「不做不可逆迁移」仍适用)。
CREATE TABLE site_tab_config (
    -- tab 的稳定标识。**闭集由代码持有**(apps/api/shared/site-tabs.ts 的 SITE_TABS),
    -- 不是这里的 CHECK —— 将来新增 tab 时要改的是那份登记表 + 一条种子行,
    -- 而不是改一条 CHECK(改 CHECK 要走 ALTER TABLE,那正是「不可逆迁移」那一类)。
    -- 这里只把形状收窄到 snake_case,挡住手工改库时写进带空格 / 大写的键。
    key        TEXT PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{0,31}$'),

    -- TRUE = 导航条渲染它、它的页面可达。默认 TRUE:新种下的 tab 是露出来的,
    -- 「藏起来」永远是一次显式动作。
    visible    BOOLEAN NOT NULL DEFAULT TRUE,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────────────── 种子:现有三个 tab,全部可见 ─────────────────────
--
-- 键与 `apps/api/shared/site-tabs.ts` 的 SITE_TABS 一一对应,少一个的表现是
-- 「那个 tab 永远开着、关不掉」(读面对缺行按 visible=true 兜底) —— 不报错,
-- 所以有一条测试从本表读回键集合与登记表比对(apps/api/site/tabs.test.ts)。
--
-- ON CONFLICT DO NOTHING:与 tool_config 的种子同款,让本迁移在已有行的库上也是幂等的。
INSERT INTO site_tab_config (key, visible) VALUES
    ('runtime', TRUE),
    ('notes',   TRUE),
    ('about',   TRUE)
ON CONFLICT (key) DO NOTHING;

-- agent_ro / agent_title / agent_image 对本表**无任何权限**:它不是内容面,是站点配置面。
-- 迁移 006 刻意没设 ALTER DEFAULT PRIVILEGES,所以这里不写 GRANT 就是全部答案。
