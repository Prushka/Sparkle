[CmdletBinding()]
param([switch]$ShowLogs, [switch]$Quit)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$AppPath = Join-Path $RepoRoot 'bin\windows\SparkleBackend.exe'
if (-not (Test-Path -LiteralPath $AppPath)) {
    if ($Quit) { return }
    & (Join-Path $RepoRoot 'build-windows-app.ps1')
}
$arguments = "--repo-root `"$RepoRoot`""
if ($Quit) { $arguments += ' --quit' }
elseif ($ShowLogs) { $arguments += ' --logs' }

# Login and Start Menu shortcuts target the GUI executable directly. This
# convenience command also keeps its child hidden until the logs are requested.
Start-Process -FilePath $AppPath -ArgumentList $arguments -WorkingDirectory $RepoRoot -WindowStyle Hidden
