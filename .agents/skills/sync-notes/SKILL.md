---
name: sync-notes
description: 「已废弃」R5 内容同步管线(所有者裁定 2026-08-31 废除,R6 删除)。被触发时不要执行同步,告知用户内容发布改走无状态 MCP 管理服务。
when_to_use: >-
  不再使用。所有者 2026-08-31 裁定废除 R5 管道机制:内容发布与修改改走无状态 MCP 管理服务
  (ROUNDS.md R6)。若用户提出同步内容,告知走 MCP,不要运行本管线。
---

# 同步 vault 教程内容进站

> **已废弃(所有者裁定 2026-08-31)**:本管线与 `dev.ps1 notes` 于 R6 删除,勿再运行。
> 内容发布与修改改走无状态 MCP 管理服务(入参即标准 markdown,server 只校验不改写);
> 存量库内数据不动,附件随 R6 迁入 Postgres。以下内容仅存档。

## 这条管线是什么

```
vault 学习分享/  ──►  tools/notes-sync  ──►  notes_categories / notes_series / notes_chapters
(只读,225 篇)      规范化 + 语法改写         apps/web/public/notes/**(压缩后的图)
                                          ──►  /notes 三级页 + /rss.xml 四分类
```

入口只有一个:`.\dev.ps1 notes`(CLAUDE.md 规则 1,encore 相关命令一律走 dev.ps1)。
底层是 `tools/notes-sync`,刻意放在 `apps/api` 之外(规则 6)。

**所有者已裁定的口径,不要在同步时临时改**(完整表在 `rounds/round-05/round-05.md`):

| 决策 | 结论 |
|---|---|
| 正文形态 | 库里存**标准 markdown**;Obsidian 专有语法在同步阶段改写掉,渲染在前端 |
| frontmatter | 不保留,元数据抽成库字段 |
| 图片 | 只收正文引用到的图,WebP + 宽度 ≤1600px,落 `apps/web/public/notes/` |
| AI 资料 | **只收中译**,英文原文不入库,`source` 原链必须保留 |
| 原始资料/ | 任何系列都不摄入,正文里指向它的链接降级为纯文本(抓取素材,无授权) |
| 内容分享 | **不同步**(与所有者工作相关);卡片保留走占位态 |
| `wiki_exclude: true` | 忽略(那是所有者另一条 wiki 管线的标记,不是本站的发布闸) |

## 流程

### 1. 前置

- Docker Desktop 已启动(本地 Postgres 在容器里),且 `.\dev.ps1` 至少跑起来过一次 —— 库要先建出来,`encore db conn-uri agent` 才有东西可取。
- vault 默认取 `D:\variFlight_work\VariFlightWork\学习分享`;换位置用环境变量 `NOTES_VAULT`。
- 先看一眼 `git status`:同步会往 `apps/web/public/notes/` 写图片,那些是要提交的产物,别和别的改动混在一次提交里。

### 2. 先空跑,读报告

```bash
.\dev.ps1 notes --dry-run
```

不写库、不写图片,只解析 + 改写 + 打报告。**报告要逐块看,不是看一眼就过**:

- **`发现 : N 篇正文 / 13 个系列`** 与**分系列计数** —— 与上次同步比,数字只应因为 vault 真的增删而变。凭空少一章通常是命名漂移(见「常见故障」)。
- **`⚠ 链接目标不在站内`** —— 这些 wikilink 已降级成纯文本。绝大多数是 vault 里的工作笔记、简历、`原始资料/`,属正常。**要找的是本该发布却没进 manifest 的内容**:出现某个系列内部的章节名,就是漏收信号。
- **`⚠ 源图缺失`** —— 正文引用了不存在的图。少量正常(vault 里删过图),成片出现说明 assets 目录被挪了。
- **`⚠ 围栏外残留裸 HTML`** —— 渲染时会被转义成字面量给读者看见。出现新种类就回 `tools/notes-sync/src/obsidian.ts` 的 `rewriteRawHtml` 补一条。

要肉眼看改写质量就加 `--dump-dir`,把改写后的正文按 `<系列>/<slug>.md` 落到临时目录里翻:

```bash
.\dev.ps1 notes --dry-run --dump-dir <临时目录>
```

### 3. 正式同步

```bash
.\dev.ps1 notes
```

末尾两行是这轮的结果:

```
图片   : 引用 63 · 新写 0 · 复用 56 · 清理 0 · 76.0MB → 6.5MB
入库   : 新增 0 · 更新 7 · 未变 218 · 删除 0
```

