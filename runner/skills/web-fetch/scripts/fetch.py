"""web-fetch:抓取一个公网 https 网页,抽取正文为 markdown(R-WEBFETCH;沙箱执行组 egress 档的首个 skill)。

stdin 读 {"url": "https://…"},stdout 写 markdown(退出码 0);失败时 stdout **只有一行固定短码**、退出码 2:
  E_BAD_URL       网址不合规(不是 https / 带端口或凭据 / 不是域名 / 超长)—— 可改正后再试
  E_UNFETCHABLE   解析不到、地址不允许、连不上、TLS 失败、非 2xx、跳转不合规或超过 3 跳、压缩方式不支持
  E_TIMEOUT       连接 / 读取 / 总时长超时
  E_NOT_HTML      Content-Type 不是网页(PDF / 图片 / JSON …)
  E_TOO_LARGE     对方声明的大小远超上界
  E_NO_CONTENT    抽不出正文(纯 JS 渲染 / 登录页 / 空页)
短码经 api 的固定文案「脚本运行失败(E_…)」到模型跟前(apps/api/agent/tools.ts 的 failureShortCode);
**E_UNFETCHABLE 不区分「内网所以拒」与「连不上」**——区分了就是给探测者做二分。

第九条约束(docs/security.md §1 R-WEBFETCH 补记)在本文件里的落点 —— 三道防线里脚本这一道:
  ① URL 收窄       narrow_url():只 https、端口只 443、无 userinfo、≤ 2048、fragment 丢弃;主机名至少一个点、每段合规、
                   末段纯字母或 xn--(一刀切掉 v4 点分 / 整数 / 八进制 / 十六进制与 v6 方括号形态)。**没有任何域名黑白名单**
                   (所有者裁定 2026-09-03:太多,无法维护);localhost / *.local 之类不单列,靠 ② 的地址校验覆盖。
  ② 逐地址校验     resolve_public():getaddrinfo 的**全部**结果逐个过 is_public_address(),任一命中回环 / 私网 / link-local /
                   CGNAT / 多播 / 保留 / 未指定 / 嵌套 v4 即拒,**不挑** —— 攻击者控制 DNS 时,「挑一个合法的用」就是让他挑。
  ③ 钉住地址去连   default_connect():按地址族直接 connect((ip, 443)),不再经任何解析;TLS 按主机名做(SNI + 证书校验);
                   连上后核 getpeername() == ip。http.client 只做报文(sock 预置),不让它自己解析或连接。
  ④ 重定向 ≤ 3 跳  fetch():每跳重走 ①②③;跳转后的地址不合规按 E_UNFETCHABLE(不告诉模型跳到了哪)。
  ⑤ 解压后计上界   read_body():256 KiB;gzip 用 decompressobj(max_length) 流式限读,炸弹在上界处停、连接随即关闭。
  ⑥ 固定短码       Fail(code);stdout / stderr 不写地址、不写跳转链、不写输入 URL 之外的主机名。
  ⑦ 判据在代码里   is_public_address() 的地址段列表没有任何外部来源(脚本 env 本来就被 runner 清空,也没有 argv)。

准入清单的 egress 档例外(rounds/round-skills/research.md §2.2):允许 socket / ssl / http.client;仍无 subprocess / ctypes /
eval;不读 argv / env;单文件(runner 以 -I 起脚本,兄弟模块 import 不到);抽取只用 trafilatura 的 bare_extraction,
**不用它的下载器**(那里面有自动跟随重定向与代理逻辑,与本文件的防线冲突)。
`run()` 接受注入的 resolve / connect / clock,runner/tests/test_web_fetch.py 据此不打真网。
"""
from __future__ import annotations

import codecs
import http.client
import ipaddress
import json
import re
import socket
import ssl
import sys
import time
import zlib
from typing import Callable, Optional
from urllib.parse import quote, urljoin, urlsplit

