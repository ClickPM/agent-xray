import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 单机 Docker 部署用 standalone 输出(deploy/docker-compose.yml)
  output: "standalone",
  // 本地开发代理:/api/* → encore run :4000(strip /api,与 deploy/Caddyfile 的
  // uri strip_prefix 同语义)。生产由 Caddy 在前面截走 /api,这里仅 dev 生效。
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    return [
      { source: "/api/:path*", destination: "http://127.0.0.1:4000/:path*" },
      // RSS 在站根(设计稿画板 2d 的地址),线上由 deploy/Caddyfile 指到 api;
      // 这里补同样的 dev 代理,免得本机验证要换一套地址。
      { source: "/rss.xml", destination: "http://127.0.0.1:4000/rss.xml" },
      { source: "/rss/:file", destination: "http://127.0.0.1:4000/rss/:file" },
      // 正文配图(R6)。图片不再进 public/,改为从 Postgres 读(所有者裁定:
      // 镜像内不烧任何 notes 内容),但**对外 URL 保持 /notes/<系列>/<哈希>.webp 不变**
      // ——存量正文里的 markdown 就是这么写的。
      //
      // 【必须按扩展名匹配】数组形式的 rewrites 属于 afterFiles:它在**动态路由之前**
      // 生效。写成 `/notes/:series/:file` 会把文章页 /notes/pi/01 一并劫走。
      // 限定到图片扩展名,文章页地址(无扩展名)不会命中。
      // 生产侧由 deploy/Caddyfile 做同样的扩展名分流。
      {
        source: "/notes/:series/:file(.+\\.(?:webp|png|jpe?g|gif))",
        destination: "http://127.0.0.1:4000/assets/notes/:series/:file",
      },
    ];
  },
};

export default nextConfig;
