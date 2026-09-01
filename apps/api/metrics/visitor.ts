// 访客标识与 UA 摘要的派生(R8)。
//
// 这个文件是 `docs/security.md` §6「IP 加盐哈希后落库,不存原始 IP」的落点:
// **原始 IP 与原始 UA 只在本文件的函数栈里出现过,不返回、不落库、不进日志。**
// 出去的只有一个 32 位 hex 的 visitor 和一个闭集里的 UA 摘要。
//
// 【本文件的第二个职责:让 visitor 的取值空间有界】(codex 第 1 轮 P1)
// `POST /t` 是无认证的公开写入口,而 visitor 是 `visits` 主键的一部分 ——
// 只要请求方能自由左右哈希输入,他就能自由制造新行,把库撑爆。所以哈希的
// **每一个输入分量都必须有界**:
//   · day —— 一天一个值
//   · ua  —— 走 uaDigest 的闭集(≤42 种),不是原始 UA 串
//   · ip  —— 收敛到网段(IPv4 /24、IPv6 /48),且取值来自**我们自己的反代**
//            追加的那一段,不是请求方随手写的那一段
// path 的有界性在 path.ts。三者相乘就是 `visits` 的行数上界。
import { createHash } from "node:crypto";

/**
 * 访客标识 = sha256(salt ‖ day ‖ ip网段 ‖ UA摘要) 的 hex 前 32 位(128 bit)。
 *
 * 【为什么 day 进哈希输入】同一个人在不同日期得到不同的 visitor,
 * 于是即便整张 visits 表泄漏,也串不出任何人的跨天访问史。代价要认清:
 * 「近 30 天 UV」这个数在本方案下不存在,只能给各日 UV 之和 —— 统计 tool 里
 * 它叫 `visitorDays` 而不是 UV,就是为了不让这个数被读成「多少个人」。
 *
 * 【调用方必须传已经收敛过的值】`ip` 要先过 `ipNetwork`、`ua` 要先过 `uaDigest`。
 * 第一版直接把原始 IP 与**原始 UA 串**喂进来,于是一个 curl 循环每次换一个
 * User-Agent 就能造出无穷多个 visitor、无穷多行(codex P1)。原始 UA 本身
 * 就是高熵指纹,拿它当身份分量既不安全也不隐私。
 *
 * 【为什么截到 128 bit】碰撞概率在本站量级下可忽略,而库里每行少一半字节。
 *
 * 分隔符 `\n` 不能省:没有它,("ab","c") 与 ("a","bc") 会哈希到同一个值。
 */
export function visitorHash(salt: string, day: string, ipNet: string, uaKey: string): string {
  return createHash("sha256")
    .update(`${salt}\n${day}\n${ipNet}\n${uaKey}`, "utf8")
    .digest("hex")
    .slice(0, 32);
}

/**
 * 请求来源 IP。
 *
 * 【为什么取 `X-Forwarded-For` 的最后一段,而不是第一段】(codex 第 1 轮 P1)
 * Caddy 的 `reverse_proxy` 是**追加**而不是覆盖:请求方自己带一个
 * `X-Forwarded-For: 1.2.3.4` 过来,api 收到的就是 `1.2.3.4, <真实对端>`。
 * 取第一段等于让请求方自选身份 —— 每次换一个假 IP 就是一个新 visitor、一行新数据。
 * 最后一段是我们自己的反代写上去的,才是它看到的真实对端。
 *
 * **这条依赖「前面恰好只有一层我们自己的反代」**(deploy/Caddyfile 的拓扑)。
 * 将来若在 Caddy 前面再加 CDN / 云 LB,这里必须改成「从右往左跳过 N 层可信代理」,
 * 否则拿到的会是那层 LB 的地址,全站访客坍缩成一个。
 *
 * `X-Real-Ip` 只在没有 XFF 时兜底(单值,由反代写)。都没有则用 socket 地址
 * —— 本机开发就是这条路径。
 *
 * **返回值只允许喂给 `ipNetwork` 再喂给 `visitorHash`**,不落库、不进日志。
 */
export function clientIp(
  headers: Record<string, string | string[] | undefined>,
  socketAddress: string | undefined,
): string {
  const raw = headers["x-forwarded-for"];
  const xff = Array.isArray(raw) ? raw[0] : raw;
  const hops = xff?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  if (hops.length > 0) return hops[hops.length - 1];
  const real = headers["x-real-ip"];
  const realStr = Array.isArray(real) ? real[0] : real;
  if (realStr?.trim()) return realStr.trim();
  return socketAddress?.trim() || "unknown";
}

