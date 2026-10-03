# 작업 스케줄러가 로그온 때 창 없이 실행한다. Docker 준비를 기다린 뒤 Worker를 빌드·실행한다.
$ErrorActionPreference = 'Continue'

$workerDir = Split-Path -Parent $PSScriptRoot
$repoDir = (Resolve-Path (Join-Path $workerDir '..\..')).Path
$stateDir = Join-Path $env:LOCALAPPDATA 'EchoNote'
$log = Join-Path $stateDir 'worker.log'

New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

function Write-Log([string]$message) {
  Add-Content -Path $log -Value "$(Get-Date -Format s) $message" -Encoding UTF8
}

# Docker Desktop은 로그온 뒤 엔진이 뜨기까지 시간이 걸린다. STT가 Docker로 돌기 때문에 기다린다.
$deadline = (Get-Date).AddMinutes(5)

while ($true) {
  docker info *> $null

  if ($LASTEXITCODE -eq 0) { break }

  if ((Get-Date) -gt $deadline) {
    Write-Log 'docker not ready after 5 minutes'
    exit 1
  }

  Start-Sleep -Seconds 5
}

# git pull로 바뀐 코드를 반영한다. 출력은 cmd로 넘겨 PowerShell 인코딩 변환 없이 로그에 붙인다.
Set-Location $repoDir
Write-Log 'build start'
cmd /c "pnpm --filter @echonote/contracts build >> `"$log`" 2>&1 && pnpm --filter @echonote/inference-worker build >> `"$log`" 2>&1"

if ($LASTEXITCODE -ne 0) {
  Write-Log "build failed exit=$LASTEXITCODE"
  exit 1
}

# worker-toggle.ps1이 명령줄의 dist\index.js 절대경로로 이 프로세스를 찾는다.
Set-Location $workerDir
Write-Log 'worker start'
cmd /c "node --env-file=.env.local `"$workerDir\dist\index.js`" >> `"$log`" 2>&1"
Write-Log "worker exit=$LASTEXITCODE"
exit $LASTEXITCODE
