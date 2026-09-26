[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$TestRoot = Join-Path $RepoRoot ('cache\launcher test ' + [guid]::NewGuid().ToString('N'))
$BinDirectory = Join-Path $TestRoot 'bin\windows'
New-Item -ItemType Directory -Path $TestRoot, (Join-Path $TestRoot 'backend'), (Join-Path $TestRoot 'output') | Out-Null
Copy-Item -LiteralPath (Join-Path $RepoRoot 'start-backend.ps1') -Destination $TestRoot
& (Join-Path $RepoRoot 'build-windows-app.ps1') -OutputDirectory $BinDirectory
$AppPath = Join-Path $BinDirectory 'SparkleBackend.exe'
$ApiPath = Join-Path $BinDirectory 'Sparkle.Api.exe'

# Reserve an unused loopback port; never stop or query a developer's backend.
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = $listener.LocalEndpoint.Port
$listener.Stop()
@"
ADDR=127.0.0.1:$port
OUTPUT=./output
PFP_DIR=./profiles
MEDIA_CACHE_DIR=./media-cache
PLEX_AUTH_SESSION_DIR=./sessions
PLEX_URL=
PLEX_TOKEN=
PLEX_PATH_MAPPINGS=
PLEX_LIBRARY_IDS=
ENCODE_ENABLED=false
GO=missing-go-must-not-be-required
"@ | Set-Content -LiteralPath (Join-Path $TestRoot '.env') -Encoding UTF8

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class SparkleLauncherTestWindow {
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
    [DllImport("shcore.dll")] public static extern int GetProcessDpiAwareness(IntPtr process, out int awareness);
}
'@

function Wait-Until([scriptblock]$Condition, [string]$Label) {
    $clock = [Diagnostics.Stopwatch]::StartNew()
    while ($clock.Elapsed.TotalSeconds -lt 25) {
        if (& $Condition) { return }
        Start-Sleep -Milliseconds 100
    }
    throw "Timed out: $Label. Fixture: $TestRoot"
}
function Test-Api {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/library/sources" -TimeoutSec 1
        return $response.StatusCode -eq 200
    } catch { return $false }
}
function Get-FixtureApi {
    @(Get-Process -Name Sparkle.Api -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $ApiPath })
}
function Invoke-App([string]$Extra = '') {
    Start-Process -FilePath $AppPath -ArgumentList "--repo-root `"$TestRoot`" $Extra" -WorkingDirectory $TestRoot -WindowStyle Hidden -PassThru
}

$SavedEnvFile = $env:ENV_FILE
$env:ENV_FILE = Join-Path $TestRoot '.env'
$trayProcess = $null
try {
    $trayProcess = Invoke-App
    Wait-Until { Test-Api } 'compiled backend HTTP readiness'
    $awareness = 0
    if ([SparkleLauncherTestWindow]::GetProcessDpiAwareness($trayProcess.Handle, [ref]$awareness) -ne 0 -or $awareness -ne 1) { throw 'Installed tray entry point is not system DPI aware.' }
    $api = @(Get-FixtureApi)
    if ($api.Count -ne 1) { throw 'Expected exactly one compiled backend.' }
    $trayProcess.Refresh()
    if ($trayProcess.MainWindowHandle -ne 0) { throw 'Login launch unexpectedly opened a window.' }
    $second = Invoke-App '--logs'
    if (-not $second.WaitForExit(5000)) { throw 'Second launch did not exit.' }
    Wait-Until { $trayProcess.Refresh(); $trayProcess.MainWindowHandle -ne 0 } 'logs activation'
    $window = $trayProcess.MainWindowHandle
    if (-not [SparkleLauncherTestWindow]::IsWindowVisible($window)) { throw 'Logs window is hidden.' }
    if ($trayProcess.MainWindowTitle -ne 'Sparkle Backend - Logs') { throw 'Unexpected logs window title.' }
    $remaining = @(Get-FixtureApi)
    if ($remaining.Count -ne 1 -or $remaining[0].Id -ne $api[0].Id) { throw 'Second launch restarted or duplicated the backend.' }
    [void][SparkleLauncherTestWindow]::PostMessage($window, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) # WM_CLOSE
    Wait-Until { -not [SparkleLauncherTestWindow]::IsWindowVisible($window) } 'close hides logs'
    if (-not (Test-Api)) { throw 'Closing logs stopped the API.' }
    $quit = Invoke-App '--quit'
    if (-not $quit.WaitForExit(5000)) { throw 'Quit command did not exit.' }
    if (-not $trayProcess.WaitForExit(20000)) { throw 'Graceful tray shutdown timed out.' }
    Wait-Until { @(Get-FixtureApi).Count -eq 0 } 'compiled backend cleanup'
    $logDirectory = Join-Path $TestRoot '.sparkle-backend\logs'
    $archives = @(Get-ChildItem -LiteralPath $logDirectory -Filter 'sparkle-*.log')
    if ($archives.Count -ne 1) { throw 'Graceful quit did not archive exactly one tray session.' }
    $log = Get-Content -LiteralPath $archives[0].FullName -Raw
    if ($log -notmatch 'sparkle backend stopped' -or $log -notmatch 'exit code 0') { throw 'Backend did not exit gracefully.' }
    if ($log -notmatch 'Sparkle Backend tray exited at ') { throw 'Exit timestamp missing from archive.' }

    $trayProcess = Invoke-App
    Wait-Until { Test-Api } 'startup after quit'
    $trayProcess.Kill()
    [void]$trayProcess.WaitForExit(5000)
    Wait-Until { @(Get-FixtureApi).Count -eq 0 } 'job cleanup after forced tray exit'
    $quit = Invoke-App '--quit'
    if (-not $quit.WaitForExit(5000)) { throw 'Quit without an instance must return immediately.' }
    $interruptedLog = Get-Content -LiteralPath (Join-Path $logDirectory 'sparkle.log') -Raw
    $trayProcess = Invoke-App
    Wait-Until { Test-Api } 'startup after forced tray exit'
    $recovered = @(Get-ChildItem -LiteralPath $logDirectory -Filter 'sparkle-*-recovered.log')
    if ($recovered.Count -ne 1 -or (Get-Content -LiteralPath $recovered[0].FullName -Raw) -ne $interruptedLog) { throw 'Forced-exit log was not preserved on relaunch.' }
    $quit = Invoke-App '--quit'
    if (-not $quit.WaitForExit(5000) -or -not $trayProcess.WaitForExit(20000)) { throw 'Final fixture shutdown timed out.' }
    Wait-Until { @(Get-FixtureApi).Count -eq 0 } 'final compiled backend cleanup'
    Write-Host 'PASS: compiled API; system DPI awareness; hidden login; single-instance logs activation; close hides logs; graceful quit archive; forced-exit process cleanup and log recovery.'
} finally {
    if ($trayProcess -and -not $trayProcess.HasExited) {
        $quit = Invoke-App '--quit'
        [void]$quit.WaitForExit(5000)
        if (-not $trayProcess.WaitForExit(15000)) { $trayProcess.Kill() }
    }
    $env:ENV_FILE = $SavedEnvFile
}
