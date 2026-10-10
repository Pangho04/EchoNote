#!/usr/bin/env bash
# suite를 돌리기 전에 기기 밖 전제를 확인한다. 녹음·업로드로 회의가 생기면 앱이 곧바로 Windows Worker에
# 녹음을 보내고, 닿지 않으면 화면을 덮는 팝업이 떠 뒤따르는 단계가 실패한다.
# 호스트 이름은 tailnet 상태에서 읽고 출력하지 않는다.
set -euo pipefail

TAILSCALE=${TAILSCALE:-$(command -v tailscale || echo /Applications/Tailscale.app/Contents/MacOS/Tailscale)}
fail=0

check() {
  if [ "$2" = ok ]; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi
}

adb get-state > /dev/null 2>&1 && s=ok || s=no
check 'Android 기기 연결' "$s"

[ "$(/usr/bin/curl -s -m 5 http://localhost:8081/status)" = 'packager-status:running' ] && s=ok || s=no
check 'Metro(8081)' "$s"

peers=$("$TAILSCALE" status --json | python3 -c '
import json, sys
peers = json.load(sys.stdin).get("Peer", {}).values()
def online(os_name):
    return any(p.get("OS") == os_name and p.get("Online") for p in peers)
host = next((p["DNSName"].rstrip(".") for p in peers if p.get("OS") == "windows" and p.get("Online")), "")
print("ok" if online("android") else "no", host)')
check 'Android Tailscale 연결' "${peers%% *}"

host=${peers#* }
[ -n "$host" ] && [ "$(/usr/bin/curl -s -o /dev/null -m 8 -w '%{http_code}' "https://$host:8443/live")" = 204 ] && s=ok || s=no
check 'Windows Worker(/live)' "$s"

exit "$fail"
