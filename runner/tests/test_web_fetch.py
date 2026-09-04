"""web-fetch 的单元测试(R-WEBFETCH 验收 1–6、8):不打真网 —— `fetch.run()` 接受注入的 resolve / connect / clock。

在 runner 镜像里跑(`dev.ps1 runner-test`,`--network none`;有 trafilatura),也能在宿主上用系统 python 跑
(没装 trafilatura 时抽取相关的用例自动跳过)。本目录**不进镜像、不进清单、不进库**。
"""
from __future__ import annotations

import gzip
import importlib.util
import io
import os
import re
import sys
import unittest
from typing import Callable

HERE = os.path.dirname(os.path.abspath(__file__))
CANDIDATES = (
    os.path.join(HERE, "..", "skills", "web-fetch", "scripts", "fetch.py"),
    "/opt/skills/web-fetch/scripts/fetch.py",
)


def load_fetch():
    for path in CANDIDATES:
        if os.path.isfile(path):
            spec = importlib.util.spec_from_file_location("web_fetch_under_test", path)
            mod = importlib.util.module_from_spec(spec)
            assert spec.loader is not None
            spec.loader.exec_module(mod)
            return mod
    raise RuntimeError("fetch.py not found")


F = load_fetch()
HAS_TRAFILATURA = importlib.util.find_spec("trafilatura") is not None


# ───────────────────────── 假 socket / 假响应 ─────────────────────────


class FakeSock:
    """http.client 用到的最小面:makefile / sendall / settimeout / getpeername / close。"""

    def __init__(self, response: bytes, peer: str):
        self.response = response
        self.peer = peer
        self.sent = bytearray()
        self.closed = False
        self.timeouts: list[float] = []

    def makefile(self, mode="rb", buffering=None, **_kw):
        return io.BytesIO(self.response)

    def sendall(self, data: bytes) -> None:
        self.sent += data

    def settimeout(self, t: float) -> None:
        self.timeouts.append(t)

    def getpeername(self):
        return (self.peer, 443)

    def close(self) -> None:
        self.closed = True

    def shutdown(self, _how) -> None:
        pass


def http_response(status: int = 200, headers: dict | None = None, body: bytes = b"", reason: str = "OK") -> bytes:
    h = {"Connection": "close"}
    h.update(headers or {})
    head = f"HTTP/1.1 {status} {reason}\r\n" + "".join(f"{k}: {v}\r\n" for k, v in h.items()) + "\r\n"
    return head.encode("latin-1") + body


def html_page(body: str, title: str = "Sample Title") -> bytes:
    paras = "".join(f"<p>Paragraph {i}: {body} <a href='/next/{i}'>continue {i}</a></p>" for i in range(12))
    return (
        f"<html><head><title>{title}</title><meta property='og:site_name' content='SampleSite'></head>"
        f"<body><nav>menu one two</nav><article><h1>{title}</h1>{paras}</article><footer>foot</footer></body></html>"
    ).encode("utf-8")


class Script:
    """按 (host, path) 出响应的假服务;记录每次 connect 的 (ip, host, timeout) 与每个 socket。"""

    def __init__(self, routes: dict[tuple[str, str], bytes], peer_of: Callable[[str], str] | None = None):
        self.routes = routes
        self.peer_of = peer_of or (lambda ip: ip)
        self.connects: list[tuple[str, str, float]] = []
        self.socks: list[FakeSock] = []

    def connect(self, ip: str, host: str, timeout: float) -> FakeSock:
        self.connects.append((ip, host, timeout))
        # 请求路径要等 http.client 发出来才知道:socket 收到 GET 行后再选响应 —— 用一个惰性 BytesIO
        sock = LazySock(self, host, self.peer_of(ip))
        self.socks.append(sock)
        return sock


class LazySock(FakeSock):
    def __init__(self, script: Script, host: str, peer: str):
        super().__init__(b"", peer)
        self.script = script
        self.host = host

    def makefile(self, mode="rb", buffering=None, **_kw):
        line = bytes(self.sent).split(b"\r\n", 1)[0].decode("latin-1")
        path = line.split(" ")[1] if line.startswith("GET ") else "/"
        resp = self.script.routes.get((self.host, path))
        if resp is None:
            resp = http_response(404, {"Content-Type": "text/html"}, b"<html><body>nope</body></html>", "Not Found")
        return io.BytesIO(resp)


