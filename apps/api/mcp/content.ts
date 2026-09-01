// 入库前的**派生**计算:字数与内容哈希。
//
// 与「server 只校验不改写」不冲突(ROUNDS.md R6):`content_md` 一个字节都不动,
// 这里算的是展示元数据。让客户端报字数才是错的 —— 两侧口径一旦漂移,
// 文章页的「约 N 分钟」就会跟正文对不上,而且没有任何一方会报错。
//
// 口径承自 R5 的 tools/notes-sync(中文按字、西文按词),换算成分钟仍在前端做。
import { createHash } from "node:crypto";

function stripMarkdown(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/[*_~]{1,3}/g, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "");
}

/** 中文按字计、西文按词计;文章页「约 N 分钟」由前端按 400 字/分钟换算。 */
export function countWords(md: string): number {
  const text = stripMarkdown(md);
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z0-9]+/g) ?? []).length;
  return cjk + latin;
}

/** 字段分隔符:正文里不可能出现的字节,防 ("ab","c") 与 ("a","bc") 撞哈希。 */
const SEP = "\u001f";

/**
 * 章节内容哈希 —— 「这次 upsert 是否真的改了东西」的判据。
 *
 * 为什么需要它:`updated_at` 同时是 RSS 的排序键与 `lastBuildDate` 的来源。
 * 没有这道判断的话,所有者用同一份内容重发一次(或脚本重跑一遍回填),
 * 整个订阅源就会假装有更新,阅读器把老文章重新推一遍。
 *
 * 参与哈希的是**所有会影响页面呈现的字段**,不只是正文:改标题、改摘要、
 * 换 sourceUrl 都是真的更新。
 */
export function chapterHash(fields: {
  ordinal: number;
  label: string;
  pinned: boolean;
  title: string;
  summary: string;
  contentMd: string;
  sourceUrl: string | null;
  publishedAt: string | null;
}): string {
  const parts = [
    String(fields.ordinal),
    fields.label,
    String(fields.pinned),
    fields.title,
    fields.summary,
    fields.contentMd,
    fields.sourceUrl ?? "",
    fields.publishedAt ?? "",
  ];
  return createHash("sha256").update(parts.join(SEP), "utf8").digest("hex");
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
