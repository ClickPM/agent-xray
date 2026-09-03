-- R-SKILLS-2:agent 使用 skills —— 注入(skill_load)+ 沙箱运行(skill_run)。
-- 所有者七条裁定见 rounds/round-skills/research.md §0;约束正本 docs/security.md §1 R-SKILLS-2 补记。
--
-- 本迁移**只有 ADD COLUMN / CREATE / INSERT**,没有任何删列、改类型、删数据的语句(R11 起的「不做不可逆迁移」)。
-- 依赖 012(skills 表)与 006/008(tool_config / daily_quota)。
--
-- 【库里能决定什么、不能决定什么】(所有者裁定 6)
-- agent 可用的 skill 集合**在代码里**(runner/skills → apps/api/shared/skills.generated.ts + runner/manifest.json)。
-- 这里的 `skills.agent_enabled` 只是「在那个集合之内打开 / 关闭」的开关;打开了但展示副本(skill_files)
-- 与代码副本 sha256 不一致,注册环节照样不注入(记日志、MCP skills_agent_status 报 drift)。
-- 管理 token 泄漏的后果因此仍是「能开关」,不是「能让 agent 跑别的东西」。

-- ───────────────────── skills.agent_enabled ─────────────────────
--
-- 默认 FALSE(所有者裁定 5:首批 skills 只展示、不注入,逐 skill 显式打开)。
ALTER TABLE skills
    ADD COLUMN agent_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- ───────────────────── sandbox_config(单行)─────────────────────
--
-- 沙箱执行组的两个上限,与 websearch_config 的超时 / 限额同形但**不带凭据**(这一组没有凭据)。
-- 单行:id 恒为 1,CHECK 挡第二行。读不到(理论上不会,种子行在下面)按「skill_run 这轮不注册」处理。
CREATE TABLE sandbox_config (
    id               SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    -- 每日 skill_run 次数上限(0 = 不限)。用量在 daily_quota.skill_runs。
    daily_run_limit  INT NOT NULL DEFAULT 0 CHECK (daily_run_limit >= 0),
    -- 单次运行的总时长上限(含在执行容器里排队)。CHECK 的上下界是硬顶:
    -- 下界 5 s 挡「配成 0 = 什么都跑不完」;上界 120 s 与 runner.py 的 MAX_TIMEOUT_MS 一致 ——
    -- 一次运行一直不结束就一直占着并发名额(并发 2)与会话名额。
    total_timeout_ms INT NOT NULL DEFAULT 30000 CHECK (total_timeout_ms BETWEEN 5000 AND 120000),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO sandbox_config (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- ───────────────────── 每日运行计数 ─────────────────────
--
-- 与 searches / images 同款:各计各的、不合列(迁移 008 里 daily_quota 那段注释的理由)。
ALTER TABLE daily_quota
    ADD COLUMN skill_runs BIGINT NOT NULL DEFAULT 0 CHECK (skill_runs >= 0);

-- ───────────────────── 两个工具的启停种子 ─────────────────────
--
-- 两个都**默认关**(打开顺序在任务卡「运维」段:发版 → 生产冒烟 4 条 → skill_load → 逐 skill agent_enabled
-- → .env 加 XRAY_UNLOCK_DANGEROUS_TOOLS=1 重建 api → skill_run)。
--
-- skill_run 是本仓库**第一个 dangerous=TRUE 的工具**:它驱动的是一个解释器(尽管在独立容器里)。
-- R7 留的 env 双闸(XRAY_UNLOCK_DANGEROUS_TOOLS=1)从这一行起真正有用武之地:
-- 表里 enabled=TRUE 只是第一闸,服务器 env 没设第二闸就不注册(agent/tools.ts loadEnabledTools)。
-- skill_load 只把编译进 api 的 SKILL.md 正文送进上下文,不碰库、不碰文件系统,dangerous=FALSE。
INSERT INTO tool_config (name, enabled, dangerous, note) VALUES
    ('skill_load', FALSE, FALSE, 'R-SKILLS-2 纯函数组:把一个 skill 的 SKILL.md 送进上下文(代码清单 ∩ agent_enabled ∩ hash 一致)'),
    ('skill_run',  FALSE, TRUE,  'R-SKILLS-2 沙箱执行组:在独立无网络容器里跑 skill 声明过的 Python 脚本(需 XRAY_UNLOCK_DANGEROUS_TOOLS=1)')
ON CONFLICT (name) DO NOTHING;

-- agent_ro / agent_title / agent_image 对 sandbox_config 与 skills.agent_enabled **无任何权限**:
-- 一致性判据与开关都在**注册环节**用全权连接读(与 loadEnabledTools 读 tool_config 同一位置),不在任何工具体内。
-- 迁移 006 刻意没设 ALTER DEFAULT PRIVILEGES,这里不写 GRANT 就是全部答案(sandbox.test.ts 有断言钉住)。