# ── 上界(rounds/round-webfetch/round-webfetch.md §4 第 5 项的默认值)──
MAX_URL_CHARS = 2048
MAX_HOST_CHARS = 253
MAX_HOPS = 3  # 最多跟 3 次重定向(第 4 次拒)
CONNECT_TIMEOUT_S = 5.0
IDLE_TIMEOUT_S = 8.0  # 单次 recv
TOTAL_TIMEOUT_S = 20.0  # 解析 + 连接 + 读体,跨所有跳;sandbox 默认 30 s,余下的给抽取与排队
MAX_BODY_BYTES = 256 * 1024  # 解压后
MAX_DECLARED_BYTES = 8 * MAX_BODY_BYTES  # Content-Length 声明超过它直接 E_TOO_LARGE(线上字节)
MAX_OUTPUT_CHARS = 48_000
READ_CHUNK = 16 * 1024
SNIFF_BYTES = 4096

USER_AGENT = "AgentXRayBot/1 (+https://www.kzgai.cloud/)"
HTML_TYPES = frozenset({"text/html", "application/xhtml+xml"})
TEXT_TYPES = frozenset({"text/plain"})
REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})

E_BAD_URL = "E_BAD_URL"
E_UNFETCHABLE = "E_UNFETCHABLE"
E_TIMEOUT = "E_TIMEOUT"
E_NOT_HTML = "E_NOT_HTML"
E_TOO_LARGE = "E_TOO_LARGE"
E_NO_CONTENT = "E_NO_CONTENT"


class Fail(Exception):
    """预期内的失败:只带一个闭集里的短码,不带任何上游细节。"""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


# ───────────────────────── ① URL 收窄 ─────────────────────────

# 主机名的每一段:RFC 1123 标签;末段另要求纯字母或 xn--(IDN),这一条把所有数字形态的「主机名」一刀切掉
LABEL_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
TLD_RE = re.compile(r"^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$")
_PATH_SAFE = "/;:@&=+$,-_.!~*'()%"
_QUERY_SAFE = _PATH_SAFE + "?"


class Target:
    """收窄后的请求目标:只剩主机名(ASCII、小写)与请求路径;scheme / 端口 / 凭据 / fragment 都已没有。"""

    __slots__ = ("host", "path")

    def __init__(self, host: str, path: str):
        self.host = host
        self.path = path

    @property
    def href(self) -> str:
        return f"https://{self.host}{self.path}"


def narrow_url(href: object) -> Target:
    if not isinstance(href, str) or not href or len(href) > MAX_URL_CHARS:
        raise Fail(E_BAD_URL)
    if any(ord(c) < 0x21 or ord(c) == 0x7F for c in href):  # 控制字符与空白(含 NUL)
        raise Fail(E_BAD_URL)
    try:
        parts = urlsplit(href)
    except ValueError:
        raise Fail(E_BAD_URL) from None
    if parts.scheme.lower() != "https":
        raise Fail(E_BAD_URL)
    if parts.username is not None or parts.password is not None:
        raise Fail(E_BAD_URL)
    if "[" in parts.netloc or "]" in parts.netloc:  # v6 方括号形态
        raise Fail(E_BAD_URL)
    try:
        port = parts.port
    except ValueError:
        raise Fail(E_BAD_URL) from None
    if port not in (None, 443):
        raise Fail(E_BAD_URL)
    host = parts.hostname or ""
    if not host:
        raise Fail(E_BAD_URL)
    if not host.isascii():
        try:
            host = host.encode("idna").decode("ascii")
        except UnicodeError:
            raise Fail(E_BAD_URL) from None
    host = host.lower()
    if len(host) > MAX_HOST_CHARS:
        raise Fail(E_BAD_URL)
    labels = host.split(".")
    if len(labels) < 2 or not all(LABEL_RE.match(label) for label in labels) or not TLD_RE.match(labels[-1]):
        raise Fail(E_BAD_URL)
    path = quote(parts.path or "/", safe=_PATH_SAFE)
    if not path.startswith("/"):
        path = "/" + path
    if parts.query:
        path += "?" + quote(parts.query, safe=_QUERY_SAFE)
    if len(path) > MAX_URL_CHARS:
        raise Fail(E_BAD_URL)
    return Target(host, path)


