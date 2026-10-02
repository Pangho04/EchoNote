import { act, render } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { isRecordingScreenHeld } from '@/features/authenticate';
import { setRecordingDraft } from '@/features/record-meeting/model/recording-draft';
import { useRecordingSession } from '@/features/record-meeting/model/use-recording-session';
import { UI_STRINGS } from '@/shared/config/ui-strings';
import { ThemeProvider } from '@/shared/ui/theme-provider';

import { RecordingPage } from './recording-page.native';

jest.mock('@/features/authenticate', () => ({
  ...jest.requireActual('@/features/authenticate/model/recording-screen-hold'),
  useSession: () => ({ state: { kind: 'signedIn', userId: 'user-1' } }),
}));
jest.mock('@/shared/ui/dialog', () => ({ useDialog: () => ({ openDialog: jest.fn() }) }));
jest.mock('@/shared/ui/toast', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ dismissTo: jest.fn() }),
  useNavigation: () => ({ canGoBack: () => true, dispatch: jest.fn() }),
}));
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }));
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => ({}) }));
jest.mock('@/features/record-meeting/api/use-recording-service.native', () => ({
  useNativeRecordingService: () => ({}),
}));
jest.mock('../model/create-recording-session-dependencies.native', () => ({
  createRecordingSessionDependencies: () => ({}),
}));
jest.mock('@/features/record-meeting/model/use-recording-session', () => ({
  useRecordingSession: jest.fn(() => ({
    savedRecording: null,
    canDiscard: false,
    isSaving: false,
    discard: jest.fn(async () => {}),
  })),
}));
jest.mock('./recording-page-view', () => ({ RecordingPageView: () => null }));

describe('RecordingPage', () => {
  it('녹음 중 meetingId params가 바뀌어도 처음 회의의 초안을 유지한다', async () => {
    setRecordingDraft({ meetingId: 'm-1', titleInput: '첫 회의' });

    const view = await render(withTheme(<RecordingPage meetingId="m-1" />));

    await view.rerender(withTheme(<RecordingPage meetingId="m-2" />));

    expect(jest.mocked(useRecordingSession).mock.lastCall![0].meetingId).toBe('m-1');
    expect(isRecordingScreenHeld()).toBe(true);

    await act(async () => {
      view.unmount();
    });
  });

  it('초안 없음 화면에선 녹음 화면 유지 표시를 켜지 않는다', async () => {
    setRecordingDraft({ meetingId: 'm-1', titleInput: '첫 회의' });

    const view = await render(withTheme(<RecordingPage meetingId="missing" />));

    expect(view.getByText(UI_STRINGS.recording.missingDraft)).toBeTruthy();
    expect(isRecordingScreenHeld()).toBe(false);
  });
});

function withTheme(element: ReactElement): ReactElement {
  return <ThemeProvider mode="light">{element}</ThemeProvider>;
}
