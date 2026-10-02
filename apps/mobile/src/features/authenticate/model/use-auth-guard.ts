import { useIsRecordingScreenHeld } from './recording-screen-hold';
import { useSession } from './session-provider';

export type AuthGuard =
  | { kind: 'restoring' }
  | { kind: 'ready'; appOpen: boolean; recordingOpen: boolean; signInOpen: boolean };

// 로그아웃 상태에서도 녹음 중인 화면은 열어 둔다. 그동안 로그인 화면은 열지 않는다.
export function useAuthGuard(): AuthGuard {
  const { state } = useSession();
  const isRecordingScreenHeld = useIsRecordingScreenHeld();

  switch (state.kind) {
    case 'restoring':
      return { kind: 'restoring' };

    case 'signedIn':
      return { kind: 'ready', appOpen: true, recordingOpen: true, signInOpen: false };

    case 'signedOut':
      return {
        kind: 'ready',
        appOpen: false,
        recordingOpen: isRecordingScreenHeld,
        signInOpen: !isRecordingScreenHeld,
      };
  }
}
