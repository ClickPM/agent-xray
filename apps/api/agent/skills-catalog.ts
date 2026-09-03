// R-SKILLS-2:本次会话「agent 可用的 skill 集合」的判定 + `skill_run` 入参的校验(docs/security.md §1 R-SKILLS-2 补记第 1 / 2 条)。
//
// 一个 skill 对 agent 可用,四个条件同时成立(所有者裁定 5 / 6;rounds/round-skills/research.md §2.2):
//   1. **在代码里**:`shared/skills.generated.ts`(由 runner/skills 生成)有它;
//   2. **库里已发布且打开**:R-SKILLS 1.0 的 `skills` 表有同名行且 `agent_enabled = TRUE`(默认 FALSE);
//   3. **展示副本与代码副本一致**:`skill_files` 每个文件的 sha256 与清单逐一相等(多一个少一个改一字节都是漂移);
//   4. 工具闸开着 —— 这一条不在本文件判,在 tools.ts 的 loadEnabledTools(它决定要不要调 `loadAgentSkills`)。
//
// 【读库发生在注册环节,不在工具体内】`loadAgentSkills` 用的是全权连接(与 loadEnabledTools 读 tool_config 同一位置);
// 三张 skills 表对 agent_ro / agent_title / agent_image 仍无任何权限(迁移 012 / 013)。工具体拿到的是这里算好的
// `AvailableSkills` 常量,不再碰库。
//
// 【入参校验是纯函数】`validateSkillInput` 同时被工具体与守卫扩展(guard.ts)调用 —— 「工具体与守卫各校一遍」
// 是与外呼组「写入时一次、调用前一次」同一取舍;两处调的是同一个实现,不会各写一遍然后漂移。
import { AGENT_SKILLS } from "../shared/skills.generated";
import {
  compareSkillFiles,
  skillCodeFingerprint,
  type GeneratedSkill,
  type GeneratedSkillScript,
  type SkillInputSchema,
} from "../shared/skill-manifest";
import { db } from "./db";

export type AgentSkill = GeneratedSkill;

export interface AvailableSkills {
  /** 本次可用的 skill(四个条件全真),按名字排序 */
  skills: AgentSkill[];
  /** 名字 + 代码指纹;并进 EnabledTools.fingerprint,集合或内容变了会话下一轮重建 */
  fingerprint: string;
  /** 代码里有、但这次没进集合的 skill 与原因(记日志用;不进任何对外响应) */
  dropped: string[];
}

/** 模型给 `skill_run.input` 的最大字符数(JSON 文本) */
export const MAX_SKILL_INPUT_CHARS = 4_096;

export function emptySkills(): AvailableSkills {
  return { skills: [], fingerprint: "-", dropped: [] };
}

interface LibraryRow {
  name: string;
  agentEnabled: boolean;
}

interface FileHashRow {
  skillName: string;
  path: string;
  sha256: string;
}

/**
 * 算本次可用集合。只查代码清单里那几个名字,哈希在 SQL 侧算(`sha256(convert_to(content,'UTF8'))`,
 * PG ≥ 11),不把整包正文拉回进程 —— 它在每一轮的 refreshRuntimeConfig 路径上被调。
 */
export async function loadAgentSkills(): Promise<AvailableSkills> {
  if (AGENT_SKILLS.length === 0) return emptySkills();
  const names = AGENT_SKILLS.map((s) => s.name);
  const placeholders = names.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await db.rawQueryAll<LibraryRow>(
    `SELECT name, agent_enabled AS "agentEnabled" FROM skills WHERE name IN (${placeholders})`,
    ...names,
  );
  const enabled = rows.filter((r) => r.agentEnabled).map((r) => r.name);
  const inLibrary = new Set(rows.map((r) => r.name));

  const hashes = new Map<string, { path: string; sha256: string }[]>();
  if (enabled.length > 0) {
    const ph = enabled.map((_, i) => `$${i + 1}`).join(", ");
    const files = await db.rawQueryAll<FileHashRow>(
      `SELECT skill_name AS "skillName", path,
              encode(sha256(convert_to(content, 'UTF8')), 'hex') AS sha256
         FROM skill_files WHERE skill_name IN (${ph})`,
      ...enabled,
    );
    for (const f of files) {
      const list = hashes.get(f.skillName) ?? [];
      list.push({ path: f.path, sha256: f.sha256 });
      hashes.set(f.skillName, list);
    }
  }

  const skills: AgentSkill[] = [];
  const dropped: string[] = [];
  for (const s of AGENT_SKILLS) {
    if (!inLibrary.has(s.name)) {
      dropped.push(`${s.name}(库里没有)`);
      continue;
    }
    if (!enabled.includes(s.name)) {
      dropped.push(`${s.name}(agent_enabled=false)`);
      continue;
    }
    const drift = compareSkillFiles(s.files, hashes.get(s.name) ?? []);
    if (drift.status === "drift") {
      dropped.push(
        `${s.name}(drift:${[
          drift.missing.length ? `missing ${drift.missing.join("|")}` : "",
          drift.extra.length ? `extra ${drift.extra.join("|")}` : "",
          drift.changed.length ? `changed ${drift.changed.join("|")}` : "",
        ]
          .filter(Boolean)
          .join(", ")})`,
      );
      continue;
    }
    if (s.network !== "none") {
      // 本轮只有 none 档的运行器;egress 档由 R-WEBFETCH 接第二个客户端
      dropped.push(`${s.name}(network=${s.network},本轮无对应运行器)`);
      continue;
    }
    skills.push(s);
  }
  skills.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return {
    skills,
    fingerprint: skills.length ? skills.map((s) => `${s.name}:${skillCodeFingerprint(s).slice(0, 16)}`).join(",") : "-",
    dropped,
  };
}

