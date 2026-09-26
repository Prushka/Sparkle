[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$Compiler = Join-Path $env:SystemRoot "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path -LiteralPath $Compiler)) { $Compiler = Join-Path $env:SystemRoot "Microsoft.NET\Framework\v4.0.30319\csc.exe" }
$TestRoot = Join-Path $RepoRoot ("cache\tray test " + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $TestRoot, (Join-Path $TestRoot 'backend') | Out-Null
Copy-Item -LiteralPath (Join-Path $RepoRoot "start-backend.ps1") -Destination $TestRoot
@'
export ADDR='127.0.0.1:18991'
OUTPUT='fixture output'
PFP_DIR='./fixture profiles'
MEDIA_CACHE_DIR='./fixture cache'
GO=missing-go-must-not-be-required
PLEX_URL=
PLEX_TOKEN=fixture-secret-not-for-logs
PLEX_PATH_MAPPINGS='[{"plex":"/source","local":"X:/test media"}]'
PLEX_LIBRARY_IDS=
ENCODE_ENABLED=false
'@ | Set-Content -LiteralPath (Join-Path $TestRoot '.env') -Encoding UTF8
$FakeBackend = Join-Path $TestRoot "FakeBackend.exe"
$TestApp = Join-Path $TestRoot "TrayTests.exe"
& $Compiler /nologo /target:exe "/out:$FakeBackend" "$PSScriptRoot\tests\FakeBackend.cs"
if ($LASTEXITCODE -ne 0) { throw "Fake backend compilation failed." }
& $Compiler /nologo /target:winexe /main:Sparkle.Backend.Windows.TrayTests `
    /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll `
    "/win32icon:$PSScriptRoot\assets\sparkle-backend.ico" "/resource:$PSScriptRoot\assets\sparkle-backend.ico,SparkleBackend.Icon" `
    "/out:$TestApp" "$PSScriptRoot\SparkleBackend.cs" "$PSScriptRoot\tests\TrayTests.cs"
if ($LASTEXITCODE -ne 0) { throw "Tray test compilation failed." }
# Explicitly isolate configuration from the developer's ENV_FILE.
$SavedEnvFile = $env:ENV_FILE
$env:ENV_FILE = Join-Path $TestRoot '.env'
try {
    $process = Start-Process -FilePath $TestApp -ArgumentList "`"$TestRoot`" `"$FakeBackend`"" -WindowStyle Hidden -PassThru
    if (-not $process.WaitForExit(60000)) {
        $process.Kill()
        throw "Tray integration tests timed out. Logs: $TestRoot"
    }
    $result = Get-Content -LiteralPath (Join-Path $TestRoot "test-result.txt") -Raw
    Write-Host $result
    if ($process.ExitCode -ne 0 -or -not $result.StartsWith("PASS:")) { throw "Tray integration tests failed. Logs: $TestRoot" }
} finally { $env:ENV_FILE = $SavedEnvFile }