def resolver(table: dict[str, list[str]], calls: list[str] | None = None):
    def resolve(host: str) -> list[str]:
        if calls is not None:
            calls.append(host)
        if host not in table:
            raise OSError("name not known")
        return list(table[host])

    return resolve


PUBLIC_V4 = "93.184.216.34"
PUBLIC_V6 = "2606:4700::1111"


def run(url: object, script: Script, table: dict[str, list[str]] | None = None, clock=None, calls=None) -> str:
    table = table or {"example.com": [PUBLIC_V4]}
    return F.run({"url": url}, resolve=resolver(table, calls), connect=script.connect, clock=clock or (lambda: 0.0))


def code_of(fn) -> str:
    try:
        fn()
    except F.Fail as f:
        return f.code
    raise AssertionError("expected Fail")


# ───────────────────────── 验收 1:入参收窄 ─────────────────────────


class NarrowUrl(unittest.TestCase):
    def test_rejects_every_non_https_or_non_domain_form(self):
        bad = [
            "http://example.com/",  # 明文
            "ftp://example.com/",
            "https://example.com:8443/",  # 非 443 端口
            "https://example.com:80/",
            "https://user:pw@example.com/",  # 内嵌凭据
            "https://user@example.com/",
            "https://@example.com/",
            "https://127.0.0.1/",  # v4 点分
            "https://2130706433/",  # 整数
            "https://0177.0.0.1/",  # 八进制
            "https://0x7f000001/",  # 十六进制
            "https://0x7f.0x0.0x0.0x1/",
            "https://127.1/",
            "https://[::1]/",  # v6 方括号
            "https://[::ffff:127.0.0.1]/",
            "https://localhost/",  # 无点(不是域名清单,是「至少一个点」)
            "https://example/",
            "https://example.com./",  # 尾点
            "https://-bad.example.com/",
            "https://exa mple.com/",
            "https://example.com/pa th",  # 空白
            "https://example.com/\x00",  # 控制字符
            "https://example.c0m/",  # 末段含数字
            "https://example.com" + "/a" * 1100,  # > 2048
            "",
            None,
            123,
            "https:///path",
            "https://example.com\\@evil.example/",
        ]
        for href in bad:
            with self.subTest(href=href):
                self.assertEqual(code_of(lambda: F.narrow_url(href)), F.E_BAD_URL)

    def test_accepts_domains_and_normalises(self):
        t = F.narrow_url("https://Example.COM:443/a/b?x=1&y=%20z#frag")
        self.assertEqual((t.host, t.path), ("example.com", "/a/b?x=1&y=%20z"))
        self.assertEqual(F.narrow_url("https://example.com").path, "/")
        self.assertEqual(F.narrow_url("https://example.com/中文/页").path, "/%E4%B8%AD%E6%96%87/%E9%A1%B5")
        # IDN 先 idna 编码;xn-- 末段合法
        self.assertEqual(F.narrow_url("https://例子.测试/").host, "xn--fsqu00a.xn--0zwm56d")
        self.assertEqual(F.narrow_url("https://xn--fsqu00a.xn--0zwm56d/").host, "xn--fsqu00a.xn--0zwm56d")
        # 没有域名清单:这些名字在名字层**不拒**,由地址校验覆盖(验收 2)
        for host in ("foo.local", "x.internal", "metadata.google.internal", "postgres.back"):
            self.assertEqual(F.narrow_url(f"https://{host}/").host, host)


# ───────────────────────── 验收 2:逐地址校验 ─────────────────────────


