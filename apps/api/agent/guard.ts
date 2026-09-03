// R-SKILLS-2:pi 侧守卫扩展 `xray-guard`(要求 ③;docs/security.md §1 R-SKILLS-2 补记末段)。
//
// 【它是第二道,不是第一道】工具体(tools.ts 的 skill_load / skill_run)与执行容器(runner.py)各自还会校验一遍;
// 守卫的价值在**策略与可见性**:裁决作为派生字段 `handlers` 写进 `tool_call` 事件,右栏 Timeline 因此能画出
// 红色 `blocked` 徽标与「└ xray-guard returned {block: true}」注记(画板 1a 第 1043 行)。它不承担隔离。
//
// 【谁裁决,谁记录】pi 对 `tool_call` 的多 handler 是短路语义:排在前面的 handler 一旦 `block`,后面的看不到事件
// (rounds/round-skills/research.md 附 A-2)。观测者要么看不到裁决、要么看不到事件,所以观测者不再订阅
// `tool_call`,由守卫自己调 `capture(...)` 把事件与裁决一起落笔。
//
// 【五条规则按序判,首条命中即 {block:true, reason}】
//   1. toolName 不在本会话白名单 → 拦(pi 自己也会拒,这是第二道);
//   2. skill_load / skill_run 的 skill 不在本会话可用集合 → 拦;
//   3. skill_run:script 不在 xray.json / input 不是 JSON 对象 / 不过 schema / 超长 / 含控制字符 → 拦,reason 写清哪一项;
//   4. skill_run 会话内计数:每 turn ≤ MAX_RUNS_PER_TURN、每会话 ≤ MAX_RUNS_PER_SESSION → 拦,文案带「不必重试」;
//   5. 守卫自身抛异常 = 拦截(fail closed):pi 对 handler 异常的处理会把栈信息外泄进错误文案,所以自己兜。
//
// 【不做的事】不 registerCommand(访客输入以 `/` 开头会被 pi 当命令分发,附 A-4)、不读 process.env、不碰库、
// 不 ctx.ui.notify(headless)。`reason` 里只出现工具名 / skill 名 / 字段名与上下界 —— 不含任何内部路径与配置值。
import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import { safeErrorText } from "../shared/redact";
import { findScript, findSkill, validateSkillInput, type AvailableSkills } from "./skills-catalog";
import { SKILL_LOAD_TOOL, SKILL_RUN_TOOL } from "./tool-names";

export const GUARD_EXTENSION = "xray-guard";

/** 每个 turn 里 skill_run 的上限(代码常量,不进配置面) */
export const MAX_RUNS_PER_TURN = 3;
/** 每个会话(pi 会话实例的生命周期)里 skill_run 的上限 */
export const MAX_RUNS_PER_SESSION = 12;

/** 守卫自身异常时的固定 reason:不带异常原文 */
const GUARD_FAILURE_REASON = "守卫检查失败,本次调用已被拦截;请不要重试同一调用,改用其它方式回答。";

/** 事件里的一条裁决记录(派生字段 `handlers` 的元素;events.ts 只放行这个形状) */
export interface HandlerRecord {
  extension: string;
  /** 该扩展返回了什么(摘要);undefined = 放行 / 未改写 */
  returned?: unknown;
}

/** 由 runtime.ts 提供:把事件 + 裁决落进轨迹(脱敏 → 待落库队列 → 总线) */
export type CaptureFn = (eventType: string, event: unknown, handlers: HandlerRecord[]) => void;

export interface GuardContext {
  /** 本会话注册的工具名(createAgentSession 的 `tools` 白名单) */
  toolNames: readonly string[];
  skills: AvailableSkills;
}

/** 会话内计数;`turn_start` 归零 turn 计数,会话重建即全部归零(不跨会话) */
export interface GuardCounters {
  turnRuns: number;
  sessionRuns: number;
}

export interface GuardDecision {
  block: true;
  reason: string;
}

/** 最多写进事件的 reason 长度(摘要,不放原文) */
const MAX_REASON_CHARS = 200;

/**
 * 纯函数的裁决:规则 1–4。返回 undefined = 放行。
 * 单独导出是为了让 guard.test.ts 逐条打,不用起 pi。
 */
