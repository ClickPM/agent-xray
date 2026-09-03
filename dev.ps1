param([string]$Cmd = "run")

# Windows 本地开发入口(CLAUDE.md 规则 1)
#
# 【本文件必须存为 UTF-8 with BOM】(CLAUDE.md 规则 3):PowerShell 5.1 对无 BOM 的
# UTF-8 按 ANSI(936) 解码,中文注释会吞行尾换行、把下一行并进注释——param 块被整行
# 注释掉后 $Cmd 恒为空,带参数调用会静默退化成 encore run(ticketBookingB2B 踩过)。
# param 放首行是同一问题的第二层保险。
#
# 背景:encore daemon 的 unix socket 无法绑定在含中文字符的用户名路径下
# ("bind: An invalid argument was supplied"),故把 encore 数据目录重定向到 D:\encore-data。
# daemon 常驻且同机与 ticketBookingB2B 共用同一套重定向,env 口径两边保持一致。
#
# 用法:.\dev.ps1            启动后端 encore run :4000(app root = apps\api)
#       .\dev.ps1 test      encore test
#       .\dev.ps1 check     encore check(编译校验)
#       .\dev.ps1 gen       encore gen client -> apps\web\lib\api-client.ts
#       .\dev.ps1 db <名>   encore db shell <数据库名>
#       .\dev.ps1 build     构建 api + web 生产镜像(tag = git 短 SHA)
#       .\dev.ps1 ship <host> [sha]
#                           把镜像与四件部署资产传到服务器(save -o / scp / load -i)
#       .\dev.ps1 skills    把 .claude\skills 镜像到 .agents\skills(给 codex 审查者用)
#       .\dev.ps1 wt-clean [名字|all] [--force]
#                           清理 .claude\worktrees 残留(不带参数 = 只列不动;坑的说明见函数注释)

$env:LOCALAPPDATA = "D:\encore-data"
$env:APPDATA = "D:\encore-data\roaming"
$env:Path += ";$HOME\.encore\bin"
New-Item -ItemType Directory -Force D:\encore-data | Out-Null

$repoRoot = $PSScriptRoot
Set-Location "$repoRoot\apps\api"
$encore = "$HOME\.encore\bin\encore.exe"

# —— Bun 统一运行时(R-BUN)——
# bun-runtime 实验位写在 apps/api/encore.app,encore run / build 都会读到。
# 但 **基座镜像只能由 --base 指定**:encore.app 的 build.docker.base_image 仅对
# Encore 自家 CI/CD 生效,本地 encore build docker 不读它(实测 2026-08-29)。
# 漏掉 --base 的后果不是构建失败,而是产出一个 ENTRYPOINT=bun 却装着 node:slim 的
# 镜像,docker run 时 `exec: "bun": executable file not found in $PATH`。
# 版本与 CLAUDE.md「钉版本」表保持一致。
$bunBase = "oven/bun:1.4.0-slim"

# 本机 bun 解释器也应与钉版本一致:packageManager 字段只让 encore test 选中 bun,
# **不校验版本**——本机装了别的版本,测试门禁就跑在与生产镜像不同的运行时上。
# 这里只告警不阻断(codex 复审 2026-08-31 P2);对齐方式:npm i -g bun@<钉版本>。
$bunPinned = ($bunBase -split ':')[1] -replace '-slim$', ''
function Warn-BunDrift {
    $localBun = (& bun --version 2>$null)
    if ($localBun -and $localBun.Trim() -ne $bunPinned) {
        Write-Warning "本机 bun $($localBun.Trim()) ≠ 钉版本 $bunPinned(CLAUDE.md 钉版本表)——测试/运行将使用非钉版运行时。对齐:npm i -g bun@$bunPinned"
    }
}

