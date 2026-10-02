import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

// 녹음 화면이 열려 있는 동안 로그아웃돼도 guard가 그 화면을 빼지 않게 하는 표시.
// 녹음기는 화면이 빠지면 저장 없이 멈추므로, 녹음을 마치거나 버릴 때까지 화면을 유지한다.
let heldCount = 0;

const subscribers = new Set<() => void>();

function changeHeldCount(delta: number): void {
  heldCount += delta;
  subscribers.forEach((notify) => notify());
}

function subscribe(notify: () => void): () => void {
  subscribers.add(notify);

  return () => subscribers.delete(notify);
}

export function isRecordingScreenHeld(): boolean {
  return heldCount > 0;
}

export function useIsRecordingScreenHeld(): boolean {
  return useSyncExternalStore(subscribe, isRecordingScreenHeld);
}

// 반환한 release는 마운트 1회당 한 번만 표시를 내린다. 언마운트도 아직 내리지 않았을 때만 내린다.
export function useRecordingScreenHold(): () => void {
  const releasedRef = useRef(false);

  /**
   * @when 녹음 화면이 마운트되면
   * @expect 유지 표시를 하나 올리고 「내렸음」 표시를 초기화한다
   * @clear 아직 release하지 않았으면 유지 표시를 하나 내린다
   */
  useEffect(() => {
    releasedRef.current = false;
    changeHeldCount(1);

    return () => {
      if (releasedRef.current) return;

      releasedRef.current = true;
      changeHeldCount(-1);
    };
  }, []);

  return useCallback(() => {
    if (releasedRef.current) return;

    releasedRef.current = true;
    changeHeldCount(-1);
  }, []);
}
