# Round R-TABS — 顶部导航 tab 的呈现开关(MCP 可配)

> 状态:已完成(codex 审查零 findings;待发预发/生产)

## 目标

所有者能经 MCP 逐个开关顶部三个 tab 的**呈现**,改完下次渲染即生效、不发版;
用途是公安网备案的内容审核窗口期里把 Runtime(agent 工作台)整块从站点上撤下来,审核后放回。

## 范围裁定(所有者 2026-09-03)

- **这是 CLAUDE.md 规则 8 的一个例外**,与 R-VISITOR 的「会话删除入口」同类:
  设计稿画板 1a 的导航条是三格固定的,没有画过「某一格可以不出现」;
  管理面的范围本来也以 ROUNDS.md R6 裁定清单为准,`site_tab_set` 不在那份清单里。
  裁定理由:**这不是产品功能,是一次合规运维动作的开关** —— 备案审核期要求内容可撤下,
  而「撤下 / 放回」若靠发版,一来一回是两次本机构建 + 传镜像 + 重建容器,窗口期里可能来回好几轮。
  与 `tool_config`(工具启停)是同一形态:配置进库、经 MCP 改、即时生效。
- **边界:只做呈现层**(所有者在开工前明确选定,拒绝了「顺带把后端也关掉」的方案)。
  隐藏一个 tab = 导航条不渲染它 + web 侧它的页面不可达;`/agent/*`、`/trace/*`、`/notes/*`、
  `/rss.xml` 等后端端点**照常服务**。想让 agent 真的停下来,现成通路是 `tool_config_set`
  关工具、或删掉默认 LLM provider。这条边界写在迁移 011 文件头、`site_tab_set` 的 description、
  MCP server 的 INSTRUCTIONS 与 `apps/api/site/README.md` 四处 —— 它是最容易被读成「关掉整个功能」的地方。
- **不扩设计稿**:本轮没有新画板。画板 1a 在三个 tab 全部可见时与实现一字不差(见「规则 7」段)。

## 前置

R6(MCP 管理面)、R8(About 只读服务的读/写分工样板)、R11(生产已上线)。无新依赖、无新凭据。

## 交付物

**后端**
- `apps/api/agent/migrations/011_site_tabs.up.sql` — `site_tab_config` 表 + 三行种子(全可见)
- `apps/api/shared/site-tabs.ts` — tab 闭集登记表(读写两面共用,两面不互相 import)
- `apps/api/site/{db,store,tabs}.ts` + `README.md` — 只读面:`GET /site/tabs`
- `apps/api/mcp/store.ts` — `listSiteTabs` / `setSiteTab`(事务 + advisory lock + 「不许关掉最后一个」)
- `apps/api/mcp/tools.ts` — `site_tabs_list` / `site_tab_set`(管理面工具总数 32 → 34)
- `apps/api/mcp/server.ts` — INSTRUCTIONS 补一句边界说明

**前端**
- `apps/web/lib/tabs.ts` — 纯登记表(key / 字样 / href / 选中态判据),Server 与 Client 都 import
- `apps/web/lib/tabs-server.ts` — 取数(React `cache` 去重)+ 两种门禁(404 / 根路径 302)
- `apps/web/components/GlobalNav.tsx` — 收 `visible` prop,少渲染几个 `<Link>`
- `apps/web/app/(site)/layout.tsx` — 服务端取可见 tab、`force-dynamic`
- `apps/web/app/(site)/page.tsx` — `runtime` 隐藏时 302 到第一个可见 tab
- `apps/web/app/(site)/{about,notes,notes/[series],notes/[series]/[chapter]}/page.tsx` — 隐藏时 404
- `apps/web/lib/api-client.ts` — `dev.ps1 gen` 产物(新增 `site` 命名空间)

**测试**
- `apps/api/site/tabs.test.ts`(6 条)· `apps/api/mcp/mcp.test.ts` 新增两个 describe(9 条)

## 关于规则 7(不改前端样式)

