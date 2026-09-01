-- R-VISITOR 访客会话隔离(docs/security.md §6 的 R-VISITOR 补记是本迁移的约束来源)。
--
-- 本轮之前 sessions 没有归属列,`GET /agent/sessions` 是全站列表 —— 任何访客打开 Runtime
-- 就能看到所有人的会话并读全文。站点公开可访问,上线前必须堵掉。

-- 访客身份。**与 metrics 的 `visits.visitor` 不是一回事**,别把两者看成同一套身份:
--   visits.visitor  = sha256(salt‖day‖IP网段‖UA摘要),按天轮换、不可跨天串联,只服务于聚合统计;
--   visitors(本表) = 服务端发放的随机 token,只回答「这些会话是谁的」,不含任何 IP/UA 派生量。
-- 两者之间没有可以对上的字段,也不允许将来对上(docs/security.md §6)。
CREATE TABLE visitors (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- cookie 里是 32 字节随机数的 base64url,库里**只存它的 sha256 十六进制**。
    -- 与 §3 管理面 token 同一套理由:库泄漏拿不到可以冒充访客的凭据。
    token_hash   TEXT NOT NULL UNIQUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- 24h 滑动窗口:每次带 cookie 的 agent 侧请求推到 now()+24h。
    -- **服务端这一列是唯一判据** —— 浏览器那边 cookie 还在不在不作数。
    expires_at   TIMESTAMPTZ NOT NULL
);

-- 保留期清理按 expires_at 扫(apps/api/agent/purge.ts,每小时一次)
CREATE INDEX idx_visitors_expires ON visitors (expires_at);

-- 归属列。**刻意允许 NULL**:本轮之前建的存量会话没有归属,而查询一律是
-- `WHERE visitor_id = $1`,`= NULL` 永不匹配 —— 存量会话因此对所有人不可见,
-- 既不用在每条查询里额外处理这个状态,也不用在迁移里删数据(它们会被保留期规则
-- 按 last_active_at 满 3 天清掉)。
--
-- ON DELETE CASCADE:访客行被清理时,他的会话(及级联的 messages / trace_events)
-- 一并消失。这不会提前带走还活着的会话 —— expires_at 是「最后一次请求 + 24h」,
-- 恒 ≥ 该访客任一会话的 last_active_at,所以 visitors 的清理条件总比 sessions 的更晚成立。
ALTER TABLE sessions
    ADD COLUMN visitor_id UUID REFERENCES visitors (id) ON DELETE CASCADE;

-- 会话列表的唯一形态:某访客的会话按最近活跃倒序。
-- 既有的 idx_sessions_last_active 留着,保留期清理仍按它扫全表。
CREATE INDEX idx_sessions_visitor_active ON sessions (visitor_id, last_active_at DESC);

-- 注:**不给 agent_ro 任何权限**。新建表在 Postgres 里默认对 PUBLIC 无权限,
-- 而迁移 006 只把 notes 三张表 SELECT 授给了 agent_ro,也刻意没有设
-- ALTER DEFAULT PRIVILEGES(见 docs/security.md §1 第 2 层最后一条)。
-- 因此这里不需要写 REVOKE —— 但将来若有人给 agent_ro 加默认权限,这条注释是提醒。