class AddressCheck(unittest.TestCase):
    BLOCKED = [
        "10.0.0.1", "172.16.0.1", "172.31.255.254", "192.168.1.1", "169.254.169.254", "169.254.0.23", "127.0.0.1",
        "127.1.2.3", "0.0.0.0", "0.1.2.3", "100.64.0.1", "100.127.255.255", "224.0.0.1", "239.255.255.255",
        "255.255.255.255", "240.0.0.1", "192.0.0.1", "192.0.2.1", "198.18.0.1", "198.51.100.1", "203.0.113.1",
        "192.88.99.1",
        "::1", "::", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:8.8.8.8", "::7f00:1", "fc00::1", "fd12::1",
        "fe80::1", "fe80::1%eth0", "fec0::1", "ff02::1", "64:ff9b::7f00:1", "64:ff9b::808:808", "2002:7f00:1::1",
        "2001::1", "2001:db8::1", "100::1",
        "not-an-ip", "", "1.2.3", "example.com",
    ]
    PUBLIC = ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700::1111", "2a00:1450:4001:80b::200e", "2400:3200::1"]

    def test_blocked_addresses(self):
        for ip in self.BLOCKED:
            with self.subTest(ip=ip):
                self.assertFalse(F.is_public_address(ip))

    def test_public_addresses(self):
        for ip in self.PUBLIC:
            with self.subTest(ip=ip):
                self.assertTrue(F.is_public_address(ip))

    def test_any_private_result_rejects_whole_set(self):
        # 两个地址其一私网 → 拒(不挑);空 → 拒;解析失败 → 拒;全部同一个短码
        for ips in ([PUBLIC_V4, "10.0.0.1"], ["10.0.0.1", PUBLIC_V4], [PUBLIC_V6, "::1"], [], ["169.254.169.254"]):
            with self.subTest(ips=ips):
                s = Script({})
                self.assertEqual(code_of(lambda: run("https://example.com/", s, {"example.com": ips})), F.E_UNFETCHABLE)
                self.assertEqual(s.connects, [], "地址校验不过就不该连")
        s = Script({})
        self.assertEqual(code_of(lambda: run("https://nx.example/", s, {})), F.E_UNFETCHABLE)
        self.assertEqual(s.connects, [])


# ───────────────────────── 验收 3:钉住地址 + 固定请求头 ─────────────────────────


class Pinning(unittest.TestCase):
    def test_connects_to_validated_address_and_sends_fixed_headers(self):
        s = Script({("example.com", "/p?q=1"): http_response(200, {"Content-Type": "text/plain"}, b"hello world")})
        out = run("https://example.com/p?q=1", s)
        self.assertEqual(out.strip(), "hello world")
        self.assertEqual([(ip, host) for ip, host, _ in s.connects], [(PUBLIC_V4, "example.com")])
        self.assertLessEqual(s.connects[0][2], F.CONNECT_TIMEOUT_S)
        sent = bytes(s.socks[0].sent).decode("latin-1")
        self.assertTrue(sent.startswith("GET /p?q=1 HTTP/1.1\r\n"))
        self.assertIn("Host: example.com\r\n", sent)
        self.assertIn(f"User-Agent: {F.USER_AGENT}\r\n", sent)
        self.assertIn("Accept-Encoding: gzip\r\n", sent)
        self.assertIn("Connection: close\r\n", sent)
        for forbidden in ("Cookie", "Authorization", "Proxy", "Content-Length"):
            self.assertNotIn(forbidden.lower(), sent.lower())
        self.assertTrue(s.socks[0].closed)

    def test_peer_mismatch_is_rejected(self):
        s = Script({("example.com", "/"): http_response(200, {"Content-Type": "text/plain"}, b"x")}, peer_of=lambda ip: "10.0.0.9")
        self.assertEqual(code_of(lambda: run("https://example.com/", s)), F.E_UNFETCHABLE)
        self.assertEqual(len(s.connects), 1)
        self.assertTrue(s.socks[0].closed)
        self.assertEqual(bytes(s.socks[0].sent), b"", "核对 getpeername 之前不发任何字节")

    def test_v6_scope_id_compares_equal(self):
        self.assertTrue(F.same_address("fe80::1%eth0", "fe80::1"))
        self.assertFalse(F.same_address("1.2.3.4", "1.2.3.5"))

    def test_falls_through_to_next_address_when_connect_fails(self):
        seen = []

        def connect(ip, host, timeout):
            seen.append(ip)
            if ip == "8.8.8.8":
                raise ConnectionRefusedError()
            return LazySock(Script({("example.com", "/"): http_response(200, {"Content-Type": "text/plain"}, b"ok")}), host, ip)

        out = F.run({"url": "https://example.com/"}, resolve=resolver({"example.com": ["8.8.8.8", "1.1.1.1"]}), connect=connect, clock=lambda: 0.0)
        self.assertEqual(out.strip(), "ok")
        self.assertEqual(seen, ["8.8.8.8", "1.1.1.1"])

    def test_all_addresses_fail(self):
        def refuse(ip, host, timeout):
            raise ConnectionRefusedError()

        def slow(ip, host, timeout):
            raise TimeoutError()

        self.assertEqual(code_of(lambda: F.run({"url": "https://example.com/"}, resolve=resolver({"example.com": [PUBLIC_V4]}), connect=refuse, clock=lambda: 0.0)), F.E_UNFETCHABLE)
        self.assertEqual(code_of(lambda: F.run({"url": "https://example.com/"}, resolve=resolver({"example.com": [PUBLIC_V4]}), connect=slow, clock=lambda: 0.0)), F.E_TIMEOUT)


