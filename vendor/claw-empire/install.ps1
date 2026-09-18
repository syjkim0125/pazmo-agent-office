param(
  [string]$AgentsPath = "",
  [int]$Port = 0,
  [string]$OpenClawConfig = "",
  [switch]$Start
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = Join-Path $scriptDir "scripts/openclaw-setup.ps1"

$forward = @()
if ($AgentsPath) { $forward += @("-AgentsPath", $AgentsPath) }
if ($Port -gt 0) { $forward += @("-Port", $Port) }
if ($OpenClawConfig) { $forward += @("-OpenClawConfig", $OpenClawConfig) }
if ($Start) { $forward += "-Start" }

& $target @forward
exit $LASTEXITCODE
