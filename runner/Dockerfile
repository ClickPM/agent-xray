# skill-runner 执行容器镜像(R-SKILLS-2;docs/security.md §1 第 3 层「执行容器」+ §7「执行容器的供应链」)。
#
# 基座按 **digest** 钉(不是 tag):tag 可变,digest 不可变。升级 = 改这一行 + 重跑一遍生产冒烟。
#   docker pull python:3.12-slim && docker inspect --format '{{index .RepoDigests 0}}' python:3.12-slim
# 它**不是 JS 运行时**,CLAUDE.md 规则 11(bun)不涉及本镜像。
#
# 布局(runner.py 里都是常量,改一处要一起改):
#   /opt/venv        venv(要求 ④:脚本必须在虚拟环境里跑;pip 装完即删,脚本运行时装不了任何东西)
#   /opt/skills      可被 agent 使用的 skill 源(COPY 自 runner/skills;只读根 FS,运行期改不了)
#   /opt/manifest.json  构建期生成的清单(tools/skills-manifest),runner.py 据此拒绝任何不在清单里的脚本
#   /opt/runner.py   守护进程;/opt/launch.py 子进程启动器(rlimit)
#   /run/work        每次运行的一次性工作目录(compose 挂 tmpfs,noexec)
#   /run/runner      unix socket 所在(compose 的命名卷 runner_sock,与 api 共用,同 uid 10001)
FROM python:3.12-slim@sha256:78387bc3881b8273120a12ebe6c1ab22b018ccc2c9adf565ae1ac9b536e184ea

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# venv + 钉哈希的依赖(--require-hashes 让任何没带 hash 的行都装不进去;R-WEBFETCH 起 requirements.txt 不再为空)。
# 装完把 pip / setuptools 从 venv 里拿掉:运行期没有网络也没有写权限,留着它们只是多一块攻击面。
# PIP_INDEX_URL 只是**下载来源**(本机直连 PyPI 慢时指向镜像站,dev.ps1 由 $env:PIP_INDEX_URL 透传):
# 每个包仍按 requirements.txt 里的 sha256 核对,来源给错包只会让构建失败(docs/security.md §7)。
ARG PIP_INDEX_URL=https://pypi.org/simple
COPY requirements.txt /opt/requirements.txt
RUN python -m venv /opt/venv \
    && /opt/venv/bin/python -m pip install --require-hashes --no-deps --index-url "$PIP_INDEX_URL" -r /opt/requirements.txt \
    && /opt/venv/bin/python -m pip uninstall -y pip setuptools wheel 2>/dev/null || true \
    && rm -rf /opt/venv/bin/pip* /opt/venv/bin/easy_install* \
    && find /opt/venv -name "__pycache__" -type d -prune -exec rm -rf {} +

# 非 root,uid 与 api 容器一致(socket 才能共用)
RUN groupadd -g 10001 runner && useradd -u 10001 -g 10001 -M -s /usr/sbin/nologin runner \
    && mkdir -p /run/runner /run/work /opt/skills \
    && chown 10001:10001 /run/runner /run/work

COPY --chown=root:root skills/ /opt/skills/
COPY --chown=root:root manifest.json /opt/manifest.json
COPY --chown=root:root runner.py launch.py /opt/
# 全部只读给 10001;可执行的只有解释器本身
RUN chmod -R a-w,a+rX /opt/skills /opt/manifest.json /opt/runner.py /opt/launch.py

USER 10001:10001
WORKDIR /run/work
ENV RUNNER_LISTEN=unix:///run/runner/runner.sock \
    RUNNER_NETWORK=none

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
    CMD ["/opt/venv/bin/python", "-I", "/opt/runner.py", "--health"]

ENTRYPOINT ["/opt/venv/bin/python", "-I", "/opt/runner.py"]