# ───────────────────────── 验收 4:重定向 ─────────────────────────


def redirect(location: str, status: int = 302) -> bytes:
    return http_response(status, {"Location": location, "Content-Type": "text/html"}, b"", "Found")


TEXT_OK = http_response(200, {"Content-Type": "text/plain; charset=utf-8"}, b"final page")


class Redirects(unittest.TestCase):
    def test_follows_absolute_relative_and_scheme_relative_locations_re_resolving_each_hop(self):
        calls: list[str] = []
        s = Script(
            {
                ("example.com", "/a"): redirect("https://example.com/b", 301),
                ("example.com", "/b"): redirect("/c"),
                ("example.com", "/c"): redirect("//other.example/d", 307),
                ("other.example", "/d"): TEXT_OK,
            }
        )
        out = run("https://example.com/a", s, {"example.com": [PUBLIC_V4], "other.example": ["1.1.1.1"]}, calls=calls)
        self.assertEqual(out.strip(), "final page")
        self.assertEqual(calls, ["example.com", "example.com", "example.com", "other.example"], "每跳重新解析")
        self.assertEqual([ip for ip, _, _ in s.connects], [PUBLIC_V4, PUBLIC_V4, PUBLIC_V4, "1.1.1.1"], "每跳重新钉")
        self.assertTrue(all(sock.closed for sock in s.socks))

    def test_fourth_redirect_is_rejected(self):
        s = Script({("example.com", f"/{i}"): redirect(f"/{i + 1}") for i in range(6)})
        self.assertEqual(code_of(lambda: run("https://example.com/0", s)), F.E_UNFETCHABLE)
        self.assertEqual(len(s.connects), F.MAX_HOPS + 1)

    def test_redirect_to_private_or_bad_url_is_unfetchable_not_bad_url(self):
        cases = {
            "https://internal.example/": {"internal.example": ["10.0.0.5"]},
            "http://example.com/plain": {},
            "https://example.com:8080/": {},
            "https://127.0.0.1/": {},
            "https://[::1]/": {},
            "https://u:p@example.com/": {},
            "javascript:alert(1)": {},
        }
        for location, extra in cases.items():
            with self.subTest(location=location):
                s = Script({("example.com", "/r"): redirect(location)})
                table = {"example.com": [PUBLIC_V4], **extra}
                self.assertEqual(code_of(lambda: run("https://example.com/r", s, table)), F.E_UNFETCHABLE)
                self.assertEqual(len(s.connects), 1, "不合规的跳转目标不该被连接")

    def test_redirect_without_location_and_non_2xx(self):
        for resp in (http_response(302, {"Content-Type": "text/html"}, b"", "Found"), http_response(404, {}, b"x", "Not Found"),
                     http_response(500, {}, b"x", "Err"), http_response(304, {}, b"", "Not Modified"), http_response(204, {}, b"", "No Content")):
            with self.subTest(resp=resp[:20]):
                s = Script({("example.com", "/"): resp})
                self.assertIn(code_of(lambda: run("https://example.com/", s)), (F.E_UNFETCHABLE, F.E_NO_CONTENT))


# ───────────────────────── 验收 5:解压炸弹 / 上界 ─────────────────────────


