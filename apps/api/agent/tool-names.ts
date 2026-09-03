// R-SKILLS-2 两个工具的名字常量。
//
// 单独一个文件是为了让 guard.ts / skill-injector.ts 能引用名字而**不 import tools.ts**:
// tools.ts 反过来要 import skills-catalog.ts,而守卫又 import skills-catalog.ts —— 名字放在 tools.ts 里
// 就是一个 tools → skills-catalog ← guard → tools 的环。名字是常量,没有理由带着整个工具实现一起被拉进来。
export const SKILL_LOAD_TOOL = "skill_load";
export const SKILL_RUN_TOOL = "skill_run";
