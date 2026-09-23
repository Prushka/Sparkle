[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$rootDir = $PSScriptRoot
$envFile = if ([string]::IsNullOrWhiteSpace($env:ENV_FILE)) {
    Join-Path $rootDir '.env'
} elseif ([System.IO.Path]::IsPathRooted($env:ENV_FILE)) {
    $env:ENV_FILE
} else {
    Join-Path $rootDir $env:ENV_FILE
}

if (Test-Path -LiteralPath $envFile -PathType Leaf) {
    foreach ($line in Get-Content -LiteralPath $envFile) {
        $trimmedLine = $line.Trim()
        if ($trimmedLine.Length -eq 0 -or $trimmedLine.StartsWith('#')) {
            continue
        }

        if ($trimmedLine.StartsWith('export ')) {
            $trimmedLine = $trimmedLine.Substring(7).TrimStart()
        }

        $separatorIndex = $trimmedLine.IndexOf('=')
        if ($separatorIndex -lt 1) {
            throw "Invalid environment entry; check the local environment file."
        }

        $name = $trimmedLine.Substring(0, $separatorIndex).Trim()
        if ($name -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
            throw "Invalid environment variable name '$name' in '$envFile'."
        }

        $value = $trimmedLine.Substring($separatorIndex + 1).Trim()
        if ($value.Length -ge 2) {
            $firstCharacter = $value[0]
            $lastCharacter = $value[$value.Length - 1]
            if (($firstCharacter -eq "'" -and $lastCharacter -eq "'") -or
                ($firstCharacter -eq '"' -and $lastCharacter -eq '"')) {
                $value = $value.Substring(1, $value.Length - 2)
            }
        }

        [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }
}

if ([string]::IsNullOrWhiteSpace($env:ADDR)) {
    $env:ADDR = ':1323'
}
if ([string]::IsNullOrWhiteSpace($env:OUTPUT)) {
    $env:OUTPUT = Join-Path $rootDir 'backend\output'
}
if ([string]::IsNullOrWhiteSpace($env:JOBS_CACHE_TTL)) {
    $env:JOBS_CACHE_TTL = '15m'
}
if ([string]::IsNullOrWhiteSpace($env:MAX_PFP_BYTES)) {
    $env:MAX_PFP_BYTES = '12000000'
}

if (-not [System.IO.Path]::IsPathRooted($env:OUTPUT)) {
    $env:OUTPUT = Join-Path $rootDir $env:OUTPUT
}
$env:OUTPUT = [System.IO.Path]::GetFullPath($env:OUTPUT)

foreach ($directoryKey in @('PFP_DIR', 'MEDIA_CACHE_DIR')) {
    $directoryValue = [Environment]::GetEnvironmentVariable($directoryKey, 'Process')
    if ([string]::IsNullOrWhiteSpace($directoryValue)) {
        $directoryValue = if ($directoryKey -eq 'PFP_DIR') { './data/pfp' } else { './cache/media' }
    }
    if (-not [System.IO.Path]::IsPathRooted($directoryValue)) {
        $directoryValue = Join-Path $rootDir $directoryValue
    }
    [Environment]::SetEnvironmentVariable($directoryKey, [System.IO.Path]::GetFullPath($directoryValue), 'Process')
}

$goCommand = if ([string]::IsNullOrWhiteSpace($env:GO)) { 'go' } else { $env:GO }
if (-not (Get-Command $goCommand -ErrorAction SilentlyContinue)) {
    throw "Go executable '$goCommand' was not found. Install Go or set GO to its path."
}

Push-Location (Join-Path $rootDir 'backend')
try {
    & $goCommand run ./cmd/api
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
