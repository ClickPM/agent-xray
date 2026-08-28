# Encore MCP stdio launcher (registered in .mcp.json).
# Redirects encore data dirs to an ASCII-only path first — the daemon's unix socket
# cannot bind under the Chinese-character user profile path (CLAUDE.md rule 1).
$env:LOCALAPPDATA = "D:\encore-data"
$env:APPDATA = "D:\encore-data\roaming"
$env:Path += ";$HOME\.encore\bin"
New-Item -ItemType Directory -Force D:\encore-data | Out-Null
Set-Location "$PSScriptRoot\..\apps\api"
& "$HOME\.encore\bin\encore.exe" mcp run
