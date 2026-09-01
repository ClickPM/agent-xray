# Notes 内容标准化要求(经 MCP 发布的输入契约)

> 面向**内容源头**(vault 导出 / 另开的标准 markdown 仓库),不是面向站点代码。
> 依据:`apps/api/mcp/tools.ts` 的入参校验、`apps/api/agent/migrations/002_notes.up.sql` 的表结构、
> ROUNDS.md R5/R6 的所有者裁定。**服务端只校验不改写**(R6 裁定:Obsidian 改写器随 R5 管道退役),
> 所以下面每一条不满足,都是发布时报错或线上出错,不会被自动兜住。

## 0. 一句话

把内容整理成「**分类 → 系列 → 章节**」三层,每个系列一个目录 + 一份 `series.json`;
正文是标准 GFM;配图全部转 WebP、改名为内容哈希、正文里一律用 `/notes/<系列slug>/<文件名>` 引用。

## 1. 三层结构与 slug

| 层 | 是什么 | 约束 |
|---|---|---|
| 分类 category | **固定四个**,不新增 | slug 只能是 `pm` / `deep-dive` / `engineering` / `frontier` |
| 系列 series | 一个目录 = 一个系列,URL 是 `/notes/<系列slug>` | slug 必须匹配 `^[a-z0-9][a-z0-9-]{0,63}$` |
| 章节 chapter | 一个 `.md` = 一篇文章,URL 是 `/notes/<系列slug>/<章节slug>` | slug 同上;系列内唯一 |

**slug 是硬校验,不是建议**:正则是 `^[a-z0-9][a-z0-9-]{0,63}$` —— 首字符必须是小写字母或数字,
之后只允许小写字母、数字、连字符,总长 ≤64。**中文、下划线、空格、大写、点号全部不合法**。
中文目录名/文件名必须映射成英文或拼音 slug(见 §6 的映射表模板)。

> 固定四分类的圆点色(建分类时要给,取自 `design/README.md` 的 token 速查):
> `pm=#2563eb` · `deep-dive=#16a34a` · `engineering=#f9c22e` · `frontier=#8b5cf6`。

**目录层级必须齐平到两层。** 当前 `Agent基础知识/` 是「分类/阶段/章节」三层,其余是两层。
三层的处理有且只有两种合法做法,选一种、别混用:

- **A(推荐)**:每个「阶段」当成一个独立系列 → 15 个系列,分类都挂 `pm` 或 `engineering`;
- **B**:整个 `Agent基础知识` 是一个系列,阶段只体现在章节的 `label` 与 `ordinal` 里(如 `1.1`/`1.2`)。

## 2. 交付形态

```text
<导出根>/
  <系列slug>/
    series.json          ← 系列与章节的元数据(见 §3)
    <章节slug>.md        ← 正文,标准 GFM,**不含 frontmatter**
    ...
    assets/
      <64位小写十六进制或其它全小写名>.webp
```

**为什么要 `series.json`**:`notes_chapter_upsert` 需要 `ordinal` / `label` / `pinned` / `title` /
`summary` / `sourceUrl` / `publishedAt`,而**库里不存 frontmatter**(R5 裁定)。
把这些写在正文顶部的 `---` 块里会被原样当正文渲染出来 —— server 一个字节都不改。
所以元数据必须走 manifest,正文里只有正文。

## 3. `series.json` 结构

```jsonc
{
  "slug": "pi",                       // 必须 = 目录名,匹配 §1 的 slug 正则
  "categorySlug": "deep-dive",        // 四选一
  "name": "Pi 源码拆解",               // ≤128 字符,展示名,可含中文
  "description": "从内核到扩展系统…",   // ≤512 字符,可空串
  "sortOrder": 10,                    // 0–9999,Notes 首页组内排序
  "chapters": [
    {
      "slug": "readme",               // §1 slug 正则;= 文件名去掉 .md
      "file": "readme.md",            // 相对本 series.json 的路径
      "ordinal": 0,                   // 0–9999,系列页章节表的顺序
      "label": "README",              // ≤32 字符,章节表左列文本:README / 01 / 02 …
      "pinned": true,                 // 置顶总览行,不计入章节数;一个系列最多一条
      "title": "教程总览",             // ≤256 字符
      "summary": "本系列讲什么",        // ≤512 字符,可空串
      "sourceUrl": null,              // 第三方译文必须给原文链接(§5),否则 null
      "publishedAt": "2026-07-02T00:00:00Z"  // ISO 8601,或 null
    }
  ]
}
```

