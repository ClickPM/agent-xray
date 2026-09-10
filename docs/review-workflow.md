# 独立审查工作流(执行器 = cursor CLI + grok 4.6 high)

> **本文只管「谁来审、怎么发起、结果怎么取回」。审查的策略**(范围口径 / 复审收口标准 / 审查边界)
> **正本在 [`CLAUDE.md`](../CLAUDE.md)「开发模式与轮次流程」,本文不复述、只引用。**
> 审查者读的任务书是 [`.claude/cursor-review-prompt.md`](../.claude/cursor-review-prompt.md)(入库,改契约改它);
> 启动脚本是 [`.claude/cursor-review.ps1`](../.claude/cursor-review.ps1)。

## 0. 为什么换执行器(所有者裁定 2026-09-10)

**codex 被限流,暂停使用**;独立审查改由 **cursor CLI(`cursor-agent`)**执行,模型钉 **`cursor-grok-4.6-high`**(即「grok 4.6 high」)。

**换的只是执行器,不是流程**:Claude Code solo 开发 + 独立审查者做缺陷门禁这套不变,
「前两轮全量 / 第 3 轮起只审整改 diff」「不得带 high 级 findings 收口」「审查不代替设计、非严重 finding 不许机制类修复」
三条策略一字不改 —— 它们是所有者 2026-08-28 / 08-31 的裁定,与用哪个模型无关。

**切回 codex 的条件**:限流解除后由**所有者裁定**是否切回;`codex-companion.mjs` 那套(`/codex:review`、`--base`、
`/codex:status`、`/codex:result`)与 `.agents/skills` 镜像**原样留着不删**,切回只是换回命令。
两者不并用 —— 同一轮里只有一个执行器,免得两份 findings 编号打架。

## 1. 发起(在仓库根跑)

```powershell
# 前两轮:全量分支 diff(main...HEAD)
powershell -File .claude\cursor-review.ps1

# 第 3 轮起:只审上一轮 findings 整改后的 diff
powershell -File .claude\cursor-review.ps1 -Scope since -Base <上一轮已审提交>

# 质疑设计取舍那一档(对应原 /codex:adversarial-review)
powershell -File .claude\cursor-review.ps1 -Kind adversarial

# 小 diff 想直接看结果:前台阻塞跑
powershell -File .claude\cursor-review.ps1 -Wait
```

参数:`-Base`(默认 `main`)、`-Scope branch|since`(默认 `branch` = `<Base>...HEAD`;`since` = `<Base>..HEAD`)、
`-Kind review|adversarial`、`-Model`(默认 `cursor-grok-4.6-high`)、`-Note "<本轮要点>"`、`-Wait`。

脚本做四件事:验 `cursor-agent` 在位且已登录 → 验 git 范围非空(空 diff 直接拒,别浪费一轮)→
把任务书模板实例化(填入范围与要点,`review` 档删掉 adversarial 专属段)→ 后台起 `cursor-agent`,
把 stdout / stderr 落到 `.claude/reviews/<时间戳>-<kind>.{out.md,err.log}`(整个目录 gitignored)。

发起时用的固定档位:`--plan`(只读,审查者不许改文件)+ `--force`(免逐条批准 `git diff` / `rg` 这类读命令)
+ `--trust` + `--output-format text`。

## 2. 取回结果

- **结果在结束时一次性落地** `.out.md`;中途没有任何输出是正常的。
- **`.err.log` 通常一直是 0 字节**(2026-09-10 实测):`--output-format text` 下 cursor-agent 不往 stderr 写心跳
  —— 这和 codex 不一样(那边 `.err` 每十几秒一条推理摘要可当心跳)。**所以别拿「err 是空的」判它死了**,
  判死活看进程树:`Get-CimInstance Win32_Process -Filter "Name='node.exe'"` 里找命令行带 `index.js -p` 的那个。
- 轮询 `.out.md` 非空,或 `tasklist /FI "PID eq <pid>"`(脚本打印的 pid 是 `cmd` 壳,真正干活的是它的 node 子进程);
  **Git Bash 里先 `export MSYS_NO_PATHCONV=1`**,否则 `/FI` 被当路径改写、永远报「进程已死」。
- **耗时基线**(同一台机,待逐轮补):`HEAD~1..HEAD` 单文件 diff = **5 分钟**(2026-09-10 首次冒烟,给出 1 条 P2,
  格式与任务书要求一致)。全量分支 diff 的基线等 R-MOBILE-2 第一轮回填。
- findings 逐条处理后回填任务卡「代码审查」段(采纳整改 / 不采纳及理由),`.out.md` 本体不入库,
  任务卡里记结论与条数。

## 3. 三条容易踩的

1. **`cursor-agent` 不在 PATH**:Windows 装在 `%LOCALAPPDATA%\cursor-agent\cursor-agent.cmd`,
   Git Bash 里裸敲 `cursor-agent` 是 command not found —— 脚本按绝对路径找,不要自己改成裸命令。
2. **必须先 `cursor-agent login`**:未登录时它会等交互输入,后台跑就是**永远不结束、`.out` 永远空**。
   脚本起手先跑 `cursor-agent status` 拦这一种。
3. **审查期间不要改仓库里的文件**:审查器是**实时读工作树**的(不是只读一次 diff),
   改了它读到的就是半新半旧的代码、findings 对不上提交。等待期间只做 scratchpad 里的准备。

## 4. 降级

降级到 Claude Code 自带 `/code-review` **只认硬失败**(`cursor-agent` 未安装 / 未登录 / 启动失败 / 限流),
降级原因写进任务卡;「等得久」「改动小」不是理由(与原口径一致,只是把「codex CLI」换成「cursor CLI」)。

## 5. 审查者拿到的项目上下文

`cursor-agent` 在仓库根自动读 **`AGENTS.md`**(实测),那份是指针 → `CLAUDE.md`(硬性规则 1–13)。
任务书里另给了判据清单与严重级口径,所以**不依赖**任何编辑器侧配置。
`.agents/skills/`(8 个 encore 官方 skill 的镜像)是给 codex 自动加载用的,**cursor 不自动加载** ——
任务书让它在需要 Encore 框架判据时按需读那个目录里的文件。
