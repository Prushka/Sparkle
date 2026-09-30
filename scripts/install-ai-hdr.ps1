param([string]$SevenZip = "$env:ProgramFiles\7-Zip\7z.exe")
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $SevenZip -PathType Leaf)) { throw 'Install 7-Zip or pass -SevenZip with its executable path.' }
$repo = Split-Path $PSScriptRoot -Parent
$downloadDir = Join-Path $repo 'cache/ai-hdr-downloads'
$toolDir = Join-Path $repo 'bin/nvencc-9.35'
New-Item -ItemType Directory -Force -Path $downloadDir, $toolDir | Out-Null
$packages = @(
    @{ Name = 'NVEncC_9.35_x64.7z'; SHA256 = '8d80c91b4d38f2065b760a9b13d7835080d9971569b172fbff6c376fd429febd' }
)
foreach ($package in $packages) {
    $archive = Join-Path $downloadDir $package.Name
    if (-not (Test-Path -LiteralPath $archive)) {
        Invoke-WebRequest -Uri "https://github.com/rigaya/NVEnc/releases/download/9.35/$($package.Name)" -OutFile $archive
    }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $package.SHA256) { throw "Checksum mismatch: $($package.Name)" }
    & $SevenZip x $archive "-o$toolDir" -y | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Extraction failed: $($package.Name)" }
}
Write-Host 'Portable AI HDR dependencies installed. Add these to the backend environment, then restart it:'
Write-Host 'ENCODE_ENABLED=true'
Write-Host 'AI_HDR_ENABLED=true'
Write-Host "NVENCC=$((Join-Path $toolDir 'NVEncC64.exe').Replace('\','/'))"
