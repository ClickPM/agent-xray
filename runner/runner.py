"""skill-runner:agent `skill_run` 工具的执行容器守护进程(R-SKILLS-2;docs/security.md §1 R-SKILLS-2 补记)。

它做的事只有一件:收到 `POST /run {skill, script, sha256, input, timeoutMs}` 之后,在**一次性的进程与工作目录**里
用 venv 解释器跑镜像里预置的那个脚本,把 stdout / stderr(各按字节截到 256 KiB)与退出码回给 api。

八条附加约束在本文件里的落点(编号对应 docs/security.md §1 R-SKILLS-2 补记):
  1. 入参只有 skill / script(两个闭集)与 input(JSON 对象):没有 code / path / argv / interpreter / env 字段;
     解释器是常量 PYTHON,命令行是常量 [python -I -B <脚本>]。
  2. 可执行集合 = /opt/manifest.json(构建期由 tools/skills-manifest 生成,与 api 的 skills.generated.ts 同源)。
     不在清单里的 skill / 脚本一律 404,**没有**「按路径找文件」这回事。
  3. 双上限:请求带的 timeoutMs(api 侧从 sandbox_config 读,库级 CHECK 5–120 s;这里再钉 MAX_TIMEOUT_MS)
     + 子进程 rlimit(launch.py:CPU 秒 / 地址空间 / 进程数 / 文件大小 / 句柄数)。排队时间计入总时长;超时 kill 整个进程组。
  5. stdout / stderr 流式读、按字节截断(MAX_CAPTURE),几百 MB 的输出不会进内存。
  7. 每次运行一个 /run/work/<uuid>(compose 里是 noexec 的 tmpfs),结束即删;env 只留 PATH / HOME / LANG;
     stdin 写完 input 即关;`-I` 隔离模式屏蔽 PYTHON* 变量与用户 site。
  8. 三方核对:请求里的 sha256 == 清单里的 == 磁盘文件现算的;realpath 仍在 /opt/skills/<skill>/scripts/ 内且是普通文件。
  另:RUNNER_NETWORK(缺省 none)与清单里该 skill 的 network 不等即拒(R-WEBFETCH C6 裁定提前进本轮):
  默认实例只跑 none 档,将来的 egress 实例只跑 egress 档,两边各自拒绝不属于自己档次的 skill。

只用标准库。监听 unix socket(RUNNER_LISTEN=unix:///run/runner/runner.sock,生产);
本机开发可 RUNNER_LISTEN=tcp://0.0.0.0:8000(dev.ps1 runner),生产 compose 不会设它。
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SKILLS_DIR = "/opt/skills"
MANIFEST_PATH = "/opt/manifest.json"
LAUNCHER = "/opt/launch.py"
PYTHON = "/opt/venv/bin/python"
WORK_ROOT = "/run/work"

LISTEN = os.environ.get("RUNNER_LISTEN", "unix:///run/runner/runner.sock")
NETWORK = os.environ.get("RUNNER_NETWORK", "none")

MAX_CONCURRENCY = 2
MAX_BODY_BYTES = 64 * 1024
MAX_CAPTURE_BYTES = 256 * 1024
MAX_INPUT_BYTES = 32 * 1024  # api 侧 input 文本 ≤ 4096 字符;这里是再序列化之后的宽松上界
MIN_TIMEOUT_MS = 1_000
MAX_TIMEOUT_MS = 120_000
DEFAULT_TIMEOUT_MS = 30_000
READER_JOIN_S = 2.0

SKILL_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
SCRIPT_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}\.py$")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
NETWORKS = ("none", "egress")


def log(msg: str) -> None:
    print(f"[skill-runner] {msg}", file=sys.stderr, flush=True)


def load_manifest() -> dict:
    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    skills = data.get("skills")
    if not isinstance(skills, dict):
        raise RuntimeError("manifest.json: missing skills object")
    for name, entry in skills.items():
        if not SKILL_RE.match(name):
            raise RuntimeError(f"manifest.json: bad skill name {name!r}")
        if entry.get("network", "none") not in NETWORKS:
            raise RuntimeError(f"manifest.json: bad network for {name}")
        scripts = entry.get("scripts", {})
        if not isinstance(scripts, dict):
            raise RuntimeError(f"manifest.json: bad scripts for {name}")
        for script, sha in scripts.items():
            if not SCRIPT_RE.match(script) or not SHA_RE.match(str(sha)):
                raise RuntimeError(f"manifest.json: bad script entry {name}/{script}")
    return skills


MANIFEST: dict = {}
SEMAPHORE = threading.Semaphore(MAX_CONCURRENCY)


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


class Rejected(Exception):
    def __init__(self, status: int, code: str):
        super().__init__(code)
        self.status = status
        self.code = code


def resolve_script(skill: str, script: str, sha256: str) -> str:
    """闭集 + 三方核对(约束 2 / 8)。任一不符即拒;返回可执行的绝对路径。"""
    entry = MANIFEST.get(skill)
    if entry is None:
        raise Rejected(404, "unknown_skill")
    if entry.get("network", "none") != NETWORK:
        raise Rejected(403, "network_mismatch")
    expected = entry.get("scripts", {}).get(script)
    if expected is None:
        raise Rejected(404, "unknown_script")
    if sha256 != expected:
        raise Rejected(409, "hash_mismatch")
    base = os.path.realpath(os.path.join(SKILLS_DIR, skill, "scripts"))
    path = os.path.realpath(os.path.join(base, script))
    if os.path.dirname(path) != base or not os.path.isfile(path):
        raise Rejected(404, "unknown_script")
    if sha256_file(path) != expected:
        # 镜像里的文件与清单不一致 —— 不该发生(同一次构建产出),发生了就是拒
        raise Rejected(409, "hash_mismatch")
    return path


class CappedReader(threading.Thread):
    """按字节流式读一条管道,超过上限只计数不存(约束 5)。"""

    def __init__(self, stream, cap: int):
        super().__init__(daemon=True)
        self.stream = stream
        self.cap = cap
        self.chunks: list[bytes] = []
        self.kept = 0
        self.total = 0

    def run(self) -> None:
        try:
            while True:
                # read1 而不是 read:BufferedReader.read(n) 会**攒够 n 字节或 EOF 才返回**,而子进程 fork 出来的
                # 孙进程只要还握着管道,EOF 就不会来 —— 自检里 fork.py 的最后一行输出就是这样丢掉的。
                # read1 拿到多少给多少,输出随时可见,收尾时 killpg 让管道关闭、循环自然结束。
                chunk = self.stream.read1(65536)
                if not chunk:
                    break
                self.total += len(chunk)
                room = self.cap - self.kept
                if room > 0:
                    piece = chunk[:room]
                    self.chunks.append(piece)
                    self.kept += len(piece)
        except (OSError, ValueError):
            pass
        finally:
            try:
                self.stream.close()
            except OSError:
                pass

    def text(self) -> str:
        return b"".join(self.chunks).decode("utf-8", errors="replace")


def run_script(path: str, payload: dict, timeout_ms: int, deadline: float) -> dict:
    """一次性进程 + 一次性工作目录(约束 7)。"""
    work = os.path.join(WORK_ROOT, uuid.uuid4().hex)
    os.makedirs(work, mode=0o700, exist_ok=False)
    started = time.monotonic()
    proc = None
    timed_out = False
    try:
        env = {"PATH": "/opt/venv/bin", "HOME": work, "LANG": "C.UTF-8"}
        cpu_seconds = max(1, int(timeout_ms / 1000) + 1)
        proc = subprocess.Popen(
            [PYTHON, "-I", "-B", LAUNCHER, str(cpu_seconds), path],
            cwd=work,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
            close_fds=True,
        )
        out = CappedReader(proc.stdout, MAX_CAPTURE_BYTES)
        err = CappedReader(proc.stderr, MAX_CAPTURE_BYTES)
        out.start()
        err.start()
        try:
            proc.stdin.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
        except (BrokenPipeError, OSError):
            pass
        finally:
            try:
                proc.stdin.close()
            except OSError:
                pass
        remaining = max(0.0, deadline - time.monotonic())
        try:
            proc.wait(timeout=remaining)
        except subprocess.TimeoutExpired:
            timed_out = True
        duration_ms = int((time.monotonic() - started) * 1000)
        # 【无论超时与否都 killpg】脚本自己退出了,它 fork 出来的孙进程可能还活着(自检里 fork.py 留下 11 个
        # 睡 30 s 的孤儿),它们握着 stdout / stderr 管道、占着 NPROC / pids 名额。整组 SIGKILL 之后管道才关、
        # 读线程才能收尾,「一次运行 = 一次性的进程」才成立(验收 ⑪:超时后进程组不残留)。
        kill_group(proc)
        out.join(READER_JOIN_S)
        err.join(READER_JOIN_S)
        return {
            "exitCode": None if timed_out else proc.returncode,
            "timedOut": timed_out,
            "durationMs": duration_ms,
            "stdout": out.text(),
            "stderr": err.text(),
            "stdoutTruncated": out.total > out.kept,
            "stderrTruncated": err.total > err.kept,
            "stdoutBytes": out.total,
            "stderrBytes": err.total,
        }
    finally:
        if proc is not None:
            kill_group(proc)
        shutil.rmtree(work, ignore_errors=True)


def kill_group(proc: subprocess.Popen) -> None:
    """start_new_session=True 让子进程自成进程组(pgid == pid);整组 SIGKILL,不留孙进程。

    组长已退出时 killpg 仍作用于组里剩下的成员(孙进程);组里一个都不剩才是 ProcessLookupError。
    被杀的孙进程由容器的 PID 1(compose `init: true` 的 tini)收养并 reap —— 本进程只 wait 自己的直接子进程,
    不碰别人的(见 main 里的说明)。
    """
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    except OSError as e:
        log(f"killpg failed: {e.__class__.__name__}")
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        log("process did not exit after SIGKILL")


def parse_run_request(body: bytes) -> tuple[str, str, str, dict, int]:
    try:
        req = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise Rejected(400, "bad_request")
    if not isinstance(req, dict):
        raise Rejected(400, "bad_request")
    skill = req.get("skill")
    script = req.get("script")
    sha = req.get("sha256")
    payload = req.get("input")
    timeout_ms = req.get("timeoutMs", DEFAULT_TIMEOUT_MS)
    if not (isinstance(skill, str) and SKILL_RE.match(skill)):
        raise Rejected(400, "bad_request")
    if not (isinstance(script, str) and SCRIPT_RE.match(script)):
        raise Rejected(400, "bad_request")
    if not (isinstance(sha, str) and SHA_RE.match(sha)):
        raise Rejected(400, "bad_request")
    if not isinstance(payload, dict):
        raise Rejected(400, "bad_request")
    if len(json.dumps(payload, ensure_ascii=False).encode("utf-8")) > MAX_INPUT_BYTES:
        raise Rejected(413, "input_too_large")
    if isinstance(timeout_ms, bool) or not isinstance(timeout_ms, int):
        raise Rejected(400, "bad_request")
    timeout_ms = min(MAX_TIMEOUT_MS, max(MIN_TIMEOUT_MS, timeout_ms))
    return skill, script, sha, payload, timeout_ms


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send_json(self, status: int, obj: dict) -> None:
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):  # noqa: N802 —— 只记方法与路径与状态,不记 body
        log(f"{self.command} {self.path} {args[1] if len(args) > 1 else ''}")

    def do_GET(self):  # noqa: N802
        if self.path == "/health":
            self._send_json(200, {"ok": True, "network": NETWORK, "skills": len(MANIFEST)})
            return
        self._send_json(404, {"error": "not_found"})

    def do_POST(self):  # noqa: N802
        if self.path != "/run":
            self._send_json(404, {"error": "not_found"})
            return
        if self.headers.get("Transfer-Encoding"):
            self._send_json(411, {"error": "length_required"})
            return
        try:
            length = int(self.headers.get("Content-Length") or "0")
        except ValueError:
            self._send_json(400, {"error": "bad_request"})
            return
        if length <= 0:
            self._send_json(411, {"error": "length_required"})
            return
        if length > MAX_BODY_BYTES:
            self._send_json(413, {"error": "body_too_large"})
            return
        body = self.rfile.read(length)
        started = time.monotonic()
        try:
            skill, script, sha, payload, timeout_ms = parse_run_request(body)
            path = resolve_script(skill, script, sha)
        except Rejected as r:
            log(f"reject {r.code}")
            self._send_json(r.status, {"error": r.code})
            return

        deadline = started + timeout_ms / 1000
        # 排队计入总时长(约束 3):等不到并发名额就是排队超时,不是无限等
        if not SEMAPHORE.acquire(timeout=max(0.0, deadline - time.monotonic())):
            self._send_json(503, {"error": "queue_timeout"})
            return
        try:
            result = run_script(path, payload, timeout_ms, deadline)
        except Exception as e:  # noqa: BLE001 —— 失败原因只进 stderr 日志,不回给 api
            log(f"run failed: {e.__class__.__name__}")
            self._send_json(500, {"error": "run_failed"})
            return
        finally:
            SEMAPHORE.release()
        self._send_json(200, result)


class UnixHTTPServer(ThreadingHTTPServer):
    address_family = socket.AF_UNIX
    daemon_threads = True

    def server_bind(self):
        path = self.server_address
        if os.path.exists(path):
            os.unlink(path)
        self.socket.bind(path)
        # api 与 runner 同 uid(compose 里都是 10001);0660 挡住同卷上的其它身份
        os.chmod(path, 0o660)


class TcpHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def parse_listen(value: str):
    if value.startswith("unix://"):
        return "unix", value[len("unix://") :]
    if value.startswith("tcp://"):
        host, _, port = value[len("tcp://") :].rpartition(":")
        return "tcp", (host or "127.0.0.1", int(port))
    raise RuntimeError(f"RUNNER_LISTEN must be unix://<path> or tcp://<host>:<port>, got {value!r}")


def health_probe() -> int:
    """`runner.py --health`:compose healthcheck 用。对自己发一次 GET /health。"""
    kind, addr = parse_listen(LISTEN)
    try:
        if kind == "unix":
            s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            s.settimeout(3)
            s.connect(addr)
        else:
            s = socket.create_connection(addr, timeout=3)
        with s:
            s.sendall(b"GET /health HTTP/1.1\r\nHost: skill-runner\r\nConnection: close\r\n\r\n")
            data = b""
            while True:
                chunk = s.recv(4096)
                if not chunk:
                    break
                data += chunk
                if len(data) > 4096:
                    break
        return 0 if data.startswith(b"HTTP/1.1 200") and b'"ok": true' in data else 1
    except OSError:
        return 1


def main() -> int:
    global MANIFEST
    if "--health" in sys.argv[1:]:
        return health_probe()
    if NETWORK not in NETWORKS:
        raise RuntimeError(f"RUNNER_NETWORK must be one of {NETWORKS}, got {NETWORK!r}")
    MANIFEST = load_manifest()
    os.makedirs(WORK_ROOT, mode=0o700, exist_ok=True)
    kind, addr = parse_listen(LISTEN)
    if kind == "unix":
        os.makedirs(os.path.dirname(addr), mode=0o770, exist_ok=True)
        server = UnixHTTPServer(addr, Handler)
    else:
        server = TcpHTTPServer(addr, Handler)
    log(f"listening {LISTEN} network={NETWORK} skills={len(MANIFEST)} concurrency={MAX_CONCURRENCY}")

    def stop(*_):
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    # 【孤儿谁来收】脚本 fork 出来的孙进程被 killpg 之后,会被容器里的 PID 1 收养、变成僵尸。本进程**刻意不当 PID 1**:
    # compose 的 `init: true`(docker 自带的 tini)是 PID 1,由它 reap 孤儿。不能在本进程里 `waitpid(-1)` 兜底 ——
    # 两次运行并发时,一个请求的 waitpid(-1) 会把另一个请求**还没 wait 的直接子进程**先收走,那边的 Popen.wait
    # 撞到 ECHILD 会把退出码记成 0,非零退出的脚本就被报成成功(codex 首轮 P1)。所以这里只检查、只告警。
    if os.getpid() == 1:
        log("WARNING: running as PID 1 without an init; orphans left by killed scripts will not be reaped (use init: true / --init)")
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        server.server_close()
        if kind == "unix" and os.path.exists(addr):
            os.unlink(addr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
