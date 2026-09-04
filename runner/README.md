# runner/ —— agent 可运行 skills 的执行容器(R-SKILLS-2)

刻意放在 Encore app root(`apps/api`)之外(CLAUDE.md 规则 6);它不是 JS 运行时,规则 11 不涉及。
约束的正本是 `docs/security.md` §1 R-SKILLS-2 补记(八条)与第 3 层「执行容器」,本文只说布局与怎么跑。

```
runner/
  Dockerfile        python:3.12-slim 按 digest 钉 → venv(--require-hashes)→ COPY skills + manifest → 非 root 10001
  requirements.txt  venv 依赖,每行 exact + --hash(R-WEBFETCH 起:trafilatura 及其全部传递依赖,pip-compile --generate-hashes 出的)
  runner.py         守护进程:unix socket 上的 HTTP(POST /run · GET /health),并发 RUNNER_CONCURRENCY(缺省 2),一次性进程 + 工作目录
  launch.py         子进程启动器:设 rlimit 后 execv 成 `python -I -B <脚本>`(不用 preexec_fn,见文件头)
  manifest.json     **生成物**(`dev.ps1 skills-gen`):每个 skill 的 network 档次 + 每个文件 / 脚本的 sha256
  skills/<name>/    可被 agent 使用的 skill 源:SKILL.md(必有)+ xray.json(可运行型才有)+ scripts/*.py
  tests/            web-fetch 的单元测试与病态输入夹具(R-WEBFETCH);**不进镜像、不进清单、不进库**,`dev.ps1 runner-test` bind mount 进镜像跑
```

