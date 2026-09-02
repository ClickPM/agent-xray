-- R-TITLE 会话命名工具(docs/security.md §1 第 1/2 层的 R-TITLE 补记是本迁移的约束来源)。
--
-- 本轮之前 sessions.title 只有一个来源:首条用户消息的首行截 40 字(store.deriveTitle)。
-- 真实对话的第一句几乎总是 hi / 你好,于是左栏每一条会话都叫同一个名字。
-- 本轮让 agent 自己调一次工具来命名 —— 而这是 agent 侧**第一次拿到写库能力**,
-- 所以授权面必须由 Postgres 限死,不能只靠工具实现自觉(理由与迁移 006 同构)。

-- ───────────────────── 标题来源标记 ─────────────────────
--
-- 「一个会话只命名一次」需要一个能区分「首行派生」与「模型命名」的判据 ——
-- 光看 title 非空不行:首条用户消息落库时它就已经非空了(store.appendMessage)。
--
-- 取值闭集写进 CHECK 而不是留成自由文本:这一列会出现在工具的 WHERE 里,
-- 拼错一个值的后果是「命名工具永远写不进去」,而那是一个不会报错的静默失败。
ALTER TABLE sessions
    ADD COLUMN title_source TEXT NOT NULL DEFAULT 'derived'
        CHECK (title_source IN ('derived', 'agent'));

-- 存量会话按默认值落在 'derived' 上:它们的标题仍是首行截断,
-- 下次被续接时 agent 会给它们补一个真正的名字。这是想要的行为,不是副作用。

-- ───────────────────── agent_title:只能改标题的角色 ─────────────────────
--
-- 与 006 的 agent_ro 是**两个**角色,别合并:
--   agent_ro    跑在 `SET TRANSACTION READ ONLY` 的事务里,只读 notes 三张表;
--   agent_title 是沙箱里唯一一段刻意可写的事务,只能改 sessions 的两列。
-- 合成一个的话,「只读」这条性质就没有任何一处还能成立了。
--
-- IF NOT EXISTS 的理由同 006:角色是**集群级**对象而迁移是库级的,本机 encore 把每个
-- worktree 的库放在同一个 postgres 容器里,裸 CREATE ROLE 会在第二个 worktree 上打断迁移。
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent_title') THEN
        CREATE ROLE agent_title NOLOGIN;
    END IF;
END
$$;

-- 应用连接要能 SET ROLE 过去,必须是该角色的成员。授予口径与 006 逐字相同:
-- 只授给「已经能 SELECT sessions」的登录角色 —— 它们本来就能整行改写 sessions,
-- 再给一个只能改两列的身份,**可证明地**不扩大任何权限。
-- (按「能 CONNECT 本库」筛是错的:Postgres 默认把 CONNECT 授给 PUBLIC,
--  同集群里别的应用的角色会跟着拿到,而 membership 是集群级的。见 006 的长注释。)
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT rolname FROM pg_roles
         WHERE rolcanlogin
           AND (rolname = current_user
                OR has_table_privilege(rolname, 'sessions', 'SELECT'))
    LOOP
        EXECUTE format('GRANT agent_title TO %I', r.rolname);
    END LOOP;
END
$$;

GRANT USAGE ON SCHEMA public TO agent_title;

-- **这就是 agent 侧写面的全部**:两列可写,三列可读(WHERE 与 RETURNING 引用的列
-- 需要 SELECT 权限,列级 UPDATE 不含读权限)。表级授权一律不给 ——
-- `GRANT UPDATE ON sessions` 会连 visitor_id / last_active_at 一起放开,
-- 那意味着被诱导的模型可以把别人的会话过继给自己,或者让会话永不过期躲开保留期清理。
GRANT SELECT (id, title, title_source) ON sessions TO agent_title;
GRANT UPDATE (title, title_source)     ON sessions TO agent_title;

-- 与 006 同样刻意**不设** ALTER DEFAULT PRIVILEGES:将来新增的表不会自动对 agent_title
-- 可写。忘了写显式 GRANT 的后果是「工具写不进去」(报错、看得见),
-- 而不是悄悄多出一张可写的表。

-- ───────────────────── 启停种子:默认开 ─────────────────────
--
-- 所有者裁定默认开启(ROUNDS.md R-TITLE)。关掉它的通路是 MCP 的 tool_config_set,
-- 不需要发版 —— 这也是本轮的止损手段。
--
-- 与三个只读工具一样,这张表只能开关**已实现**的工具:名字必须同时出现在
-- agent/tools.ts 的 SESSION_TOOL_REGISTRY 里,否则注册阶段被丢弃并记日志。
INSERT INTO tool_config (name, enabled, dangerous, note) VALUES
    ('session_rename', TRUE, FALSE, 'R-TITLE 会话绑定工具:给本会话起标题(只写 sessions.title,一次)')
ON CONFLICT (name) DO NOTHING;