- `删除 N` 不是 0 时**停下确认**:那是 vault 里没有了、站点上要下线的章节。确实删了就继续,是漏收导致的就先修 manifest。
- `清理 N` 是不再被任何正文引用的图片文件被删掉,与 `删除` 同理。

### 4. 验收

**同步命令自己会跑一遍自检**,末尾输出九行 PASS/FAIL;有 FAIL 时进程以非零码退出:

```
自检   : 225 章
  PASS  wikilink 已全部改写           0
  PASS  callout 已全部改写            0
  PASS  Obsidian 注释已清除           0
  PASS  围栏外无裸 HTML               0
  PASS  无指向原始资料的链接             0
  PASS  frontmatter 未入正文          0
  PASS  内容分享未同步                 0 章
  PASS  英文原文未入库                 0 章
  PASS  档案文章保留 source 原链        61/62
```

不重新同步、只想复检已入库内容:

```bash
.\dev.ps1 notes --verify
```

> **不要改用手写的 SQL LIKE 去查这些**。实测那样几乎全是误报:Rust 教程里的 `[[bin]]`
> 是 Cargo 的 TOML 语法、bash 的 `[[ -n $X ]]` 是条件测试、讲 HTML 的文章正文里有行内代码
> `<table>`,它们都长得像"没改干净的 Obsidian 语法"。自检的判据和改写器一致 ——
> **只看代码围栏与行内代码之外的部分**,所以才敢当门禁用。

另外两项自检覆盖不到、需要手动确认的:

```bash
# 幂等:紧接着再跑一次,必须是「新增 0 · 更新 0 · 删除 0」且图片「新写 0」
.\dev.ps1 notes

# 页面与订阅源(需要 .\dev.ps1 与 apps/web 的 dev server 都起着)
curl -s http://127.0.0.1:4000/notes/series | head -c 300
curl -s http://127.0.0.1:3000/rss.xml | head -20
```

### 5. 提交

图片是二进制产物,和内容一起提交:

```bash
git add apps/web/public/notes tools/notes-sync
git status   # 确认没有夹带无关改动
```

## vault 结构变了怎么办

映射表在 `tools/notes-sync/src/manifest.ts`,13 个系列一条一条写死的。**它的失效方式被刻意设计成"报错停下"而不是"静默少收"**,所以同步报错通常是好事:

| 报错 | 含义与处理 |
|---|---|
| `manifest 指向的文件不存在` | 文件改名或移动了。改 manifest 里的路径 |
| `<目录> 下没有「第N章」文件` | 教程目录结构变了。确认新结构,改对应系列的 `collect` |
| `章节 slug 重复` | 两篇文章算出了同一个 URL 片段。给其中一篇换 slug 规则 |
| `AI资料/<目录> 下没有识别出中译` | 中译文件没按 `-Chinese-<日期>` 命名。**先确认它确实是中文**,是就加进 `ARCHIVE_EXTRA` 白名单;只有英文原文就把该目录列为已知排除 |

**新增一个系列**要三步:manifest 加一条 `SeriesSpec`(slug / 分类 / 名称 / 描述 / 排序 / `collect`)→ 空跑核对章节数与顺序 → 正式同步。
注意 slug 是 URL 的一部分,定了就不要改 —— 改了等于把已发布的链接全部作废。

## 投递到预发 / 生产

本机同步是直接对 encore 的本地库 upsert。服务器上没有仓库也没有工具链(规则 10),所以产出一份可传输的 SQL:

```bash
.\dev.ps1 notes --emit-sql <输出文件>
```

生成的 SQL 是**声明式全量**(upsert + 删除不在清单里的章节),对空库和已同步库执行结果一致,单事务、可重复执行 —— 与 `deploy/migrate.sh` 同一套路。图片要随 web 镜像走,所以内容更新后 web 镜像需要重新构建。

> 具体怎么把这份 SQL 送上 130 / 生产、以及和镜像发布的先后顺序,**R9 定**。在那之前不要自己发明部署步骤。

## 不要做的事

- **不要写 vault**。这条管线对 vault 只读,任何"顺手把源文件改一下"的想法都不行。
- **不要为了让某篇文章显示得好看而放宽内容边界**(收英文原文、收内容分享、收原始资料)。边界是所有者裁定的,要改先找所有者。
- **不要给 markdown 渲染挂 `rehype-raw`**。正文里有从网页抓来的 `<script>` / `<style>`,前端默认丢弃裸 HTML 是 XSS 兜底。
- **不要手改 `apps/web/lib/api-client.ts`**(生成物,规则 6),也不要为 Notes 页改样式(规则 7)。