约束速查:`ordinal` 与 `label` 一一对应且系列内不重复;`pinned: true` 的那条固定 `ordinal: 0`。

## 4. 正文(`.md`)的硬要求

1. **标准 GFM,无 Obsidian 语法**:不出现 `[[wikilink]]`、`![[embed]]`。
   *当前导出已满足(211 篇全 0 命中)。*
2. **不含 frontmatter**。元数据走 `series.json`。*当前导出已满足。*
3. **配图引用只能是站内绝对路径** `/notes/<系列slug>/<文件名>` 或 `http(s)://` 外链。
   **相对路径一律不合法** —— 站上没有那个路径,渲染出来就是破图。
   *当前导出有 **56 处**相对图片引用(`assets/…`),全部要改。*
   其中至少 1 处是**语法坏的**:`![…](<assets/…(阶段-0-的-⭐-最小产出…` 括号未配平,
   见 `Agent基础知识/阶段0-能力盘点与统一词汇/讲义-从模型到Agent产品的四层分工.md`。
4. **站外相对链接要清理**。*当前导出有 **73 处**非图片相对链接*,指向导出包里不存在的路径
   (`/tables/customers.md`、`./docs/typescript/`、`mention://user/userId` …),线上全是 404。
   处理方式二选一:改成可用的绝对 URL,或退化成纯文本/行内代码。
5. **`---` 前必须有空行**。「一行文本紧跟 `---`」在 CommonMark 与 Obsidian 里都会把那行文本
   渲染成 **H2 标题**(setext heading),于是正文段落变大标题、「本章目录」锚点整体错位。
   *当前导出有 **21 处**(围栏代码块内的已排除)。* 修法是在 `---` 前插一个空行。
6. **单篇正文 ≤ 1 MiB**(UTF-8 字节)。*当前导出全部满足。*
7. **正文不要用一级标题重复文章标题**。文章页已经把 `series.json` 的 `title` 渲染成页面大标题,
   正文再以 `# <同样的标题>` 开头,读者会连着看到两遍。正文的章节标题**从 `##` 起步**,不跳级;
   代码围栏成对闭合(第 5 条的检测依赖围栏配平)。
   *(这条是 R9 上线后才发现的:首批 205 篇里有 **153 篇**正文首行是与 `title` 一字不差的 `# …`,
   前端把它降级成 `<h2>` 渲染,于是页面上标题连出两遍。判据:正文第一个非空行如果是 `# X`
   且 `X == title`,删掉那一行。)*

## 5. 收录范围(ROUNDS.md R5 所有者裁定,仍然有效)

| 目录 | 处理 |
|---|---|
| `内容分享/` | **不收**。当前导出里有 7 篇,请从交付包里移除 |
| `原始资料/`(若有) | **不收**,且**不得生成指向它的链接** |
| `AI资料/` | **只收中译**;每篇必须在 `series.json` 里给 `sourceUrl` = 原文链接。*当前 64 篇里只有 6 篇正文带「来源/原文」行,其余需要补出原链;补不出的,那篇就不收* |
| 其余 | 收 |

## 6. 分类映射(建议,最终以你的裁定为准)

