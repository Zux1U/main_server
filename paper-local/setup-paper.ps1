param(
  [string]$PaperVersion = "",
  [string]$PaperBuild = "",
  [switch]$ForceDownload
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Info([string]$Message) {
  Write-Host "[paper-bootstrap] $Message"
}

function Fail([string]$Message) {
  Write-Error "[paper-bootstrap] $Message"
  exit 1
}

function Resolve-Value([string]$Candidate, [string]$EnvName, [string]$Fallback) {
  if (-not [string]::IsNullOrWhiteSpace($Candidate)) {
    return $Candidate.Trim()
  }

  $envValue = [Environment]::GetEnvironmentVariable($EnvName)
  if (-not [string]::IsNullOrWhiteSpace($envValue)) {
    return $envValue.Trim()
  }

  return $Fallback
}

function Resolve-BoolEnv([string]$EnvName) {
  $value = [Environment]::GetEnvironmentVariable($EnvName)
  if ([string]::IsNullOrWhiteSpace($value)) {
    return $false
  }

  switch ($value.Trim().ToLowerInvariant()) {
    "1" { return $true }
    "true" { return $true }
    "yes" { return $true }
    "y" { return $true }
    "on" { return $true }
    default { return $false }
  }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtimeDir = Join-Path $scriptDir "runtime"
$paperJarPath = Join-Path $runtimeDir "paper.jar"
$tempJarPath = Join-Path $runtimeDir "paper.jar.part"
$metaPath = Join-Path $runtimeDir "paper-meta.json"

$PaperVersion = Resolve-Value $PaperVersion "PAPER_VERSION" "1.21.11"
$PaperBuild = Resolve-Value $PaperBuild "PAPER_BUILD" ""
if (-not $ForceDownload) {
  $ForceDownload = Resolve-BoolEnv "PAPER_FORCE_DOWNLOAD"
}

if (-not (Test-Path -LiteralPath $runtimeDir)) {
  New-Item -ItemType Directory -Path $runtimeDir | Out-Null
}

$serverPropsExample = Join-Path $scriptDir "server.properties.example"
$serverProps = Join-Path $runtimeDir "server.properties"
if (-not (Test-Path -LiteralPath $serverProps)) {
  if (-not (Test-Path -LiteralPath $serverPropsExample)) {
    Fail "Missing template file: $serverPropsExample"
  }
  Copy-Item -LiteralPath $serverPropsExample -Destination $serverProps
  Info "Created runtime/server.properties from template."
}

$eulaExample = Join-Path $scriptDir "eula.txt.example"
$eula = Join-Path $runtimeDir "eula.txt"
if (-not (Test-Path -LiteralPath $eula)) {
  if (-not (Test-Path -LiteralPath $eulaExample)) {
    Fail "Missing template file: $eulaExample"
  }
  Copy-Item -LiteralPath $eulaExample -Destination $eula
  Info "Created runtime/eula.txt from template."
}

if ((Test-Path -LiteralPath $paperJarPath) -and -not $ForceDownload) {
  $metaMatches = $false
  if (Test-Path -LiteralPath $metaPath) {
    try {
      $meta = Get-Content -LiteralPath $metaPath -Raw | ConvertFrom-Json
      if ($null -ne $meta -and $meta.paperVersion -eq $PaperVersion) {
        if ([string]::IsNullOrWhiteSpace($PaperBuild)) {
          $metaMatches = $true
        } elseif ("$($meta.paperBuild)" -eq $PaperBuild) {
          $metaMatches = $true
        }
      }
    } catch {
      Info "paper-meta.json is invalid, refreshing Paper jar."
    }
  } else {
    Info "paper-meta.json not found, refreshing Paper jar."
  }

  if ($metaMatches) {
    Info "paper.jar already exists for requested version, skipping download."
    exit 0
  }

  Info "Existing paper.jar does not match requested version/build, refreshing."
}

if (-not $ForceDownload) {
  Info "paper.jar not found, downloading Paper $PaperVersion..."
} else {
  Info "Force download requested, refreshing Paper jar..."
}

$apiBase = "https://api.papermc.io/v2/projects/paper"
$versionEndpoint = "$apiBase/versions/$PaperVersion"

try {
  $versionData = Invoke-RestMethod -Uri $versionEndpoint -Method Get -TimeoutSec 30
} catch {
  Fail "Failed to fetch version metadata for '$PaperVersion'. Check version value and internet access."
}

$builds = @()
if ($null -ne $versionData.builds) {
  $builds = @($versionData.builds | ForEach-Object { [int]$_ })
}

if (-not $builds.Count) {
  Fail "No builds returned for Paper version '$PaperVersion'."
}

$resolvedBuild = 0
if (-not [string]::IsNullOrWhiteSpace($PaperBuild)) {
  $parsedBuild = 0
  if (-not [int]::TryParse($PaperBuild, [ref]$parsedBuild)) {
    Fail "PAPER_BUILD must be an integer, got '$PaperBuild'."
  }

  if ($builds -notcontains $parsedBuild) {
    $latestBuild = ($builds | Sort-Object -Descending | Select-Object -First 1)
    Fail "Build '$parsedBuild' not found for version '$PaperVersion'. Latest available: $latestBuild."
  }
  $resolvedBuild = $parsedBuild
} else {
  $resolvedBuild = ($builds | Sort-Object -Descending | Select-Object -First 1)
}

$buildEndpoint = "$apiBase/versions/$PaperVersion/builds/$resolvedBuild"

try {
  $buildData = Invoke-RestMethod -Uri $buildEndpoint -Method Get -TimeoutSec 30
} catch {
  Fail "Failed to fetch build metadata for Paper $PaperVersion build $resolvedBuild."
}

$downloadName = $null
if ($buildData.downloads -and $buildData.downloads.application -and $buildData.downloads.application.name) {
  $downloadName = [string]$buildData.downloads.application.name
}

if ([string]::IsNullOrWhiteSpace($downloadName)) {
  Fail "Build metadata is missing application download name (version $PaperVersion, build $resolvedBuild)."
}

$downloadUri = "$apiBase/versions/$PaperVersion/builds/$resolvedBuild/downloads/$downloadName"
Info "Downloading $downloadName (build $resolvedBuild)..."

try {
  Invoke-WebRequest -Uri $downloadUri -OutFile $tempJarPath -TimeoutSec 300
} catch {
  if (Test-Path -LiteralPath $tempJarPath) {
    Remove-Item -LiteralPath $tempJarPath -Force -ErrorAction SilentlyContinue
  }
  Fail "Download failed from '$downloadUri'. Check internet access or proxy settings."
}

try {
  Move-Item -LiteralPath $tempJarPath -Destination $paperJarPath -Force
} catch {
  if (Test-Path -LiteralPath $tempJarPath) {
    Remove-Item -LiteralPath $tempJarPath -Force -ErrorAction SilentlyContinue
  }
  Fail "Failed to place paper.jar into '$paperJarPath'. Check permissions."
}

try {
  $metaPayload = @{
    paperVersion = $PaperVersion
    paperBuild = "$resolvedBuild"
    downloadedAt = (Get-Date).ToString("o")
    downloadName = $downloadName
  } | ConvertTo-Json
  Set-Content -LiteralPath $metaPath -Value $metaPayload -Encoding UTF8
} catch {
  Info "Warning: failed to write paper-meta.json. Next run may re-check/download."
}

Info "Paper ready: version=$PaperVersion build=$resolvedBuild path=$paperJarPath"
exit 0