export function findSkill(available: AvailableSkills, name: unknown): AgentSkill | undefined {
  if (typeof name !== "string") return undefined;
  return available.skills.find((s) => s.name === name);
}

export function findScript(skill: AgentSkill, script: unknown): GeneratedSkillScript | undefined {
  if (typeof script !== "string") return undefined;
  return skill.scripts.find((s) => s.file === script);
}

export type InputCheck =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: string };

/** NUL 写成 fromCharCode：字面量会被编辑器 / 管道吞掉，也会让 grep 把本文件判成二进制（.gitattributes 那段注释） */
const NUL = String.fromCharCode(0);

/** C0 控制字符(除 \t \n \r)与 DEL:JSON 文本里不该裸出现;出现了就是有人在试探解析器 */
function hasBadControl(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x7f) return true;
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) return true;
  }
  return false;
}

/**
 * `skill_run.input`(JSON 文本)→ 已过 schema 的对象。**失败理由写给模型看**:说清哪一项、怎么改。
 * 理由里只出现字段名、类型与上下界 —— 这些本来就在工具目录里,不是配置面。
 */
export function validateSkillInput(schema: SkillInputSchema, raw: unknown): InputCheck {
  if (typeof raw !== "string") return { ok: false, reason: "input 必须是一段 JSON 对象文本" };
  if (raw.length > MAX_SKILL_INPUT_CHARS) {
    return { ok: false, reason: `input 超过 ${MAX_SKILL_INPUT_CHARS} 字符,请精简` };
  }
  if (hasBadControl(raw)) return { ok: false, reason: "input 含控制字符,请只传 JSON 文本" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "input 不是合法 JSON;请传一个 JSON 对象文本,如 {\"text\": \"…\"}" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: "input 必须是 JSON 对象(不是数组或标量)" };
  }
  const obj = parsed as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (!Object.hasOwn(schema.properties, key)) {
      return { ok: false, reason: `input 里有未声明的字段 ${key};只接受 ${Object.keys(schema.properties).join(" / ")}` };
    }
  }
  for (const [key, p] of Object.entries(schema.properties)) {
    const v = obj[key];
    if (v === undefined) {
      if (schema.required.includes(key)) return { ok: false, reason: `input 缺少必填字段 ${key}` };
      continue;
    }
    if (p.type === "string") {
      if (typeof v !== "string") return { ok: false, reason: `字段 ${key} 必须是字符串` };
      if (v.includes(NUL)) return { ok: false, reason: `字段 ${key} 含 NUL 字符` };
      if (p.minLength !== undefined && v.length < p.minLength) {
        return { ok: false, reason: `字段 ${key} 至少 ${p.minLength} 个字符` };
      }
      if (p.maxLength !== undefined && v.length > p.maxLength) {
        return { ok: false, reason: `字段 ${key} 超过 ${p.maxLength} 个字符` };
      }
      out[key] = v;
    } else if (p.type === "integer") {
      if (typeof v !== "number" || !Number.isInteger(v)) return { ok: false, reason: `字段 ${key} 必须是整数` };
      if (p.minimum !== undefined && v < p.minimum) return { ok: false, reason: `字段 ${key} 不能小于 ${p.minimum}` };
      if (p.maximum !== undefined && v > p.maximum) return { ok: false, reason: `字段 ${key} 不能大于 ${p.maximum}` };
      out[key] = v;
    } else {
      if (typeof v !== "boolean") return { ok: false, reason: `字段 ${key} 必须是 true / false` };
      out[key] = v;
    }
  }
  return { ok: true, value: out };
}
