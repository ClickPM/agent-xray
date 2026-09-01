# agent 服务

pi SDK in-process 会话管理、对话流、只读工具组与限额。

## 端点

- `POST /agent/ask`(`ask.ts`,`api.raw`)—— 创建/续接会话,对话流 SSE ← `session.subscribe()`。
  非 2xx 的 JSON 体是 `{error, code?}`:`error` 只供调试,访客文案由前端按 status/code 分档。
- `GET /agent/sessions` · `GET /agent/sessions/:id` · `DELETE /agent/sessions/:id` ·
  `POST /agent/sessions`(`sessions.ts`)—— 会话列表 / 历史回放 / 删除 / 建空会话。

## 访客隔离(R-VISITOR;`visitor.ts` + `../shared/visitor-cookie.ts`)

约束来源是 `docs/security.md` §6 的 R-VISITOR 补记,那里是口径的正本。本服务的落点:

- **归属列 `sessions.visitor_id`**(迁移 007)是唯一判据。列表 / 单查 / 续接 / 删除全部
  `WHERE visitor_id = $当前访客`;不匹配一律 `not_found`,**不回 403**(403 等于确认
  「这个 id 存在」)。存量会话 `visitor_id IS NULL`,`= $1` 永不匹配,天然不可见。
- **身份只在会话被创建时发放**:`resolveVisitor` 只认领(读路径用),`ensureVisitor` 才发放,
  且只出现在 `POST /agent/sessions` 与 `/agent/ask` 的新建分支里 —— 读路径也发的话,
  `GET /agent/sessions` 就成了一个无认证的建行入口。
- **cookie 属性只有一个来源**:`shared/visitor-cookie.ts` 的 `buildSetCookie`。
- ⚠️ **`Header<string, "Set-Cookie">` 必须逐处内联写,不能抽类型别名**。Encore 的静态解析器
  不穿透别名,写成别名会**静默**把它降级成响应体字段(token 明文进 JSON,浏览器收不到
  Set-Cookie)。详见 `sessions.ts` 顶部那段注释与任务卡实测。
- **保留期清理在 `purge.ts`**:进程内定时器,不是 Encore `CronJob`(自托管镜像不执行 cron)。

## 运行时(`runtime.ts`)

- 会话注册表:并发上限 `MAX_ACTIVE_SESSIONS`、空闲回收、容量满时逐出最旧的空闲会话、及时 `dispose()`。
- 观测者扩展订阅 34 种事件 → 逐字段白名单脱敏(`events.ts`)→ 待落库队列 + 进程内总线(trace 服务从总线取 live 帧)。
- **配置指纹 → 会话重建**(R6 定下、R7 扩面的统一规则):`RuntimeConfig.fingerprint`
  覆盖 LLM 配置(provider / baseUrl / 模型 / key)**与工具集**。两者都在
  `createAgentSession` 时定格、事后换不掉,所以指纹一变,会话在下一轮被重建到新配置上
  (走空闲回收同一条重建路径,库内历史照常注入)。

## 四层沙箱在本服务的落点(`docs/security.md` §1)

| 层 | 落点 | 要点 |
|---|---|---|
| 1 · 工具白名单 | `tools.ts` + `runtime.ts` | `noTools:"all"` 起步 + `customTools` + `tools` 白名单三个参数一组闸;`TOOL_REGISTRY` 是**已实现工具的全部**,`tool_config` 只能开关它们,未知名字丢弃并记日志;`dangerous` 行另需 env `XRAY_UNLOCK_DANGEROUS_TOOLS=1` |
| 2 · 数据面只读 | `ro-db.ts` | 工具的唯一取数通道 `queryAsAgentRo`:事务内 `SET TRANSACTION READ ONLY` + `statement_timeout` + `SET LOCAL ROLE agent_ro`。角色只对 notes 三张表有 SELECT |
| 3 · 容器隔离 | `deploy/` | 非 root / `read_only` / `cap_drop ALL` / `mem_limit`,不在本服务 |
| 4 · 出网管控 | `quota.ts` | 每日 token/费用计数(`daily_quota`)超限拒**新会话**;单会话轮数上限。限额值读 `llm_config` 默认行,0 = 不限 |

**改工具相关代码前先读 `tools.ts` 的文件头**:纯函数 / 注册表即全部 / 输出有界三条性质,
每条都有对应的攻击面,不是风格偏好。

## LLM 配置(`llm-config.ts`)

运行期 LLM 凭据的**唯一来源**是 `llm_config` 表(R6;引导 secret 已彻底移除)。
未配置时 `/agent/ask` 回明确的 503,而不是含糊的模型错误。
本服务只读这张表,写面在 mcp 服务 —— 沿用 R4 定下的服务间耦合口径:只读、不拥有 schema、不 import 对方目录。

## 测试

`dev.ps1 test`(CLAUDE.md 规则 2)。`runtime.test.ts` 是不触碰 pi SDK 的纯逻辑测试;
`sandbox.test.ts` 是 R7 两条验收项本身(agent_ro 写库必须失败 / 超限有明确拒绝)。
