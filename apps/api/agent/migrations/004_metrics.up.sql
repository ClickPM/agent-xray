-- R8 访问统计:自托管 pageview 打点(`docs/security.md` §6:IP 加盐哈希后落库,
-- **不存原始 IP**;无第三方统计脚本、无 cookie)。
--
-- 建在 agent 库而不是新开 SQLDatabase:与 002 / 003 同理,deploy/migrate.sh 只认
-- agent 一个库,发现第二个 migrations 目录会直接拒绝执行。
--
-- 写入方是 metrics 服务(`POST /t`),读取方是 mcp 管理面的统计查询 tools。
-- pi agent 侧的 agent_ro 角色对本表**无任何权限**(docs/security.md §1 第 2 层,
-- §2 已把 visits 列进不授权清单)——访客统计不是教程内容,agent 没有理由读得到。

-- ───────────────────── pageview ─────────────────────
--
-- 【为什么是计数行而不是一行一次 pageview】
-- 一行一 pageview 的表在被人对着 `POST /t` 打循环时会无界增长;做成
-- `(day, path, visitor)` 的计数行之后,同一个访客当天在同一页刷一万次也只是
-- 一行的 hits 变大。
--
-- 【行数上界 = 天数 × 路径数 × visitor 数,而这三项都必须有界】
-- `/t` 是无认证的公开写入口,主键的每一个分量都是请求方能影响的东西 ——
-- 任何一项无界,这张表就能被一个 curl 循环撑爆(codex 第 1 轮 P1 就是这么来的:
-- 当时 visitor 的哈希输入里含**原始 UA 串**,每次换个 User-Agent 就是一行新数据)。
--   · path    —— 归一到站内已知路由形状 + 库内存在性校验(metrics/path.ts)
--   · visitor —— 哈希输入全部收敛过:day + IP **网段** + UA **摘要**(metrics/visitor.ts)
--
-- 【visitor 是什么】sha256(salt ‖ day ‖ IP网段 ‖ UA摘要) 的 hex 前 32 位。
-- **day 进哈希输入是刻意的**:同一个人在不同日期得到不同的 visitor,
-- 跨天无法串成一条访问史 —— 这也意味着「近 30 天 UV」只能是各日 UV 之和
-- (统计 tool 里叫 visitorDays,不叫 UV,免得被读成「多少个人」)。
--
-- 【ua 是摘要不是原文】浏览器族/平台族的闭集组合(如 Chrome/Windows),
-- 上限几十种。原始 UA 串本身就是高熵指纹,不落库。
CREATE TABLE visits (
    day      DATE NOT NULL,
    -- 已归一的站内路径('/', '/notes', '/notes/<系列>', '/notes/<系列>/<章节>',
    -- '/about');归一不出来的一律落到常量桶 '/*'
    path     TEXT NOT NULL,
    visitor  TEXT NOT NULL,
    ua       TEXT NOT NULL,
    hits     INT  NOT NULL DEFAULT 1 CHECK (hits > 0),
    first_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- 业务唯一键 = 计数行的身份;打点走 ON CONFLICT 累加
    PRIMARY KEY (day, path, visitor)
);

-- 全部统计查询都先按天切区间(近 30 天趋势 / 路径分布 / UA 分布),
-- 主键的首列虽然也是 day,但主键索引的排序是升序且带后两列,
-- 单独给 day 一条倒序索引让「最近 N 天」直接走索引。
CREATE INDEX idx_visits_day ON visits (day DESC);
