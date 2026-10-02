import { useEffect } from 'react';

import { UI_STRINGS } from '@/shared/config/ui-strings';
import { useDialog } from '@/shared/ui/dialog';

import { isRecordingScreenHeld } from './recording-screen-hold';
import { useSession } from './session-provider';

export function useSessionExpiryDialog(): void {
  const { state } = useSession();
  const { openDialog } = useDialog();

  /**
   * @when 세션 상태가 signedOut(expired)로 바뀌면
   * @expect 만료 팝업을 한 번 띄운다. 녹음 화면을 유지 중이면 녹음이 계속된다는 문구를 쓴다
   * @clear -
   */
  useEffect(() => {
    if (state.kind !== 'signedOut' || state.cause !== 'expired') return;

    openDialog({
      title: UI_STRINGS.auth.sessionExpiredTitle,
      message: isRecordingScreenHeld()
        ? UI_STRINGS.auth.sessionExpiredRecordingMessage
        : UI_STRINGS.auth.sessionExpiredMessage,
      actions: [{ label: UI_STRINGS.common.confirm, emphasis: 'primary' }],
    });
  }, [openDialog, state]);
}
