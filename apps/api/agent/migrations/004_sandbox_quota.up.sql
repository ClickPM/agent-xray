-- R7 沙箱与配额:agent_ro 只读角色(docs/security.md §1 第 2 层)+ 每日限额计数(第 4 层)。
--
-- 【为什么是 SET LOCAL ROLE 而不是独立连接串】(所有者裁定 2026-09-01)
-- ROUNDS.md 原文写的是「连接串用 AGENT_RO_DATABASE_URL」。落地时发现那条路要多带三样
-- 东西:一个 pg 驱动依赖、一份 agent_ro 的登录口令(于是 .env / initdb / secret 各加一处)、
-- 以及一个 Encore 管不到的第二连接池。更要命的是**验收跑不了**:本机 encore 的库由 CLI
-- 托管,agent_ro 的登录口令进不了 `.secrets.local.cue` 以外的地方,「以 agent_ro 写库必须
-- 失败」这条只能推到 R9 在 130 上人工核验 —— 而 M2 的止损写的是「R7 沙箱验收不过不得进入
-- 任何公网部署轮」,把验收推到部署轮等于把止损点也推掉了。
--
-- 改法:角色仍然是真的 Postgres 角色、权限仍然由库强制;只是**不给它登录能力**,
-- 由应用连接在事务里 `SET LOCAL ROLE agent_ro` 临时降权(agent/ro-db.ts)。
-- 语义上与独立连接等价 —— SET ROLE 到一个非超级用户角色之后,权限检查按该角色执行,
-- 写 notes 表一样是 permission denied;而 `SET LOCAL` 随事务结束自动复位,
-- 连接池复用不会把降权状态泄漏给下一个请求。
-- 代价已认:ROUNDS.md R9 里「docker-entrypoint-initdb.d 建角色」一项随之取消(角色由本迁移建)。

-- ───────────────────── agent_ro 只读角色 ─────────────────────
--
-- NOLOGIN:它不是一个可以拨号进来的账号,只能被已认证的应用连接 SET ROLE 切过去。
-- 少一份口令就少一处泄漏面(docs/security.md §3)。
--
-- 【为什么要 IF NOT EXISTS 而不是裸 CREATE ROLE】角色是**集群级**对象而迁移是库级的:
-- 本机 encore 把所有本地 app 的库放在同一个 postgres 容器里,换一个 worktree 就是另一个
-- app、另一个库、但还是同一个集群。裸 CREATE ROLE 会在第二个 worktree 上直接
-- `role "agent_ro" already exists` 把迁移打断。
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent_ro') THEN
        CREATE ROLE agent_ro NOLOGIN;
    END IF;
END
$$;

-- 应用连接要能 SET ROLE 过去,必须是该角色的**成员**。
--
-- 【为什么不是 `GRANT agent_ro TO CURRENT_USER`】那是第一版的写法,本机直接跑不通:
-- encore 的本地集群按职责分了好几个登录角色,**迁移与业务查询不是同一个**
-- (实测:迁移跑在 `encore-migrator` 上,请求跑在 `encore-write` / `encore-service` 上)。
-- 只授给 CURRENT_USER 的结果是迁移成功、运行期 `permission denied to set role "agent_ro"`。
-- 生产 compose 只有 `app` 一个角色,两者同名,所以这个坑只在本机暴露 —— 而本机正是
-- 验收要跑的地方(见文件头的裁定说明)。
--
-- 【为什么可以授得这么宽】membership 给的是「**降**到 agent_ro 的能力」,不是任何新权限:
-- agent_ro 的权限集是这些角色的真子集(只有三张表的 SELECT)。授给能连本库的每一个
-- 登录角色,不会让任何角色多做一件它原本做不到的事。
DO $$
DECLARE
    r record;
BEGIN
    -- 不排除超级用户:生产 compose 的 `app` 就是容器的 bootstrap 超级用户。
    -- 超级用户本来就能 SET ROLE 到任何角色,多这一条 GRANT 是空转;
    -- 但少了它就得依赖「超级用户免检」这条语义,不如显式授掉。
    FOR r IN
        SELECT rolname FROM pg_roles
         WHERE rolcanlogin
           AND has_database_privilege(rolname, current_database(), 'CONNECT')
    LOOP
        EXECUTE format('GRANT agent_ro TO %I', r.rolname);
    END LOOP;
END
$$;

