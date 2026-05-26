param(
    [string]$SourceRoot,
    [switch]$RefreshIndexes,
    [switch]$SyncOutlook
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $ProjectRoot

function Find-Python {
    foreach ($Command in @("py", "python")) {
        try {
            & $Command --version *> $null
            if ($LASTEXITCODE -eq 0) {
                return $Command
            }
        } catch {
            continue
        }
    }
    throw "Python 3.11+ was not found. Install Python first, then run this script again."
}

function Find-SourceRoot {
    if ($SourceRoot) {
        return $SourceRoot
    }

    $Candidates = @()
    if ($env:OneDriveCommercial) {
        $Candidates += $env:OneDriveCommercial
    }
    if ($env:OneDrive) {
        $Candidates += $env:OneDrive
    }

    $UserProfile = [Environment]::GetFolderPath("UserProfile")
    if ($UserProfile -and (Test-Path -LiteralPath $UserProfile)) {
        $Candidates += Get-ChildItem -LiteralPath $UserProfile -Directory -Filter "OneDrive - *" -ErrorAction SilentlyContinue |
            ForEach-Object { $_.FullName }
    }

    foreach ($Candidate in ($Candidates | Select-Object -Unique)) {
        if ($Candidate -and (Test-Path -LiteralPath (Join-Path $Candidate "Talbots"))) {
            return $Candidate
        }
    }

    return $null
}

function Upsert-EnvLine {
    param(
        [string[]]$Lines,
        [string]$Key,
        [string]$Value
    )

    $Found = $false
    $Pattern = "^{0}=" -f [regex]::Escape($Key)
    $Updated = foreach ($Line in $Lines) {
        if ($Line -match $Pattern) {
            $Found = $true
            "{0}={1}" -f $Key, $Value
        } else {
            $Line
        }
    }

    if (-not $Found) {
        $Updated += "{0}={1}" -f $Key, $Value
    }

    return ,$Updated
}

Write-Host "OpenCrab Talbots team bootstrap"
Write-Host "Project root: $ProjectRoot"

$Python = Find-Python
$VenvPython = Join-Path $ProjectRoot ".venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $VenvPython)) {
    Write-Host "Creating .venv..."
    & $Python -m venv .venv
}

Write-Host "Installing Python requirements..."
& $VenvPython -m pip install -r requirements.txt

$EnvPath = Join-Path $ProjectRoot ".env"
if (-not (Test-Path -LiteralPath $EnvPath)) {
    Copy-Item -LiteralPath (Join-Path $ProjectRoot ".env.example") -Destination $EnvPath
}

$Lines = @(Get-Content -LiteralPath $EnvPath -Encoding UTF8)
$DetectedSourceRoot = Find-SourceRoot

if ($DetectedSourceRoot) {
    $Lines = Upsert-EnvLine $Lines "OPENCRAB_SOURCE_ROOT" $DetectedSourceRoot
} else {
    Write-Warning "Could not auto-detect a OneDrive folder containing Talbots. Re-run with -SourceRoot ""C:\path\to\OneDrive - company"" or edit .env manually."
}

$Lines = Upsert-EnvLine $Lines "OPENCRAB_WORKSPACE" $ProjectRoot
$Lines = Upsert-EnvLine $Lines "OPENCRAB_DB_PATH" "data\opencrab_thin_index.sqlite"
$Lines = Upsert-EnvLine $Lines "OPENCRAB_MAIL_DB_PATH" "data\mail_thin_ontology.sqlite"
$Lines = Upsert-EnvLine $Lines "OPENCRAB_STYLE_DB_PATH" "data\business_style_index.sqlite"
$Lines = Upsert-EnvLine $Lines "OPENCRAB_VISUAL_DB_PATH" "data\visual_sketch_index.sqlite"
$Lines = Upsert-EnvLine $Lines "OPENCRAB_MAX_MAIL_AGE_HOURS" "72"
$Lines = Upsert-EnvLine $Lines "OPENCRAB_LAYOUT_SPEC_DIR" "knowledge\workbook_layout_specs"

Set-Content -LiteralPath $EnvPath -Value $Lines -Encoding UTF8

Write-Host "Running production smoke check..."
& $VenvPython .\scripts\production_smoke_check.py

Write-Host "Running preflight..."
& $VenvPython -m opencrab_starter.cli preflight

if ($RefreshIndexes) {
    Write-Host "Refreshing file and style indexes..."
    & $VenvPython -m opencrab_starter.cli build-index
    & $VenvPython -m opencrab_starter.cli style-refresh --include-top Talbots
}

if ($SyncOutlook) {
    Write-Host "Syncing recent Outlook mail..."
    & $VenvPython -m opencrab_starter.cli outlook-sync --count 200
}

Write-Host ""
Write-Host "Bootstrap complete."
Write-Host "Open this folder in Codex and say: 작업 시작하자"
Write-Host "If mail or indexes are not fresh yet, run with -RefreshIndexes and/or -SyncOutlook."
