[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$ImageName = "echonote/faster-whisper-benchmark:cuda12.8"
$ImageOwner = "stt-benchmark-image-v1"
$TurboCacheVolumeName = "echonote-stt-benchmark-turbo-cache-v1"
$TurboCacheVolumeOwner = "stt-benchmark-turbo-model-cache-v1"
$LargeV3CacheVolumeName = "echonote-stt-benchmark-large-v3-cache-v1"
$LargeV3CacheVolumeOwner = "stt-benchmark-large-v3-model-cache-v1"
$ResourceLabel = "com.echonote.resource"
$AudioExtensions = @(".m4a", ".mp3", ".wav", ".mp4", ".aac", ".flac", ".ogg", ".opus", ".webm")
$InputDirectory = Join-Path $PSScriptRoot "input"
$OutputRootDirectory = Join-Path $PSScriptRoot "output"
$OutputRootMarkerName = ".echonote-stt-benchmark-output-root"
$RunMarkerName = ".echonote-stt-benchmark-run"
$OutputRootOwner = "stt-benchmark-output-v1"

function Invoke-Docker {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,

    [Parameter(Mandatory = $true)]
    [string]$FailureMessage
  )

  & docker @Arguments

  if ($LASTEXITCODE -ne 0) {
    throw "$FailureMessage (exit code: $LASTEXITCODE)"
  }
}

function Assert-OwnedImageIfPresent {
  $PreviousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"

  try {
    $InspectOutput = @(& docker image inspect $ImageName --format '{{json .Config.Labels}}' 2>&1)
    $InspectExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $PreviousErrorActionPreference
  }

  if ($InspectExitCode -ne 0) {
    $InspectError = ($InspectOutput | Out-String).Trim()

    if ($InspectError -match "No such image") {
      return
    }

    throw "Benchmark image inspection failed: $InspectError"
  }

  $LabelsJson = ($InspectOutput | Out-String).Trim()
  $Labels = $LabelsJson | ConvertFrom-Json
  $Owner = $null

  if ($null -ne $Labels) {
    $Property = $Labels.PSObject.Properties[$ResourceLabel]

    if ($null -ne $Property) {
      $Owner = [string]$Property.Value
    }
  }

  if ($Owner -ne $ImageOwner) {
    throw "Image name is already used by another resource: $ImageName"
  }
}

function Initialize-OwnedCacheVolume {
  param(
    [Parameter(Mandatory = $true)]
    [string]$CacheVolumeName,

    [Parameter(Mandatory = $true)]
    [string]$CacheVolumeOwner
  )

  $PreviousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"

  try {
    $InspectOutput = @(& docker volume inspect $CacheVolumeName --format '{{json .Labels}}' 2>&1)
    $InspectExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $PreviousErrorActionPreference
  }

  if ($InspectExitCode -ne 0) {
    $InspectError = ($InspectOutput | Out-String).Trim()

    if ($InspectError -notmatch "No such volume") {
      throw "Benchmark model cache volume inspection failed: $InspectError"
    }

    Invoke-Docker `
      -Arguments @("volume", "create", "--label", "$ResourceLabel=$CacheVolumeOwner", $CacheVolumeName) `
      -FailureMessage "Benchmark model cache volume creation failed."

    return
  }

  $LabelsJson = ($InspectOutput | Out-String).Trim()
  $Labels = $LabelsJson | ConvertFrom-Json
  $Owner = $null

  if ($null -ne $Labels) {
    $Property = $Labels.PSObject.Properties[$ResourceLabel]

    if ($null -ne $Property) {
      $Owner = [string]$Property.Value
    }
  }

  if ($Owner -ne $CacheVolumeOwner) {
    throw "Volume name is already used by another resource: $CacheVolumeName"
  }
}

function Assert-NotReparsePoint {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [Parameter(Mandatory = $true)]
    [string]$FailureMessage
  )

  $Item = Get-Item -LiteralPath $Path -Force

  if (($Item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw $FailureMessage
  }
}

