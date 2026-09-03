# runner/ —— agent 可运行 skills 的执行容器(R-SKILLS-2)

刻意放在 Encore app root(`apps/api`)之外(CLAUDE.md 规则 6);它不是 JS 运行时,规则 11 不涉及。
约束的正本是 `docs/security.md` §1 R-SKILLS-2 补记(八条)与第 3 层「执行容器」,本文只说布局与怎么跑。

```
runner/
  Dockerfile        python:3.12-slim 按 digest 钉 → venv → COPY skills + manifest → 非 root 10001
  requirements.txt  venv 依赖(--require-hashes;首批为空)
  runner.py         守护进程:unix socket 上的 HTTP(POST /run · GET /health),并发 2,一次性进程 + 工作目录
  launch.py         子进程启动器:设 rlimit 后 execv 成 `python -I -B <脚本>`(不用 preexec_fn,见文件头)
  manifest.json     **生成物**(`dev.ps1 skills-gen`):每个 skill 的 network 档次 + 每个文件 / 脚本的 sha256
  skills/<name>/    可被 agent 使用的 skill 源:SKILL.md(必有)+ xray.json(可运行型才有)+ scripts/*.py
```

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

- `network`:`none`(缺省)/ `egress`。本轮只允许 `none`;`egress` 档由 R-WEBFETCH 的第二个实例跑。
  runner 与 api 各自按这个字段拒绝不属于自己档次的 skill(R-WEBFETCH C6,提前进本轮)。
- `scripts` 的键 = `scripts/` 下的文件名(闭集);`input` 是 `ToolParametersSchema` 的子集
  (string / integer / boolean,`required`,长度与数值上下界,`additionalProperties: false`)。
- 脚本准入清单:`rounds/round-skills/research.md` §2.2 —— stdin 读一个 JSON 对象 → stdout,只用标准库或
  `requirements.txt` 里钉住的依赖,无 subprocess / socket / ctypes / eval,不写 cwd 之外,确定性,单次远小于超时。

## 协议(api ↔ runner,只走 unix socket)

- `POST /run` `{ skill, script, sha256, input, timeoutMs }` → `200 { exitCode, timedOut, durationMs, stdout, stderr,
  stdoutTruncated, stderrTruncated, stdoutBytes, stderrBytes }`;拒绝一律 JSON `{ error }`:
  `400 bad_request` · `404 unknown_skill / unknown_script` · `403 network_mismatch` · `409 hash_mismatch` ·
  `413 input_too_large / body_too_large` · `503 queue_timeout` · `500 run_failed`。
- `GET /health` → `{ ok, network, skills }`。compose 的 healthcheck 就是 `runner.py --health`。

## 本机怎么跑

生产走 compose(`deploy/docker-compose.yml` 的 `skill-runner`,`network_mode: none`);本机 api 跑在 Windows 宿主上拿不到
容器里的 unix socket,所以开发模式用 TCP:

```powershell
.\dev.ps1 runner            # docker build runner/ + docker run --rm -p 127.0.0.1:8000:8000(RUNNER_LISTEN=tcp://)
$env:XRAY_SKILL_RUNNER_URL = "http://127.0.0.1:8000"   # 再起 .\dev.ps1;api 只接受这一种覆盖形状
```

`XRAY_SKILL_RUNNER_URL` 是代码级闭集(`unix:` 默认值或 `http://127.0.0.1:<port>`),写别的值 `skill_run` 直接不注册。
