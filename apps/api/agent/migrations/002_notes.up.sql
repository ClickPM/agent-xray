-- R5 教程库:分类 / 系列 / 章节。内容由 tools/notes-sync 从 vault `学习分享/` 同步进来
-- (所有者裁定 2026-08-31:库里存**标准 markdown**,Obsidian 语法在同步阶段改写;
--  正文渲染在前端做)。
--
-- 为什么建在 agent 库而不是新开一个 SQLDatabase("notes"):
--   deploy/migrate.sh 显式只认 agent 一个库,发现第二个 migrations 目录会直接 die
--   (那是刻意的守卫,防止静默灌错库)。单库多服务是 agent/db.ts 既定的用法,
--   notes 服务经 SQLDatabase.named("agent") 引用即可。
--
-- R6 的 agent_ro 角色只对 notes_* 三张表授 SELECT(docs/security.md §1 第 2 层),
-- 授权语句在 R6/R9 补(建表在前、授权在后的顺序已写进 ROUNDS.md R9)。

CREATE TABLE notes_categories (
    slug       TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    -- 分类圆点色,取自 design/README.md 的 token 速查;前端不再硬编码颜色
    dot        TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE notes_series (
    slug          TEXT PRIMARY KEY,
    category_slug TEXT NOT NULL REFERENCES notes_categories (slug),
    name          TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    sort_order    INT NOT NULL DEFAULT 0
);

-- Notes 首页按分类分组、组内按 sort_order
CREATE INDEX idx_notes_series_category ON notes_series (category_slug, sort_order);

CREATE TABLE notes_chapters (
    id           BIGSERIAL PRIMARY KEY,
    series_slug  TEXT NOT NULL REFERENCES notes_series (slug) ON DELETE CASCADE,
    -- URL 片段:/notes/<series_slug>/<slug>。同步侧保证跨轮次稳定,不随新增章节漂移
    slug         TEXT NOT NULL,
    -- 展示顺序;0 = 置顶的 README 行(设计稿系列页 2b)
    ordinal      INT NOT NULL,
    -- 章节表左列展示文本(README / 01 / 02 …)
    label        TEXT NOT NULL,
    pinned       BOOLEAN NOT NULL DEFAULT FALSE,
    title        TEXT NOT NULL,
    summary      TEXT NOT NULL DEFAULT '',
    -- 标准 markdown 正文(已剥离 frontmatter,Obsidian 语法已改写)
    content_md   TEXT NOT NULL,
    -- 中文按字、西文按词;文章页「约 N 分钟」由前端换算
    word_count   INT NOT NULL DEFAULT 0,
    -- 第三方文章的原文链接(所有者裁定 4.2:只收中译,原链必须保留)
    source_url   TEXT,
    -- vault 内相对路径,溯源用
    source_path  TEXT NOT NULL,
    -- 正文 + 展示元数据的哈希;同步侧据此判断"未变",支撑重跑不写库
    content_hash TEXT NOT NULL,
    published_at TIMESTAMPTZ,
    updated_at   TIMESTAMPTZ NOT NULL,
    -- 业务唯一键;同时充当系列内按 slug 取章节的索引
    UNIQUE (series_slug, slug)
);

-- 系列页章节表:按 ordinal 有序
CREATE INDEX idx_notes_chapters_order ON notes_chapters (series_slug, ordinal);
-- RSS 与「最新」行:全站按更新时间倒序
CREATE INDEX idx_notes_chapters_updated ON notes_chapters (updated_at DESC);