class BodyLimits(unittest.TestCase):
    def fetch_body(self, resp: bytes):
        s = Script({("example.com", "/"): resp})
        first, mime, body, truncated, charset = F.fetch("https://example.com/", resolver({"example.com": [PUBLIC_V4]}), s.connect, lambda: 0.0)
        return body, truncated, s

    def test_gzip_bomb_stops_at_decompressed_cap(self):
        bomb = gzip.compress(b"\0" * (64 * 1024 * 1024), compresslevel=9)  # 64 MiB → 约 64 KiB
        self.assertLess(len(bomb), 128 * 1024)
        body, truncated, s = self.fetch_body(http_response(200, {"Content-Type": "text/html", "Content-Encoding": "gzip"}, bomb))
        self.assertEqual(len(body), F.MAX_BODY_BYTES)
        self.assertTrue(truncated)
        self.assertTrue(s.socks[0].closed)

    def test_plain_body_is_capped(self):
        body, truncated, _ = self.fetch_body(http_response(200, {"Content-Type": "text/html"}, b"a" * (F.MAX_BODY_BYTES + 5)))
        self.assertEqual(len(body), F.MAX_BODY_BYTES)
        self.assertTrue(truncated)
        body, truncated, _ = self.fetch_body(http_response(200, {"Content-Type": "text/html"}, b"a" * 1000))
        self.assertEqual(len(body), 1000)
        self.assertFalse(truncated)

    def test_gzip_normal_page_roundtrips(self):
        page = html_page("hello")
        body, truncated, _ = self.fetch_body(http_response(200, {"Content-Type": "text/html", "Content-Encoding": "gzip"}, gzip.compress(page)))
        self.assertEqual(body, page)
        self.assertFalse(truncated)

    def test_incomplete_gzip_stream_is_marked_truncated(self):
        # 对方提前掐断:gzip 尾没到,flush() 仍吐出已解的部分 —— 必须标「不完整」,不能当完整页面(codex 首轮 P2)
        page = html_page("hello")
        cut = gzip.compress(page)[:-24]
        body, truncated, _ = self.fetch_body(http_response(200, {"Content-Type": "text/html", "Content-Encoding": "gzip"}, cut))
        self.assertTrue(truncated)
        self.assertGreater(len(body), 0)
        self.assertLess(len(body), len(page))
        out = F.render("T", "", "", body.decode("utf-8", "replace"), truncated)
        self.assertIn("正文可能不完整", out)

    def test_unsupported_encoding_and_declared_size(self):
        s = Script({("example.com", "/"): http_response(200, {"Content-Type": "text/html", "Content-Encoding": "br"}, b"x")})
        self.assertEqual(code_of(lambda: run("https://example.com/", s)), F.E_UNFETCHABLE)
        s = Script({("example.com", "/"): http_response(200, {"Content-Type": "text/html", "Content-Length": str(F.MAX_DECLARED_BYTES + 1)}, b"x")})
        self.assertEqual(code_of(lambda: run("https://example.com/", s)), F.E_TOO_LARGE)
        s = Script({("example.com", "/"): http_response(200, {"Content-Type": "text/html", "Content-Encoding": "gzip"}, b"not gzip at all")})
        self.assertEqual(code_of(lambda: run("https://example.com/", s)), F.E_UNFETCHABLE)

    def test_chunked_transfer_is_decoded(self):
        chunked = b"5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n"
        body, truncated, _ = self.fetch_body(http_response(200, {"Content-Type": "text/plain", "Transfer-Encoding": "chunked"}, chunked))
        self.assertEqual(body, b"hello world")

    def test_total_timeout_uses_injected_clock(self):
        ticks = iter([0.0, 0.0, 0.0, 30.0, 30.0, 30.0, 30.0])
        s = Script({("example.com", "/"): TEXT_OK})
        self.assertEqual(code_of(lambda: run("https://example.com/", s, clock=lambda: next(ticks))), F.E_TIMEOUT)

    def test_trickling_body_hits_total_deadline_between_receives(self):
        # codex 第 2 轮 P2:每次底层 recv 只给几个字节、且每次都在空闲超时之内 —— 总时长必须仍在 recv 之间被核到。
        # 假 socket 每次 raw read 只吐 4 字节;注入时钟每被问一次前进 3 s(解析 / 连接阶段各问几次,读体阶段每个 recv 问一次)
        body = b"x" * 4096
        resp = http_response(200, {"Content-Type": "text/plain", "Content-Length": str(len(body))}, body)

        class Trickle(io.RawIOBase):
            def __init__(self, data):
                self.data, self.pos = data, 0

            def readable(self):
                return True

            def readinto(self, b):
                piece = self.data[self.pos : self.pos + 4]
                n = len(piece)
                b[:n] = piece
                self.pos += n
                return n

        class TrickleSock(FakeSock):
            def makefile(self, mode="rb", buffering=None, **_kw):
                return io.BufferedReader(Trickle(self.response))

        t = [0.0]

        def clock():
            t[0] += 3.0
            return t[0]

        connects = []

        def connect(ip, host, timeout):
            connects.append(ip)
            return TrickleSock(resp, ip)

        code = code_of(lambda: F.run({"url": "https://example.com/"}, resolve=resolver({"example.com": [PUBLIC_V4]}), connect=connect, clock=clock))
        self.assertEqual(code, F.E_TIMEOUT)
        self.assertEqual(connects, [PUBLIC_V4])
        # 对照:时钟不走时同一份滴流体能完整读完(read1 不改变正常路径)
        out = F.run({"url": "https://example.com/"}, resolve=resolver({"example.com": [PUBLIC_V4]}), connect=lambda ip, host, to: TrickleSock(resp, ip), clock=lambda: 0.0)
        self.assertEqual(out.strip(), "x" * 4096)


