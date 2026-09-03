// R-SKILLS-2:pi 侧注入扩展 `xray-skills`(要求 ①⑥)。
//
// 只订阅 `before_agent_start`:把本会话可用 skill 的目录以 `<available_skills>` 追加到本轮系统提示词末尾,
// 返回 `{ systemPrompt }`。pi 对多个扩展返回的 systemPrompt 是链式叠加、下一轮无人返回就回到 base
// (rounds/round-skills/research.md 附 A-3),所以每轮注入、幂等。
//
// 【为什么不直接写进 runtime.ts 的 systemPromptFor】那样「注入」这件事在轨迹里不存在。放在 chain 事件里,
// 每一轮的 `before_agent_start` 行都能展开看到「xray-skills 返回了什么」—— 画板 1b 那张 `context-injector` 卡,
// 也是 Chain View(1c)的步骤列表来源。派生字段 `handlers` 只放摘要(systemPromptDelta + skill 名),不放提示词原文。
//
// 【谁裁决,谁记录】与 guard.ts 同理:观测者不再订阅 `before_agent_start`,由本扩展调 `capture(...)`。
// 【不做的事】不 registerCommand、不读 process.env、不碰库;目录里只有名字 / 描述 / 档次,没有正文
// (正文由 skill_load 按需送进上下文,几千字的 SKILL.md 不该每轮都占 token)。
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { safeErrorText } from "../shared/redact";
import type { CaptureFn, NamedExtension } from "./guard";
import type { AgentSkill, AvailableSkills } from "./skills-catalog";
import { SKILL_LOAD_TOOL, SKILL_RUN_TOOL } from "./tool-names";

export const SKILLS_EXTENSION = "xray-skills";

export interface SkillInjectorContext {
  skills: AvailableSkills;
  /** 本会话注册了 skill_load(注入的目录才有意义) */
  canLoad: boolean;
  /** 本会话注册了 skill_run(目录里才列脚本) */
  canRun: boolean;
}

/**
 * `<available_skills>` 目录文本。纯函数,导出给测试与系统提示词的说明段引用。
 * 空集合回空串(调用方据此不注入)。
 */
export function renderAvailableSkills(skills: readonly AgentSkill[], opts: { canLoad: boolean; canRun: boolean }): string {
  if (skills.length === 0 || (!opts.canLoad && !opts.canRun)) return "";
  const lines: string[] = ["<available_skills>"];
  lines.push(
    "以下是本站对你开放的 skills(每个 skill 是一份 SKILL.md 说明,可能附带可运行脚本)。" +
      (opts.canLoad ? `用 ${SKILL_LOAD_TOOL}(name) 读取完整说明后再照着做;` : "") +
      (opts.canRun
        ? `脚本只能经 ${SKILL_RUN_TOOL}(skill, script, input) 在隔离容器里运行,且只能运行下面列出的脚本。`
        : "本会话不能运行脚本。"),
  );
  for (const s of skills) {
    lines.push(`- ${s.name}: ${s.description}`);
    if (opts.canRun) {
      for (const x of s.scripts) lines.push(`  · script ${x.file} — ${x.description}`);
    }
  }
  lines.push("</available_skills>");
  return lines.join("\n");
}

export function makeSkillInjector(ctx: SkillInjectorContext, capture: CaptureFn): NamedExtension {
  const block = renderAvailableSkills(ctx.skills.skills, { canLoad: ctx.canLoad, canRun: ctx.canRun });
  const names = ctx.skills.skills.map((s) => s.name);
  return {
    name: SKILLS_EXTENSION,
    factory: (pi: ExtensionAPI) => {
      pi.on("before_agent_start", (event) => {
        // 空集合:不注入,handlers 记 returned: undefined(验收 ⑧)
        const result = block ? { systemPrompt: `${event.systemPrompt}\n\n${block}` } : undefined;
        try {
          capture("before_agent_start", event, [
            {
              extension: SKILLS_EXTENSION,
              returned: result ? { systemPromptDelta: block.length + 2, skills: names } : undefined,
            },
          ]);
        } catch (err) {
          console.error(`${SKILLS_EXTENSION} capture failed: ${safeErrorText(err)}`);
        }
        return result;
      });
    },
  };
}
