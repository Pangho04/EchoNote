import { useNavigation, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { BackHandler } from 'react-native';

import { useRecordingScreenHold, useSession } from '@/features/authenticate';
import { ROUTES } from '@/shared/config/routes';
import { UI_STRINGS } from '@/shared/config/ui-strings';
import { useDialog } from '@/shared/ui/dialog';

export interface RecordingExitInput {
  canDiscard: boolean;
  isSaving: boolean;
  discard(): Promise<void>;
}

export interface RecordingExit {
  finish(meetingId: string): void;
  cancel(): void;
}

// 녹음 화면을 떠나는 모든 경로(저장 완료·[취소]·뒤로가기)를 한곳에서 정한다.
// 저장 완료는 상세로 바꿔 들어가 텍스트 변환을 자동 요청하고, 취소 경로는 목록으로 돌아간다.
// 로그아웃 상태에선 목록이 guard에서 빠져 이동이 무시되므로, 유지 표시를 내려 guard가 녹음 화면을 빼게 한다.
export function useRecordingExit({
  canDiscard,
  isSaving,
  discard,
}: RecordingExitInput): RecordingExit {
  const router = useRouter();
  const navigation = useNavigation();
  const { state } = useSession();
  const { openDialog } = useDialog();
  const release = useRecordingScreenHold();
  const isSignedIn = state.kind === 'signedIn';
  const latestRef = useRef({ isSignedIn, canDiscard, isSaving, discard });

  /**
   * @when 렌더가 커밋될 때마다
   * @expect 고정된 finish·cancel이 누른 순간의 세션 상태와 녹음 상태를 읽도록 최신 값을 담는다
   * @clear -
   */
  useLayoutEffect(() => {
    latestRef.current = { isSignedIn, canDiscard, isSaving, discard };
  });

  // 만료 뒤 다시 로그인한 녹음 화면은 아래 목록이 없다. 목록을 먼저 놓아 상세의 뒤로가기가 목록이 되게 한다.
  const finish = useCallback(
    (meetingId: string) => {
      release();

      if (!latestRef.current.isSignedIn) return;

      const detail = ROUTES.meeting.afterRecording(meetingId);

      if (navigation.canGoBack()) {
        router.replace(detail);

        return;
      }

      router.replace(ROUTES.meeting.list);
      router.push(detail);
    },
    [navigation, release, router],
  );

  const leave = useCallback(() => {
    release();

    if (latestRef.current.isSignedIn) router.dismissTo(ROUTES.meeting.list);
  }, [release, router]);

  // 폐기가 끝난 시점에 로그인 상태면 leave로 원래 이동을 이어 가고, 아니면 guard가 녹음 화면을 뺀다.
  const confirmDiscard = useCallback(
    (leave: () => void) => {
      const discardAndLeave = async () => {
        try {
          await latestRef.current.discard();
        } catch {
          openDialog({
            message: UI_STRINGS.recording.discardFailed,
            actions: [{ label: UI_STRINGS.common.confirm, emphasis: 'primary' }],
          });

          return;
        }

        release();

        if (latestRef.current.isSignedIn) leave();
      };

      openDialog({
        title: UI_STRINGS.recording.discardTitle,
        message: UI_STRINGS.recording.discardMessage,
        actions: [
          { label: UI_STRINGS.recording.keepRecording },
          {
            label: UI_STRINGS.recording.discard,
            emphasis: 'destructive',
            onPress: () => void discardAndLeave(),
          },
        ],
      });
    },
    [openDialog, release],
  );

  const cancel = useCallback(() => {
    const latest = latestRef.current;

    if (latest.isSignedIn) {
      if (!latest.canDiscard && !latest.isSaving) leave();
      else router.dismissTo(ROUTES.meeting.list);

      return;
    }

    if (latest.isSaving) return;

    if (latest.canDiscard) confirmDiscard(leave);
    else leave();
  }, [confirmDiscard, leave, router]);

  // 취소 버튼·iOS 스와이프·Android 뒤로가기가 모두 여기서 멈춘다. 확인 뒤 같은 action을
  // 다시 보내면 이 hook은 그 action을 다시 막지 않는다.
  usePreventRemove(canDiscard || isSaving, ({ data }) => {
    if (isSaving) return;

    confirmDiscard(() => navigation.dispatch(data.action));
  });

  /**
   * @when 녹음 화면이 마운트된 동안 Android 뒤로가기를 누르면
   * @expect 아래 화면이 있으면 기본 뒤로가기(usePreventRemove가 가로챔), 없으면 [취소]와 같게 처리한다
   * @clear 뒤로가기 구독 해제
   */
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (navigation.canGoBack()) return false;

      cancel();

      return true;
    });

    return () => subscription.remove();
  }, [cancel, navigation]);

  return { finish, cancel };
}
