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

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtimeDir = Join-Path $scriptDir "runtime"
$paperJarPath = Join-Path $runtimeDir "paper.jar"
$tempJarPath = Join-Path $runtimeDir "paper.jar.part"

$PaperVersion = Resolve-Value $PaperVersion "PAPER_VERSION" "1.21.11"
$PaperBuild = Resolve-Value $PaperBuild "PAPER_BUILD" ""

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
  Info "paper.jar already exists, skipping download."
  exit 0
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

Info "Paper ready: version=$PaperVersion build=$resolvedBuild path=$paperJarPath"
exit 0