# ───────────────────────── 验收 6:内容类型与编码 ─────────────────────────


class ContentTypes(unittest.TestCase):
    def test_non_html_types_are_rejected(self):
        for ct in ("application/json", "application/pdf", "image/png", "application/octet-stream", "text/css", "application/xml"):
            with self.subTest(ct=ct):
                s = Script({("example.com", "/"): http_response(200, {"Content-Type": ct}, b"{}")})
                self.assertEqual(code_of(lambda: run("https://example.com/", s)), F.E_NOT_HTML)

    def test_charset_from_header_meta_bom_and_aliases(self):
        self.assertEqual(F.pick_charset("gbk", b"", True), "gb18030")
        self.assertEqual(F.pick_charset("", b"<html><head><meta charset=GB2312></head>", True), "gb18030")
        self.assertEqual(F.pick_charset("", b'<meta http-equiv="Content-Type" content="text/html; charset=big5">', True), "big5")
        self.assertEqual(F.pick_charset("", b'<?xml version="1.0" encoding="ISO-8859-1"?><html>', True), "cp1252")
        self.assertEqual(F.pick_charset("", b"\xef\xbb\xbf<html>", True), "utf-8-sig")
        self.assertEqual(F.pick_charset("no-such-charset-zz", b"", True), "utf-8")
        # rot13 / base64 是 bytes↔bytes(或 str↔str)编解码器,不是文本编码:lookup 得到但不能用来 decode,必须回落 utf-8
        self.assertEqual(F.pick_charset("rot13", b"", True), "utf-8")
        self.assertEqual(F.pick_charset("base64", b"", True), "utf-8")
        self.assertEqual(F.pick_charset("", b"<meta charset=gbk>", False), "utf-8", "text/plain 不嗅探 meta")

    def test_gbk_plain_text_decodes(self):
        text = "中文内容测试"
        s = Script({("example.com", "/"): http_response(200, {"Content-Type": "text/plain; charset=gbk"}, text.encode("gbk"))})
        self.assertEqual(run("https://example.com/", s).strip(), text)

    def test_bytes_to_bytes_codecs_cannot_be_selected(self):
        # rot13 / base64 / zlib 不是文本编码,codecs.lookup 能找到但 decode 会 LookupError —— 必须回落到 utf-8
        s = Script({("example.com", "/"): http_response(200, {"Content-Type": "text/plain; charset=base64"}, b"aGk=")})
        self.assertIn(run("https://example.com/", s).strip(), ("aGk=",))


# ───────────────────────── 抽取 / 输出(需要 trafilatura;宿主上没装就跳过)─────────────────────────


