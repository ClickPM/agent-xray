-- R-SOURCE:Source 源码 tab —— 站点自身源码的快照(第五个顶部 tab;所有者裁定 2026-09-08)。
--
-- 两张表与 skills 三张同一分工:读面在 apps/api/source/(只读),写面在 apps/api/mcp/
-- (`source_*` 五个工具,三段式发布:begin → put → commit)。建在 agent 库而不是新开 SQLDatabase:
-- 与 002/003/006/008/010/011/012 同理,deploy/migrate.sh 只认 agent 一个库。
--
-- 【一个快照 = 一个 git SHA 的文件表】`source_snapshots` 一行是一次发布(按 40 位 SHA 不可变),
-- `source_files` 是那次发布里的每个**文本**文件。文件一律当文本存、当文本渲染、永不执行
-- (docs/security.md §4 R-SOURCE 补记):只收 UTF-8、无 NUL,kind 由扩展名派生且是闭集。
-- 二进制进不来 —— 不是这里的 CHECK 挡的,是写面(shared/source-pack.ts)在入库前拒掉的;
-- 这里的 CHECK 只是最后一道闸,挡手工改库时写进离谱的值。
--
-- 【快照从哪来】发布脚本 tools/source-publish/publish.mjs 只从 `git ls-tree <sha>` 取文件(永不读工作树),
-- 随 `dev.ps1 ship` 自动发(所有者裁定 5 / 8:快照随每次生产发版发布,从源头保证「展示的 = 正在跑的」)。
--
-- 【current 唯一,且只保留一份】读面与 agent 工具只查 `status = 'current'`;commit 在一个事务里翻状态并删掉其余快照。
-- staging 期间 `content` 允许为 NULL(待上传 / 待从 current 复制),commit 前必须全非 NULL —— 读面永远读不到半成品。
--
-- 本迁移只有 CREATE / INSERT / GRANT,没有删列、改类型、删数据(R11 起的「不做不可逆迁移」仍适用)。

-- ───────────────────── 快照 ─────────────────────
CREATE TABLE source_snapshots (
    -- 40 位全长 git SHA;页面与工具显示前 7 位
    sha          TEXT PRIMARY KEY CHECK (sha ~ '^[0-9a-f]{40}$'),
    -- staging = 正在上传;current = 读面与 agent 读的那一份(至多一行,见下面的部分唯一索引)
    status       TEXT NOT NULL CHECK (status IN ('staging', 'current')),
    file_count   INT NOT NULL DEFAULT 0 CHECK (file_count >= 0),
    total_bytes  BIGINT NOT NULL DEFAULT 0 CHECK (total_bytes >= 0),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- commit 的时刻;staging 行为 NULL。页面 meta 行「发布 YYYY-MM-DD」取它
    published_at TIMESTAMPTZ
);

-- current 至多一行:两次 commit 并发也不可能各自成功
CREATE UNIQUE INDEX source_snapshots_one_current ON source_snapshots ((status)) WHERE status = 'current';

-- ───────────────────── 文件 ─────────────────────
CREATE TABLE source_files (
    sha     TEXT NOT NULL REFERENCES source_snapshots (sha) ON DELETE CASCADE,
    -- 仓库根相对路径(`apps/api/agent/tools.ts`)。写面保证:无 `..`、不以 / 开头、无反斜杠、
    -- 段字符集 [A-Za-z0-9._()[]-](Next 路由段要 `(site)` `[series]`)、段数 <= 12。
    -- 这里只把形状收窄到「没有反斜杠、不以 / 开头、长度 <= 300」。
    path    TEXT NOT NULL CHECK (path <> '' AND path !~ '^/' AND path !~ '\\' AND length(path) <= 300),
    -- 由扩展名派生的闭集(shared/source-pack.ts 的 SOURCE_FILE_KINDS);前端据此选渲染方式
    kind    TEXT NOT NULL CHECK (kind IN ('markdown', 'typescript', 'javascript', 'python', 'shell', 'powershell', 'sql', 'json', 'yaml', 'toml', 'css', 'dockerfile', 'text')),
    -- 内容的 sha256(UTF-8 字节);begin 时由 manifest 声明,put 时服务端现算核对,增量复制也按它判
    sha256  TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    -- UTF-8 字节数;单文件上限 256 KB(所有者裁定 3;写面判,这里兜底)
    bytes   INT NOT NULL CHECK (bytes >= 0 AND bytes <= 262144),
    lines   INT NOT NULL CHECK (lines >= 0),
    -- 原文,UTF-8 文本。staging 期间可为 NULL;current 快照里一律非 NULL(commit 核过)。永不执行、永不 import。
    content TEXT,
    PRIMARY KEY (sha, path)
);

-- ───────────────────── 第 2 层:两张表对 agent_ro 开放 SELECT ─────────────────────
--
-- 迁移 006 刻意没设 ALTER DEFAULT PRIVILEGES,所以「显式 GRANT」正是 docs/security.md §1 第 2 层
-- 为「给 agent 一个新内容面」预留的那条路(R-SKILLS 补记原话)。三个 `source_*` 工具经 ro-db.ts 的
-- READ ONLY 事务读**当前快照**;agent_title / agent_image 对这两张表仍无任何权限。
-- 仓库本来就是公开的 MIT 项目,「能做的也只有…」那句多一件「读公开源码快照」,不新增泄露面。
GRANT SELECT ON source_snapshots, source_files TO agent_ro;

-- ───────────────────── 三个工具的启停种子(所有者裁定 4:默认开)─────────────────────
INSERT INTO tool_config (name, enabled, dangerous, note) VALUES
    ('source_list',   TRUE, FALSE, 'R-SOURCE 纯函数组:列出站点源码快照的文件(agent_ro 只读)'),
    ('source_read',   TRUE, FALSE, 'R-SOURCE 纯函数组:读一个源码文件,可给行区间(agent_ro 只读)'),
    ('source_search', TRUE, FALSE, 'R-SOURCE 纯函数组:按关键词在源码快照里逐行检索(agent_ro 只读)')
ON CONFLICT (name) DO NOTHING;

-- ───────────────────── 顶部 tab 登记(R-TABS「新增 tab 要改三处」的第 2 处)─────────────────────
--
-- 第 1 处是 apps/api/shared/site-tabs.ts,第 3 处是 apps/web/lib/tabs.ts。
-- 漏了这一行的表现是「source 这个 tab 永远开着、关不掉」(读面对缺行按可见兜底),
-- apps/api/site/tabs.test.ts 从本表读回键集合与登记表比对,会抓到。
INSERT INTO site_tab_config (key, visible) VALUES ('source', TRUE)
ON CONFLICT (key) DO NOTHING;
