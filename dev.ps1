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

# 打进公网镜像的服务白名单。spike 是 R1 验证脚手架(无认证、无限额、真实 LLM 端点),
# 绝不能进预发/生产镜像;--services 是构建期硬门禁,实测可让 /spike/* 返回 404。
# ⚠️ R4/R5/R7/R8 新增 trace / notes / admin / metrics 服务时必须在这里补名字,
#    漏补的表现是该服务端点 404,R9 冒烟会抓到。
$hostedServices = "agent,system"

switch ($Cmd) {
    "test"  { & $encore test @args }
    "check" { & $encore check }
    "gen"   { & $encore gen client --output ../web/lib/api-client.ts --env local }
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
    }
    default { & $encore run --listen 127.0.0.1:4000 }
}