# 打进公网镜像的服务白名单。spike 是 R1 验证脚手架(无认证、无限额、真实 LLM 端点),
# 绝不能进预发/生产镜像;--services 是构建期硬门禁,实测可让 /spike/* 返回 404。
# ⚠️ 新增服务时必须在这里补名字(trace 于 R4、notes 于 R5、mcp 于 R6、
#    metrics 与 about 于 R8、site 于 R-TABS、skills 于 R-SKILLS 补入),漏补的表现是该服务端点 404,R9 冒烟会抓到。
#    site 漏补的后果比 404 更重:web 的 layout 每次渲染都调 /site/tabs 且取数失败不兜底
#    (apps/web/lib/tabs-server.ts「原样抛」),整站每一页 500 —— 构建与健康检查全绿。
$hostedServices = "agent,trace,notes,mcp,metrics,about,system,site,skills"

# —— worktree 残留清理 ——
#
# 【坑在哪】在 .claude\worktrees\<名字> 里跑过东西之后,那个目录就删不掉:
# `git worktree remove` 报 Permission denied,而且往往已经删掉一半、只剩空壳,
# 于是登记与磁盘状态长期不一致(本仓库曾同时留下 r3/r4/r5 三份,其中一份 385MB)。
# 占用者有三类(2026-08-31 实测):
#   1. .claude\mcp-encore.ps1 会 Set-Location 到 <worktree>\apps\api——encore.app 的 id 为空,
#      本地 app 只能靠 cwd 定位,换 `encore mcp run --app <id>` 也绕不开;那个会话的
#      encore mcp run 进程于是把 apps\api 当 cwd 占死。
#   2. **encore daemon**:被上面那个 MCP 注册过该 app 之后,daemon 自己也握着 apps\api 的句柄。
#      单杀 MCP 无效(实测杀完照样 Permission denied),必须连 daemon 一起停。
#   3. codex 的 app-server-broker 以 --cwd <worktree> 启动,连同它拉起的 node/bun 占住根目录。
# 本函数按 1→2 的顺序逐级升级,能不停 daemon 就不停(daemon 同机与 ticketBookingB2B 共用,
# 规则 1);真停了会立刻拉回来。
#
# 【还有一种根本不是占用:路径超过 MAX_PATH(260)】2026-09-02 实测三个 worktree 清理后各剩 3–12 个文件,
# 全在 apps\api\node_modules\@earendil-works\pi-coding-agent\node_modules\@aws-sdk\...\*.d.ts,
# 路径 261–269 字符,没有任何进程持句柄——PowerShell 5.1 的 Remove-Item 就是过不了 MAX_PATH。
# 旧版把这当成「句柄占用」,白白重启了同机共用的 daemon。所以删除一律先走 Remove-DirLongPath
# (cmd 的 rd /s /q 配 \\?\ 前缀,实测能删),Remove-Item 只是兜底;只有长路径删除也失败才升级到停 daemon。
#
# 【本函数不碰的一类】以该 worktree 为根目录的 Claude Code 会话进程(claude.exe 及其子 shell、skill server
# 的 node)也占着根目录。那是你的会话,脚本不替你杀——删不掉时会提示你先排除路径长度,再用 CCD 的
# list_sessions 按 cwd 找到那个会话,关掉后重跑。

