# Encore MCP stdio launcher (registered in .mcp.json).
# Redirects encore data dirs to an ASCII-only path first — the daemon's unix socket
# cannot bind under the Chinese-character user profile path (CLAUDE.md rule 1).
$env:LOCALAPPDATA = "D:\encore-data"
$env:APPDATA = "D:\encore-data\roaming"
$env:Path += ";$HOME\.encore\bin"
# docker daemon lives in WSL since 2026-09-14 (Docker Desktop uninstalled) — see dev.ps1's
# "docker daemon 在 WSL" block. This matters here too: whichever process starts the shared
# encore daemon first decides which docker it talks to, and this launcher may well be it.
if (-not $env:DOCKER_HOST) { $env:DOCKER_HOST = "tcp://127.0.0.1:2375" }
New-Item -ItemType Directory -Force D:\encore-data | Out-Null
Set-Location "$PSScriptRoot\..\apps\api"
& "$HOME\.encore\bin\encore.exe" mcp run
