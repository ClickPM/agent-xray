-- R-WEBSEARCH:第一个**外呼型**业务工具 `web_search` 的配置面与限额面
-- (docs/security.md §1「工具分两组」+ 第 4 层「外呼型工具…目标域白名单…计入日限额」)。
--
-- 唯一写入方是 mcp 服务(`websearch_provider_upsert` 等四个 tool);agent 侧只读、只解密。
-- 建在 agent 库而不是新开 SQLDatabase:与 002/003/006 同理,deploy/migrate.sh 只认 agent 一个库。

-- ───────────────────── websearch provider ─────────────────────
--
-- 一行 = 一个「能做联网搜索的 Responses API 端点」的完整接入配置。
-- `is_default` 唯一为真的那行就是 `web_search` 工具实际打的端点。
--
-- 【为什么不复用 llm_config 那一行的 key】搜索网关与聊天 provider 可以是两家
-- (实际用例正是如此:聊天走 DeepSeek 直连,搜索走自建 AI 网关,反过来也成立)。
-- 合成一行的后果是「换聊天 provider」会顺带换掉搜索凭据,而那两件事之间没有任何关系。
--
-- 【为什么与 llm_config 长得几乎一样却不合表】两张表的**列集合**只是碰巧相似:
-- 这里没有 models 目录、没有 token/费用限额,却多了 tool_type 与两个超时。
-- 合表要么长出一堆对另一方永远为 NULL 的列,要么加一个 kind 判别列 —— 后者会让
-- 「唯一默认」的部分唯一索引变成「每个 kind 唯一默认」,而那正是最容易写错的地方。
CREATE TABLE websearch_config (
    -- 一个**标签**,不是 pi-ai 的 provider id(本表与 pi 的 ModelRuntime 无关):
    -- 由所有者自取,如 deepseek / cliproxy-dmit。口径与 llm_config.provider 同形,
    -- 便于所有者在两张表里用同一套名字指同一家。
    provider           TEXT PRIMARY KEY,

    -- 【必填,且没有内置默认】llm_config 的 base_url 可以为 NULL(用 pi 内置 provider 的
    -- 默认端点),这里不行:URL 由本仓库自己拼(见 websearch.ts 的 responsesUrl),
    -- 没有「内置端点」这回事。它同时是**目标域白名单**的比对对象 —— 白名单是外呼组的
    -- 硬约束(docs/security.md §1),一个可以为空的字段无从校验。
    base_url           TEXT   NOT NULL,

    -- AES-256-GCM 密文,密钥来自 secret ConfigEncryptionKey(与 llm_config 同一把)
    api_key_enc        BYTEA  NOT NULL,
    -- 掩码(sk-…3f9a);读接口与 MCP tool result 只回这一列(docs/security.md §3)
    api_key_hint       TEXT   NOT NULL,

    -- 该端点上要用的模型 id(如 deepseek-v4-flash / gpt-5.6-luna)
    model_id           TEXT   NOT NULL,

    -- Responses API 的内置工具类型名。DeepSeek 除 `web_search` 外还接受带日期的
    -- `web_search_2025_08_26`(见其 Responses API 文档),所以做成可配。
    --
    -- **CHECK 不是形式主义**:这一列的值会被原样拼进发往上游的 JSON body 的
    -- `tools[0].type`。收紧到这个形状之后,库里能出现的取值集合是可枚举的,
    -- 不存在「所有者手滑写进一段别的东西、被当成另一个内置工具启用」。
    tool_type          TEXT   NOT NULL DEFAULT 'web_search'
                       CHECK (tool_type ~ '^web_search(_[0-9]{4}_[0-9]{2}_[0-9]{2})?$'),

    -- 双计时器的两个上界(docs/security.md §1 外呼组约束 3)。默认 180s / 45s
    -- 是所有者裁定,贴着实测:网关侧「搜索 + 综述」常越过 90s。
    -- CHECK 的上界(300s / 120s)是硬顶 —— 外呼一直不结束就一直占着会话名额,
    -- 而 SSE 断连信号在本架构下探测不到(apps/api/trace/README.md)。
    total_timeout_ms   INT    NOT NULL DEFAULT 180000
                       CHECK (total_timeout_ms BETWEEN 10000 AND 300000),
    idle_timeout_ms    INT    NOT NULL DEFAULT 45000
                       CHECK (idle_timeout_ms BETWEEN 5000 AND 120000),
    -- 空闲上限大于总上限时空闲计时器永远不会先触发,等于配了个不生效的字段。
    -- 让库来拒,而不是让它成为一个「配了但没用」的静默状态。
    CHECK (idle_timeout_ms <= total_timeout_ms),

    -- 每日搜索次数上限(0 = 不限)。用量在 daily_quota.searches。
    -- 与 llm_config 的 token/费用限额刻意分开计 —— 见下方 daily_quota 的注释。
    daily_search_limit INT    NOT NULL DEFAULT 0 CHECK (daily_search_limit >= 0),

    is_default         BOOLEAN NOT NULL DEFAULT FALSE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 至多一个默认 provider。与 llm_config 同款部分唯一索引:并发的两个 set_default
-- 谁都读不到对方未提交的写,只有库能把「唯一」变成事实。
CREATE UNIQUE INDEX idx_websearch_config_single_default
    ON websearch_config ((is_default)) WHERE is_default;

-- agent_ro 对本表**无任何权限**:它是凭据面,不是内容面。迁移 006 刻意没设
-- ALTER DEFAULT PRIVILEGES,所以这里不写 GRANT 就是全部答案 —— 这条注释只是
-- 防止后来者以为漏了(docs/security.md §1 第 2 层逐表列举已同步补上本表)。

-- ───────────────────── 每日搜索计数 ─────────────────────
--
-- 【为什么不折进 daily_quota.tokens】那一列的口径是「聊天 provider 报什么就记什么」,
-- 而 daily_token_limit 是照着那家的账单定的。把第二家厂商的 token 混进同一个数之后,
-- 「daily_token_limit 到底在限什么」就没法解释了 —— 一次搜索会把聊天的额度吃掉一块,
-- 而所有者调那个数字时想的完全是另一回事。计次是搜索类 API 的通用计价单位,
-- 单独一列既够用又能说清。
ALTER TABLE daily_quota
    ADD COLUMN searches BIGINT NOT NULL DEFAULT 0 CHECK (searches >= 0);

-- ───────────────────── web_search 的启停种子 ─────────────────────
--
-- **默认关**(所有者裁定)。新环境部署完还没配 websearch provider,注册阶段本来就会
-- 把这个名字丢掉;默认关是把「没配就没有」变成显式的一件事,而不是让每次冷启动
-- 都刷一行 dropped 日志。所有者配好 provider 后经 MCP 的 tool_config_set 打开。
--
-- dangerous 仍是 FALSE:那一位管的是「执行类工具的双闸」(XRAY_UNLOCK_DANGEROUS_TOOLS),
-- 而外呼不是执行 —— 外呼组的约束是另一套(域白名单 / 超时 / 限额,见 websearch.ts)。
-- 把它标成 dangerous 会让 env 双闸看起来能兜住外呼风险,而它兜不住。
INSERT INTO tool_config (name, enabled, dangerous, note) VALUES
    ('web_search', FALSE, FALSE, 'R-WEBSEARCH 外呼工具:经 Responses API 网关联网搜索(需先配 websearch provider)')
ON CONFLICT (name) DO NOTHING;
