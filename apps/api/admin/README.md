# admin 服务(待实现 — 接口形状以管理后台设计终稿为准)

同域 `/admin` 前端的后端;单管理员强认证。

- `POST /admin/login` — argon2id 校验 + HttpOnly/Secure/SameSite=Strict 会话 cookie;登录限速与锁定
- `GET /admin/stats` — 每日访问数据(PV/UV/会话数/token/费用/限额用量)
- `GET|PUT /admin/config` — LLM provider/key(写入加密存储,读返回掩码)、每日 token/费用限额、单会话上限
- `GET|PUT /admin/tools` — 已集成工具清单(名称/来源[内置|MCP|pi extension]/风险级/启停);启停写审计日志;高危工具双闸(`XRAY_UNLOCK_DANGEROUS_TOOLS` + 后台开关);集成与下线走代码发布