**首批 skill 源与出处**(2026-09-03):`text-tools` 自研(可运行型,纯标准库);`encore-api` / `encore-database` / `encore-testing`
是 [encoredev/skills](https://github.com/encoredev/skills)(Apache-2.0,Copyright 2024 Encore)`encore/<name>/SKILL.md` 的**逐字节原版**
(与上游 `main` 比对 sha256 相等),每个目录随包放上游 `LICENSE` —— 镜像与 api 都带着这份副本,再经 skill_load 送进上下文,属再分发,
Apache-2.0 要求附许可证。所有者经 MCP 上传展示副本时也要带同一个 `LICENSE`(一致性判据按文件集合比,少了它就是 drift)。
**R-WEBFETCH(2026-09-04)**:`web-fetch` 自研,首个 `network: egress` 档(单文件 `scripts/fetch.py`,标准库做网络 + `trafilatura` 抽取;
SSRF 防线的七点落在文件头逐条注释里,约束正本 `docs/security.md` §1 R-WEBFETCH 补记)。

**可用集合在代码里**(所有者裁定 6):改这里的任何一个字节 = 发版。`tools/skills-manifest/generate.mjs`
读 `skills/` 生成两份同源清单 —— 本目录的 `manifest.json`(执行容器核对用)与
`apps/api/shared/skills.generated.ts`(api 注入 / 校验 / 一致性判据用);`apps/api/agent/skills-manifest.test.ts`
把「生成物 == 现算」钉成测试,篡改任一字节即红。

## `xray.json`(可运行型 skill 才有)

```json
{
  "network": "none",
  "scripts": {
    "wordfreq.py": {
      "description": "一句话",
      "input": { "type": "object", "properties": { "text": { "type": "string", "maxLength": 4000 } },
                 "required": ["text"], "additionalProperties": false }
    }
  }
}
```

- `network`:`none`(缺省)/ `egress`。`none` 档跑在无网络的 `skill-runner`;`egress` 档(R-WEBFETCH 起,首个是 `web-fetch`)只跑在
  同一镜像的第二个实例 `skill-runner-egress`(compose 专用 egress 网络,只出公网)。runner(按 daemon env `RUNNER_NETWORK`)与 api(按清单)
  各自拒绝不属于自己档次的 skill;egress 档 skill 的准入清单例外(允许 `socket` / `ssl` / `http.client`)与第九条约束见
  `docs/security.md` §1 R-WEBFETCH 补记 —— 缺一条不许收录。
- `scripts` 的键 = `scripts/` 下的文件名(闭集);`input` 是 `ToolParametersSchema` 的子集
  (string / integer / boolean,`required`,长度与数值上下界,`additionalProperties: false`)。
- 脚本准入清单:`rounds/round-skills/research.md` §2.2 —— stdin 读一个 JSON 对象 → stdout,只用标准库或
  `requirements.txt` 里钉住的依赖,无 subprocess / socket / ctypes / eval,不写 cwd 之外,确定性,单次远小于超时。

## 进程模型:谁当 PID 1

runner.py **不当 PID 1**:compose 写了 `init: true`(docker 自带的 tini 当 PID 1),`dev.ps1 runner` 与自检脚本用 `--init`。
脚本 fork 出来的孙进程被 killpg 之后由 tini 收养并 reap;runner 只 wait 自己的直接子进程。**不能**在 runner 里 `waitpid(-1)` 兜底 ——
两次运行并发时会把另一次还没 wait 的子进程先收走、退出码丢成 0,非零退出被报成成功(codex 首轮 P1)。缺 init 时 runner 启动记一行 WARNING,
表现是僵尸逐渐占满 `pids_limit`。

## 协议(api ↔ runner,只走 unix socket)

- `POST /run` `{ skill, script, sha256, input, timeoutMs }` → `200 { exitCode, timedOut, durationMs, stdout, stderr,
  stdoutTruncated, stderrTruncated, stdoutBytes, stderrBytes }`;拒绝一律 JSON `{ error }`:
  `400 bad_request` · `404 unknown_skill / unknown_script` · `403 network_mismatch` · `409 hash_mismatch` ·
  `413 input_too_large / body_too_large` · `503 queue_timeout` · `500 run_failed`。
- `GET /health` → `{ ok, network, skills }`。compose 的 healthcheck 就是 `runner.py --health`。
- daemon 的 env(不是脚本的 env,脚本的 env 被清空):`RUNNER_LISTEN`、`RUNNER_NETWORK`(none / egress)、`RUNNER_CONCURRENCY`(1–8,缺省 2;
  egress 实例 compose 里设 1,所有者裁定 C7)。
- 失败短码约定(egress 档的 `web-fetch` 首用,任何 skill 都可以用):脚本非零退出且 stdout **恰好只有一行** `E_[A-Z0-9_]+`,api 会把它附在
  固定失败文案后交给模型;别的 stdout 形状一律不附。

## 本机怎么跑

生产走 compose(`deploy/docker-compose.yml` 的 `skill-runner`,`network_mode: none`;`skill-runner-egress`,专用 egress 网络);本机 api 跑在
Windows 宿主上拿不到容器里的 unix socket,所以开发模式用 TCP,每档一个端口:

```powershell
.\dev.ps1 runner            # docker build runner/ + docker run --rm -p 127.0.0.1:8000:8000(RUNNER_LISTEN=tcp://,none 档)
.\dev.ps1 runner egress     # 同一镜像的 egress 档实例:127.0.0.1:8001,RUNNER_NETWORK=egress、并发 1、内存 256m,挂默认 bridge(有公网)
$env:XRAY_SKILL_RUNNER_URL = "http://127.0.0.1:8000"          # 再起 .\dev.ps1;api 只接受这一种覆盖形状
$env:XRAY_SKILL_RUNNER_EGRESS_URL = "http://127.0.0.1:8001"   # 不设 = unix 默认值(Windows 上连不上,web-fetch 以固定文案失败)
.\dev.ps1 runner-test       # 镜像里跑 tests/:unittest(--network none)+ 病态输入夹具(经 launch.py,rlimit 同真实运行)
```

两个 URL 都是代码级闭集(`unix:` 默认值或 `http://127.0.0.1:<port>`):none 档写别的值 `skill_run` 直接不注册;egress 档写别的值只是
egress 档的 skill 不进可用集合。本机不复现生产的两道网络防线(专用网络 + 宿主 `DOCKER-USER`),那在生产冒烟(`deploy-environments.md` 第 21 条)。
镜像构建要从 PyPI 装 `requirements.txt`(全部带 hash);本机直连慢就 `$env:PIP_INDEX_URL = "https://pypi.tuna.tsinghua.edu.cn/simple"`,hash 照核。
