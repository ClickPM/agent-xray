// 服务端渲染用的 API 客户端。
//
// 类型与调用都来自 `encore gen client` 的产物(CLAUDE.md 规则 6:web 与 api 不手工
// 共享源码,类型只经生成物流动),不要在这里手写请求与接口形状。
//
// Notes 三级页都是 Server Component,请求发自 web 进程:
//   dev  -> encore run 的 127.0.0.1:4000
//   生产 -> compose 内网服务名 api:4000(deploy/docker-compose.yml)
// 浏览器侧那条 `/api/*` 路径由 Caddy / next rewrites 处理,与这里无关。
import Client from "./api-client";

const target = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

export const api = new Client(target);
