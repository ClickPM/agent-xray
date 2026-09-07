-- R-GSEARCH:`web_search` 的第二种线协议 —— Gemini 原生 Google Search grounding
-- (所有者 2026-09-07 对 CPA 网关做 A/B 探针验证后裁定接入;docs/security.md §1 R-GSEARCH 补记)。
--
-- 唯一的改动是把 `tool_type` 的闭集扩一项:`google_search`。这个值仍然会被原样拼进发往上游的
-- 请求体 —— 只是这次拼的是 `/v1/chat/completions` 的 `tools:[{google_search:{}}]`,而不是
-- `/v1/responses` 的 `tools:[{type:…}]`;哪条线由 websearch.ts 的 `wireOf(toolType)` 决定。
--
-- 【为什么不加一列 api_style】A/B 实测:`{type:"web_search"}` 打 chat/completions 会被网关静默忽略
-- (200、答案停在训练截止期),`/v1/responses` 对 gemini 模型也拿不到 grounding。两个字段能拼出的
-- 四种组合里只有一种通 —— 一个字段唯一决定线协议,就没有「配了却静默不生效」的组合。
--
-- CHECK 仍然是**闭集**(迁移 008 的理由原样成立):库里能出现的取值可枚举,mcp/tools.ts 的 zod 与这里同步。
-- 列级 CHECK 的自动命名是 <表>_<列>_check;测试库从零迁移会验证这个名字。
ALTER TABLE websearch_config DROP CONSTRAINT websearch_config_tool_type_check;
ALTER TABLE websearch_config ADD CONSTRAINT websearch_config_tool_type_check
    CHECK (tool_type ~ '^(web_search(_[0-9]{4}_[0-9]{2}_[0-9]{2})?|google_search)$');

-- 迁移 008 种下的说明文案写死了「经 Responses API 网关」,现在有两条线,改成不指定协议的说法。
-- 只改 note,不动 enabled / updated_at:那两列是所有者的开关状态,不是本迁移的事。
UPDATE tool_config
   SET note = 'R-WEBSEARCH 外呼工具:经搜索网关联网搜索(Responses API 或 Gemini google_search,由 provider 的 toolType 决定;需先配 websearch provider)'
 WHERE name = 'web_search';
