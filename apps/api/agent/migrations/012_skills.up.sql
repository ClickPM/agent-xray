-- R-SKILLS:Skills 技能库(第四个顶部 tab;所有者裁定 2026-09-03)。
--
-- 三张表与 notes 三张同一分工:读面在 apps/api/skills/(只读),写面在 apps/api/mcp/
-- (`skills_*` 八个工具,整包发布)。建在 agent 库而不是新开 SQLDatabase:
-- 与 002/003/006/008/010/011 同理,deploy/migrate.sh 只认 agent 一个库。
--
-- 【一个 skill = 一个目录】`skills` 一行是目录本身(名字、分类、出处、zip),
-- `skill_files` 是目录里的每个**文本**文件。文件一律当文本存、当文本渲染、永不执行
-- (docs/security.md §4 R-SKILLS 补记):只收 UTF-8、无 NUL,kind 由扩展名派生且是闭集。
-- 二进制进不来 —— 不是这里的 CHECK 挡的,是写面(shared/skill-pack.ts)在入库前拒掉的;
-- 这里的 CHECK 只是最后一道闸,挡手工改库时写进离谱的值。
--
-- 【zip 在写入时打好存库】读面只吐字节(`/assets/skills/<name>.zip`),不落盘、不读文件系统。
-- 内容没变时整包不动(`content_hash` 判据,与 notes_chapters 同一套约定),
-- 于是 `updated_at` 只在真的改了东西时才走 —— 首页「最近更新」与卡片上的相对时间才可信。
--
-- 本迁移只有 CREATE / INSERT,没有删列、改类型、删数据(R11 起的「不做不可逆迁移」仍适用)。
--
-- agent_ro / agent_title / agent_image 对本迁移的三张表**无任何权限**(所有者裁定:本轮 agent 不读 skills)。
-- 迁移 006 刻意没设 ALTER DEFAULT PRIVILEGES,所以这里不写 GRANT 就是全部答案;
-- apps/api/agent/sandbox.test.ts 有断言钉住「以 agent_ro 读这三张表 → permission denied」。
-- R-SKILLS-2 只会给 `skills` 加一列 `agent_enabled`,不改本迁移。

