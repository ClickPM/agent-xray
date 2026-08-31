-- R6 管理面数据表:LLM 多 provider / 工具启停 / About 内容 / notes 附件 / 审计。
--
-- 唯一写入方是 mcp 服务(无状态 MCP 管理面 `/api/mcp`,docs/security.md §4);
-- pi agent 侧走 agent_ro 只读角色,对本文件建的表**一律无权限**(R7 建角色时授权,
-- 只授 notes_* 三张表的 SELECT —— 本文件的表不在其中,这是第 2 层沙箱的落点)。
--
-- 建在 agent 库而不是新开 SQLDatabase:与 002 同理,deploy/migrate.sh 只认 agent 一个库。

-- ───────────────────── LLM 多 provider ─────────────────────
--
-- 一行 = 一个 provider 的完整接入配置。`is_default` 唯一为真的那行就是运行期实际使用的
-- provider + 模型(agent/llm-config.ts 读它)。
--
-- 为什么 key 是 BYTEA 而不是 TEXT:存的是 AES-256-GCM 密文(nonce‖ct‖tag),
-- 二进制;走 TEXT 要么再套一层 base64(多一层可错的编码),要么被当字符集内容处理。
-- 明文 key **任何读路径都不返回**,读回只给 api_key_hint 掩码(docs/security.md §3)。
CREATE TABLE llm_config (
    -- pi-ai 的 provider id(如 deepseek);同时是 ModelRuntime.setRuntimeApiKey 的第一个参数
    provider        TEXT PRIMARY KEY,
    -- 中转端点;NULL = 用 pi 内置 provider 的默认 baseUrl
    -- (境内直连不稳,docs/security.md §5)
    base_url        TEXT,
    -- AES-256-GCM 密文,密钥来自 secret ConfigEncryptionKey
    api_key_enc     BYTEA NOT NULL,
    -- 掩码(如 sk-…3f9a);读接口与 MCP tool result 只回这一列
    api_key_hint    TEXT NOT NULL,
    -- 该 provider 下要用的模型 id
    model_id        TEXT NOT NULL,
    -- 可选的自定义模型目录,形状 = pi 的 ProviderConfigInput["models"];
    -- 内置 provider 用默认目录时留 NULL(pi 自带 deepseek 等的模型清单)
    models          JSONB,
    is_default      BOOLEAN NOT NULL DEFAULT FALSE,
    -- —— R7 消费的限额(0 = 不限)——
    daily_token_limit      BIGINT NOT NULL DEFAULT 0 CHECK (daily_token_limit >= 0),
    daily_cost_limit_cents INT    NOT NULL DEFAULT 0 CHECK (daily_cost_limit_cents >= 0),
    max_turns_per_session  INT    NOT NULL DEFAULT 0 CHECK (max_turns_per_session >= 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 至多一个默认 provider。做成部分唯一索引而不是应用层判断:两个并发的
-- llm_set_default 谁都读不到对方未提交的写,只有库能把「唯一」变成事实。
CREATE UNIQUE INDEX idx_llm_config_single_default ON llm_config ((is_default)) WHERE is_default;

-- ───────────────────── 工具启停 ─────────────────────
--
-- pi agent 的业务工具注册集合由这张表决定(docs/security.md §1 第 1 层)。
-- `dangerous` 标记的工具是**双闸**的其中一闸:开启还需要服务器 env
-- XRAY_UNLOCK_DANGEROUS_TOOLS=1。表里为真不等于会被注册。
CREATE TABLE tool_config (
    name       TEXT PRIMARY KEY,
    enabled    BOOLEAN NOT NULL DEFAULT FALSE,
    dangerous  BOOLEAN NOT NULL DEFAULT FALSE,
    note       TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────────────── About 页内容 ─────────────────────
--
-- 单行表:`id` 恒为 TRUE,CHECK 把「只能有一行」交给库。
-- 字段范围以设计稿画板(About 页)为准,不多长功能(CLAUDE.md 规则 8):
-- 头像/昵称来自 github_user,双链 = GitHub + origin,简介与「本站如何构建」条目。
-- 前端接线在 R8。
CREATE TABLE about_content (
    id           BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    github_user  TEXT  NOT NULL DEFAULT '',
    origin_url   TEXT  NOT NULL DEFAULT '',
    intro        TEXT  NOT NULL DEFAULT '',
    -- 字符串数组;画板「本站如何构建」的逐条
    build_points JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────────────── notes 附件(正文配图)─────────────────────
--
-- 所有者裁定 2026-08-31:**镜像内不烧任何 notes 内容**,图片全部从 Postgres 读。
-- 对外 URL 保持 R5 的 `/notes/<系列>/<哈希>.webp` 不变(免改写存量 markdown);
-- API 侧路径是 `/assets/notes/:series/:file`,由 Caddy / next dev 的 rewrite 桥接
-- —— Encore 路由里 `/notes/:series/:file` 会与既有的 `/notes/series/:slug` 撞车。
--
-- 外键到 notes_series:附件是系列的一部分,系列删了图也该跟着走;
-- 同时挡住「传到一个拼错的系列名下、页面永远破图」这类手误。
CREATE TABLE notes_assets (
    series_slug  TEXT NOT NULL REFERENCES notes_series (slug) ON DELETE CASCADE,
    -- 文件名(R5 的口径是 <内容哈希>.webp);与 series_slug 一起构成 URL 与主键
    name         TEXT NOT NULL,
    content_type TEXT NOT NULL,
    bytes        BYTEA NOT NULL,
    byte_size    INT  NOT NULL,
    -- 内容的 sha256(hex);供图端点用它做 ETag,浏览器二次访问走 304
    etag         TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (series_slug, name)
);

-- ───────────────────── 管理面审计 ─────────────────────
--
-- docs/security.md §4:认证失败与**全部写操作**入审计。读操作不记
-- (量大且无价值),但认证失败一定记 —— 那是唯一能看出 token 被猜的地方。
--
-- remote 存的是**所有者自己的**来源地址,与 §6「访客统计不存原始 IP」不是一回事:
-- 管理面只有一个人用,审计要能回答「这次写入是从哪儿发起的」。
CREATE TABLE mcp_audit (
    id      BIGSERIAL PRIMARY KEY,
    at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'denied', 'error')),
    -- JSON-RPC method(tools/call、server/discover…);解析不出时为 NULL
    method  TEXT,
    -- tools/call 的工具名
    tool    TEXT,
    -- 一行已脱敏摘要(shared/redact.ts 口径),不含请求原文
    summary TEXT NOT NULL DEFAULT '',
    remote  TEXT,
    detail  JSONB
);

-- 审计只按时间倒序翻
CREATE INDEX idx_mcp_audit_at ON mcp_audit (at DESC);

-- ───────────────────── notes_chapters:管道遗留列退役 ─────────────────────
--
-- `source_path` 是 vault 相对路径(溯源用)。notes-sync 管道本轮删除,vault 不再是
-- 内容来源,这一列不可能再有正确值 —— 留着只会诱导后来者以为还有个 vault 侧真相。
-- **存量数据不动**:只丢这一列,正文/标题/时间戳原样保留(所有者裁定)。
ALTER TABLE notes_chapters DROP COLUMN source_path;

-- `content_hash` 保留但改口径:原先是同步侧算的「正文+展示元数据」哈希,用于判断未变;
-- 现在由 mcp 服务在 upsert 时算同一件事 —— 内容没变就不碰 updated_at,
-- 免得每次重发都让 RSS 假装有更新(rss.ts 的 lastBuildDate 取最新条目时间)。
COMMENT ON COLUMN notes_chapters.content_hash IS
  'sha256(正文+展示元数据);mcp 服务 upsert 时计算,用于「内容未变则不更新 updated_at」';
