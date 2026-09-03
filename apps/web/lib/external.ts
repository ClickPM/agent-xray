// 外链白名单(R-SKILLS 把 About 页里的同名函数抽到这里,About 页本身零改动)。
//
// `repoUrl` 在服务端已被 `skills_upsert` 校验过,这里是第二道 —— 库是可以绕过 tool 直接改的,
// 而这个值会进 `<a href>`。React 会转义属性值,但它不会替你判断协议:`javascript:` 照样能点。
//
// 与服务端 `mcp/tools.ts` 的 `isHttpUrl` 同一口径,两处必须同步改(web 与 api 不共享源码,规则 6)。
// **不能退回成前缀匹配**:`https://` 与 `http://?x` 都能通过前缀检查,却渲染成点不开的链接;
// 而 `new URL("javascript:…")` 解析得成功,所以协议白名单同样不能省。
export function safeExternal(value: string | null | undefined): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "" ? value : null;
}
