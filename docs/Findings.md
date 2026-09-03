# Known Findings

本文件归档当前仓库已确认的代码质量、安全与工程化缺陷。它不是设计文档，也不替代
`docs/security.md`；每条记录都保留证据位置、影响、缓解因素与建议动作。严重度沿用审计口径：

- **Critical**：违反安全硬约束，可能造成凭据/跨访客数据泄漏或核心安全边界失效。
- **High**：会让发布门禁、测试结论或生产安全保障失真。
- **Medium**：真实的策略/实现不一致，影响范围受隔离或其他条件限制。
- **Low**：测试覆盖或鲁棒性不足，当前不直接构成线上漏洞。
- **Info**：已知取舍或依赖环境假设，记录以防后续误判。

## 1. Critical — 公开工具目录端点未标记 `sensitive`

- **证据**：`apps/api/agent/catalog.ts:122-123` 的 `GET /agent/tools` 只有
  `expose: true`，没有 `sensitive: true`。
- **影响**：访客 cookie 为 `Path=/`，浏览器访问该端点时会携带 cookie；Encore 默认可能把请求头写入 trace，导致可冒充访客身份的 token 进入轨迹数据。这违反仓库既定不变量“每个 `expose: true` 端点都必须带 `sensitive: true`”（见 `apps/api/shared/visitor-cookie.ts:96-99` 和 `docs/security.md` §6）。
- **缓解因素**：端点响应本身是静态工具目录，不读取会话或配置；问题在请求头被 trace 记录，而不是响应字段泄露。
- **建议**：补 `sensitive: true`；增加基于 AST/Encore 元数据的自动检查，不要只依赖 grep 计数。
- **状态**：待修复。

## 2. High — `dev.ps1` 在依赖缺失时可能“失败但退出码为 0”

- **证据**：`dev.ps1:157-170`、`dev.ps1:172` 直接调用 Encore/Bun，并以 `$LASTEXITCODE` 作为结果；但 PowerShell 对“命令不存在”的错误不会可靠地设置该变量。本机缺少 `bun` 与 Encore 时，`./dev.ps1 test` 仍返回 0，实际测试没有执行。
- **影响**：本地或 CI 可能把“未运行测试/检查”误判为通过，削弱发布门禁的可信度。
- **建议**：脚本入口显式检查 `Get-Command bun` 与 Encore 可执行文件；设置 `$ErrorActionPreference = 'Stop'`；每个外部命令检查命令存在性和非零退出码，缺少依赖时返回非零状态。
- **状态**：待修复。

## 3. High — Web 依赖存在已知 PostCSS 漏洞

- **证据**：`apps/web/package-lock.json:2161-2170` 锁定 `next@15.5.24` 与 `postcss@8.4.31`（`2256-2259`）。`npm audit --json` 报告 1 个 high 与 1 个 moderate 漏洞，涉及 PostCSS 任意文件读取/路径穿越及 CSS 输出 XSS。
- **影响**：构建链依赖存在公开安全公告；具体可利用性取决于 Next/PostCSS 的使用路径，但当前依赖状态不能视为干净。
- **建议**：优先升级到包含修复版本的 Next/PostCSS 组合并回归 Next standalone 构建；若暂不能升级，评估兼容的 `overrides`，并把 `npm audit` 纳入实际 CI（当前仓库没有发现 `.github` workflow/Dependabot 配置）。
- **状态**：待处置。

## 4. Medium — `web_search` 结果与进度泄露 provider/model 配置面

- **证据**：
  - `apps/api/agent/tools.ts:650-653` 把 `provider` 与 `model` 放进 `details`；
  - `apps/api/agent/events.ts:185` 对 `tool_execution_end` 调用 `previewText(e.result)`，会把整个结果（包括 `details`）序列化进 `resultPreview`；
  - `apps/api/agent/websearch.ts:216` 的进度文案还直接包含上游 hostname 与 model；进度经 `tools.ts:617-625` 进入 `tool_execution_update` 事件。
