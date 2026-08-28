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
#       .\dev.ps1 gen       encore gen client → apps\web\lib\api-client.ts
#       .\dev.ps1 db <名>   encore db shell <数据库名>

$env:LOCALAPPDATA = "D:\encore-data"
$env:APPDATA = "D:\encore-data\roaming"
$env:Path += ";$HOME\.encore\bin"
New-Item -ItemType Directory -Force D:\encore-data | Out-Null

Set-Location "$PSScriptRoot\apps\api"
$encore = "$HOME\.encore\bin\encore.exe"

switch ($Cmd) {
    "test"  { & $encore test @args }
    "check" { & $encore check }
    "gen"   { & $encore gen client --output ../web/lib/api-client.ts --env local }
    "db"    { & $encore db shell @args }
    default { & $encore run --listen 127.0.0.1:4000 }
}
