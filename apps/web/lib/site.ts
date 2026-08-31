// 站点对外地址。**单一来源是 SITE_ORIGIN**,必须带 scheme(必要时带端口):
//   生产   https://agent-xray.dev
//   130 预发 http://<内网IP>:8080     ← 备案通过前 Caddy 只在 :80/:8080 上跑明文
// 早先拆成「SITE_HOST + 代码里拼 https://」是错的:预发根本没有 HTTPS 在听,
// 订阅弹层给出的地址会指向一个不存在的端点(codex review 2026-08-31 P2)。
//
// 只在 Server Component 里读(值经 props 传给客户端组件),所以不加 NEXT_PUBLIC_ 前缀 ——
// 那个前缀意味着构建期内联,而这个值要到部署时才定,必须是运行时环境变量。
const RAW = process.env.SITE_ORIGIN?.trim().replace(/\/+$/, "") || "https://agent-xray.dev";

export const SITE_ORIGIN = RAW;

/** 订阅源的完整地址(复制给阅读器用) */
export const rssHref = (categorySlug?: string) =>
  categorySlug ? `${SITE_ORIGIN}/rss/${categorySlug}.xml` : `${SITE_ORIGIN}/rss.xml`;

/** 弹层里展示用的地址:设计稿画板 2d 不显示 scheme */
export const rssDisplay = (categorySlug?: string) => rssHref(categorySlug).replace(/^https?:\/\//, "");
