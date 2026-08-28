-- R2 数据层:会话 / 消息 / 轨迹事件(docs/architecture.md 既定决策:Postgres 持久化,
-- 重启不丢会话、轨迹可回放)。JSONB 列的写入口径见 CLAUDE.md 规则 4。

CREATE TABLE sessions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title          TEXT NOT NULL DEFAULT '',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 会话列表按最近活跃倒序
CREATE INDEX idx_sessions_last_active ON sessions (last_active_at DESC);

CREATE TABLE messages (
    id         BIGSERIAL PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    seq        INT NOT NULL,
    role       TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
    content    TEXT NOT NULL DEFAULT '',
    -- 结构化附加信息(如 R6 工具消息的 {name, preview, dur, error});普通文本消息为 NULL
    payload    JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- 会话内按 seq 有序回放;唯一约束同时充当 (session_id, seq) 回放索引
    UNIQUE (session_id, seq)
);

CREATE TABLE trace_events (
    id         BIGSERIAL PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    seq        INT NOT NULL,
    event_type TEXT NOT NULL,
    mode       TEXT NOT NULL CHECK (mode IN ('notify', 'veto', 'chain', 'takeover')),
    ts         TIMESTAMPTZ NOT NULL,
    -- 采集侧已脱敏的事件数据(spike/events.ts sanitizeEvent 白名单出口,单事件 ≤8KB)
    data       JSONB NOT NULL,
    -- 轨迹回放按 seq 有序;唯一约束同时充当 (session_id, seq) 回放索引
    UNIQUE (session_id, seq)
);