/** 认不出形状的地址一律归到这里 —— 取值必须有界,不能把原串带进哈希。 */
const UNKNOWN_NET = "unknown";

const V4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const V6_GROUP_RE = /^[0-9a-f]{1,4}$/;

/** IPv4 → `a.b.c.0/24`;不是合法 IPv4 则 null。 */
function v4Network(ip: string): string | null {
  const m = V4_RE.exec(ip);
  if (!m) return null;
  const parts = m.slice(1, 5).map(Number);
  if (parts.some((n) => n > 255)) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

/**
 * IPv6 → `x:y:z::/48`;不是合法 IPv6 则 null。
 *
 * 【必须先把 `::` 展开再取前三组】直接对原文 `split(":")` 取前三段是错的:
 * `fe80::1` 会切成 `["fe80","","1"]`,于是把**主机位**当成了网段的一部分 ——
 * `fe80::1` 与 `fe80::2` 会落进两个不同的桶。那正好复活了本函数要消除的
 * 「一个 /64 里换地址就能造新行」(codex 第 1 轮 P1)。自测第一版就是这么写错的。
 */
function v6Network(ip: string): string | null {
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : [];

  let groups: string[];
  if (halves.length === 1) {
    groups = head;
    if (groups.length !== 8) return null;
  } else {
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return null; // `::` 至少代表一组零
    groups = [...head, ...Array<string>(fill).fill("0"), ...tail];
  }
  if (groups.some((g) => !V6_GROUP_RE.test(g))) return null;
  // 前导零归一(`0db8` 与 `db8` 是同一组),否则同一网段会有两个桶名
  const net = groups.slice(0, 3).map((g) => parseInt(g, 16).toString(16));
  return `${net.join(":")}::/48`;
}

/**
 * 把地址收敛到网段:IPv4 → /24,IPv6 → /48。
 *
 * 两个作用同时成立,这不是巧合:
 *   1. **有界**(codex 第 1 轮 P1 的一半):一台机器能拿到的 IPv6 通常是一整个
 *      /64,逐个换地址几乎零成本;收敛到 /48 之后,它再怎么换也只是同一行。
 *      要多造一行就得真的换一个网段 —— 那需要真实的网络资源。
 *   2. **更隐私**:落库的身份分量比「精确到一台设备的出口地址」粗一档,
 *      与 §6 的方向一致。
 *
 * 代价要认:同一 /24(或 /48)里的两位访客、且浏览器族与平台族相同时,
 * 会被算成同一个人。个人站量级下这是可接受的低估,不是缺陷。
 */
export function ipNetwork(raw: string): string {
  let ip = raw.trim().toLowerCase();
  if (ip === "" || ip === UNKNOWN_NET) return UNKNOWN_NET;

  // `[::1]:1234` 这种 socket 字面量:剥掉方括号与端口
  if (ip.startsWith("[")) {
    const end = ip.indexOf("]");
    if (end === -1) return UNKNOWN_NET;
    ip = ip.slice(1, end);
  }
  // IPv6 的 zone id(`fe80::1%eth0`)不属于地址本身
  ip = ip.split("%")[0];

  // `1.2.3.4:5678`(IPv4 带端口)。IPv6 里冒号是分隔符,所以只在「恰好一个冒号
  // 且含点」时才剥 —— 否则会把 `::ffff:1.2.3.4` 也切坏
  if (ip.includes(".") && ip.split(":").length === 2) ip = ip.split(":")[0];

  // 纯 IPv4
  const v4 = v4Network(ip);
  if (v4) return v4;

  // IPv4-mapped IPv6(`::ffff:1.2.3.4`、`0:0:0:0:0:ffff:1.2.3.4`)按 IPv4 处理,
  // 否则同一个人从两条协议栈过来会被算成两个网段
  if (ip.includes(":") && ip.includes(".")) {
    const mapped = v4Network(ip.slice(ip.lastIndexOf(":") + 1));
    return mapped ?? UNKNOWN_NET;
  }

  if (ip.includes(":")) return v6Network(ip) ?? UNKNOWN_NET;

  return UNKNOWN_NET;
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