function Initialize-OwnedOutputRoot {
  $MarkerPath = Join-Path $OutputRootDirectory $OutputRootMarkerName

  if (Test-Path -LiteralPath $OutputRootDirectory) {
    if (-not (Test-Path -LiteralPath $OutputRootDirectory -PathType Container)) {
      throw "Output path is not a directory: $OutputRootDirectory"
    }

    Assert-NotReparsePoint `
      -Path $OutputRootDirectory `
      -FailureMessage "Output root cannot be a reparse point: $OutputRootDirectory"

    if (-not (Test-Path -LiteralPath $MarkerPath -PathType Leaf)) {
      throw "Output root is not owned by this benchmark: $OutputRootDirectory"
    }

    Assert-NotReparsePoint `
      -Path $MarkerPath `
      -FailureMessage "Output ownership marker cannot be a reparse point: $MarkerPath"

    if ((Get-Content -LiteralPath $MarkerPath -Encoding Ascii -Raw).Trim() -ne $OutputRootOwner) {
      throw "Output root is not owned by this benchmark: $OutputRootDirectory"
    }

    return
  }

  New-Item -ItemType Directory -Path $OutputRootDirectory -ErrorAction Stop | Out-Null
  Set-Content `
    -LiteralPath $MarkerPath `
    -Value $OutputRootOwner `
    -Encoding Ascii `
    -NoNewline
}

Get-Command docker -ErrorAction Stop | Out-Null
Invoke-Docker -Arguments @("info") -FailureMessage "Cannot connect to Docker Desktop."

if (-not (Test-Path -LiteralPath $InputDirectory -PathType Container)) {
  New-Item -ItemType Directory -Path $InputDirectory | Out-Null
  throw "The input directory was created. Add exactly one audio file and one Clova TXT file, then run again: $InputDirectory"
}

$InputFiles = @(Get-ChildItem -LiteralPath $InputDirectory -File)
$AudioFiles = @(
  $InputFiles | Where-Object { $AudioExtensions -contains $_.Extension.ToLowerInvariant() }
)
$ReferenceFiles = @(
  $InputFiles | Where-Object { $_.Extension.Equals(".txt", [System.StringComparison]::OrdinalIgnoreCase) }
)

if ($AudioFiles.Count -ne 1) {
  throw "The input directory must contain exactly one supported audio file. Found: $($AudioFiles.Count)"
}

if ($ReferenceFiles.Count -ne 1) {
  throw "The input directory must contain exactly one Clova TXT file. Found: $($ReferenceFiles.Count)"
}

Initialize-OwnedOutputRoot

$RunId = "{0}-{1}" -f (Get-Date -Format "yyyyMMdd-HHmmss-fff"), ([guid]::NewGuid().ToString("N").Substring(0, 8))
$OutputDirectory = Join-Path $OutputRootDirectory $RunId
New-Item -ItemType Directory -Path $OutputDirectory -ErrorAction Stop | Out-Null
$TurboOutputDirectory = Join-Path $OutputDirectory "turbo"
$LargeV3OutputDirectory = Join-Path $OutputDirectory "large-v3"
$ComparisonOutputDirectory = Join-Path $OutputDirectory "comparison"
New-Item -ItemType Directory -Path $TurboOutputDirectory -ErrorAction Stop | Out-Null
New-Item -ItemType Directory -Path $LargeV3OutputDirectory -ErrorAction Stop | Out-Null
New-Item -ItemType Directory -Path $ComparisonOutputDirectory -ErrorAction Stop | Out-Null
Set-Content `
  -LiteralPath (Join-Path $OutputDirectory $RunMarkerName) `
  -Value $RunId `
  -Encoding Ascii `
  -NoNewline
$ResolvedAudioPath = (Resolve-Path -LiteralPath $AudioFiles[0].FullName).Path
$ResolvedReferencePath = (Resolve-Path -LiteralPath $ReferenceFiles[0].FullName).Path
$ResolvedOutputDirectory = (Resolve-Path -LiteralPath $OutputDirectory).Path
$ResolvedTurboOutputDirectory = (Resolve-Path -LiteralPath $TurboOutputDirectory).Path
$ResolvedLargeV3OutputDirectory = (Resolve-Path -LiteralPath $LargeV3OutputDirectory).Path
$AudioContainerPath = "/input/audio$($AudioFiles[0].Extension.ToLowerInvariant())"
$ReferenceContainerPath = "/input/reference.txt"

Assert-OwnedImageIfPresent
Initialize-OwnedCacheVolume `
  -CacheVolumeName $TurboCacheVolumeName `
  -CacheVolumeOwner $TurboCacheVolumeOwner
Initialize-OwnedCacheVolume `
  -CacheVolumeName $LargeV3CacheVolumeName `
  -CacheVolumeOwner $LargeV3CacheVolumeOwner

