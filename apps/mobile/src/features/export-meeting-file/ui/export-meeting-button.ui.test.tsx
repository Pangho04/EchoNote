import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { TranscriptContent } from '@/entities/transcript';
import { DialogProvider } from '@/shared/ui/dialog';
import { ThemeProvider } from '@/shared/ui/theme-provider';

import { saveRecordingCopy, saveTextFile } from '../api/export-meeting-file';
import { ExportMeetingButton, type ExportMeetingButtonProps } from './export-meeting-button';

jest.mock('react-native-safe-area-context', () => {
  const mock = jest.requireActual('react-native-safe-area-context/jest/mock');

  return mock.default ?? mock;
});
jest.mock('../api/export-meeting-file', () => ({
  saveRecordingCopy: jest.fn(async () => 'saved'),
  saveTextFile: jest.fn(async () => 'saved'),
}));

const mockedSaveTextFile = jest.mocked(saveTextFile);
const mockedSaveRecordingCopy = jest.mocked(saveRecordingCopy);

const transcript: TranscriptContent = {
  durationMs: 5_000,
  segments: [{ startMs: 5_000, endMs: 6_000, text: '안녕하세요' }],
};

const baseProps: ExportMeetingButtonProps = {
  title: '주간 회의',
  recordingUri: 'file://recording.m4a',
  transcript,
};

function element(props: Partial<ExportMeetingButtonProps> = {}) {
  return (
    <ThemeProvider mode="light">
      <DialogProvider>
        <ExportMeetingButton {...baseProps} {...props} />
      </DialogProvider>
    </ThemeProvider>
  );
}

async function openDialog() {
  await fireEvent.press(screen.getByLabelText('회의 파일 저장'));
}

// 저장 동작은 iOS에서 Modal이 다 닫혔다는 onDismiss 뒤에 실행된다.
// jest의 Modal은 숨겨지면 트리에서 빠지므로 onDismiss를 미리 잡아 둔다.
async function pressSave() {
  const { onDismiss } = screen.getByTestId('dialog-modal').props;

  await fireEvent.press(screen.getByText('저장'));
  await act(async () => onDismiss());
}

describe('ExportMeetingButton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('전사가 있으면 txt가 기본이고 저장하면 txt를 저장 화면에 넘긴다', async () => {
    await render(element());
    await openDialog();

    expect(screen.getByLabelText('내보낼 파일 종류, 현재 전사 텍스트 (.txt)')).toBeOnTheScreen();

    await pressSave();

    expect(mockedSaveTextFile).toHaveBeenCalledWith('주간 회의.txt', '[00:05] 안녕하세요\n');
    expect(mockedSaveRecordingCopy).not.toHaveBeenCalled();
  });

  it.each([null, { durationMs: 0, segments: [{ startMs: 0, endMs: 0, text: '  ' }] }])(
    '전사가 없거나 공백뿐이면 드롭다운을 잠그고 녹음을 저장 화면에 넘긴다',
    async (empty) => {
      await render(element({ transcript: empty }));
      await openDialog();

      const field = screen.getByLabelText('내보낼 파일 종류, 현재 녹음 파일 (.m4a)');

      expect(field.props.accessibilityState.disabled).toBe(true);

      await pressSave();

      expect(mockedSaveRecordingCopy).toHaveBeenCalledWith('file://recording.m4a', '주간 회의.m4a');
    },
  );

  it('녹음으로 바꿔 저장하면 녹음을 저장 화면에 넘긴다', async () => {
    await render(element());
    await openDialog();
    await fireEvent.press(screen.getByLabelText('내보낼 파일 종류, 현재 전사 텍스트 (.txt)'));
    await fireEvent.press(screen.getByText('녹음 파일 (.m4a)'));
    await pressSave();

    expect(mockedSaveRecordingCopy).toHaveBeenCalledWith('file://recording.m4a', '주간 회의.m4a');
    expect(mockedSaveTextFile).not.toHaveBeenCalled();
  });

  it('팝업에서 취소하면 저장 화면을 띄우지 않는다', async () => {
    await render(element());
    await openDialog();
    await fireEvent.press(screen.getByText('취소'));

    expect(mockedSaveTextFile).not.toHaveBeenCalled();
    expect(mockedSaveRecordingCopy).not.toHaveBeenCalled();
  });

  it('녹음을 골랐다가 취소하고 다시 열면 기본값 txt로 돌아간다', async () => {
    await render(element());
    await openDialog();
    await fireEvent.press(screen.getByLabelText('내보낼 파일 종류, 현재 전사 텍스트 (.txt)'));
    await fireEvent.press(screen.getByText('녹음 파일 (.m4a)'));
    await fireEvent.press(screen.getByText('취소'));
    await openDialog();
    await pressSave();

    expect(mockedSaveTextFile).toHaveBeenCalledTimes(1);
    expect(mockedSaveRecordingCopy).not.toHaveBeenCalled();
  });

  it('저장 화면이 열린 동안 아이콘이 비활성이고 저장하면 성공 팝업을 띄운다', async () => {
    let finishSave: () => void = () => {};

    mockedSaveTextFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSave = () => resolve('saved');
        }),
    );

    await render(element());
    await openDialog();
    await pressSave();

    expect(screen.getByLabelText('회의 파일 저장').props.accessibilityState.disabled).toBe(true);

    await act(async () => finishSave());

    expect(screen.getByLabelText('회의 파일 저장').props.accessibilityState.disabled).toBe(false);
    expect(screen.getByText('저장했습니다')).toBeOnTheScreen();
    expect(screen.getByText('선택한 위치에 파일을 저장했습니다.')).toBeOnTheScreen();
    expect(screen.queryByText('내보내지 못했습니다')).toBeNull();
  });

  it('저장 화면에서 취소하면 팝업 없이 아이콘을 다시 켠다', async () => {
    mockedSaveTextFile.mockResolvedValueOnce('cancelled');

    await render(element());
    await openDialog();
    await pressSave();

    expect(screen.queryByText('저장했습니다')).toBeNull();
    expect(screen.queryByText('내보내지 못했습니다')).toBeNull();
    expect(screen.getByLabelText('회의 파일 저장').props.accessibilityState.disabled).toBe(false);
  });

  it('저장이 실패하면 실패 팝업을 띄우고 아이콘을 다시 켠다', async () => {
    mockedSaveTextFile.mockRejectedValueOnce(new Error('save'));

    await render(element());
    await openDialog();
    await pressSave();

    expect(screen.getByText('내보내지 못했습니다')).toBeOnTheScreen();
    expect(screen.getByText('다시 시도해 주세요.')).toBeOnTheScreen();
    expect(screen.getByLabelText('회의 파일 저장').props.accessibilityState.disabled).toBe(false);
  });

  it('팝업이 열린 뒤 전사가 바뀌어도 연 순간의 값으로 저장한다', async () => {
    await render(element({ transcript: null }));
    await openDialog();
    await screen.rerender(element());

    expect(screen.getByLabelText('내보낼 파일 종류, 현재 녹음 파일 (.m4a)')).toBeOnTheScreen();

    await pressSave();

    expect(mockedSaveRecordingCopy).toHaveBeenCalledTimes(1);
    expect(mockedSaveTextFile).not.toHaveBeenCalled();
  });

  it('녹음 파일이 아직 없으면 아이콘이 비활성이고 팝업이 뜨지 않는다', async () => {
    await render(element({ recordingUri: null, transcript: null }));

    expect(screen.getByLabelText('회의 파일 저장').props.accessibilityState.disabled).toBe(true);

    await openDialog();

    expect(screen.queryByText('내보내기')).toBeNull();
  });
});