# ───────────────────────── ② 地址校验 ─────────────────────────

# 固定的 RFC 地址段(零维护)。ipaddress 的 is_* 标志与 is_global 已覆盖绝大部分,这份显式清单是第二道:
# 两边任一命中即不公网。**不是域名清单**,这里没有一个域名。
_V4_BLOCKED = tuple(
    ipaddress.ip_network(n)
    for n in (
        "0.0.0.0/8",  # 本网(未指定)
        "10.0.0.0/8",  # 私网
        "100.64.0.0/10",  # CGNAT(shared address space)
        "127.0.0.0/8",  # 回环
        "169.254.0.0/16",  # link-local;云元数据 169.254.169.254 / 腾讯云 169.254.0.23 都在这里
        "172.16.0.0/12",  # 私网
        "192.0.0.0/24",  # IETF 协议保留
        "192.0.2.0/24",  # TEST-NET-1
        "192.88.99.0/24",  # 6to4 中继(废弃)
        "192.168.0.0/16",  # 私网
        "198.18.0.0/15",  # 基准测试
        "198.51.100.0/24",  # TEST-NET-2
        "203.0.113.0/24",  # TEST-NET-3
        "224.0.0.0/4",  # 多播
        "240.0.0.0/4",  # 保留(含广播)
    )
)
# 嵌套 v4 的几种形态(v4-mapped / 6to4 / Teredo / NAT64)**整段拒**,不再往里看嵌的是什么:公网网站不会只以这些形态可达,
# 而「往里看」只是多一处可能判错的代码
_V6_BLOCKED = tuple(
    ipaddress.ip_network(n)
    for n in (
        "::/96",  # 未指定 / 回环 / IPv4-compatible(废弃)
        "::ffff:0:0/96",  # IPv4-mapped
        "64:ff9b::/96",  # NAT64 well-known prefix
        "64:ff9b:1::/48",  # NAT64 local-use
        "100::/64",  # discard-only
        "2001::/32",  # Teredo
        "2001:db8::/32",  # 文档
        "2002::/16",  # 6to4
        "fc00::/7",  # ULA
        "fe80::/10",  # link-local
        "fec0::/10",  # site-local(废弃)
        "ff00::/8",  # 多播
    )
)


def is_public_address(text: str) -> bool:
    try:
        addr = ipaddress.ip_address(text.split("%", 1)[0])  # 去掉 v6 的 scope id
    except ValueError:
        return False
    if (
        addr.is_unspecified
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_multicast
        or addr.is_reserved
        or addr.is_private
        or not addr.is_global
    ):
        return False
    blocked = _V4_BLOCKED if addr.version == 4 else _V6_BLOCKED
    return not any(addr in net for net in blocked)


def same_address(a: str, b: str) -> bool:
    try:
        return ipaddress.ip_address(a.split("%", 1)[0]) == ipaddress.ip_address(b.split("%", 1)[0])
    except ValueError:
        return False


Resolver = Callable[[str], "list[str]"]
Connector = Callable[[str, str, float], "socket.socket"]


def default_resolve(host: str) -> list[str]:
    infos = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    out: list[str] = []
    for family, _type, _proto, _canon, sockaddr in infos:
        if family not in (socket.AF_INET, socket.AF_INET6):
            continue
        ip = str(sockaddr[0])
        if ip not in out:
            out.append(ip)
    out.sort(key=lambda ip: ":" in ip)  # v4 在前(稳定排序):容器多半没有 v6 路由,先试 v4 少一次必败的连接
    return out


def resolve_public(host: str, resolve: Resolver) -> list[str]:
    """全部地址都公网才放行;解析失败、空结果、任一地址不公网 → 同一个短码(不区分)。"""
    try:
        ips = resolve(host)
    except (OSError, UnicodeError, ValueError):
        raise Fail(E_UNFETCHABLE) from None
    if not ips or not all(isinstance(ip, str) and is_public_address(ip) for ip in ips):
        raise Fail(E_UNFETCHABLE)
    return list(ips)


