// 打点路径的归一(R8)。
//
// 【为什么不能把客户端给的路径原样落库】`POST /t` 是**无认证的公开写入口**。
// 路径原样入库意味着任何人都能往 `visits` 里灌任意多条不同的行:表无界增长,
// 统计面被垃圾路径淹没。所以路径先按站内**已知路由形状**归一,归不出来的
// 一律折进常量桶 `/*` —— 行数上界从此由站内真实内容决定,而不是由请求方决定。
//
// 形状白名单来自设计稿的三个 Tab 与 Notes 三级页(design/README.md 画板 1a / 2a–2c / 2e),
// 与 `apps/web/app/(site)/` 的路由一一对应。新增页面时两处一起改,
// 漏改的表现不是报错,而是那个页面的访问全部记进 `/*`。
import { db } from "./db";

/** 归不出来的路径统一落这个桶。刻意用 `*`:它不是合法 slug,不可能与真实路径撞名。 */
export const OTHER_BUCKET = "/*";

/** 与 notes 服务、mcp 服务的 slug 口径一字不差(三处漂移会让页面列得出、点开 404)。 */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** 无需查库即可确认的静态路由。 */
const STATIC_PATHS = new Set(["/", "/notes", "/about"]);

type Shape =
  | { kind: "static"; path: string }
  | { kind: "series"; series: string }
  | { kind: "chapter"; series: string; chapter: string }
  | { kind: "other" };

/**
 * 纯函数部分:把路径归到一个形状。查询字符串与 hash 在这里被丢掉
 * —— 它们是访客可控的高基数输入,而站内没有任何一页靠 query 区分内容。
 */
export function classifyPath(raw: string): Shape {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 256) return { kind: "other" };
  // 只接受站内绝对路径。`//evil.com` 这类协议相对地址也在此被挡掉。
  if (!raw.startsWith("/") || raw.startsWith("//")) return { kind: "other" };

  let path = raw.split(/[?#]/, 1)[0];
  // 末尾斜杠归一:`/notes/` 与 `/notes` 是同一页,不该在统计里裂成两行
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (STATIC_PATHS.has(path)) return { kind: "static", path };

  const parts = path.split("/").slice(1);
  if (parts[0] !== "notes") return { kind: "other" };
  if (parts.length === 2 && SLUG_RE.test(parts[1])) return { kind: "series", series: parts[1] };
  if (parts.length === 3 && SLUG_RE.test(parts[1]) && SLUG_RE.test(parts[2])) {
    return { kind: "chapter", series: parts[1], chapter: parts[2] };
  }
  return { kind: "other" };
}

/**
 * 归一 + **库内存在性校验**。
 *
 * 光有形状白名单还挡不住灌库:`/notes/aaaa`、`/notes/aaab`… 全都是合法形状。
 * 所以系列页与文章页还要确认那个 slug 在库里真的存在,不存在就折进 `/*`。
 * 代价是每次打点多一次走唯一索引的 EXISTS 查询 —— 在本站量级下可忽略,
 * 换来的是「visits 的行数由内容量决定」这条硬性质。
 *
 * 查询失败时按 `/*` 处理:统计的可用性不值得让打点整个失败。
 */
export async function resolvePath(raw: string): Promise<string> {
  const shape = classifyPath(raw);
  switch (shape.kind) {
    case "static":
      return shape.path;
    case "series": {
      const row = await db.rawQueryRow<{ ok: number }>(
        `SELECT 1 AS ok FROM notes_series WHERE slug = $1`,
        shape.series,
      );
      return row ? `/notes/${shape.series}` : OTHER_BUCKET;
    }
    case "chapter": {
      const row = await db.rawQueryRow<{ ok: number }>(
        `SELECT 1 AS ok FROM notes_chapters WHERE series_slug = $1 AND slug = $2`,
        shape.series,
        shape.chapter,
      );
      return row ? `/notes/${shape.series}/${shape.chapter}` : OTHER_BUCKET;
    }
    default:
      return OTHER_BUCKET;
  }
}