| 源目录 | 建议 categorySlug | 建议 series slug |
|---|---|---|
| `Pi/` | `deep-dive` | `pi` |
| `Claude Code Harness/` | `deep-dive` | `claude-code-harness` |
| `Codex Harness/` | `deep-dive` | `codex-harness` |
| `DeepSeek Harness/` | `deep-dive` | `deepseek-harness` |
| `Harness Engineering/` | `engineering` | `harness-engineering` |
| `Rust深度教程/` | `engineering` | `rust-deep-dive` |
| `TypeScript深度教程/` | `engineering` | `typescript-deep-dive` |
| `AI native软件工程教程/` | `engineering` | `ai-native-engineering` |
| `Agent基础知识/` | `pm` | 见 §1 的 A/B 选择;A 方案下每个阶段一个 slug,如 `agent-basics-s01` … |
| `AI资料/` | `frontier` | `ai-frontier`(或按子目录再分系列) |

## 7. 配图

| 项 | 要求 |
|---|---|
| 格式 | **WebP**(统一转)。允许 webp / png / jpeg / gif;**SVG 永不接受**(可执行文档,同源存储型 XSS) |
| 尺寸 | 宽度压到 **≤1600px**(R5 管线口径) |
| 单张大小 | **≤4 MiB**;转 WebP 后应远低于此 |
| 文件名 | **全小写**,匹配 `^[a-z0-9][a-z0-9._-]{0,95}$`。推荐 `<内容 sha256 前 16 位>.webp`。**大写扩展名会在线上 404** —— Caddy 与 next dev 的分流 matcher 都只认小写 |
| 扩展名 ↔ contentType | 必须自洽(`.webp`↔`image/webp` 等),否则上传被拒 |
| 正文引用 | `![alt](/notes/<系列slug>/<文件名>)` |
| 放置 | `<系列slug>/assets/` 下,不按章节再分子目录(文件名已是全局唯一的哈希) |

*当前导出:55 张 PNG(共 77.3 MB,最大 1.84 MB)+ 1 张 JPG,**全部要转 WebP 并改名**。*
另有 **48 处 http 外链图片**——保留外链还是下载本地化,请裁定(保留则境内可达性自负;
本地化则并入上面的流程)。

## 8. 交付前自检清单

逐条跑一遍,全绿再发:

- [ ] 每个系列目录名 = `series.json` 的 `slug`,且匹配 `^[a-z0-9][a-z0-9-]{0,63}$`
- [ ] `categorySlug` 只出现 `pm` / `deep-dive` / `engineering` / `frontier` 四个值
- [ ] 每篇 `.md` 在 `series.json` 的 `chapters` 里有且只有一条;`file` 指向存在的文件
- [ ] 系列内 `slug` 不重复、`ordinal` 不重复;`pinned: true` 的至多一条且 `ordinal: 0`
- [ ] 全库 `grep -c '\[\['` = 0(无 wikilink)
- [ ] 没有任何 `.md` 以 `---` 开头(无 frontmatter)
- [ ] 没有任何 `.md` 的第一个非空行是与 `series.json` 里 `title` 相同的 `# 一级标题`(会重复渲染)
- [ ] 全库图片引用要么 `/notes/<系列slug>/…`,要么 `http(s)://`;**零条相对路径**
- [ ] 全库非图片链接:无指向导出包内文件的相对路径
- [ ] 无「非空行紧跟 `---`」(围栏内不算)
- [ ] `assets/` 下全是 WebP、文件名全小写、单张 ≤4 MiB,且每一张都被至少一篇正文引用
- [ ] 正文里引用的每一个 `/notes/<系列slug>/<文件名>` 都能在对应 `assets/` 里找到
- [ ] `AI资料` 系的每篇都有 `sourceUrl`
- [ ] `内容分享/`、`原始资料/` 已从交付包移除

## 9. 满足之后怎么发布

发布走 MCP 管理面(`/api/mcp`,R6),顺序固定:

1. `notes_category_upsert` × 4(四个固定分类,只需一次)
2. 每个系列:`notes_series_upsert` → `notes_asset_put`(该系列全部配图)→ `notes_chapter_upsert`(逐篇)
3. 配图必须**先于**引用它的章节上传,否则文章上线后有一段破图窗口

`notes_chapter_upsert` 幂等:内容与库内完全一致时整行不动、不刷新 `updatedAt`,RSS 不会假装有更新。
重跑安全。