@unittest.skipUnless(HAS_TRAFILATURA, "trafilatura not installed (run inside the runner image)")
class Extraction(unittest.TestCase):
    def test_html_becomes_markdown_with_title_site_links_and_no_images(self):
        page = html_page("body text here", title="Extraction Test")
        page = page.replace(b"<footer>", b"<img src='https://tracker.example/p.gif'><footer>")
        s = Script({("example.com", "/article"): http_response(200, {"Content-Type": "text/html; charset=utf-8"}, page)})
        out = run("https://example.com/article", s)
        self.assertTrue(out.startswith("# Extraction Test\n"))
        self.assertEqual(out.count("# Extraction Test"), 1, "标题不重复(正文的 h1 已是标题)")
        self.assertIn("SampleSite", out)
        self.assertIn("body text here", out)
        # 相对链接按**输入** URL 补成绝对(trafilatura 的 url= 参数),不是按跳转后的
        self.assertIn("](https://example.com/next/", out, "保留链接")
        self.assertNotIn("![", out, "不含图片")
        self.assertNotIn("tracker.example", out)
        self.assertNotIn(PUBLIC_V4, out, "不外泄解析到的地址")

    def test_no_content_and_javascript_links_and_truncation_note(self):
        s = Script({("example.com", "/empty"): http_response(200, {"Content-Type": "text/html"}, b"<html><body><script>x()</script></body></html>")})
        self.assertEqual(code_of(lambda: run("https://example.com/empty", s)), F.E_NO_CONTENT)
        # 链接原样保留(所有者裁定 §4-8;非法 scheme 由 react-markdown 的 urlTransform 处理),图片开启符转义
        md = F.sanitize_markdown("a [x](javascript:alert(1)) b [y](https://ok.example/) c ![img](https://i.example/p.png) d [z](mailto:a@b) e [rel](page.html)")
        self.assertEqual(md, "a [x](javascript:alert(1)) b [y](https://ok.example/) c !\\[img](https://i.example/p.png) d [z](mailto:a@b) e [rel](page.html)")
        self.assertEqual(F.sanitize_markdown("[w](https://en.wikipedia.org/wiki/Foo_(bar))"), "[w](https://en.wikipedia.org/wiki/Foo_(bar))")
        big = html_page("word " * 1000)  # 12 段 × 5000 字符 > 48000
        s = Script({("example.com", "/big"): http_response(200, {"Content-Type": "text/html"}, big)})
        out = run("https://example.com/big", s)
        self.assertLessEqual(len(out), F.MAX_OUTPUT_CHARS + 200)
        self.assertIn("已在此截断", out)

    def test_redirect_target_hostname_does_not_leak_into_output(self):
        page = html_page("redirected content", title="Moved")
        s = Script({("example.com", "/old"): redirect("https://redirected.example/new"), ("redirected.example", "/new"): http_response(200, {"Content-Type": "text/html"}, page)})
        out = run("https://example.com/old", s, {"example.com": [PUBLIC_V4], "redirected.example": ["1.1.1.1"]})
        self.assertIn("redirected content", out)
        self.assertNotIn("redirected.example", out)
        self.assertNotIn("1.1.1.1", out)


# ───────────────────────── 输出消毒(不需要 trafilatura:render / sanitize_markdown 是纯函数)─────────────────────────


