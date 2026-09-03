// SKILL.md 开头 `---` 围起来的 frontmatter → 画板 2g 的键值块(R-SKILLS)。
//
// **只切 `key: value` 行,不引 yaml 库**(所有者裁定的交付清单):skill 的 frontmatter 只有
// name / description / when_to_use 这几种扁平键。折叠块(`key: >-` 后接缩进的续行)按
// 「续行并进上一个值」处理,读起来是一段话;更复杂的 yaml(嵌套 / 列表)不在本站的用例里,
// 出现了就原样显示成文本,不会炸。
//
// 与服务端 `apps/api/shared/skill-pack.ts` 的 frontmatterName 是同一种形状判断
// (web 与 api 不共享源码,规则 6),两边都只认「文档第一行是 ---」这一种开头。

export interface FrontmatterEntry {
  key: string;
  value: string;
}

export interface SplitMarkdown {
  /** 没有 frontmatter 时为空数组 */
  entries: FrontmatterEntry[];
  /** frontmatter 之后的正文;没有 frontmatter 时就是全文 */
  body: string;
}

const KEY_LINE = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/;
/** yaml 的块标量指示符:`>` / `>-` / `|` / `|-` 等,值本身在后面的缩进行里 */
const BLOCK_INDICATOR = /^[>|][+-]?$/;

export function splitFrontmatter(md: string): SplitMarkdown {
  const lines = md.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { entries: [], body: md };
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      close = i;
      break;
    }
  }
  if (close < 0) return { entries: [], body: md };

  const entries: FrontmatterEntry[] = [];
  for (const line of lines.slice(1, close)) {
    const m = KEY_LINE.exec(line);
    if (m && !/^\s/.test(line)) {
      const raw = m[2].trim();
      entries.push({ key: m[1], value: BLOCK_INDICATOR.test(raw) ? "" : unquote(raw) });
      continue;
    }
    // 缩进的续行:并进上一个值(折叠块按空格接,读起来是一段话)
    const last = entries[entries.length - 1];
    if (last && line.trim() !== "") last.value = last.value ? `${last.value} ${line.trim()}` : line.trim();
  }
  return { entries, body: lines.slice(close + 1).join("\n") };
}

function unquote(v: string): string {
  return v.replace(/^(['"])(.*)\1$/, "$2");
}
