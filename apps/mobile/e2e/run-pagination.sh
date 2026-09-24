#!/usr/bin/env bash
# 회의 25건을 넣고 목록 페이지네이션 flow를 돌린 뒤, 결과와 관계없이 넣은 회의를 지운다.
set -euo pipefail

PLATFORM=${1:?usage: $0 <android|ios> <device> [maestro-runner 추가 인자...]}
DEVICE=${2:?usage: $0 <android|ios> <device> [maestro-runner 추가 인자...]}
shift 2
DIR=$(cd "$(dirname "$0")" && pwd)
FLOW="$DIR/scenarios/meeting-list-pagination.yaml"

"$DIR/device-state.sh" "$PLATFORM" meetings-seed "$DEVICE"
trap '"$DIR/device-state.sh" "$PLATFORM" meetings-unseed "$DEVICE"' EXIT

if [ "$PLATFORM" = android ]; then
  maestro --device "$DEVICE" test "$FLOW"
else
  maestro-runner --platform ios --device "$DEVICE" "$@" test "$FLOW"
fi
