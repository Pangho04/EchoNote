# 관리자 PowerShell에서 한 번 실행한다. 다시 실행하면 작업과 바탕화면 파일을 덮어쓴다.
# 로그온 트리거 작업 등록에 관리자 권한이 필요하다. 작업 자체는 현재 사용자 권한으로 실행된다.
$ErrorActionPreference = 'Stop'

$taskName = 'EchoNote Worker'
$runScript = Join-Path $PSScriptRoot 'run-worker.ps1'
$toggleScript = Join-Path $PSScriptRoot 'worker-toggle.ps1'
$user = "$env:USERDOMAIN\$env:USERNAME"

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runScript`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
# 실행 시간 제한 기본값(72시간)이 지나면 Worker가 강제 종료되므로 제한을 없앤다.
$settings = New-ScheduledTaskSettingsSet `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Force | Out-Null

# OneDrive로 옮겨진 바탕화면도 GetFolderPath가 찾는다. cmd는 시스템 코드 페이지로 읽으므로 Default로 쓴다.
$desktop = [Environment]::GetFolderPath('Desktop')
$cmd = "@powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$toggleScript`""
Set-Content -Path (Join-Path $desktop 'EchoNote Worker.cmd') -Value $cmd -Encoding Default

Write-Host "등록 완료: 작업 '$taskName', 바탕화면 'EchoNote Worker.cmd'"