-- 第 2 层沙箱的**全部**授权面:只有 notes 的三张内容表,只有 SELECT。
-- 刻意不含 notes_assets —— 附件是二进制,agent 没有读它的用途,而它与 llm_config /
-- tool_config / about_content / mcp_audit 一样属于「管理面写、agent 永不可见」那一侧
-- (docs/security.md §1 第 2 层逐表列举)。
GRANT USAGE ON SCHEMA public TO agent_ro;
GRANT SELECT ON notes_categories, notes_series, notes_chapters TO agent_ro;

-- PUBLIC 是每个角色的隐式成员,授给 PUBLIC 的权限**无法**再从单个角色上撤销。
-- PG15 之前 public 模式默认给 PUBLIC 带 CREATE —— 那意味着 agent_ro 能建自己的表。
-- 撤掉它对库主没有影响(库主的权限来自所有权,不来自 PUBLIC);PG15+ 本就没有,
-- 这条是空操作。宁可写死也不赌部署环境的大版本。
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- 后建的表不自动授权:ALTER DEFAULT PRIVILEGES 刻意**不设**。
-- 将来新增内容表要给 agent 看,必须在那次迁移里显式写 GRANT ——
-- 「忘了写」的后果是工具读不到(报错、看得见),而不是悄悄多出一张可读的表。

-- ───────────────────── 每日限额计数 ─────────────────────
--
-- 限额**值**在 R6 建的 llm_config 上(daily_token_limit / daily_cost_limit_cents /
-- max_turns_per_session,0 = 不限);本表只存**用量**。分开是因为两者的变更节奏不同:
-- 限额由所有者经 MCP 改,用量由每一轮对话累加。
--
-- 【日界按 Asia/Shanghai】不是 UTC:所有者在境内,「今天的额度」应当在本地零点重置,
-- 而不是早上八点。写死时区而不是依赖服务器 TZ —— 容器里 TZ 通常是 UTC,
-- 依赖它等于让日界随部署环境漂移。读写两侧都必须用同一个表达式(agent/quota.ts)。
--
-- 【为什么费用存 micros 而不是 cents】provider 回的 cost 是美元浮点,一轮常在
-- 1e-5 量级;按分四舍五入的话绝大多数轮次会被记成 0,累计永远追不上限额。
-- 存百万分之一美元、比较时把 cents 换算过去,精度足够且全程整数。
CREATE TABLE daily_quota (
    -- Asia/Shanghai 的自然日
    day         DATE PRIMARY KEY,
    -- Usage.totalTokens 累加(含 input/output/cache;provider 报什么就记什么)
    tokens      BIGINT NOT NULL DEFAULT 0 CHECK (tokens >= 0),
    -- 百万分之一美元
    cost_micros BIGINT NOT NULL DEFAULT 0 CHECK (cost_micros >= 0),
    -- 当日完成的对话轮数(诊断用:限额没触发时也能看出量级)
    turns       BIGINT NOT NULL DEFAULT 0 CHECK (turns >= 0),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- agent_ro 对本表**无任何权限**:它是配额面,不是内容面。上面没有 GRANT 就是全部答案,
-- 这条注释只是防止后来者以为漏了。

-- ───────────────────── 只读工具组的启停种子 ─────────────────────
--
-- 注册集合由 tool_config 决定(R6 建表,本轮开始消费)。三个只读工具默认**开**:
-- 它们的全部能力就是以 agent_ro 读 notes 三张表,而站点本身就是把这些内容讲给访客听。
-- 所有者随时可经 MCP 的 tool_config_set 关掉。
--
-- dangerous 一律 FALSE。表里出现的名字若不在 agent/tools.ts 的注册表里(比如手写了
-- 'bash'),注册阶段会直接丢弃并记日志 —— 这张表决定的是「已实现的工具开不开」,
-- 不是「凭名字长出一个工具」(docs/security.md §1 第 1 层)。
INSERT INTO tool_config (name, enabled, dangerous, note) VALUES
    ('notes_list_series', TRUE, FALSE, 'R7 只读工具组:列教程系列 / 某系列的章节表'),
    ('notes_get_chapter', TRUE, FALSE, 'R7 只读工具组:取一章正文(标准 markdown,截断)'),
    ('notes_search',      TRUE, FALSE, 'R7 只读工具组:在标题/摘要/正文里做子串检索')
ON CONFLICT (name) DO NOTHING;
