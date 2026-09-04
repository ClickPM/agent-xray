"""病态输入夹具(R-WEBFETCH 验收 7):预研 study.md §4.3 的那几种形状,喂给 fetch.run()(注入假 connect,不打网),
量每种在 **runner 的 rlimit 下**(经 /opt/launch.py 起)的耗时与地址空间 / RSS 峰值。

用法(在 runner 镜像里;dev.ps1 runner-test 的第二段就是它):
  /opt/venv/bin/python -I -B /opt/launch.py 30 /tests/pathological.py
输出一张表:形状 · 字节 · 结果(ok / 短码 / 异常)· 秒 · VmPeak · VmHWM。判据:每种都在 total_timeout 内结束、
不 MemoryError(或 MemoryError 也只是一次失败)、峰值明显低于 egress 容器的 mem_limit 256m。
"""
from __future__ import annotations

import importlib.util
import io
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
for candidate in (os.path.join(HERE, "..", "skills", "web-fetch", "scripts", "fetch.py"), "/opt/skills/web-fetch/scripts/fetch.py"):
    if os.path.isfile(candidate):
        spec = importlib.util.spec_from_file_location("web_fetch_under_test", candidate)
        F = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(F)  # type: ignore[union-attr]
        break
else:
    raise SystemExit("fetch.py not found")

CAP = F.MAX_BODY_BYTES


def shapes() -> list[tuple[str, bytes]]:
    prose = "".join(f"<p>{'lorem ipsum dolor sit amet ' * 12}</p>" for _ in range(2700))
    out = [
        ("nested-div-1000", "<div>" * 1000 + "deep text here" + "</div>" * 1000),
        ("nested-div-2000", "<div>" * 2000 + "deep text here" + "</div>" * 2000),
        ("nested-div-4000", "<div>" * 4000 + "deep text here" + "</div>" * 4000),
        ("unclosed-inline-24000", "<b><i>" * 12000 + "text"),
        ("links-12000", "".join(f"<a href='/l/{i}'>link number {i}</a> " for i in range(12000))),
        ("table-90k-rows-cut", "<table>" + "".join(f"<tr><td>{i}</td><td>cell value</td><td>x</td></tr>" for i in range(90000)) + "</table>"),
        ("prose-2700-p", prose),
        ("attr-64k", "<p " + "data-x='" + "y" * 65000 + "'>text</p>"),
        ("svg-blob", "<svg>" + "<path d='M0 0 L1 1'/>" * 20000 + "</svg><p>after svg</p>"),
        ("comments-sea", "<!-- c -->" * 30000 + "<p>after comments</p>"),
        ("zeros", "\0" * CAP),
    ]
    result = []
    for name, body in out:
        html = ("<html><head><title>T</title></head><body>" + body + "</body></html>").encode("utf-8", "replace")[:CAP]
        result.append((name, html))
    return result


class Sock:
    def __init__(self, resp: bytes):
        self.resp = resp
        self.sent = bytearray()

    def makefile(self, *_a, **_k):
        return io.BytesIO(self.resp)

    def sendall(self, d):
        self.sent += d

    def settimeout(self, _t):
        pass

    def getpeername(self):
        return ("93.184.216.34", 443)

    def close(self):
        pass


def vm() -> tuple[int, int]:
    peak = hwm = 0
    with open("/proc/self/status") as f:
        for line in f:
            if line.startswith("VmPeak"):
                peak = int(line.split()[1]) // 1024
            elif line.startswith("VmHWM"):
                hwm = int(line.split()[1]) // 1024
    return peak, hwm


def main() -> int:
    print(f"{'shape':<24}{'bytes':>9}  {'result':<14}{'secs':>7}  {'VmPeak':>7}  {'VmHWM':>6}")
    worst = 0.0
    for name, html in shapes():
        resp = b"HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n" + html
        t0 = time.monotonic()
        try:
            out = F.run({"url": "https://example.com/"}, resolve=lambda _h: ["93.184.216.34"], connect=lambda *_a: Sock(resp), clock=time.monotonic)
            result = f"ok({len(out)})"
        except F.Fail as f:
            result = f.code
        except MemoryError:
            result = "MemoryError"
        except RecursionError:
            result = "RecursionError"
        secs = time.monotonic() - t0
        worst = max(worst, secs)
        peak, hwm = vm()
        print(f"{name:<24}{len(html):>9}  {result:<14}{secs:>7.2f}  {peak:>5}MB  {hwm:>4}MB", flush=True)
    print(f"worst {worst:.2f}s; final VmPeak/VmHWM {vm()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
