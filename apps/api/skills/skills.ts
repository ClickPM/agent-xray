// R-SKILLS:Skills 技能库查询端点(设计稿画板 2f 首页 / 2g–2h 详情页)。
//
// 内容由所有者经 **MCP 管理面**的 `skills_*` 工具整包发布(`apps/api/mcp/`);
// 本服务只读。前端 `apps/web/app/(site)/skills/` 是 Server Component,经生成客户端调用这里。
//
// **文件一律当文本返回**(docs/security.md §4 R-SKILLS 补记):这里不解析、不执行、不 import
// 任何文件内容,markdown 也不在服务端渲染 —— 与 notes 正文同一口径(渲染在前端)。
import { api, APIError } from "encore.dev/api";
import { SKILL_NAME_RE, type SkillFileKind } from "../shared/skill-pack";
import * as store from "./store";
import type { SkillSourceType } from "./store";

const toIso = (ms: number) => new Date(ms).toISOString();

function assertName(value: string): void {
  // 参数全部走占位符,这里挡的是"脏 name 打到库上做无谓查询"与错误信息里的回显
  if (!SKILL_NAME_RE.test(value)) throw APIError.invalidArgument("name 不是合法的 skill 名");
}

// ───────────────────── 首页:分类 × skill 卡 ─────────────────────

export interface SkillCard {
  /** 目录名 = URL 段 /skills/<name> */
  name: string;
  /** 一句话中文描述 */
  summary: string;
  /** own = 自研(徽标蓝、出处 @owner);curated = 精选第三方(徽标灰、出处 owner/repo) */
  sourceType: SkillSourceType;
  /** `owner/repo`;安装命令 `npx skills add <repo> --skill <name>` 由前端据此派生 */
  repo: string;
  /** GitHub 目录外链;null = 所有者没给(前端不渲染外链) */
  repoUrl: string | null;
  fileCount: number;
  /** ISO 8601 */
  updatedAt: string;
}

export interface SkillCategoryGroup {
  slug: string;
  name: string;
  /** 分类圆点色,与 design token 一致 */
  dot: string;
  skills: SkillCard[];
}

export interface LatestSkill {
  name: string;
  updatedAt: string;
}

export interface ListSkillsResponse {
  /** 只含有 skill 的分类;顺序按分类 sort_order、组内按 skill sort_order */
  categories: SkillCategoryGroup[];
  /** 全站 skill 总数(页脚「共 N 个 skill」) */
  total: number;
  /** 页脚「最近更新」;没有 skill 时为 null */
  latest: LatestSkill | null;
}

export const listSkills = api(
  {
    expose: true,
    method: "GET", path: "/skills",
    // 【R-VISITOR】访客 cookie 的 Path 是 `/`,浏览器**直接访问这条路径时会把它一并带来**
    // (哪怕本端点根本不看它)。不设 sensitive 的话,一个可冒充身份的凭据会进 trace。
    // 口径见 shared/visitor-cookie.ts 的「Path=/ 的连带义务」与 docs/security.md §6。
    sensitive: true,
  },

  async (): Promise<ListSkillsResponse> => {
    const rows = await store.listSkillCards();
    const groups: SkillCategoryGroup[] = [];
    for (const r of rows) {
      let g = groups.find((x) => x.slug === r.categorySlug);
      if (!g) groups.push((g = { slug: r.categorySlug, name: r.categoryName, dot: r.dot, skills: [] }));
      g.skills.push({
        name: r.name,
        summary: r.summary,
        sourceType: r.sourceType,
        repo: r.repo,
        repoUrl: r.repoUrl,
        fileCount: r.fileCount,
        updatedAt: toIso(r.updatedAt),
      });
    }
    const latest = await store.latestSkill();
    return {
      categories: groups,
      total: rows.length,
      latest: latest ? { name: latest.name, updatedAt: toIso(latest.updatedAt) } : null,
    };
  },
);

// ───────────────────── 详情:元信息 + 全部文件 ─────────────────────

export interface SkillFile {
  /** 目录内相对路径,如 `SKILL.md` / `scripts/review.py` */
  path: string;
  /** 由扩展名派生的闭集;前端据此选渲染方式(markdown 渲染 / 代码带行号) */
  kind: SkillFileKind;
  /** 原文。前端当纯文本处理,永不执行 */
  content: string;
  sizeBytes: number;
  lineCount: number;
}

export interface GetSkillResponse {
  name: string;
  categorySlug: string;
  categoryName: string;
  summary: string;
  sourceType: SkillSourceType;
  repo: string;
  repoUrl: string | null;
  /** 版本展示文本(`1.2` → 画板上的 `v1.2`);null = 不显示 */
  version: string | null;
  fileCount: number;
  /** 全部文件的 UTF-8 字节数之和 */
  totalBytes: number;
  /** `/skills/<name>.zip` 的字节数(画板 2g 的「下载 zip · N KB」) */
  zipSize: number;
  updatedAt: string;
  /** SKILL.md 首位,其余按路径;整包 <= 512 KB,一次取完、文件切换不打后端 */
  files: SkillFile[];
}

export const getSkill = api(
  {
    expose: true,
    method: "GET", path: "/skills/:name",
    // 【R-VISITOR】同上:访客 cookie 会随浏览器直接访问一并带来,不设 sensitive 会进 trace。
    sensitive: true,
  },

  async ({ name }: { name: string }): Promise<GetSkillResponse> => {
    assertName(name);
    const skill = await store.getSkill(name);
    if (!skill) throw APIError.notFound(`skill ${name} 不存在`);
    const files = await store.listSkillFiles(name);
    return {
      name: skill.name,
      categorySlug: skill.categorySlug,
      categoryName: skill.categoryName,
      summary: skill.summary,
      sourceType: skill.sourceType,
      repo: skill.repo,
      repoUrl: skill.repoUrl,
      version: skill.version,
      fileCount: files.length,
      totalBytes: files.reduce((a, f) => a + f.sizeBytes, 0),
      zipSize: skill.zipSize,
      updatedAt: toIso(skill.updatedAt),
      files,
    };
  },
);
