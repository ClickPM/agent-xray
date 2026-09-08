// R-CROSSLINK C3(画板 2r / 4x):Notes 章节页 →  Runtime 的「在 Runtime 里聊这一章」。
//
// 【为什么是通用模板,不给章节加「示例提问」字段】任务卡裁定 4 / 派生取舍 3:
// 加字段要动 `notes_chapter_upsert` + 一条迁移 + `docs/mcp.md`,而模板这一句已经能落地 ——
// 模型手里有 `notes_get_chapter`,给它系列 / 标题 / slug 路径就够它读到这一章。
// 更好的逐章提问是备选方案,要所有者另行裁定。
//
// 【模板里只放章节页拿得到的字段】系列名 / 章节标题 / slug 路径;不塞字数与更新时间
// (画板 2r 注释)——那两个数对「聊这一章」没用,只会让预填的句子更长。
import { MAX_PREFILL } from "./ask-why";

export interface ChapterRef {
  seriesName: string;
  title: string;
  seriesSlug: string;
  chapterSlug: string;
}

/**
 * 单个字段的长度上限。
 *
 * 不是防御姿态:章节标题由所有者经 MCP 写入,理论上不会离谱。但整句要落进
 * `?ask=`,而读取侧超过 `MAX_PREFILL` 是**整段丢弃**(ask-why.ts)——
 * 与其让一个超长标题把整个入口变成哑链接,不如在这里把它收住。
 */
const FIELD_MAX = 160;

const clip = (s: string, max = FIELD_MAX) => {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max)}…` : t;
};

/**
 * 章节 → 预填文本。与 `askWhyText` 一样:**放进输入框,访客自己按发送**。
 *
 * 句子里点名 `notes_get_chapter` 是有意的:章节正文不在预填里(那会是几千字),
 * 模型得自己去读。给出 slug 路径正是为了这一步 —— 工具的两个入参就是这两个 slug。
 */
export function tryInRuntimeText(ref: ChapterRef): string {
  const path = `/notes/${ref.seriesSlug}/${ref.chapterSlug}`;
  return (
    `我在读本站教程《${clip(ref.seriesName)} · ${clip(ref.title)}》(${clip(path)})。` +
    "请用 notes_get_chapter 读这一章,先用三句话概括核心观点,然后等我提问。"
  );
}

/**
 * 章节 → `/?ask=…` 链接。
 *
 * 拼出来仍超上限时回 `/` —— 入口照常存在、只是不带预填,好过给一条读取侧会整段丢弃的链接。
 * (`FIELD_MAX` 之下这一支实际到不了,留着是因为「上限在两处、判据只有一处」才是对的。)
 */
export function tryInRuntimeHref(ref: ChapterRef): string {
  const text = tryInRuntimeText(ref);
  if (text.length > MAX_PREFILL) return "/";
  return `/?ask=${encodeURIComponent(text)}`;
}
