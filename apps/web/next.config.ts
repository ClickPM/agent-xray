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
    ];
  },
};

export default nextConfig;
