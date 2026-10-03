# Windows 자동 시작

Worker를 로그온할 때 창 없이 띄우고, 바탕화면 `EchoNote Worker.cmd` 하나로 켜고 끈다.

## 설치

1. `services/inference-worker/.env.local`을 채운다(`.env.example` 참고).
2. 관리자 PowerShell에서 한 번 실행한다. 저장소 위치를 옮기면 다시 실행한다.

   ```powershell
   powershell -ExecutionPolicy Bypass -File services\inference-worker\windows\install-autostart.ps1
   ```

3. 바탕화면 `EchoNote Worker.cmd`를 실행해 켠다.

## 동작

- 로그온 → Docker 준비를 최대 5분 기다림 → contracts·worker 빌드 → 실행.
- 로그: `%LOCALAPPDATA%\EchoNote\worker.log`
- 끄기는 지금 실행 중인 Worker만 끝낸다. 다음 로그온 때 다시 자동으로 켜진다.
- 끄면 전사 중이던 job은 중단되고, 다음에 켤 때 처음부터 다시 처리한다.
- 바탕화면 위치는 Windows 설정을 따른다. OneDrive로 옮긴 바탕화면에도 생긴다.
- 비정상 종료 시 작업 스케줄러가 1분 뒤 다시 실행한다(최대 3회).