-- ───────────────────── 分类 ─────────────────────
--
-- 与 notes_categories 同形(slug / name / dot / sort_order),按**用途**分类(所有者裁定)。
CREATE TABLE skills_categories (
    slug       TEXT PRIMARY KEY CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
    name       TEXT NOT NULL,
    -- 分类圆点色(#RRGGBB),沿用 Notes 四色(design/README.md 的 token 速查)
    dot        TEXT NOT NULL CHECK (dot ~ '^#[0-9a-fA-F]{6}$'),
    sort_order INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────────────── skill(目录)─────────────────────
CREATE TABLE skills (
    -- 目录名 = URL 段 = 安装命令里的 --skill 值。形状与 notes 的 slug 同一口径,
    -- 因为它同样会进 URL、进 zip 文件名、进 `npx skills add … --skill <name>` 那一行。
    name          TEXT PRIMARY KEY CHECK (name ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
    category_slug TEXT NOT NULL REFERENCES skills_categories (slug),
    -- 卡片上的一句话中文描述(画板 2f)
    summary       TEXT NOT NULL DEFAULT '',
    -- own = 自研(徽标蓝,出处显示 @owner);curated = 精选第三方(徽标灰,出处显示 owner/repo)
    source_type   TEXT NOT NULL CHECK (source_type IN ('own', 'curated')),
    -- `owner/repo`,安装命令由它派生(`npx skills add <repo> --skill <name>`)。
    -- 每个 skill 发布时必填、不设全局默认(所有者裁定 2026-09-03 第 3 条)。
    -- 形状按 GitHub 的用户名 / 仓库名收紧:它会原样进访客可复制的命令行。
    repo          TEXT NOT NULL CHECK (repo ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}$'),
    -- GitHub 目录外链,**可空**(所有者裁定第 2 条):空时前端不渲染 `GitHub ↗` 与出处链接,
    -- 与 About 的 originUrl 同一口径;有值时写面只收 http(s)。
    repo_url      TEXT,
    -- 版本号展示文本(画板 2g 的 `v1.2`),可空 = 不显示
    version       TEXT CHECK (version IS NULL OR length(version) <= 32),
    sort_order    INT NOT NULL DEFAULT 0,
    -- 写入时由 skill_files 打好的 zip;读面原样吐出
    zip           BYTEA NOT NULL,
    zip_size      INT NOT NULL CHECK (zip_size >= 0),
    -- 元信息 + 全部文件的哈希:同内容重发时整行不动(见文件头)。读面同时把它当 zip 的 ETag
    content_hash  TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 首页按分类分组、组内按 sort_order
CREATE INDEX idx_skills_category ON skills (category_slug, sort_order);
-- 页脚「最近更新」
CREATE INDEX idx_skills_updated ON skills (updated_at DESC);

-- ───────────────────── 文件 ─────────────────────
CREATE TABLE skill_files (
    skill_name TEXT NOT NULL REFERENCES skills (name) ON DELETE CASCADE,
    -- 目录内相对路径(`SKILL.md` / `scripts/review.py`)。写面保证:无 `..`、不以 / 开头、
    -- 段字符集 [A-Za-z0-9._-]、段数 <= 4。这里只把形状收窄到「没有反斜杠、没有 NUL、不以 / 开头」。
    path       TEXT NOT NULL CHECK (path <> '' AND path !~ '^/' AND path !~ '\\' AND length(path) <= 200),
    -- 由扩展名派生的闭集(shared/skill-pack.ts 的 SKILL_FILE_KINDS);前端据此选渲染方式
    kind       TEXT NOT NULL CHECK (kind IN ('markdown', 'python', 'shell', 'typescript', 'javascript', 'json', 'yaml', 'toml', 'text')),
    -- 原文,UTF-8 文本。永不执行、永不 import。
    content    TEXT NOT NULL,
    -- UTF-8 字节数;单文件上限 256 KB(写面判,这里兜底)
    size_bytes INT NOT NULL CHECK (size_bytes >= 0 AND size_bytes <= 262144),
    line_count INT NOT NULL CHECK (line_count >= 0),
    -- 目录树顺序;SKILL.md 恒为 0(排首位),其余按路径
    sort_order INT NOT NULL DEFAULT 0,
    PRIMARY KEY (skill_name, path)
);

-- ───────────────────── 种子:四个用途分类 ─────────────────────
--
-- slug / 名字 / 色点照画板 2f;色点沿用 Notes 四色,没有新造 token(design/README.md)。
-- ON CONFLICT DO NOTHING:与 tool_config / site_tab_config 的种子同款,幂等。
INSERT INTO skills_categories (slug, name, dot, sort_order) VALUES
    ('framework', '开发框架',   '#2563eb', 1),
    ('workflow',  '工作流',     '#16a34a', 2),
    ('review',    '审查与质量', '#f9c22e', 3),
    ('writing',   '写作与内容', '#8b5cf6', 4)
ON CONFLICT (slug) DO NOTHING;

-- ───────────────────── 顶部 tab 登记(R-TABS「新增 tab 要改三处」的第 2 处)─────────────────────
--
-- 第 1 处是 apps/api/shared/site-tabs.ts,第 3 处是 apps/web/lib/tabs.ts。
-- 漏了这一行的表现是「skills 这个 tab 永远开着、关不掉」(读面对缺行按可见兜底),
-- apps/api/site/tabs.test.ts 从本表读回键集合与登记表比对,会抓到。
INSERT INTO site_tab_config (key, visible) VALUES ('skills', TRUE)
ON CONFLICT (key) DO NOTHING;
