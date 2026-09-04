// agent 可用 skills 的清单类型与一致性判据(R-SKILLS-2;所有者裁定 6「可用集合在代码里」)。
//
// 生成物 `skills.generated.ts`(tools/skills-manifest 从 runner/skills 生成)长成这里的 `GeneratedSkill`;
// 两个服务都要用它:agent(注册环节算可用集合、工具体校验入参)与 mcp(`skills_agent_status` 报一致性)。
// 两个面刻意不互相 import(docs/security.md §4),所以类型与判据落在 shared/ —— 与 skill-pack.ts 同一个安排。
//
// 【本文件不碰文件系统、不执行任何内容】输入是字符串与哈希,输出是判定。
import { createHash } from "node:crypto";

/**
 * 出网档次(闭集):`none` = 默认实例 `skill-runner`(network_mode: none);`egress` = R-WEBFETCH 的第二个实例
 * `skill-runner-egress`(只出公网、不在 front / back)。api 按它选运行器,两个实例各自拒绝不属于自己档次的 skill。
 */
export const SKILL_NETWORKS = ["none", "egress"] as const;
export type SkillNetwork = (typeof SKILL_NETWORKS)[number];

/** 脚本入参 schema 的子集:与 agent/tools.ts 的 ToolParametersSchema 同形,多一个 boolean。 */
export interface SkillInputParam {
  type: "string" | "integer" | "boolean";
  description: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
}

export interface SkillInputSchema {
  type: "object";
  properties: Record<string, SkillInputParam>;
  required: string[];
  additionalProperties: false;
}

export interface GeneratedSkillScript {
  /** `scripts/` 下的文件名(闭集的键);模型给 skill_run 的 `script` 就是它 */
  file: string;
  sha256: string;
  description: string;
  input: SkillInputSchema;
}

export interface GeneratedSkillFile {
  path: string;
  sha256: string;
}

export interface GeneratedSkill {
  name: string;
  /** SKILL.md frontmatter 的 description(单行);进 `<available_skills>` 目录 */
  description: string;
  network: SkillNetwork;
  /** SKILL.md 去掉 frontmatter 之后的正文;skill_load 的输出 */
  body: string;
  /** 目录里每个文件的 sha256(码点序);「展示副本 == 代码副本」按它逐一比 */
  files: GeneratedSkillFile[];
  /** 可运行的脚本(空 = 注入型) */
  scripts: GeneratedSkillScript[];
}

/** 库内展示副本(skill_files)的一致性判定结果 */
export type SkillConsistency = "ok" | "drift";

export interface SkillDrift {
  status: SkillConsistency;
  /** 代码里有、库里没有 */
  missing: string[];
  /** 库里有、代码里没有 */
  extra: string[];
  /** 两边都有但哈希不等 */
  changed: string[];
}

/** 文本 → sha256(hex),口径 = 文件字节(UTF-8)的哈希,与生成器对磁盘文件的算法相同 */
export function sha256Utf8(content: string): string {
  return createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex");
}

/**
 * 逐文件比对:集合相等且每个哈希相等才是 `ok`,多一个少一个改一字节都是 `drift`
 * (所有者裁定 6:访客在 Skills 页看到的,就是 agent 用的)。
 */
export function compareSkillFiles(
  code: readonly GeneratedSkillFile[],
  library: readonly GeneratedSkillFile[],
): SkillDrift {
  const codeMap = new Map(code.map((f) => [f.path, f.sha256]));
  const libMap = new Map(library.map((f) => [f.path, f.sha256]));
  const missing: string[] = [];
  const changed: string[] = [];
  const extra: string[] = [];
  for (const [path, sha] of codeMap) {
    const other = libMap.get(path);
    if (other === undefined) missing.push(path);
    else if (other !== sha) changed.push(path);
  }
  for (const path of libMap.keys()) if (!codeMap.has(path)) extra.push(path);
  const status: SkillConsistency = missing.length + changed.length + extra.length === 0 ? "ok" : "drift";
  return { status, missing: missing.sort(), extra: extra.sort(), changed: changed.sort() };
}

/** 一个 skill 在代码里的整体指纹(名字 + 每文件哈希),给注册环节的指纹拼接用 */
export function skillCodeFingerprint(skill: GeneratedSkill): string {
  const h = createHash("sha256");
  h.update(skill.name);
  h.update("\n");
  h.update(skill.network);
  for (const f of skill.files) {
    h.update("\n");
    h.update(f.path);
    h.update("=");
    h.update(f.sha256);
  }
  return h.digest("hex");
}