Write-Host "[1/7] Build CUDA 12.8 benchmark image"
Invoke-Docker `
  -Arguments @("build", "--pull", "--tag", $ImageName, $PSScriptRoot) `
  -FailureMessage "Docker image build failed."

Write-Host "[2/7] Check CTranslate2 GPU availability"
Invoke-Docker `
  -Arguments @(
    "run",
    "--rm",
    "--network", "none",
    "--gpus", "all",
    "--entrypoint", "python3",
    $ImageName,
    "-c", "import ctranslate2; count = ctranslate2.get_cuda_device_count(); print(f'CUDA devices: {count}'); raise SystemExit(0 if count > 0 else 1)"
  ) `
  -FailureMessage "CTranslate2 cannot access the GPU."

Write-Host "[3/7] Download turbo model without mounting private input"
Invoke-Docker `
  -Arguments @(
    "run",
    "--rm",
    "--mount", "type=volume,source=$TurboCacheVolumeName,target=/model",
    "--entrypoint", "python3",
    $ImageName,
    "-c", "from faster_whisper.utils import download_model; print(download_model('turbo', output_dir='/model'))"
  ) `
  -FailureMessage "Turbo model download failed."

Write-Host "[4/7] Run offline turbo transcription"
Invoke-Docker `
  -Arguments @(
    "run",
    "--rm",
    "--network", "none",
    "--gpus", "all",
    "--env", "HF_HUB_OFFLINE=1",
    "--env", "ECHONOTE_WHISPER_MODEL_PATH=/model",
    "--mount", "type=bind,source=$ResolvedAudioPath,target=$AudioContainerPath,readonly",
    "--mount", "type=bind,source=$ResolvedReferencePath,target=$ReferenceContainerPath,readonly",
    "--mount", "type=bind,source=$ResolvedTurboOutputDirectory,target=/output",
    "--mount", "type=volume,source=$TurboCacheVolumeName,target=/model,readonly",
    $ImageName,
    "--audio", $AudioContainerPath,
    "--reference", $ReferenceContainerPath,
    "--output-dir", "/output",
    "--model", "turbo"
  ) `
  -FailureMessage "Turbo benchmark failed."

Write-Host "[5/7] Download large-v3 model without mounting private input"
Invoke-Docker `
  -Arguments @(
    "run",
    "--rm",
    "--mount", "type=volume,source=$LargeV3CacheVolumeName,target=/model",
    "--entrypoint", "python3",
    $ImageName,
    "-c", "from faster_whisper.utils import download_model; print(download_model('large-v3', output_dir='/model'))"
  ) `
  -FailureMessage "Large-v3 model download failed."

Write-Host "[6/7] Run offline large-v3 transcription"
Invoke-Docker `
  -Arguments @(
    "run",
    "--rm",
    "--network", "none",
    "--gpus", "all",
    "--env", "HF_HUB_OFFLINE=1",
    "--env", "ECHONOTE_WHISPER_MODEL_PATH=/model",
    "--mount", "type=bind,source=$ResolvedAudioPath,target=$AudioContainerPath,readonly",
    "--mount", "type=bind,source=$ResolvedReferencePath,target=$ReferenceContainerPath,readonly",
    "--mount", "type=bind,source=$ResolvedLargeV3OutputDirectory,target=/output",
    "--mount", "type=volume,source=$LargeV3CacheVolumeName,target=/model,readonly",
    $ImageName,
    "--audio", $AudioContainerPath,
    "--reference", $ReferenceContainerPath,
    "--output-dir", "/output",
    "--model", "large-v3"
  ) `
  -FailureMessage "Large-v3 benchmark failed."

Write-Host "[7/7] Compare 224 low-confidence candidates"
Invoke-Docker `
  -Arguments @(
    "run",
    "--rm",
    "--network", "none",
    "--entrypoint", "python3",
    "--mount", "type=bind,source=$ResolvedOutputDirectory,target=/results",
    $ImageName,
    "/app/compare_candidates.py",
    "--turbo-dir", "/results/turbo",
    "--large-v3-dir", "/results/large-v3",
    "--output-dir", "/results/comparison",
    "--expected-candidates", "224"
  ) `
  -FailureMessage "Candidate comparison failed."

Write-Host ""
Write-Host "Benchmark completed: $OutputDirectory"
Write-Host "Candidate review:"
Get-Content -LiteralPath (Join-Path $ComparisonOutputDirectory "candidate-review.txt") -Encoding UTF8 -Raw