class OutputSanitizing(unittest.TestCase):
    """消毒器的契约(所有者裁定 2026-09-04):输出里不存在任何能开启图片的 `![`(全部写成 `!\\[`),控制字符去掉;其余原样。
    图片语法留成字面文字是接受的代价;链接不过滤。"""

    IMG_OPENER = re.compile(r"(?<!\\)!\[")

    def test_metadata_fields_are_sanitized_like_the_body(self):
        # codex 首轮 P1:title / sitename / date 是页面给的,标题里塞图片语法不能绕过
        out = F.render(
            "![pixel](https://tracker.example/p.gif) Real Title",
            "![s](https://tracker.example/s.gif) Site",
            "2026-09-03 ![d][ref]",
            "body ![b](https://tracker.example/b.gif) text",
            False,
        )
        self.assertNotRegex(out, self.IMG_OPENER)
        self.assertEqual(out.count("!\\["), 4)
        self.assertTrue(out.startswith("# !\\[pixel](https://tracker.example/p.gif) Real Title\n"), out)

    def test_every_image_form_is_neutralised_and_nothing_else_changes(self):
        # 内联 / reference / shortcut / 嵌套 / 转义方括号 / 邻接 / 空 alt:一律只是 `![` → `!\[`,别的一个字不动
        cases = [
            "![a](https://evil.example/p.gif)",
            "![a [b]](https://evil.example/p.gif)",
            "![a [b [c]]](https://evil.example/p.gif) tail",
            "![a\\]](https://evil.example/p.gif)",
            "![a][ref]\n\n[ref]: https://evil.example/r.gif",
            "![a]\n\n[a]: https://evil.example/s.gif",
            "![outer ![inner](https://evil.example/i.gif)][outer]",
            "![unterminated (https://evil.example/p.gif)",
            "text ![](https://evil.example/e.gif) end",
            "[[click]](data:x)(mailto:evil@example.com)",
            "[x]![](https://e.example/e.gif)(mailto:z)",
            "see ![alt][img1] here\n\n[img1]: https://tracker.example/x.png \"t\"\nkeep [link](https://ok.example/) and text",
            "\\![escaped](https://ok.example/) stays a link",
            "[a](https://ok.example/) [b](mailto:c) [d](javascript:x)",
        ]
        for src in cases:
            with self.subTest(src=src):
                got = F.sanitize_markdown(src)
                self.assertEqual(got, src.replace("![", "!\\["))
                self.assertNotRegex(got, self.IMG_OPENER)

    def test_control_characters_are_removed_before_anything_else(self):
        self.assertEqual(F.sanitize_markdown("a\x00b\x1f\x7fc\td\ne"), "abc\td\ne")
        self.assertEqual(F.sanitize_markdown("!\x00[a](https://e.example/p.gif)"), "!\\[a](https://e.example/p.gif)")

    def test_title_leading_hashes_and_newlines_are_collapsed(self):
        out = F.render("## Multi\nline\ttitle", "", "", "body", False)
        self.assertTrue(out.startswith("# Multi line title\n"))

    def test_hostile_markdown_is_sanitized_in_linear_time(self):
        # codex 第 3 轮 P2:大量未闭合 / 半闭合的图片开启符不得让消毒变成二次方(256 KiB 正文 → 占满 egress 唯一并发名额)
        import time

        cap = F.MAX_BODY_BYTES
        for name, src in (
            ("all-openers", "![" * (cap // 2)),
            ("half-closed", "![a](" * (cap // 5)),
            ("deep-nesting", "![" * (cap // 10) + "x" + "](u)" * (cap // 10)),
            ("brackets-sea", "[" * (cap // 2)),
            ("many-images", "![a](https://e.example/p.gif) " * (cap // 30)),
            ("empty-unsafe-links", "[](data:x)" * (cap // 10)),  # codex 第 6 轮 P2:每次删除留空片段会让守卫倒扫二次方
            ("empty-images", "![](u)" * (cap // 6)),
            ("adjacent-guard-storm", "[[a]](data:x)(" * (cap // 14)),
        ):
            with self.subTest(name=name):
                t0 = time.perf_counter()
                got = F.sanitize_markdown(src)
                secs = time.perf_counter() - t0
                self.assertLess(secs, 2.0, f"{name}: {secs:.2f}s")
                self.assertNotRegex(got, r"(?<!\\)!\[")


# ───────────────────────── 验收 8:失败路径的 stdout 只有短码 ─────────────────────────


class FailureOutput(unittest.TestCase):
    def test_main_writes_only_the_code(self):
        for stdin, expected in (("{", F.E_BAD_URL), ('{"url": "http://example.com/"}', F.E_BAD_URL), ("[]", F.E_BAD_URL)):
            with self.subTest(stdin=stdin):
                saved_in, saved_out = sys.stdin, sys.stdout
                out = io.StringIO()
                try:
                    sys.stdin, sys.stdout = io.StringIO(stdin), out
                    rc = F.main()
                finally:
                    sys.stdin, sys.stdout = saved_in, saved_out
                self.assertEqual(rc, 2)
                self.assertEqual(out.getvalue(), expected + "\n")

    def test_all_codes_are_a_closed_set(self):
        for code in (F.E_BAD_URL, F.E_UNFETCHABLE, F.E_TIMEOUT, F.E_NOT_HTML, F.E_TOO_LARGE, F.E_NO_CONTENT):
            self.assertRegex(code, r"^E_[A-Z][A-Z0-9_]{1,30}$")


if __name__ == "__main__":
    unittest.main(verbosity=2)
