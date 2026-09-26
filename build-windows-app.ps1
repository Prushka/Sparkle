[CmdletBinding()]
param([string]$GoExe, [string]$OutputDirectory)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $RepoRoot 'bin\windows' }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
if (-not $GoExe) {
    $command = Get-Command go -CommandType Application -ErrorAction SilentlyContinue
    if (-not $command) { throw 'Install Go on PATH or supply -GoExe.' }
    $GoExe = $command.Source
}
$Compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $Compiler)) {
    $Compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path -LiteralPath $Compiler)) { throw 'The Windows .NET Framework C# compiler is required.' }

$AppPath = Join-Path $OutputDirectory 'SparkleBackend.exe'
$ApiPath = Join-Path $OutputDirectory 'Sparkle.Api.exe'
$running = @(Get-Process -Name SparkleBackend,Sparkle.Api -ErrorAction SilentlyContinue | Where-Object { $_.Path -in @($AppPath, $ApiPath) })
if ($running.Count) { throw 'Quit Sparkle Backend from its tray menu before rebuilding it.' }

$Stage = Join-Path $RepoRoot ('cache\windows-build-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $Stage, $OutputDirectory | Out-Null
$StagedApp = Join-Path $Stage 'SparkleBackend.exe'
$StagedBackend = Join-Path $Stage 'Sparkle.Api.exe'
Push-Location (Join-Path $RepoRoot 'backend')
try {
    & $GoExe build -trimpath -o $StagedBackend ./cmd/api
    if ($LASTEXITCODE -ne 0) { throw 'Backend build failed.' }
    & $Compiler /nologo /target:winexe /optimize+ /platform:anycpu `
        /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll `
        "/win32icon:$RepoRoot\windows\assets\sparkle-backend.ico" `
        "/resource:$RepoRoot\windows\assets\sparkle-backend.ico,SparkleBackend.Icon" `
        "/out:$StagedApp" "$RepoRoot\windows\SparkleBackend.cs"
    if ($LASTEXITCODE -ne 0) { throw 'Windows tray build failed.' }
    Copy-Item -LiteralPath $StagedBackend -Destination $ApiPath -Force
    Copy-Item -LiteralPath $StagedApp -Destination $AppPath -Force
} finally { Pop-Location }
Write-Host "Built $AppPath"
