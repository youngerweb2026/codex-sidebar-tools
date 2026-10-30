param(
  [Parameter(Position = 0)]
  [ValidateSet('install', 'launch', 'status', 'uninstall', 'start-agent', 'stop-agent', 'recover')]
  [string]$Action = 'status',
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Remaining
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  Write-Error '需要原生 Windows Node.js 24 或更新版本，请先安装 Node.js。'
  exit 1
}
$manager = Join-Path $PSScriptRoot '..\manage.cjs'
& $nodeCommand.Source $manager $Action @Remaining
exit $LASTEXITCODE
