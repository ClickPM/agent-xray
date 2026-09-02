// 「这段字节是不是图片、是哪种图片」的判据 —— 全站只有这一份(R-IMAGEGEN 抽出)。
//
// 两个消费方,都是安全判定而不是格式转换:
//   - `mcp/tools.ts` 的附件上传:声明的 contentType 必须与文件头一致,否则一份
//     「声称是 png 的 HTML」会被供图端点原样出成 `image/png` 之外的东西 —— 同源下的存储型 XSS
//   - `agent/imagegen.ts` 的上游响应:生图网关回来的是**不可信字节**,上游声明的 mime 不作数,
//     魔数认不出来就不存、也不给模型(docs/security.md §1 外呼组约束 6 在生图侧的形态)
//
// **SVG 永远不在这张表里**:它是可执行文档(R6 裁定),两个消费方都不接受。
// 想加新类型先加这里,再让两边的白名单跟着走 —— 判据只能有一份。

export type ImageContentType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

/** 允许的图片类型 → 文件扩展名。对外 URL 与附件名都从这里取扩展名。 */
export const IMAGE_EXTENSIONS: Readonly<Record<ImageContentType, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** 扩展名 → 类型(`jpeg` 与 `jpg` 都认;供图端点按 URL 里的扩展名反查)。 */
export function imageTypeOfExtension(ext: string): ImageContentType | null {
  switch (ext.toLowerCase()) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return null;
  }
}

/**
 * 按文件头识别图片类型;认不出来回 null。
 *
 * 只看魔数,不解析图像本身:这里要回答的是「浏览器会把它当什么」,
 * 而浏览器的 MIME 嗅探看的正是这几个字节。
 */
export function sniffImageType(bytes: Uint8Array): ImageContentType | null {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buf.length >= 8 && buf.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }
  if (
    buf.length >= 6 &&
    (buf.subarray(0, 6).toString("latin1") === "GIF87a" || buf.subarray(0, 6).toString("latin1") === "GIF89a")
  ) {
    return "image/gif";
  }
  return null;
}

/** 声明的类型与文件头是否一致。未知的 contentType 一律 false —— 白名单之外没有「一致」可言。 */
export function magicMatches(contentType: string, bytes: Uint8Array): boolean {
  const sniffed = sniffImageType(bytes);
  return sniffed !== null && sniffed === contentType;
}
