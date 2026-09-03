"""子进程启动器:先给自己上 rlimit,再 execv 成真正的脚本进程(约束 3 的第二道上限)。

【为什么不用 subprocess 的 preexec_fn】它在 fork 之后、exec 之前于子进程里跑 Python 代码,
而 runner.py 是多线程的(ThreadingHTTPServer + 两条读管道线程):Python 文档明确说 preexec_fn
在多线程程序里**不安全**(子进程可能在 exec 前死锁)。换成一个独立的启动器进程,
rlimit 在 exec 之后的单线程新进程里设置,不存在这个问题;execv 之后 rlimit 随进程保留。

用法(由 runner.py 调用,不是给人用的):python -I -B launch.py <cpu_seconds> <script_path>
"""
import os
import resource
import sys

PYTHON = "/opt/venv/bin/python"

MiB = 1024 * 1024
LIMITS = {
    "RLIMIT_AS": 256 * MiB,  # 地址空间
    "RLIMIT_NPROC": 16,  # 进程 / 线程数(按 uid 计;容器另有 pids_limit)
    "RLIMIT_FSIZE": 16 * MiB,  # 单文件大小(cwd 是有容量上限的 tmpfs)
    "RLIMIT_NOFILE": 64,  # 句柄数
    "RLIMIT_CORE": 0,  # 不留 core
}


def main() -> None:
    if len(sys.argv) != 3:
        os._exit(64)
    cpu_seconds = max(1, int(sys.argv[1]))
    script = sys.argv[2]
    for name, value in LIMITS.items():
        res = getattr(resource, name, None)
        if res is None:
            continue
        resource.setrlimit(res, (value, value))
    resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds))
    os.umask(0o077)
    # 环境已由 runner.py 清空(只剩 PATH / HOME / LANG);-I 忽略 PYTHON* 与用户 site
    os.execv(PYTHON, [PYTHON, "-I", "-B", script])


if __name__ == "__main__":
    main()