export function decideToolCall(
  event: { toolName: unknown; input: unknown },
  ctx: GuardContext,
  counters: GuardCounters,
): GuardDecision | undefined {
  const toolName = typeof event.toolName === "string" ? event.toolName : "";
  // 1. 白名单
  if (!ctx.toolNames.includes(toolName)) {
    return { block: true, reason: `工具 ${toolName || "(未命名)"} 不在本会话的工具白名单里。` };
  }
  if (toolName !== SKILL_LOAD_TOOL && toolName !== SKILL_RUN_TOOL) return undefined;

  const input = (typeof event.input === "object" && event.input !== null ? event.input : {}) as Record<string, unknown>;
  // 2. skill 在可用集合里
  const skillName = toolName === SKILL_LOAD_TOOL ? input.name : input.skill;
  const skill = findSkill(ctx.skills, skillName);
  if (!skill) {
    const shown = typeof skillName === "string" ? skillName.slice(0, 64) : "(未指定)";
    const list = ctx.skills.skills.map((s) => s.name).join(" / ") || "(无)";
    return { block: true, reason: `skill ${shown} 未对 agent 开放;当前可用:${list}。` };
  }
  if (toolName === SKILL_LOAD_TOOL) return undefined;

  // 3. script 在 xray.json 里、input 过 schema
  const script = findScript(skill, input.script);
  if (!script) {
    const shown = typeof input.script === "string" ? input.script.slice(0, 64) : "(未指定)";
    const list = skill.scripts.map((s) => s.file).join(" / ") || "(该 skill 没有可运行脚本)";
    return { block: true, reason: `脚本 ${shown} 不在 ${skill.name} 的可运行清单里;可运行:${list}。` };
  }
  const checked = validateSkillInput(script.input, input.input);
  if (!checked.ok) return { block: true, reason: checked.reason };

  // 4. 会话内计数(只数通过了前三条的 skill_run)
  if (counters.turnRuns >= MAX_RUNS_PER_TURN) {
    return { block: true, reason: `本轮已运行 ${MAX_RUNS_PER_TURN} 次脚本,达到上限;不必重试,请基于已有结果回答。` };
  }
  if (counters.sessionRuns >= MAX_RUNS_PER_SESSION) {
    return { block: true, reason: `本会话已运行 ${MAX_RUNS_PER_SESSION} 次脚本,达到上限;不必重试,请基于已有结果回答。` };
  }
  counters.turnRuns += 1;
  counters.sessionRuns += 1;
  return undefined;
}

function summarize(decision: GuardDecision | undefined): unknown {
  if (!decision) return undefined;
  return { block: true, reason: decision.reason.slice(0, MAX_REASON_CHARS) };
}

/**
 * 守卫扩展。与 `makeObserver` 同款的 InlineExtension,拿着本会话的上下文闭包;永远注册(不随 skills 开关)。
 * 注册顺序由 runtime.ts 决定:[xray-skills, xray-observer, xray-guard]。
 */
export function makeGuard(ctx: GuardContext, capture: CaptureFn): InlineExtension {
  const counters: GuardCounters = { turnRuns: 0, sessionRuns: 0 };
  return {
    name: GUARD_EXTENSION,
    factory: (pi: ExtensionAPI) => {
      pi.on("turn_start", () => {
        counters.turnRuns = 0;
        return undefined;
      });
      pi.on("tool_call", (event) => {
        let decision: GuardDecision | undefined;
        try {
          decision = decideToolCall(event, ctx, counters);
        } catch (err) {
          // 规则 5:异常即拦截。原因只进服务端日志(过 safeErrorText),reason 是固定文案
          console.error(`${GUARD_EXTENSION} failed, blocking ${String(event.toolName)}: ${safeErrorText(err)}`);
          decision = { block: true, reason: GUARD_FAILURE_REASON };
        }
        try {
          capture("tool_call", event, [{ extension: GUARD_EXTENSION, returned: summarize(decision) }]);
        } catch (err) {
          console.error(`${GUARD_EXTENSION} capture failed: ${safeErrorText(err)}`);
        }
        return decision;
      });
    },
  };
}
