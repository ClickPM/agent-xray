// 服务端渲染用的 API 客户端。
//
// 类型与调用都来自 `encore gen client` 的产物(CLAUDE.md 规则 6:web 与 api 不手工
// 共享源码,类型只经生成物流动),不要在这里手写请求与接口形状。
//
// Notes 三级页都是 Server Component,请求发自 web 进程:
//   dev  -> encore run 的 127.0.0.1:4000
//   生产 -> compose 内网服务名 api:4000(deploy/docker-compose.yml)
// 浏览器侧那条 `/api/*` 路径由 Caddy / next rewrites 处理,与这里无关。
import Client, { ErrCode, isAPIError } from "./api-client";
import { notFound } from "next/navigation";

const target = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

export const api = new Client(target);

/**
 * 路由参数取自 URL,是访客可以随便填的。后端对它有两种拒绝方式:
 * 认不出的 slug 回 `not_found`,形状就不合法的(大写、非 ASCII、超 64 字符)回
 * `invalid_argument` —— **两者在页面上都该是 404**。
 *
 * 只认 `not_found` 的话,`/notes/PI` 这种大小写写错的地址会把 `invalid_argument`
 * 一路抛到 Next,渲染成 500(codex review 2026-08-31 第 5 轮 P2):一个坏链接被
 * 报成服务器故障,既误导读者也污染错误监控。
 *
 * 其余错误(网络不通、后端 500)必须原样抛出 —— 那才是真故障,伪装成 404 会让
 * 一次 api 挂掉看起来像"这些内容不存在"。
 */
export function notFoundOnBadRoute(err: unknown): never {
  if (isAPIError(err) && (err.code === ErrCode.NotFound || err.code === ErrCode.InvalidArgument)) {
    notFound();
  }
  throw err;
}
