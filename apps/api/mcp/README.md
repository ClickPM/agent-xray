# mcp 服务(待实现 — R6)

无状态 MCP 管理面,替代已废弃的 `/admin` 后台(所有者裁定 2026-08-31;安全条款见 `docs/security.md` §4)。
所有者以 MCP 客户端(Claude Code 等)管理站点内容与配置;访客不可达的写面,认证 = 静态 bearer token(服务端只存哈希),写操作全审计。

- 协议:**2026-07-28 规范为目标版本**(无状态:无握手、无 `Mcp-Session-Id`,`server/discover` 必须实现);官方 TS SDK,**保留向下协商**;不做 `subscriptions/listen`
- 挂载:`api.raw` 单 POST 端点 `/api/mcp`(走既有 `/api/*` 反代)
- tools 首批:
  - notes 三张表 CRUD——**入参即标准 markdown,server 只校验不改写**
  - 附件上传/删除(`notes_assets`,Postgres 存储 + 运行期供图;镜像不烧任何 notes 内容,图片 URL 保持 `/notes/<系列>/<哈希>.webp` 不变)
  - About 内容(github / origin 双链)
  - LLM provider 管理——多 provider 走 pi-ai 统一对接(`ModelRuntime.setRuntimeApiKey`),key 加密入库、**任何读回只给掩码**
  - 工具启停(`tool_config`,高危工具双闸之一)
  - 统计查询(R8 数据面就绪后落地,不在 R6)
- 安全边界:MCP 用全权 DB 角色写库;pi agent 仍走 `agent_ro` 只读,in-process 进程无 HTTP 类工具、物理上不可达本端点
