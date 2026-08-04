[CmdletBinding()]
param(
  [switch]$RemoveModelCache,
  [switch]$RemoveOutputs
)

$ErrorActionPreference = "Stop"
$ImageName = "echonote/faster-whisper-benchmark:cuda12.8"
$ImageOwner = "stt-benchmark-image-v1"
$TurboCacheVolumeName = "echonote-stt-benchmark-turbo-cache-v1"
$TurboCacheVolumeOwner = "stt-benchmark-turbo-model-cache-v1"
$LargeV3CacheVolumeName = "echonote-stt-benchmark-large-v3-cache-v1"
$LargeV3CacheVolumeOwner = "stt-benchmark-large-v3-model-cache-v1"
$ResourceLabel = "com.echonote.resource"
$OutputDirectory = Join-Path $PSScriptRoot "output"
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

function Remove-OwnedImageIfPresent {
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

    Invoke-Docker `
      -Arguments @("info") `
      -FailureMessage "Cannot connect to Docker Desktop."

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
    throw "Refusing to remove an image not owned by this benchmark: $ImageName"
  }

  & docker image rm $ImageName

  if ($LASTEXITCODE -ne 0) {
    throw "Benchmark image removal failed: $ImageName"
  }
}

function Remove-OwnedCacheVolumeIfPresent {
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

    Invoke-Docker `
      -Arguments @("info") `
      -FailureMessage "Cannot connect to Docker Desktop."

    if ($InspectError -match "No such volume") {
      return
    }

    throw "Benchmark model cache volume inspection failed: $InspectError"
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
    throw "Refusing to remove a volume not owned by this benchmark: $CacheVolumeName"
  }

  & docker volume rm $CacheVolumeName

  if ($LASTEXITCODE -ne 0) {
    throw "Benchmark model cache volume removal failed: $CacheVolumeName"
  }
}

function Remove-OwnedOutputsIfPresent {
  if (-not (Test-Path -LiteralPath $OutputDirectory)) {
    return
  }

  if (-not (Test-Path -LiteralPath $OutputDirectory -PathType Container)) {
    throw "Refusing to remove unowned output path: $OutputDirectory"
  }

  Assert-NotReparsePoint `
    -Path $OutputDirectory `
    -FailureMessage "Refusing to remove unowned output reparse point: $OutputDirectory"

  $RootMarkerPath = Join-Path $OutputDirectory $OutputRootMarkerName

  if (-not (Test-Path -LiteralPath $RootMarkerPath -PathType Leaf)) {
    throw "Refusing to remove unowned output directory: $OutputDirectory"
  }

  Assert-NotReparsePoint `
    -Path $RootMarkerPath `
    -FailureMessage "Refusing to remove unowned output marker: $RootMarkerPath"

  if ((Get-Content -LiteralPath $RootMarkerPath -Encoding Ascii -Raw).Trim() -ne $OutputRootOwner) {
    throw "Refusing to remove unowned output directory: $OutputDirectory"
  }

  $RunDirectories = @()

  foreach ($Entry in @(Get-ChildItem -LiteralPath $OutputDirectory -Force)) {
    if ($Entry.Name -eq $OutputRootMarkerName) {
      continue
    }

    if (-not $Entry.PSIsContainer) {
      throw "Refusing to remove unowned output entry: $($Entry.FullName)"
    }

    Assert-NotReparsePoint `
      -Path $Entry.FullName `
      -FailureMessage "Refusing to remove unowned output reparse point: $($Entry.FullName)"

    if ($Entry.Name -notmatch "^\d{8}-\d{6}-\d{3}-[0-9a-f]{8}$") {
      throw "Refusing to remove unowned output directory: $($Entry.FullName)"
    }

    $RunMarkerPath = Join-Path $Entry.FullName $RunMarkerName

    if (-not (Test-Path -LiteralPath $RunMarkerPath -PathType Leaf)) {
      throw "Refusing to remove unowned output directory: $($Entry.FullName)"
    }

    Assert-NotReparsePoint `
      -Path $RunMarkerPath `
      -FailureMessage "Refusing to remove unowned output marker: $RunMarkerPath"

    if ((Get-Content -LiteralPath $RunMarkerPath -Encoding Ascii -Raw).Trim() -ne $Entry.Name) {
      throw "Refusing to remove unowned output directory: $($Entry.FullName)"
    }

    foreach ($NestedEntry in @(Get-ChildItem -LiteralPath $Entry.FullName -Force -Recurse)) {
      Assert-NotReparsePoint `
        -Path $NestedEntry.FullName `
        -FailureMessage "Refusing to remove output containing a reparse point: $($NestedEntry.FullName)"
    }

    $RunDirectories += $Entry.FullName
  }

  foreach ($RunDirectory in $RunDirectories) {
    Remove-Item -LiteralPath $RunDirectory -Recurse -Force
  }

  Remove-Item -LiteralPath $RootMarkerPath -Force
  Remove-Item -LiteralPath $OutputDirectory -Force
}

Get-Command docker -ErrorAction Stop | Out-Null
Invoke-Docker -Arguments @("info") -FailureMessage "Cannot connect to Docker Desktop."
Remove-OwnedImageIfPresent

if ($RemoveModelCache) {
  Remove-OwnedCacheVolumeIfPresent `
    -CacheVolumeName $TurboCacheVolumeName `
    -CacheVolumeOwner $TurboCacheVolumeOwner
  Remove-OwnedCacheVolumeIfPresent `
    -CacheVolumeName $LargeV3CacheVolumeName `
    -CacheVolumeOwner $LargeV3CacheVolumeOwner
}

if ($RemoveOutputs) {
  Remove-OwnedOutputsIfPresent
}

Write-Host "Cleanup completed. The hermes container and shared CUDA base image were not changed."