# 长路径删除:先 rd /s /q + \\?\ 前缀,还在再回落 Remove-Item。
# rd 的退出码不可信(目录被进程当 cwd 占着时照样回 0,2026-09-02 实测),成败一律看事后 Test-Path。
function Remove-DirLongPath([string]$dir) {
    if (Test-Path $dir) { & cmd /c rd /s /q ('\\?\' + $dir) 2>$null | Out-Null }
    if (Test-Path $dir) { Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue }
}

function Remove-DevWorktree([string]$name, [bool]$force) {
    $path = "$repoRoot\.claude\worktrees\$name"
    if (-not (Test-Path $path)) { Write-Warning "$($name):目录不存在,跳过"; return }

    $registered = (((& git -C $repoRoot worktree list --porcelain) -join "`n") -like "*$name*")

    # 安全闸:未提交改动、或分支还有没并进 main 的提交,一律拒绝(确认要丢再加 --force)。
    # **纯删除(D)不算未提交改动**:这条命令要处理的常态就是「上一次删到一半被占用中断」的半删目录,
    # 那种状态下 git status 全是 D;这些文件的内容都在提交里,丢不了东西。真正要护住的是
    # 修改 / 新增 / 未跟踪文件——那才是没有第二份的工作成果。
    if ($registered -and -not $force) {
        $dirty = (((& git -C $path status --porcelain 2>$null) | Where-Object { $_ -notmatch '^(D[ D]| D) ' }) -join "`n")
        if ($dirty) { throw "$($name):有未提交改动,拒绝清理(确认要丢加 --force)`n$dirty" }
        $branch = (& git -C $path rev-parse --abbrev-ref HEAD 2>$null)
        if ($branch -and $branch -ne "HEAD") {
            $ahead = ((& git -C $repoRoot log --oneline "main..$branch" 2>$null) -join "`n")
            if ($ahead) { throw "$($name):分支 $branch 有未并入 main 的提交,拒绝清理(--force 跳过)`n$ahead" }
        }
    }

    Write-Host "==> 清理 $name"
    if ($registered) { & git -C $repoRoot worktree remove --force $path 2>$null }

    # 第 1 级:命令行里带该 worktree 路径的进程(codex broker、encore run 拉起的 bun 应用进程等)
    if (Test-Path $path) {
        $holders = Get-CimInstance Win32_Process | Where-Object {
            $_.ProcessId -ne $PID -and $_.Name -match '^(node|bun|codex|encore)' -and $_.CommandLine -like "*$name*"
        }
        foreach ($h in $holders) {
            Write-Host "    停 $($h.Name) ($($h.ProcessId))"
            Stop-Process -Id $h.ProcessId -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Milliseconds 300
        Remove-DirLongPath $path
    }

    # 第 2 级:长路径删除也过不去 = 真有句柄(daemon 握着)。停掉全部 encore 进程(daemon + 各会话的
    # mcp run)再删,完事拉回。纯路径长度问题在上一步就已删干净,不会走到这里。
    if (Test-Path $path) {
        Write-Host "    长路径删除后仍在 -> 停 encore daemon 与全部 encore mcp run(同机共用,会一并重启)"
        Get-Process encore -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 300
        Remove-DirLongPath $path
        & $encore daemon | Out-Null
    }

    & git -C $repoRoot worktree prune
    if (Test-Path $path) {
        Write-Warning "$($name):仍删不掉。先排除路径长度,再怀疑会话占用:"
        Write-Host "    1) 长路径:残留若在 node_modules 深层、路径超过 260 字符,本命令已用 \\?\ 前缀的 rd /s /q 试过;还留着就到 Git Bash 里 rm -rf 该目录(先 find <目录> -type f 看残留在哪)。"
        Write-Host "    2) 会话占用:残留路径不长、目录已空却 busy,才是以该 worktree 为根目录的 Claude Code 会话(claude.exe 及其子进程)占着——用 CCD 的 list_sessions 按 cwd 找到那个会话,关掉后重跑本命令。"
    } else {
        Write-Host "    已删除"
    }
}

switch ($Cmd) {
    "test"  { Warn-BunDrift; & $encore test @args }
    "check" { & $encore check }
    "gen"   {
        # 排除 mcp:管理面是**服务端到服务端**的面,前端永不调用它
        # (docs/security.md §4「两个面互不触碰」)。不排的话浏览器包里会多出一个
        # /mcp 的类型化包装 —— 它给不了权限(认证是 bearer token),
        # 但会让「前端可以碰管理面吗」这个问题在代码里出现两种答案。
        & $encore gen client --output ../web/lib/api-client.ts --env local --excluded-services mcp
    }
    "db"    { & $encore db shell @args }
    "build" {
        $sha = (& git -C $repoRoot rev-parse --short HEAD).Trim()
        if (-not $sha) { throw "拿不到 git SHA,构建中止" }
        $dirty = (& git -C $repoRoot status --porcelain)
        if ($dirty) { throw "工作区不干净,拒绝构建不可复现的镜像。先提交或 stash:`n$dirty" }

        $registry = if ($env:IMAGE_REGISTRY) { $env:IMAGE_REGISTRY } else { "local" }
        $apiTag = "$registry/xray-api:$sha"
        $webTag = "$registry/xray-web:$sha"

        Write-Host "==> api  $apiTag  (bun 基座 $bunBase, 服务 $hostedServices)"
        & $encore build docker `
            --config "$repoRoot\deploy\infra-config.json" `
            --base $bunBase `
            --services $hostedServices `
            $apiTag
        if ($LASTEXITCODE -ne 0) { throw "api 镜像构建失败" }

        Write-Host "==> web  $webTag"
        & docker build -t $webTag "$repoRoot\apps\web"
        if ($LASTEXITCODE -ne 0) { throw "web 镜像构建失败" }

        Write-Host ""
        Write-Host "构建完成。部署用:"
        Write-Host "  IMAGE_TAG=$sha (写进 deploy/.env)"
        # 传输必须走文件,不能在 PowerShell 里管道直传:PS 5.1 对原生命令的管道
        # 按文本重编码,docker save 输出的二进制 tar 会被破坏,远端 load 必失败。
        Write-Host "  传输(勿在 PowerShell 用 `"docker save | ssh docker load`" 管道直传,二进制会被重编码破坏):"
        Write-Host "    docker save -o xray-$sha.tar $apiTag $webTag"
        Write-Host "    scp xray-$sha.tar <host>:~  然后  ssh <host> docker load -i xray-$sha.tar"
        Write-Host "  或直接: .\dev.ps1 ship <host>"
    }
    "ship" {
        # 把镜像 + 四件部署资产送到服务器(R9)。文档里那段手工流程漏一步就会出事:
        # 漏 migrate.sh → 服务器上无法迁移;走 PowerShell 管道 → 二进制 tar 被文本
        # 重编码破坏;漏 mkdir → 多文件 scp 直接失败。固化成一条命令。
        #
        # **不传 .env**:它按环境独立、含密钥、永不出本机(deploy/.env.example 里
        # 有生成方式)。服务器上首次部署时由所有者手工 cp + 填。
        $shipHost = $args[0]
        if (-not $shipHost) { throw "用法:.\dev.ps1 ship <host> [sha];host 是 ssh 目标(别名或 user@ip)" }
        $sha = if ($args[1]) { $args[1] } else { (& git -C $repoRoot rev-parse --short HEAD).Trim() }
        if (-not $sha) { throw "拿不到 git SHA" }

        $registry = if ($env:IMAGE_REGISTRY) { $env:IMAGE_REGISTRY } else { "local" }
        $apiTag = "$registry/xray-api:$sha"
        $webTag = "$registry/xray-web:$sha"
        foreach ($t in @($apiTag, $webTag)) {
            & docker image inspect $t 2>$null | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "本机没有镜像 $t,先跑 .\dev.ps1 build" }
        }

        $tar = Join-Path $env:TEMP "xray-$sha.tar"
        Write-Host "==> docker save → $tar"
        & docker save -o $tar $apiTag $webTag
        if ($LASTEXITCODE -ne 0) { throw "docker save 失败" }
        $mb = [math]::Round((Get-Item $tar).Length / 1MB, 1)
        Write-Host "    $mb MB"

        Write-Host "==> scp 镜像与部署资产 → $shipHost"
        & ssh $shipHost "mkdir -p ~/deploy"
        if ($LASTEXITCODE -ne 0) { throw "ssh $shipHost 不通" }
        # 二进制走 scp 文件,绝不用 PowerShell 管道(PS 5.1 对原生命令管道按文本
        # 重编码,tar 会被破坏,远端 load 报 unexpected EOF)
        & scp $tar "${shipHost}:~/"
        if ($LASTEXITCODE -ne 0) { throw "scp 镜像失败" }
        & scp "$repoRoot\deploy\docker-compose.yml" "$repoRoot\deploy\Caddyfile" `
              "$repoRoot\deploy\migrate.sh" "$repoRoot\deploy\.env.example" "${shipHost}:~/deploy/"
        if ($LASTEXITCODE -ne 0) { throw "scp 部署资产失败" }
        & ssh $shipHost "chmod +x ~/deploy/migrate.sh"

        Write-Host "==> docker load(远端)"
        & ssh $shipHost "docker load -i ~/xray-$sha.tar && rm -f ~/xray-$sha.tar"
        if ($LASTEXITCODE -ne 0) { throw "远端 docker load 失败(tar 已保留在 ~/xray-$sha.tar 供排查)" }
        Remove-Item $tar -Force

        Write-Host ""
        Write-Host "已送达。接下来在 $shipHost 上(顺序不能颠倒,见 docs/deploy-environments.md):"
        Write-Host "  cd ~/deploy"
        Write-Host "  cp .env.example .env && chmod 600 .env   # 首次;IMAGE_TAG=$sha"
        Write-Host "  docker compose stop api web              # 仅升级时"
        Write-Host "  docker compose up -d --wait postgres"
        Write-Host "  ./migrate.sh"
        Write-Host "  docker compose up -d"
        Write-Host ""
        Write-Host "发版后:docs/releases.md 加一行(日期 / SHA / 迁移版本 / 内容 / .env 变更)。生产发版必记(CLAUDE.md 项目定位)。"
    }
    "skills" {
        # 把 .claude\skills 镜像到 .agents\skills。
        #
        # 【为什么要这份镜像】codex 只从 CODEX_HOME(~/.codex/skills)、插件缓存,以及**仓库级**
        # 的 .agents\skills / .codex\skills 发现 skill——**不认 .claude\skills**(2026-08-31 实测:
        # 四个候选目录各放一个探针,只有 .agents\skills 与 .codex\skills 被加载)。没有镜像时,
        # codex 审查拿不到 encore 官方 skill 里的框架缺陷清单,只能靠 AGENTS.md/CLAUDE.md。
        #
        # 【权威副本仍是 .claude\skills】它由 skills-lock.json 锁版本、`npx -y skills update` 升级;
        # .agents\skills 是生成物。**升级 skill 后必须跑一次本命令重新同步**,否则审查者吃到的是旧版。
        $src = "$repoRoot\.claude\skills"
        $dst = "$repoRoot\.agents\skills"
        if (-not (Test-Path $src)) { throw "找不到 $src" }
        if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
        New-Item -ItemType Directory -Force $dst | Out-Null
        Copy-Item -Recurse -Force "$src\*" $dst
        $names = (Get-ChildItem -Directory $dst | Select-Object -ExpandProperty Name) -join ", "
        $n = (Get-ChildItem -Recurse -File $dst).Count
        Write-Host "已同步 $n 个文件到 .agents\skills:$names"
        Write-Host "(codex 读 .agents\skills;Claude Code 仍读 .claude\skills)"
    }
    "wt-clean" {
        $wtRoot = "$repoRoot\.claude\worktrees"
        $force = ($args -contains "--force")
        $names = @($args | Where-Object { $_ -notlike "--*" })
        $onDisk = @()
        if (Test-Path $wtRoot) { $onDisk = @(Get-ChildItem -Force -Directory $wtRoot | Select-Object -ExpandProperty Name) }

        # 不带名字 = 只列不动。磁盘目录与 git 登记会各自残留一边,两边都要看。
        if ($names.Count -eq 0) {
            & git -C $repoRoot worktree list
            Write-Host ""
            if (-not $onDisk) { Write-Host ".claude\worktrees 下没有残留目录。"; break }
            Write-Host ".claude\worktrees 下的目录:"
            foreach ($n in $onDisk) {
                $cnt = (Get-ChildItem -Recurse -Force "$wtRoot\$n" -ErrorAction SilentlyContinue).Count
                Write-Host "  $n  ($cnt 个文件)"
            }
            Write-Host ""
            Write-Host "清理:.\dev.ps1 wt-clean <名字|all> [--force]"
            break
        }

        if ($names -contains "all") { $names = $onDisk }
        foreach ($n in $names) { Remove-DevWorktree $n $force }
    }
    default { & $encore run --listen 127.0.0.1:4000 }
}