改了 `GlobalNav.tsx` 的**结构**:tab 数组从组件内常量搬到 `lib/tabs.ts`,渲染前按 `visible` 过滤。
理由与影响范围:这是本轮功能的落点,除此之外**每一格的样式、间距、圆角、选中态与外层容器一个字节没动**;
三个 tab 全部可见时,渲染结果与画板 1a 一字不差(实测截图见「本轮实测」)。
其余页面的改动都是在 `export default` 的第一行加一句门禁 `await`,不进 JSX。

## 验收

| # | 检查 | 命令 / 期望 |
|---|---|---|
| 1 | 编译与全量测试 | `dev.ps1 check` 通过;`dev.ps1 test` 16 文件 388 用例全绿 |
| 2 | 迁移种子 ↔ 登记表一致 | `site/tabs.test.ts` 第 1 条:库里的 key 集合 == `SITE_TAB_KEYS` |
| 3 | 读面缺行兜底成可见 | `site/tabs.test.ts`:删掉 about 那行,`listTabs` 仍回 `about: true` |
| 4 | 库里未知 key 被丢弃 | `site/tabs.test.ts`:插 `admin` 行,`listTabs` 仍只回三个 |
| 5 | 写面拒绝未知 key | `mcp.test.ts`:`setSiteTab({key:'admin'})` → `NotFoundError`;`site_tab_set` 的 `key` 是 enum |
| 6 | **不许关掉最后一个可见 tab** | `mcp.test.ts`:关掉两个后再关第三个 → `ConflictError`,且事务回滚(第三个仍可见) |
| 7 | 遗留的未知行不算「还有可见 tab」 | `mcp.test.ts`:库里有 `admin` 行时第 6 条仍然拒绝 |
| 8 | 隐藏 runtime → 导航条少一格,`/` 302 | 本机实跑:`GET / 307`,落到 `/notes`,导航条只剩 Notes / About |
| 9 | 隐藏 notes → `/notes` 404 | 本机实跑:`GET /notes 404`,页面是站点布局里的 404 |
| 10 | 全部恢复可见 → 与画板 1a 一致 | 本机实跑截图:三格齐全、Runtime 选中、工作台照常 |
| 11 | 管理面工具总数闸更新 | `mcp.test.ts` 的 `toHaveLength(34)`(原 32) |

## 禁止

- 不改前端页面样式(规则 7),`GlobalNav` 的结构性改动已在上面写明理由与影响范围。
- **不把「隐藏」扩大成「停服」**:不在 `/agent/*`、`/trace/*`、`/notes/*`、`/rss.xml` 上加任何门禁。
- 不新增画板、不加设计稿没有的可见元素(规则 8)。
- 不动 `.secrets.local.cue` 与任何环境的 token / 密钥。

## 已知边界(不在本轮修)

1. **About 页里那条指向 `/notes` 的链接**(`about/page.tsx:185`)在 Notes 被隐藏时会指到 404。
   这是站点上唯一一条跨 tab 的硬编码链接。不当场改的理由:改它要在画板 2e 的定稿页面里加一个
   条件渲染(规则 7 的结构性改动),而所有者本轮的实际用法是隐藏 **Runtime**,Notes 保持可见 ——
   为一个不会发生的配置去动定稿页面不划算。已记 `rounds/BACKLOG.md`。
2. **RSS 与后端端点不受影响**,这是范围裁定本身,不是遗漏(见上「边界:只做呈现层」)。
3. **后端不可达时整站报错**:`(site)/layout.tsx` 现在每次渲染都要读一次 `/site/tabs`,
   读失败原样抛出(与 `lib/api.ts` 的口径一致:真故障不能伪装成「这些 tab 不存在」)。
   代价是站点根路径 `/` 从「后端挂了也能渲染出工作台外壳」变成「跟 Notes / About 一样报错」。
   兜成「全部可见」更糟 —— 一次后端抖动会把所有者刚藏起来的 tab 重新露出来,而那正是本轮要避免的事。

## 代码审查

- 审查方式:codex `/codex:review --background`,范围 `branch diff against main`(本轮是 R-TABS 的第 1 轮审查,
  按 CLAUDE.md「审查范围」用固定的全量范围)
