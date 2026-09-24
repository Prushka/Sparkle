[CmdletBinding()]
param(
    [switch]$Remove,
    [switch]$NoStartup,
    [switch]$NoStartMenu,
    [switch]$Start,
    [string]$GoExe
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$AppPath = Join-Path $RepoRoot 'bin\windows\SparkleBackend.exe'
# Sparkle-Transcoder already owns Sparkle.lnk. Never replace its shortcuts.
$ShortcutName = 'Sparkle Backend.lnk'
$StartupShortcut = Join-Path ([Environment]::GetFolderPath('Startup')) $ShortcutName
$MenuShortcut = Join-Path ([Environment]::GetFolderPath('Programs')) $ShortcutName
$shell = New-Object -ComObject WScript.Shell

function Assert-OwnedShortcut([string]$Path) {
    if (Test-Path -LiteralPath $Path) {
        if ($shell.CreateShortcut($Path).TargetPath -ne $AppPath) {
            throw "A different application owns '$Path'; leave it intact or rename it first."
        }
    }
}
function Write-Shortcut([string]$Path, [switch]$ShowLogs) {
    Assert-OwnedShortcut $Path
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
    $shortcut = $shell.CreateShortcut($Path)
    $shortcut.TargetPath = $AppPath
    $shortcut.Arguments = "--repo-root `"$RepoRoot`""
    if ($ShowLogs) { $shortcut.Arguments += ' --logs' }
    $shortcut.WorkingDirectory = $RepoRoot
    $shortcut.Description = 'Manage the Sparkle watch-party backend and view its logs.'
    $shortcut.IconLocation = "$AppPath,0"
    $shortcut.Save()
    Write-Host "Created $Path"
}

try {
    Assert-OwnedShortcut $StartupShortcut
    Assert-OwnedShortcut $MenuShortcut
    if ($Remove) {
        foreach ($path in @($StartupShortcut, $MenuShortcut)) {
            if (Test-Path -LiteralPath $path) {
                Remove-Item -LiteralPath $path -Force
                Write-Host "Removed $path"
            }
        }
        Write-Host 'Shortcuts removed. Use Quit in the tray to stop an already running backend.'
        return
    }
    & (Join-Path $RepoRoot 'build-windows-app.ps1') -GoExe $GoExe
    if (-not $NoStartup) { Write-Shortcut $StartupShortcut }
    if (-not $NoStartMenu) { Write-Shortcut $MenuShortcut -ShowLogs }
    if ($Start) { & (Join-Path $RepoRoot 'launch-backend-tray.ps1') }
    Write-Host 'Sparkle Backend is installed. Login starts it in the tray; double-click the icon to open logs.'
} finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) }
