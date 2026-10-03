# 바탕화면 EchoNote Worker.cmd가 실행한다. 현황을 보여 주고 켜기·끄기를 확인받는다.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

$taskName = 'EchoNote Worker'
$title = 'EchoNote Worker'
$workerEntry = Join-Path (Split-Path -Parent $PSScriptRoot) 'dist\index.js'
# docker-transcriber.ts의 RESOURCE_LABEL과 같은 값이다.
$sttLabel = 'label=com.echonote.resource=stt-job-v1'

function Show-Box([string]$text, [string]$buttons = 'OK', [string]$icon = 'Information') {
  [System.Windows.Forms.MessageBox]::Show($text, $title, $buttons, $icon)
}

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

if ($null -eq $task) {
  Show-Box '자동 시작 작업이 없습니다. install-autostart.ps1을 관리자 PowerShell에서 먼저 실행해 주세요.' 'OK' 'Warning' | Out-Null
  exit 1
}

$worker = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -like "*$workerEntry*" } |
  Select-Object -First 1
$sttIds = @(docker ps -q --filter $sttLabel 2> $null)
$autostart = if ($task.State -eq 'Disabled') { '꺼짐' } else { '켜짐' }

if ($null -ne $worker) {
  $since = $worker.CreationDate.ToString('HH:mm')
  $status = "상태: 실행 중 (PID $($worker.ProcessId), ${since}부터)"
} elseif ($task.State -eq 'Running') {
  $status = '상태: 시작 중 (Docker 대기 또는 빌드)'
} else {
  $status = '상태: 꺼짐'
}

$summary = "$status`n자동 시작: $autostart`n전사 중: $($sttIds.Count)건"

if ($null -ne $worker -or $task.State -eq 'Running') {
  $question = "$summary`n`n끌까요? 다음 로그온 때는 다시 자동으로 켜집니다."

  if ($sttIds.Count -gt 0) {
    $question += "`n전사 중인 $($sttIds.Count)건은 중단되고, 다음에 켤 때 처음부터 다시 처리됩니다.`n(끈 직후 바로 다시 켜면 최대 5분 기다린 뒤 시작합니다.)"
  }

  if ((Show-Box $question 'YesNo' 'Question') -ne 'Yes') { exit 0 }

  # 작업을 먼저 멈춘다. node를 먼저 죽이면 run-worker.ps1이 실패로 끝나 작업 스케줄러가 1분 뒤 다시 띄운다.
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

  # 절전 방지 PowerShell 등 자식 프로세스까지 함께 끝낸다.
  if ($null -ne $worker) { taskkill /PID $worker.ProcessId /T /F | Out-Null }

  # STT 상자는 Docker 소유라 Worker를 끝내도 남아 GPU를 계속 쓴다.
  if ($sttIds.Count -gt 0) { docker rm -f $sttIds | Out-Null }

  Show-Box '꺼졌습니다.' | Out-Null
  exit 0
}

if ((Show-Box "$summary`n`n켤까요?" 'YesNo' 'Question') -ne 'Yes') { exit 0 }

try {
  Start-ScheduledTask -TaskName $taskName
} catch {
  Show-Box "작업을 시작하지 못했습니다: $($_.Exception.Message)" 'OK' 'Error' | Out-Null
  exit 1
}

Show-Box '켰습니다. Docker 준비와 빌드에 1~2분 걸릴 수 있습니다.' | Out-Null
