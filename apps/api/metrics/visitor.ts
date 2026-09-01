// 访客标识与 UA 摘要的派生(R8)。
//
// 这个文件是 `docs/security.md` §6「IP 加盐哈希后落库,不存原始 IP」的落点:
// **原始 IP 与原始 UA 只在本文件的函数栈里出现过,不返回、不落库、不进日志。**
// 出去的只有一个 32 位 hex 的 visitor 和一个闭集里的 UA 摘要。
import { createHash } from "node:crypto";

/**
 * 访客标识 = sha256(salt ‖ day ‖ ip ‖ ua) 的 hex 前 32 位(128 bit)。
 *
 * 【为什么 day 进哈希输入】同一个人在不同日期得到不同的 visitor,
 * 于是即便整张 visits 表泄漏,也串不出任何人的跨天访问史。代价要认清:
 * 「近 30 天 UV」这个数在本方案下不存在,只能给各日 UV 之和 —— 统计 tool 里
 * 它叫 `visitorDays` 而不是 UV,就是为了不让这个数被读成「多少个人」。
 *
 * 【为什么 UA 也进输入】同一出口 IP 后面常常是一整个家庭/办公室的 NAT。
 * 掺进 UA 能把它们分开一些;掺的是**原始 UA**(熵更高)而不是摘要。
 *
 * 【为什么截到 128 bit】碰撞概率在本站量级下可忽略,而库里每行少一半字节。
 *
 * 分隔符 `\n` 不能省:没有它,("ab","c") 与 ("a","bc") 会哈希到同一个值。
 */
export function visitorHash(salt: string, day: string, ip: string, userAgent: string): string {
  return createHash("sha256")
    .update(`${salt}\n${day}\n${ip}\n${userAgent}`, "utf8")
    .digest("hex")
    .slice(0, 32);
}

/**
 * 请求来源 IP。反代(Caddy)在前,socket 地址永远是反代自己,所以先看
 * `X-Forwarded-For` 的**第一段**(最靠近客户端的那个)。
 *
 * 头可以被伪造 —— 伪造的后果只是把自己算成另一个访客,统计面没有安全语义
 * (认证、限额都不依赖它)。**返回值只允许喂给 visitorHash**。
 */
export function clientIp(
  headers: Record<string, string | string[] | undefined>,
  socketAddress: string | undefined,
): string {
  const raw = headers["x-forwarded-for"];
  const xff = Array.isArray(raw) ? raw[0] : raw;
  const first = xff?.split(",")[0]?.trim();
  if (first) return first;
  const real = headers["x-real-ip"];
  const realStr = Array.isArray(real) ? real[0] : real;
  if (realStr?.trim()) return realStr.trim();
  return socketAddress?.trim() || "unknown";
}

/** 浏览器族:顺序有意义 —— Edge/Chrome 的 UA 里都含 "Chrome",Safari 的里含 "Safari"。 */
const BROWSERS: [RegExp, string][] = [
  // 【`bot` 前面不能加 \b】几乎所有爬虫的名字都是「厂商 + bot」连写:Googlebot、
  // bingbot、YandexBot、Twitterbot —— 前置词边界一个都匹配不上(实测,本条第一版
  // 就是这么写错的)。后置 \b 保留,而真实浏览器的 UA 里不出现 "bot" 这个子串。
  [
    /bot\b|crawler|spider|slurp|bingpreview|headlesschrome|curl\/|wget\/|python-requests|go-http-client/i,
    "Bot",
  ],
  [/\bedg(?:e|a|ios)?\//i, "Edge"],
  [/\b(opr|opera)\//i, "Opera"],
  [/\bfirefox\/|\bfxios\//i, "Firefox"],
  [/\b(chrome|crios)\//i, "Chrome"],
  [/\bsafari\//i, "Safari"],
];

const PLATFORMS: [RegExp, string][] = [
  [/\bandroid\b/i, "Android"],
  [/\b(iphone|ipad|ipod)\b/i, "iOS"],
  [/\bwindows nt\b/i, "Windows"],
  [/\b(macintosh|mac os x)\b/i, "macOS"],
  [/\b(linux|x11|cros)\b/i, "Linux"],
];

function match(table: [RegExp, string][], ua: string): string {
  for (const [re, name] of table) if (re.test(ua)) return name;
  return "Other";
}

/**
 * UA 摘要 = `<浏览器族>/<平台族>`,取值落在一个 ≤42 项的闭集里。
 *
 * **原始 UA 串永不落库**:它本身就是一份高熵指纹(版本号 + 设备型号 + 一堆
 * 厂商标记),存下来等于给「不存原始 IP」开了一扇后门。摘要只保留
 * 「访客大致用什么在看」这一件对所有者有用的事。
 *
 * Bot 单独成族且不再细分平台:爬虫不跑 JS,能打到 `/t` 的多半是直接构造的请求,
 * 把它们归成一堆比按平台散开更有用。
 */
export function uaDigest(userAgent: string): string {
  const ua = userAgent.slice(0, 512);
  if (ua.trim() === "") return "Other/Other";
  const browser = match(BROWSERS, ua);
  if (browser === "Bot") return "Bot/Other";
  return `${browser}/${match(PLATFORMS, ua)}`;
}
