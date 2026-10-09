import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';

import { lightTheme } from '@/shared/config/theme';
import { ThemeProvider } from '@/shared/ui/theme-provider';

import type { ConfirmRecordingResult } from '../model/use-meeting-library-view-model';
import { RecordingTitleForm } from './recording-title-form';

function pressIn(host: TestInstance) {
  fireEvent(host, 'responderGrant', {
    persist() {},
    nativeEvent: { timestamp: 0, pageX: 0, pageY: 0, locationX: 0, locationY: 0 },
    currentTarget: { measure() {} },
  });
}

const onGranted = jest.fn();
const onCancel = jest.fn();
const onOpenSettings = jest.fn();

async function renderForm(result: ConfirmRecordingResult) {
  const confirmRecordingTitle = jest.fn(async () => result);

  return render(
    <ThemeProvider mode="light">
      <RecordingTitleForm
        confirmRecordingTitle={confirmRecordingTitle}
        onCancel={onCancel}
        onGranted={onGranted}
        onOpenSettings={onOpenSettings}
      />
    </ThemeProvider>,
  );
}

describe('RecordingTitleForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('granted면 만들어진 meetingId를 넘기고 안내 문구를 띄우지 않는다', async () => {
    const { getByText, queryByText } = await renderForm({ kind: 'granted', meetingId: 'm1' });

    await fireEvent.press(getByText('녹음 시작'));

    await waitFor(() => expect(onGranted).toHaveBeenCalledWith('m1'));
    expect(queryByText('마이크 권한을 허용해야 녹음을 시작할 수 있습니다.')).toBeNull();
  });

  it('denied면 팝업을 유지한 채 재시도 안내를 띄우고 시작 버튼을 남긴다', async () => {
    const { getByText, queryByText } = await renderForm({ kind: 'denied' });

    await fireEvent.press(getByText('녹음 시작'));

    await waitFor(() =>
      expect(getByText('마이크 권한을 허용해야 녹음을 시작할 수 있습니다.')).toBeOnTheScreen(),
    );
    expect(onGranted).not.toHaveBeenCalled();
    // 단순 거부는 다시 시도할 수 있어야 한다.
    expect(getByText('녹음 시작')).toBeOnTheScreen();
    expect(queryByText('설정 열기')).toBeNull();
  });

  it('blocked면 설정 안내로 바꾸고 시작 버튼을 설정 열기로 교체한다', async () => {
    const { getByText, queryByText } = await renderForm({ kind: 'blocked' });

    await fireEvent.press(getByText('녹음 시작'));

    await waitFor(() =>
      expect(getByText('설정에서 마이크 권한을 허용해 주세요.')).toBeOnTheScreen(),
    );
    expect(queryByText('녹음 시작')).toBeNull();

    await fireEvent.press(getByText('설정 열기'));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('취소를 누르면 onCancel을 호출한다', async () => {
    const { getByText } = await renderForm({ kind: 'denied' });

    await fireEvent.press(getByText('취소'));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('누르는 동안 취소 버튼 배경이 눌림 토큰 색이다', async () => {
    const { getByText } = await renderForm({ kind: 'denied' });
    const button = getByText('취소').parent as TestInstance;

    await act(async () => pressIn(button));

    expect(button).toHaveStyle({ backgroundColor: lightTheme.colors.surfacePressed });
  });
});