# ───────────────────────── ③ 钉住地址连 + ④ 逐跳请求 ─────────────────────────


def default_connect(ip: str, host: str, timeout: float) -> socket.socket:
    """按地址族直接 connect 到校验过的地址(不经任何解析),再按主机名做 TLS。返回已握手的 TLS socket。"""
    family = socket.AF_INET6 if ":" in ip else socket.AF_INET
    sock = socket.socket(family, socket.SOCK_STREAM)
    try:
        sock.settimeout(timeout)
        sock.connect((ip, 443))
        ctx = ssl.create_default_context()  # 校验证书 + check_hostname + 系统 CA(镜像里的 ca-certificates)
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        return ctx.wrap_socket(sock, server_hostname=host)
    except BaseException:
        sock.close()
        raise


def open_and_request(target: Target, ips: list[str], connect: Connector, remaining: Callable[[], float]):
    sock = None
    last = E_UNFETCHABLE
    for ip in ips:
        try:
            sock = connect(ip, target.host, min(CONNECT_TIMEOUT_S, remaining()))
        except TimeoutError:
            last = E_TIMEOUT
            continue
        except OSError:  # 含 ssl.SSLError(证书 / 握手失败)与拒绝连接 / 不可达
            last = E_UNFETCHABLE
            continue
        break
    if sock is None:
        raise Fail(last)
    # 钉住:连上的必须就是校验过的那个地址(注入的 connect 也逃不过这一核)
    try:
        peer = str(sock.getpeername()[0])
    except OSError:
        sock.close()
        raise Fail(E_UNFETCHABLE) from None
    if not same_address(peer, ip):
        sock.close()
        raise Fail(E_UNFETCHABLE)

    conn = http.client.HTTPConnection(target.host, 443)  # 只做报文;sock 预置后它不会自己去解析 / 连接
    conn.sock = sock
    try:
        # 空闲超时**只在这里设一次**:响应带 Connection: close 时 http.client 会在 getresponse() 里把 socket 对象 close 掉
        # (读端靠 makefile 的引用继续活着),之后再对 sock 调 settimeout 就是 EBADF(实测 example.com 第二块就炸)。
        # 单次 recv 最多等 IDLE_TIMEOUT_S,总时长由 read_body 每次循环的 remaining() 兜住(最坏多等一个空闲超时)。
        sock.settimeout(min(IDLE_TIMEOUT_S, remaining()))
        conn.putrequest("GET", target.path, skip_host=True, skip_accept_encoding=True)
        conn.putheader("Host", target.host)
        conn.putheader("User-Agent", USER_AGENT)
        conn.putheader("Accept", "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8,*/*;q=0.1")
        conn.putheader("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        conn.putheader("Accept-Encoding", "gzip")
        conn.putheader("Connection", "close")
        conn.endheaders()
        resp = conn.getresponse()
    except TimeoutError:
        conn.close()
        raise Fail(E_TIMEOUT) from None
    except (OSError, http.client.HTTPException, ValueError):
        conn.close()
        raise Fail(E_UNFETCHABLE) from None
    return resp, conn


def content_type(resp) -> tuple[str, str]:
    raw = resp.getheader("Content-Type")
    if raw is None:
        return "text/html", ""  # 没给就按网页处理(浏览器也是嗅探);后面的抽取自会判定有没有正文
    parts = [p.strip() for p in raw.split(";")]
    mime = parts[0].lower()
    charset = ""
    for p in parts[1:]:
        key, _, value = p.partition("=")
        if key.strip().lower() == "charset":
            charset = value.strip().strip('"').strip("'").lower()
    return mime, charset


# ───────────────────────── ⑤ 读体带上界 ─────────────────────────


def read_body(resp, gz: bool, remaining: Callable[[], float]) -> tuple[bytes, bool]:
    """按**解压后**字节计,到 MAX_BODY_BYTES 即停;返回 (body, truncated)。每次循环核一次总时长(单次 recv 受 socket 空闲超时约束)。"""
    chunks: list[bytes] = []
    total = 0
    truncated = False
    inflater = zlib.decompressobj(16 + zlib.MAX_WBITS) if gz else None
    while total < MAX_BODY_BYTES:
        room = MAX_BODY_BYTES - total
        remaining()
        try:
            # read1 而不是 read:read(n) 会在**一次调用里**攒够 n 字节才返回,每次底层 recv 都重置空闲超时,
            # 一个每几秒滴一点的服务器能让总时长永远核不到(codex 第 2 轮 P2);read1 一次底层 recv 就返回,
            # 循环顶上的 remaining() 于是每个 recv 后都会核一次,总时长的粒度 = 一个空闲超时
            raw = resp.read1(READ_CHUNK)
        except TimeoutError:
            raise Fail(E_TIMEOUT) from None
        except (OSError, http.client.HTTPException, ValueError):
            raise Fail(E_UNFETCHABLE) from None
        if not raw:
            if inflater is not None:
                tail = inflater.flush()[:room]
                chunks.append(tail)
                total += len(tail)
                # 对方提前掐断的 gzip 流:flush() 照样把已解出的部分吐出来、不报错,但 gzip 尾没读到(eof 为 False)——
                # 那是残缺正文,必须按「不完整」标注,不能当完整页面交给模型去总结(codex 首轮 P2)
                if not inflater.eof:
                    truncated = True
            break
        if inflater is None:
            piece = raw[:room]
            truncated = len(piece) < len(raw)
        else:
            try:
                piece = inflater.decompress(raw, room)
            except zlib.error:
                raise Fail(E_UNFETCHABLE) from None
            truncated = bool(inflater.unconsumed_tail)  # 输出到了上界、输入还有剩 → 炸弹或大页,都在这里停
        chunks.append(piece)
        total += len(piece)
        if truncated:
            break
    else:
        truncated = True  # 恰好填满上界:按「可能还有」标注
    return b"".join(chunks), truncated


def fetch(url: object, resolve: Resolver, connect: Connector, clock: Callable[[], float]):
    """逐跳抓取。返回 (首跳 target, mime, body, truncated, charset_hint)。"""
    deadline = clock() + TOTAL_TIMEOUT_S

    def remaining() -> float:
        left = deadline - clock()
        if left <= 0:
            raise Fail(E_TIMEOUT)
        return left

    target = narrow_url(url)
    first = target
    for hop in range(MAX_HOPS + 1):
        ips = resolve_public(target.host, resolve)
        remaining()
        resp, conn = open_and_request(target, ips, connect, remaining)
        try:
            if resp.status in REDIRECT_STATUSES:
                location = resp.getheader("Location")
                if not location or hop >= MAX_HOPS:
                    raise Fail(E_UNFETCHABLE)
                try:
                    target = narrow_url(urljoin(target.href, location.strip()))
                except Fail:
                    raise Fail(E_UNFETCHABLE) from None  # 跳到不合规的地址:不告诉模型跳到了哪
                continue
            if not 200 <= resp.status < 300:
                raise Fail(E_UNFETCHABLE)
            mime, charset = content_type(resp)
            if mime not in HTML_TYPES and mime not in TEXT_TYPES:
                raise Fail(E_NOT_HTML)
            encoding = (resp.getheader("Content-Encoding") or "").strip().lower()
            if encoding in ("", "identity"):
                gz = False
            elif encoding in ("gzip", "x-gzip"):
                gz = True
            else:
                raise Fail(E_UNFETCHABLE)  # 我们没宣告 br / deflate,对方硬给就是不按规矩
            declared = (resp.getheader("Content-Length") or "").strip()
            if declared.isdigit() and int(declared) > MAX_DECLARED_BYTES:
                raise Fail(E_TOO_LARGE)
            body, truncated = read_body(resp, gz, remaining)
            return first, mime, body, truncated, charset
        finally:
            conn.close()
    raise Fail(E_UNFETCHABLE)


# ───────────────────────── 解码 / 抽取 / 输出 ─────────────────────────

_META_CHARSET_RE = re.compile(rb"""<meta[^>]+charset\s*=\s*["']?\s*([A-Za-z0-9_.:-]+)""", re.I)
_XML_ENC_RE = re.compile(rb"""^\s*<\?xml[^>]+encoding\s*=\s*["']([A-Za-z0-9_.:-]+)""", re.I)
# 按浏览器口径取超集:gb2312 / gbk 页面常混入 gb18030 才有的字;iso-8859-1 实际是 cp1252
_CHARSET_ALIASES = {
    "gb2312": "gb18030",
    "gbk": "gb18030",
    "iso-8859-1": "cp1252",
    "latin1": "cp1252",
    "latin-1": "cp1252",
    "us-ascii": "utf-8",
    "ascii": "utf-8",
}


def pick_charset(hint: str, head: bytes, is_html: bool) -> str:
    if head.startswith(codecs.BOM_UTF8):
        return "utf-8-sig"
    name = hint
    if not name and is_html:
        m = _XML_ENC_RE.match(head) or _META_CHARSET_RE.search(head)
        if m:
            name = m.group(1).decode("ascii", "replace").lower()
    name = _CHARSET_ALIASES.get(name, name)
    if name:
        try:
            info = codecs.lookup(name)
        except LookupError:
            return "utf-8"
        # base64 / rot13 / zlib 这类 bytes↔bytes 编解码器 lookup 得到、decode 不了:只认文本编码
        if getattr(info, "_is_text_encoding", True):
            return name
    return "utf-8"


def decode_body(body: bytes, hint: str, is_html: bool) -> str:
    # errors="replace":256 KiB 处截断可能切在多字节字符中间,只该坏一个字,不该整页退回 utf-8
    try:
        return body.decode(pick_charset(hint, body[:SNIFF_BYTES], is_html), errors="replace")
    except LookupError:
        return body.decode("utf-8", errors="replace")


def extract_markdown(html: str, href: str) -> tuple[str, str, str, str]:
    """→ (title, sitename, date, 正文 markdown);抽不出正文 → E_NO_CONTENT。"""
    # 延迟 import:失败路径(坏 URL / 连不上)不用付它的启动时间与内存;只用 bare_extraction,不用它的下载器
    from trafilatura import bare_extraction

    try:
        # trafilatura 2.2.0 实测:output_format="markdown" 只在 extract() 里生效,bare_extraction 的 .text 会是空;
        # 要同时拿到元数据与 markdown 正文,得用 output_format="python" + include_formatting=True(.text 即 markdown,
        # 标题 / 粗体 / 链接 / 表格都在;相对链接按 url 补成绝对 —— 传的是**输入** URL,不是跳转后的)
        doc = bare_extraction(
            html,
            url=href,
            output_format="python",
            include_formatting=True,
            include_images=False,  # 威胁 9:第三方图不进对话框
            include_links=True,  # 「顺着来源继续读」是这个 skill 独有的用法
            include_tables=True,
            include_comments=False,
            with_metadata=True,
            favor_recall=True,  # 给模型读:宁多一点边栏,不漏正文
        )
    except Exception:  # noqa: BLE001 —— 抽取库对畸形 HTML 的内部异常,一律当没正文
        raise Fail(E_NO_CONTENT) from None
    if doc is None:
        raise Fail(E_NO_CONTENT)
    d = doc.as_dict() if hasattr(doc, "as_dict") else dict(doc)
    body = str(d.get("text") or "").strip()
    if not body:
        raise Fail(E_NO_CONTENT)
    return str(d.get("title") or ""), str(d.get("sitename") or ""), str(d.get("date") or ""), body


_CTRL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def sanitize_markdown(text: str) -> str:
    """输出消毒,只做两件事:去控制字符;把每一个 `![` 写成 `!\\[`。

    **为什么只有一行转义,而不是解析 markdown**(所有者裁定 2026-09-04,回退 codex 第 2–6 轮里长出来的栈式扫描器与链接过滤):
    边界只有一个 —— 输出里不能有能渲染成 <img> 的东西(docs/security.md §0 威胁 9:第三方图 = 访客 IP 泄给第三方 + 跟踪像素)。
    CommonMark 里 `\\[` 永远不能开启图片(内联 `![alt](src)`、reference `![alt][id]`、shortcut `![alt]` 三种形式都以 `![` 开头),
    所以「每个 `![` 无条件转义」是可证明完备的、线性的、不需要解析器 —— 而任何试图「识别图片语法再删掉」的解析器都在每一轮审查里
    被嵌套 / 转义 / 邻接 / 二次方的下一个角落击穿(第 2–6 轮各一条)。代价:text/plain 的 markdown 页与元数据里的图片会以字面
    `![alt](url)` 出现;trafilatura 抽的正文本来就 include_images=False,影响面只有这一类。
    **链接不过滤**:所有者裁定保留正文链接(任务卡 §4 第 8 项);`javascript:` / `data:` 由 react-markdown 既有的 urlTransform 丢弃,
    `mailto:` 它放行、remark-gfm 还会把裸邮箱自动变成 mailto 链接 —— 脚本侧的 scheme 过滤既不在威胁模型里,也拦不住后者。
    页面里**任何**要进输出的文本都过这里:正文与 title / sitename / date 元数据一样(codex 首轮 P1)。"""
    return _CTRL_RE.sub("", text).replace("![", "!\\[")


def render(title: str, sitename: str, date: str, body: str, body_truncated: bool) -> str:
    """拼最终输出。四个字段都是页面给的、都不可信,**全部**过 sanitize_markdown;标题与元数据再压成单行。"""
    parts: list[str] = []
    body = sanitize_markdown(body)
    title = " ".join(sanitize_markdown(title).split()).lstrip("#").strip()
    sitename = " ".join(sanitize_markdown(sitename).split())
    date = " ".join(sanitize_markdown(date).split())
    if title:
        # 正文常以 <h1> 开头,trafilatura 已把它写成 `# 标题`;把正文里那一行去掉,标题只出现一次、且在最前
        head, _, rest = body.lstrip().partition("\n")
        if " ".join(head.split()).lower() == f"# {title}".lower():
            body = rest.lstrip("\n")
        parts.append(f"# {title}")
    meta = " · ".join(x for x in (sitename, date) if x)
    if meta:
        parts.append(meta)
    if body_truncated:
        parts.append("[说明:只读取了页面的一部分(超过 256 KiB 上界,或对方提前断开),正文可能不完整]")
    if len(body) > MAX_OUTPUT_CHARS:
        body = body[:MAX_OUTPUT_CHARS].rstrip() + "\n\n[说明:正文超过 48000 字符,已在此截断]"
    parts.append(body)
    return "\n\n".join(parts).strip() + "\n"


def run(
    req: object,
    *,
    resolve: Resolver = default_resolve,
    connect: Connector = default_connect,
    clock: Callable[[], float] = time.monotonic,
) -> str:
    if not isinstance(req, dict):
        raise Fail(E_BAD_URL)
    first, mime, body, truncated, charset = fetch(req.get("url"), resolve, connect, clock)
    if not body.strip():
        raise Fail(E_NO_CONTENT)  # 204 / 空体:不必进抽取
    is_html = mime in HTML_TYPES
    text = decode_body(body, charset, is_html)
    if is_html:
        title, sitename, date, md = extract_markdown(text, first.href)
    else:
        title, sitename, date, md = "", "", "", text.strip()
        if not md:
            raise Fail(E_NO_CONTENT)
    return render(title, sitename, date, md, truncated)


def main() -> int:
    try:
        req = json.load(sys.stdin)
    except (json.JSONDecodeError, UnicodeDecodeError):
        sys.stdout.write(E_BAD_URL + "\n")
        return 2
    try:
        out = run(req)
    except Fail as f:
        sys.stdout.write(f.code + "\n")
        return 2
    sys.stdout.buffer.write(out.encode("utf-8", "replace"))
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
