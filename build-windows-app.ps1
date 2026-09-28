[CmdletBinding()]
param([string]$GoExe, [string]$OutputDirectory, [switch]$BackendOnly)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# The tray owns compiler children before this script is allowed to start them.
if ($env:SPARKLE_BUILD_EVENT) {
    $gate = [Threading.EventWaitHandle]::OpenExisting($env:SPARKLE_BUILD_EVENT)
    try {
        if (-not $gate.WaitOne(30000)) { throw 'Tray build startup timed out.' }
    } finally { $gate.Dispose() }
}
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$RepoRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $RepoRoot 'bin\windows' }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
if (-not $GoExe) {
    $command = Get-Command go -CommandType Application -ErrorAction SilentlyContinue
    if (-not $command) { throw 'Install Go on PATH or supply -GoExe.' }
    $GoExe = $command.Source
}
$GoExe = (Get-Command $GoExe -CommandType Application -ErrorAction Stop).Source
if (-not $BackendOnly) {
    $Compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    if (-not (Test-Path -LiteralPath $Compiler)) {
        $Compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
    }
    if (-not (Test-Path -LiteralPath $Compiler)) { throw 'The Windows .NET Framework C# compiler is required.' }
}

$AppPath = Join-Path $OutputDirectory 'SparkleBackend.exe'
$ApiPath = Join-Path $OutputDirectory 'Sparkle.Api.exe'
$targets = @($ApiPath)
if (-not $BackendOnly) { $targets += $AppPath }
$running = @(Get-Process -Name SparkleBackend,Sparkle.Api -ErrorAction SilentlyContinue | Where-Object { $_.Path -in $targets })
if ($running.Count) { throw 'Quit Sparkle Backend from its tray menu before rebuilding it.' }

$Stage = if ($BackendOnly) { $OutputDirectory } else { Join-Path $RepoRoot ('cache\windows-build-' + [guid]::NewGuid().ToString('N')) }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
if ($Stage -ne $OutputDirectory) { New-Item -ItemType Directory -Force -Path $Stage | Out-Null }
$StagedApp = Join-Path $Stage 'SparkleBackend.exe'
$StagedBackend = Join-Path $Stage 'Sparkle.Api.exe'
Push-Location (Join-Path $RepoRoot 'backend')
try {
    & $GoExe build -trimpath -o $StagedBackend ./cmd/api
    if ($LASTEXITCODE -ne 0) { throw 'Backend build failed.' }
    if (-not $BackendOnly) {
        & $Compiler /nologo /target:winexe /optimize+ /platform:anycpu `
            /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll `
            "/win32icon:$RepoRoot\windows\assets\sparkle-backend.ico" `
            "/resource:$RepoRoot\windows\assets\sparkle-backend.ico,SparkleBackend.Icon" `
            "/out:$StagedApp" "$RepoRoot\windows\SparkleBackend.cs"
        if ($LASTEXITCODE -ne 0) { throw 'Windows tray build failed.' }
    }
    if (-not $BackendOnly) {
        Copy-Item -LiteralPath $StagedBackend -Destination $ApiPath -Force
        Copy-Item -LiteralPath $StagedApp -Destination $AppPath -Force
        # Keep custom -GoExe installations usable from Explorer's tray environment.
        [IO.File]::WriteAllText((Join-Path $OutputDirectory 'Sparkle.Go.txt'), $GoExe)
    }
} finally { Pop-Location }
if ($BackendOnly) { Write-Host 'Backend build completed.' }
else { Write-Host "Built $AppPath" }
