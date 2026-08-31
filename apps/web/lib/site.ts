// 站点级常量。RSS 地址要出现在订阅弹层里(设计稿画板 2d),必须是对外域名,
// 而不是容器内网地址,所以单独配一个而不是复用 API_INTERNAL_URL。
// 只在 Server Component 里读(值经 props 传给客户端组件),所以**不加 NEXT_PUBLIC_ 前缀** ——
// 那个前缀意味着构建期内联,而这个值要在部署时才定,必须是运行时环境变量。
export const SITE_HOST = process.env.SITE_HOST ?? "agent-xray.dev";

/** 弹层里展示用的地址(设计稿里不带 scheme),复制时补 https:// */
export const rssPath = (categorySlug?: string) =>
  categorySlug ? `${SITE_HOST}/rss/${categorySlug}.xml` : `${SITE_HOST}/rss.xml`;
