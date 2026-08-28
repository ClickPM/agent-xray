import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 单机 Docker 部署用 standalone 输出(deploy/docker-compose.yml)
  output: "standalone",
};

export default nextConfig;
