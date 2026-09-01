-- R8:About 页的「公开仓库」与「语言构成」两块入库(所有者裁定 2026-09-01)。
--
-- 【为什么 R6 没建这两列】003 建 about_content 时按「双链 + 简介 + 本站如何构建」
-- 四项落的,而设计稿画板 2e 上还有仓库卡与语言条两块 —— 它们当时留在
-- `apps/web/lib/demo-data.ts` 里硬编码。R8 是「About 真实化」轮,所有者裁定
-- 把这两块也收进 about_content 由 MCP 维护,前端零硬编码。
--
-- 【为什么是 JSONB 而不是两张表】它们是**整块覆盖的展示数据**,没有独立的
-- 生命周期、没有外键、也不会被单独查询或排序 —— 建两张表只会多出两套 CRUD。
-- 形状由 mcp/tools.ts 的 zod schema 把关(server 侧校验,不信客户端)。
--
-- 默认 '[]' 且 NOT NULL:读路径不必处理 NULL,前端对空数组的行为就是「不渲染该块」。
ALTER TABLE about_content
    -- [{ name, lang, dot(#RRGGBB), stars, desc, pushed }] —— 画板 2e 的仓库卡
    ADD COLUMN repos    JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- [{ name, pct, color(#RRGGBB) }] —— 画板 2e 底部的语言构成条
    ADD COLUMN lang_bar JSONB NOT NULL DEFAULT '[]'::jsonb;