- findings 处理:**零 findings**。原文:"The changes consistently implement configurable tab visibility across the
  MCP management layer, API read endpoint, database migration, and dynamic frontend routing. TypeScript checks pass,
  and no actionable regressions were identified in the diff."
  审查过程里 codex 自己跑了 `npx tsc --noEmit`(通过)与 `dev.ps1 test`(exit 0),并专门查过几处值得查的:
  Next 客户端 Router Cache 会不会让导航条留在旧状态、`site_tab_config` 的迁移是否漏了角色授权、
  `= ANY($1)` 的数组参数序列化、React `cache` 的作用域、以及 `sensitive: true` 对数据暴露面的影响 —— 均未成为 finding。
- 结论:**PASS**(无整改,故不需要第二轮复审;缺陷门禁通过)

## 失败处理

同一验收项针对性整改后连续 2 次验证仍不过 → 写 `rounds/round-tabs/BLOCKED.md`,停下呼人。

## 本轮实测

- `dev.ps1 test`:**16 文件 388 用例全绿**(本轮之前 15 文件 373 用例;新增 15 条)。
  一次红是预期内的:`mcp.test.ts` 有一道「管理面工具总数」的闸(32),加两个工具后必须显式改成 34。
- **本机实跑(encore run :4000 + next dev :3000,直接改库模拟 MCP 写入)**:
  | 库里的开关 | `GET /` | `GET /notes` | 导航条 |
  |---|---|---|---|
  | 三个都 true | 200,工作台 | 200 | Runtime · Notes · About(与画板 1a 一致) |
  | runtime=false | **307 → /notes** | 200 | Notes · About |
  | runtime=false, notes=false | **307 → /about** | **404** | About |
  | 恢复三个 true | 200,工作台 | 200 | 三格齐全 |
- **踩到的一处**:`z.enum` 要拿到字面量取值就必须让登记表是 `as const` —— 写成
  `readonly SiteTabMeta[]` 的话 `key` 退化成 `string`,enum 仍能在运行期拦住未知值,
  但 `tools/list` 不再向 MCP 客户端下发「可用的三个值」,管理端只能猜键名。
  已在 `shared/site-tabs.ts` 注释里写明,别在整理类型时把 `as const` 顺手删掉。
- **真实 MCP 协议路径已在本机验掉**(所有者指出 token 就在用户环境变量里,不必等预发):
  用 `XRAY_MCP_TOKEN` 直接对 `127.0.0.1:4000/mcp` 发 2026-07-28 契约的 JSON-RPC(`_meta` 三个带命名空间的键、
  `Mcp-Method` 头,`tools/call` 再加 `Mcp-Name` 头;形状照 `rounds/round-10/checklist.md` §9),实测:
  | 步骤 | 结果 |
  |---|---|
  | `server/discover` | 200,`supportedVersions=2026-07-28` |
  | `tools/list` | 200,**工具总数 34**,含 `site_tabs_list` / `site_tab_set`;`key` 的 enum 下发为 `runtime, notes, about` |
  | `site_tab_set{runtime,false}` | `visibleTabs: [notes, about]`,`GET /site/tabs` 同步变为 `runtime:false` |
  | `site_tab_set{key:'admin'}` | `isError`,SDK 层就拒:`expected one of "runtime"\|"notes"\|"about"` |
  | 关掉 notes 后再关 about | `isError` + 那句可读的拒绝理由,事务回滚,about 仍可见 |
  | 三个逐个恢复 | 全部 `updated`,收尾态三格全可见 |
- **仍留给 130 / 生产的**:迁移 v10 → v11 在真实部署上跑一遍,以及经 `xray-admin-130` /
  `xray-admin-prod` 各调一次(生产那把 token 也在用户环境变量里,但生产现在跑的是 `b291eb1`,
  还没有这两个工具 —— 发上去之后才谈得上验)。
- **踩到的第二处坑(规则 3)**:探测脚本第一版带中文注释、没存 BOM,PowerShell 5.1 按 ANSI(936) 解码,
  整个脚本被解析成一堆语法错误。规则 3 说的就是这件事;临时脚本更省事的做法是**全 ASCII**。
