// 图片管线(所有者裁定 2026-08-31 决策 3):只收正文真正引用到的图,
// 转 WebP + 宽度上限 1600px,落 apps/web/public/notes/<series>/,随 web 镜像走。
//
// 为什么必须压:vault 里 56 张位图中位数 1.4MB、最大 1.88MB,原样带走是 77.7MB,
// 每次镜像构建与传输都要背着(CLAUDE.md 规则 10 是「本机构建后整包传输」)。
//
// 为什么文件名用内容哈希:源文件名是中文且含未转义括号
// (`01-分层图(阶段-0-的-⭐-最小产出就是把这张图画出来).png`),进 URL 只会带来编码麻烦;
// 哈希还顺带让「内容没变 → 文件名没变 → git 无 diff」成立,支撑同步幂等。

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const MAX_WIDTH = 1600;
const WEBP_QUALITY = 82;

export interface ImageReport {
  referenced: number;
  written: number;
  reused: number;
  removedOrphans: number;
  missing: string[];
  bytesIn: number;
  bytesOut: number;
}

interface Pending {
  /** 磁盘路径,或已解码的内嵌图字节 */
  source: string | Buffer;
  seriesSlug: string;
  outName: string;
}

export class ImagePipeline {
  /** key = 输出相对路径(<series>/<hash>.<ext>),保证同图多引用只转一次 */
  private readonly pending = new Map<string, Pending>();
  private readonly missing: string[] = [];
  private referenced = 0;

  constructor(private readonly publicDir: string) {}

  /**
   * 内嵌 base64 图(`data:image/png;base64,…`)。知识星球课程经 Web Clipper 抓下来时
   * 把配图直接嵌进了 markdown(实测 7 处 / 59KB),不解出来的话既进不了压缩流程,
   * 又会把整串 base64 塞进 content_md。
   */
  resolveInline(dataUrl: string, seriesSlug: string): string | null {
    const m = /^data:image\/([a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl);
    if (!m) return null;
    const [, subtype, payload] = m;
    let buf: Buffer;
    try {
      buf = Buffer.from(payload, "base64");
    } catch {
      return null;
    }
    if (buf.length === 0) return null;
    this.referenced++;

    const ext = subtype.toLowerCase() === "svg+xml" ? "svg" : "webp";
    const hash = createHash("sha1").update(buf).digest("hex").slice(0, 12);
    const outName = `${hash}.${ext}`;
    const key = `${seriesSlug}/${outName}`;
    if (!this.pending.has(key)) this.pending.set(key, { source: buf, seriesSlug, outName });
    return `/notes/${key}`;
  }

  /**
   * 改写阶段调用:登记一次图片引用,返回站点 URL;源文件不存在返回 null(调用方丢弃该图)。
   * @param mdPath  引用它的 markdown 绝对路径
   * @param relUrl  markdown 里的相对路径
   */
  resolve(mdPath: string, relUrl: string, seriesSlug: string): string | null {
    const abs = resolve(dirname(mdPath), relUrl);
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      this.missing.push(abs);
      return null;
    }
    this.referenced++;

    const ext = abs.toLowerCase().endsWith(".svg") ? "svg" : "webp";
    const hash = createHash("sha1").update(readFileSync(abs)).digest("hex").slice(0, 12);
    const outName = `${hash}.${ext}`;
    const key = `${seriesSlug}/${outName}`;
    if (!this.pending.has(key)) this.pending.set(key, { source: abs, seriesSlug, outName });
    return `/notes/${key}`;
  }

  /** 全部改写完成后统一落盘;顺带清掉本轮不再被引用的旧文件(幂等的另一半) */
  async flush(): Promise<ImageReport> {
    const report: ImageReport = {
      referenced: this.referenced,
      written: 0,
      reused: 0,
      removedOrphans: 0,
      missing: this.missing,
      bytesIn: 0,
      bytesOut: 0,
    };

    // sharp 是原生依赖,只在真的有位图要转时才加载 —— 全 SVG 的轮次不该被它的
    // 安装状态卡住(Rust/TypeScript 教程一张图都没有)。
    let sharp: typeof import("sharp") | null = null;

    for (const [key, item] of this.pending) {
      const outPath = join(this.publicDir, key);
      mkdirSync(dirname(outPath), { recursive: true });
      report.bytesIn += typeof item.source === "string" ? statSync(item.source).size : item.source.length;

      if (existsSync(outPath)) {
        // 文件名即内容哈希:存在即等价,跳过转码
        report.reused++;
        report.bytesOut += statSync(outPath).size;
        continue;
      }

      if (item.outName.endsWith(".svg")) {
        writeFileSync(outPath, typeof item.source === "string" ? readFileSync(item.source) : item.source);
      } else {
        if (!sharp) sharp = (await import("sharp")).default as unknown as typeof import("sharp");
        await sharp(item.source)
          .resize({ width: MAX_WIDTH, withoutEnlargement: true })
          .webp({ quality: WEBP_QUALITY })
          .toFile(outPath);
      }
      report.written++;
      report.bytesOut += statSync(outPath).size;
    }

    report.removedOrphans = this.removeOrphans();
    return report;
  }

  /** 删除 public/notes/ 下本轮没有被引用的文件与空目录 */
  private removeOrphans(): number {
    if (!existsSync(this.publicDir)) return 0;
    const keep = new Set(this.pending.keys());
    let removed = 0;
    for (const seriesDir of readdirSync(this.publicDir)) {
      const abs = join(this.publicDir, seriesDir);
      if (!statSync(abs).isDirectory()) continue;
      for (const file of readdirSync(abs)) {
        if (keep.has(`${seriesDir}/${file}`)) continue;
        rmSync(join(abs, file));
        removed++;
      }
      if (readdirSync(abs).length === 0) rmSync(abs, { recursive: true });
    }
    return removed;
  }
}
