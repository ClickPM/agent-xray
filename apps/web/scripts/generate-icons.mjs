// R-MOBILE:从「Pulse X」图形生成 manifest 需要的三张位图图标。
//
// 为什么不直接栅格化 `app/icon.svg`:那份用 `currentColor` + `<style>` 里的
// `prefers-color-scheme` 切明暗,**栅格化器解析不到这两样** —— librsvg 不跑 CSS 媒体查询,
// `currentColor` 没有继承源就落到黑色。所以这里内联同一图形但把颜色写死。
//
// 图形本身必须与 `app/icon.svg` / `components/XrayMark.tsx` 保持一致(三份载体同一个图形,
// 改图形要三处一起改)。栅格几何直接抄 icon.svg 的 32×32 栅格。
//
// 跑法:cd apps/web && node scripts/generate-icons.mjs
// 产物 public/icon-{192,512}.png 与 public/icon-maskable-512.png **入库**
// (web 镜像构建期不跑本脚本,Dockerfile 直接 COPY public)。

import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const BRAND = "#2563eb";
const BG = "#ffffff";

/**
 * @param {number} inset 图形四周留白占画布的比例。
 *   `any` 档取 0.12(和常见 app 图标的视觉留白一致);
 *   `maskable` 档取 0.20 —— maskable 的安全区是**中心 80% 直径的圆**,
 *   图形越出就会被 Android 的圆形 / 水滴遮罩切掉边角。
 */
const markSvg = (inset) => {
  const span = 32 / (1 - inset * 2); // 把 32 栅格放进带留白的画布
  const off = (span - 32) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-off} ${-off} ${span} ${span}">
  <rect x="${-off}" y="${-off}" width="${span}" height="${span}" fill="${BG}"/>
  <mask id="cut">
    <rect x="${-off}" y="${-off}" width="${span}" height="${span}" fill="#fff"/>
    <rect x="${-off}" y="13.2" width="${span}" height="5.6" fill="#000"/>
  </mask>
  <g stroke="${BRAND}" stroke-width="4.6" mask="url(#cut)">
    <path d="M5.0 5.0 27.0 27.0"/>
    <path d="M27.0 5.0 5.0 27.0"/>
  </g>
  <path d="M1 16H31" stroke="${BRAND}" stroke-width="1.8" opacity=".3"/>
  <path d="M11 16 H13.3 L15 13.4 L17 18.6 L18.7 16 H21" stroke="${BRAND}" stroke-width="2.0" fill="none"/>
</svg>`;
};

const jobs = [
  { file: "icon-192.png", size: 192, inset: 0.12 },
  { file: "icon-512.png", size: 512, inset: 0.12 },
  { file: "icon-maskable-512.png", size: 512, inset: 0.2 },
];

await mkdir("public", { recursive: true });
for (const { file, size, inset } of jobs) {
  const out = `public/${file}`;
  const info = await sharp(Buffer.from(markSvg(inset)))
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(out);
  console.log(`${out}  ${info.width}x${info.height}  ${info.size} B`);
}