- **影响**：短结果或进度事件会把 provider、model、上游 host 暴露给触发搜索的访客，与 `docs/security.md` §2/§3 及 R-TOOLS 的“配置面不公开”政策不一致。
- **缓解因素**：轨迹流按访客 cookie 隔离，只泄露给发起该次搜索的访客；`previewText` 仍有长度上限，正文较长时 details 可能被截断。
- **建议**：删除 `web_search` details 中的 provider/model；进度只保留固定阶段文案，不输出 host/model；或让事件摘要只提取工具 `content` 文本，不序列化完整 result。补充轨迹级回归测试，断言 provider/model/baseUrl/host 均不出现在公开事件中。
- **状态**：待修复。

## 5. Medium — 非法 URL 编码在公开 raw 端点上未统一处理

- **证据**：`apps/api/notes/rss.ts:45`、`apps/api/notes/assets.ts:58-59` 直接调用 `decodeURIComponent`，没有捕获 `URIError`。对比之下，`skills/zip.ts` 与 `agent/images.ts` 已将坏编码按 404 处理。
- **影响**：请求 `/rss/%ZZ.xml` 或 `/assets/notes/%ZZ/x.webp` 等畸形路径可能进入 500；公开输入可造成噪声错误、污染监控，并暴露端点鲁棒性差异。
- **建议**：统一封装安全解码函数，解码失败返回 404；为 RSS 与 notes 资源端点增加 `%ZZ`、不完整 UTF-8 等测试。
- **状态**：待修复。

## 6. Low — 安全原语缺少 `shared/` 就地回归测试

- **范围**：`apps/api/shared/crypto.ts`、`redact.ts`、`outbound-hosts.ts`、`skill-pack.ts`、`http-body.ts` 等关键原语，当前主要由 agent/mcp 消费方间接覆盖；`shared/` 下只有 `trace-bus.test.ts`。
- **影响**：原语被单独修改时，测试失败位置远离改动点，容易出现“消费方场景仍为绿、边界契约已漂移”的情况，尤其是脱敏、URL 白名单、字节上限和 skill 路径校验。
- **建议**：为每个安全原语建立同目录单元测试，至少覆盖边界值、异常路径、恶意输入和不变量；消费方测试继续保留作为集成回归。
- **状态**：改进项。

## 7. Low — `about` 与 `system` 服务没有测试

- **证据**：`apps/api/about/` 与 `apps/api/system/` 没有对应测试文件；两者合计约 135 行，但 `about` 内容最终会进入前端 Markdown 渲染路径。
- **影响**：读面逻辑、空数据/异常数据和内容安全约束缺少直接回归防线；当前不等于已确认 XSS，但会降低对内容面变更的发现能力。
- **建议**：至少为 about store/endpoint 添加空值、字段映射、异常路径测试；为 system health 添加响应契约测试，并在前端补充不可信 Markdown/链接的渲染回归。
- **状态**：改进项。

## 8. Info — MCP 审计来源依赖反代 `X-Forwarded-For`

- **证据**：`apps/api/mcp/audit.ts:60-64` 与 `apps/api/mcp/server.ts:43-46` 读取 `x-forwarded-for` 首段作为 `remote`。`deploy/Caddyfile` 当前没有对该头做显式覆盖/清洗。
- **影响**：若 Caddy 前还有其他代理，或代理允许客户端自带 XFF，管理面审计中的来源地址可被伪造。
- **已知取舍**：`docs/security.md` §4/§6 已明确“Caddy 前没有其他代理”的前提；这属于审计可信度的环境假设，不是当前已确认的认证绕过。
- **建议**：部署时确认 Caddy 是唯一反代；若未来接入 CDN/LB，改为按可信代理层数提取地址，或在边缘显式覆盖 XFF，并补充管理面审计冒烟测试。
- **状态**：已知取舍，持续跟踪。

## 审查与验证备注

- `node tools/skills-manifest/generate.mjs --check` 已通过（生成物一致）。
- `npm audit`：API 依赖无已报告漏洞；Web 依赖存在第 3 条所述漏洞。
- 当前环境缺少 Bun 与 Encore CLI，无法实际运行 `dev.ps1 test/check`；因此本文件不把“测试通过”作为结论。
- 审查时工作区存在未提交/未跟踪变更（包括 `docs/mcp.md` 与 `.sessions/`），正式合并前应先确认这些文件是否属于本次发布范围。

