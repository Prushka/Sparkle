param([string]$SevenZip = "$env:ProgramFiles\7-Zip\7z.exe")
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $SevenZip -PathType Leaf)) { throw 'Install 7-Zip or pass -SevenZip with its executable path.' }
$repo = Split-Path $PSScriptRoot -Parent
$downloadDir = Join-Path $repo 'cache/ffmpeg-downloads'
$toolDir = Join-Path $repo 'bin/ffmpeg-9.0.2'
$archive = Join-Path $downloadDir 'ffmpeg-9.0.2-full_build.7z'
New-Item -ItemType Directory -Force -Path $downloadDir, $toolDir | Out-Null
if (-not (Test-Path -LiteralPath $archive)) {
    Invoke-WebRequest -Uri 'https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-full_build.7z' -OutFile $archive
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne 'f0e46253c70dfe902bac915dfb4224f0cf1b7c6eeab9da2ccc9a5581f9a71b13') { throw 'FFmpeg archive checksum mismatch.' }
& $SevenZip x $archive "-o$toolDir" -y | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'FFmpeg extraction failed.' }
$binaryDir = Join-Path $toolDir 'ffmpeg-9.0.2-full_build/bin'
foreach ($name in @('ffmpeg', 'ffprobe')) {
    $executable = Join-Path $binaryDir "$name.exe"
    if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw "Missing installed executable: $name" }
    $versionOutput = & $executable -version
    if ($LASTEXITCODE -ne 0) { throw "Installed executable failed: $name" }
    $versionOutput | Select-Object -First 1
}
Write-Host 'Portable FFmpeg installed. Add these to the backend environment, then restart it:'
Write-Host "FFMPEG=$((Join-Path $binaryDir 'ffmpeg.exe').Replace('\','/'))"
Write-Host "FFPROBE=$((Join-Path $binaryDir 'ffprobe.exe').Replace('\','/'))"
