-- R-IMAGEGEN:第二个**外呼型**业务工具 `generate_image` 的配置面、限额面、存储面与写角色
-- (docs/security.md §1「工具分两组」+ 第 2 层 R-IMAGEGEN 补记 + 第 4 层)。
--
-- 唯一写 `imagegen_config` 的是 mcp 服务(`imagegen_provider_upsert` 等四个 tool);agent 侧只读、只解密。
-- 唯一写 `generated_images` 的是 agent 侧的 `agent_image` 角色(只有 INSERT);读面是 agent 服务的供图端点。
-- 建在 agent 库而不是新开 SQLDatabase:与 002/003/006/008 同理,deploy/migrate.sh 只认 agent 一个库。
--
-- **本迁移只有 CREATE / ADD COLUMN / GRANT,没有任何删列、改类型、删数据的语句**
-- (R11 所有者裁定「上线期间不做不可逆迁移」;pg 备份仍未落地,不可逆意味着没有兜底)。

-- ───────────────────── imagegen provider ─────────────────────
--
-- 一行 = 一个「能生图的 OpenAI 系端点」的完整接入配置。`is_default` 唯一为真的那行就是
-- `generate_image` 工具实际打的端点。与 websearch_config 同构、同样**不合表**(理由见迁移 008)。
CREATE TABLE imagegen_config (
    -- 自取的标签(如 cliproxy-dmit / openai),与 llm_config / websearch_config 的 provider 同形,
    -- 便于所有者在三张表里用同一套名字指同一家。不是 pi-ai 的 provider id。
    provider           TEXT PRIMARY KEY,

    -- 【必填,且没有内置默认】URL 由本仓库自己拼(见 imagegen.ts 的 imagesUrl / chatUrl),
    -- 同时是目标域白名单的比对对象 —— 一个可以为空的字段无从校验。
    base_url           TEXT   NOT NULL,

    -- AES-256-GCM 密文,密钥来自 secret ConfigEncryptionKey(与 llm_config / websearch_config 同一把)
    api_key_enc        BYTEA  NOT NULL,
    -- 掩码(sk-…3f9a);读接口与 MCP tool result 只回这一列(docs/security.md §3)
    api_key_hint       TEXT   NOT NULL,

    -- 该端点上要用的模型 id(如 gpt-image-2 / gemini-3.1-flash-image)
    model_id           TEXT   NOT NULL,

    -- 【协议形态是 provider 的属性,不是工具的属性】参考插件(pi 的 image-generation 扩展)
    -- 为两条链路各注册一个工具;本站是「唯一默认 provider」语义,两个工具等于要同时激活
    -- 两个 provider。于是收成一个字段:
    --   images —— POST {base}/v1/images/generations,图在 data[0].b64_json(OpenAI gpt-image-*)
    --   chat   —— POST {base}/v1/chat/completions,图在 choices[0].message.images[0].image_url.url
    --             的 data URL(gemini-*-image 经 OpenAI 兼容网关)
    -- CHECK 把取值收成可枚举的闭集:这一列决定代码走哪条解析路径,不能是自由文本。
    api_style          TEXT   NOT NULL DEFAULT 'images'
                       CHECK (api_style IN ('images', 'chat')),

    -- 【尺寸是 provider 配置,不是工具入参】(所有者裁定,任务卡「范围裁定」)
    -- 外呼组约束 1 的最严读法:模型给的东西只落进请求体的**一个**字段(prompt)。
    -- NULL = 不发 size 字段,用上游默认;`auto` 同样不发(与参考插件一致);
    -- 否则形如 1024x1024 / 1536x1024,原样进请求体的 size —— 所以形状要 CHECK 死。
    -- `chat` 形态忽略此列(那条协议没有 size 参数)。
    image_size         TEXT   CHECK (image_size IS NULL OR image_size ~ '^(auto|[0-9]{3,4}x[0-9]{3,4})$'),

    -- 双计时器的两个上界(docs/security.md §1 外呼组约束 3)。上界与 websearch_config 同为
    -- 300s / 120s(外呼一直不结束就一直占着会话名额)。默认 180s / 30s:
    -- 生图常在 20–90s 之间出图,而**空闲计时器只在响应头之后才起**(生图是非流式的,
    -- 出图前上游一个字节都不发),所以 30s 管的只是「响应体下载中途断了多久」。
    total_timeout_ms   INT    NOT NULL DEFAULT 180000
                       CHECK (total_timeout_ms BETWEEN 10000 AND 300000),
    idle_timeout_ms    INT    NOT NULL DEFAULT 30000
                       CHECK (idle_timeout_ms BETWEEN 5000 AND 120000),
    CHECK (idle_timeout_ms <= total_timeout_ms),

    -- 每日生图张数上限(0 = 不限)。用量在 daily_quota.images。
    -- 与 token / 搜索次数分开计 —— 见迁移 008 里 daily_quota 那段注释,同一个理由。
    daily_image_limit  INT    NOT NULL DEFAULT 0 CHECK (daily_image_limit >= 0),

    is_default         BOOLEAN NOT NULL DEFAULT FALSE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 至多一个默认 provider(与 llm_config / websearch_config 同款部分唯一索引)。
CREATE UNIQUE INDEX idx_imagegen_config_single_default
    ON imagegen_config ((is_default)) WHERE is_default;

-- agent_ro / agent_title / agent_image 对本表**无任何权限**:它是凭据面。
-- 迁移 006 刻意没设 ALTER DEFAULT PRIVILEGES,所以这里不写 GRANT 就是全部答案。

-- ───────────────────── 每日生图计数 ─────────────────────
--
-- 与 searches 同一格式、同一理由(迁移 008):计次是这类 API 的通用计价单位,
-- 混进 tokens 之后 daily_token_limit 就没法解释了。
ALTER TABLE daily_quota
    ADD COLUMN images BIGINT NOT NULL DEFAULT 0 CHECK (images >= 0);

-- ───────────────────── 生成的图片 ─────────────────────
--
-- 【为什么存库不落盘】容器根文件系统只读(第 3 层)、工具禁止碰文件系统(第 1 层)、
-- 镜像内不烧内容(R6 裁定)—— 与 notes_assets 是同一个理由。
--
-- 【为什么挂在 sessions 下】生成图是会话内容的一部分:访客删会话、3 天保留期到期,
-- 图要一起消失(ON DELETE CASCADE),否则 R-VISITOR 的隐私承诺在这张表上是漏的。
-- 供图端点也按 sessions.visitor_id 判归属(docs/security.md §6 R-IMAGEGEN 补记)。
CREATE TABLE generated_images (
    -- 由 agent 侧在 JS 里生成(randomUUID):agent_image 角色没有 SELECT,用不了 RETURNING,
    -- 也用不了 DEFAULT gen_random_uuid() 再读回来。地址里就是它,122 位随机不可枚举 ——
    -- 但「不可枚举」不是授权,归属过滤照样做。
    id           UUID PRIMARY KEY,
    session_id   UUID NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    -- 只能是魔数认得出来的那四种(shared/image-magic.ts);SVG 永不在内(可执行文档)。
    -- 供图端点把这一列原样出成响应头,所以取值必须是闭集。
    content_type TEXT NOT NULL
                 CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
    bytes        BYTEA NOT NULL,
    -- 上界 8 MiB,**必须与 imagegen.ts 的 MAX_IMAGE_BYTES 同值**(测试从 information_schema 读
    -- 这条 CHECK 比对)。代码那道是「不把大东西读进内存」,这道是「就算代码漏了也进不了库」。
    byte_size    INT  NOT NULL CHECK (byte_size > 0 AND byte_size <= 8388608),
    -- 内容的 sha256(hex);供图端点用它做 ETag
    etag         TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 级联删除与「某会话有几张图」都按会话找
CREATE INDEX idx_generated_images_session ON generated_images (session_id);

-- ───────────────────── agent_image:只能追加图片的角色 ─────────────────────
--
-- 与 006 的 agent_ro、009 的 agent_title 是**三个**角色,别合并:合成一个之后,
-- 「只读」「只能改标题」「只能追加图」三条性质就没有任何一处还能单独成立。
--
-- IF NOT EXISTS 的理由同 006/009:角色是集群级对象而迁移是库级的,本机 encore 把每个
-- worktree 的库放在同一个 postgres 容器里,裸 CREATE ROLE 会在第二个 worktree 上打断迁移。
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent_image') THEN
        CREATE ROLE agent_image NOLOGIN;
    END IF;
END
$$;

-- 成员资格的授予口径与 006/009 逐字相同:只授给「已经能 SELECT sessions」的登录角色 ——
-- 它们本来就能整表改写 generated_images,再给一个只能 INSERT 的身份,可证明地不扩大任何权限。
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
        EXECUTE format('GRANT agent_image TO %I', r.rolname);
    END LOOP;
END
$$;

GRANT USAGE ON SCHEMA public TO agent_image;

-- **这就是 agent 侧对这张表的全部写面**:只有 INSERT。
--   - 没有 SELECT:连自己刚写的行都读不回来(RETURNING 不可用),更读不到别人的图
--   - 没有 UPDATE / DELETE:图只能被追加,改不了、删不了
--   - 对 sessions 无任何权限:外键检查由 Postgres 以被引用表所有者的身份执行,
--     不需要 agent_image 能读 sessions(测试钉住这一点)
GRANT INSERT ON generated_images TO agent_image;

-- 与 006/009 同样刻意**不设** ALTER DEFAULT PRIVILEGES:将来新增的表不会自动对 agent_image 可写。

-- ───────────────────── generate_image 的启停种子 ─────────────────────
--
-- **默认关**(所有者裁定,与 web_search 同一理由):新环境部署完还没配 imagegen provider,
-- 注册阶段本来就会把这个名字丢掉;默认关是把「没配就没有」变成显式的一件事。
-- 所有者配好 provider 后经 MCP 的 tool_config_set 打开。
--
-- dangerous 仍是 FALSE:那一位管的是「执行类工具的双闸」,而外呼不是执行(见迁移 008 的同段注释)。
INSERT INTO tool_config (name, enabled, dangerous, note) VALUES
    ('generate_image', FALSE, FALSE, 'R-IMAGEGEN 外呼工具:经生图网关生成一张图片存进本会话(需先配 imagegen provider)')
ON CONFLICT (name) DO NOTHING;
