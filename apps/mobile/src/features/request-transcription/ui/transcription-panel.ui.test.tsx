import { fireEvent, render, screen } from '@testing-library/react-native';

import { UI_STRINGS } from '@/shared/config/ui-strings';
import { ThemeProvider } from '@/shared/ui/theme-provider';

import type { TranscriptionPanelState, TranscriptionViewModel } from '../model/use-transcription';
import { TranscriptionPanel } from './transcription-panel';

function buildViewModel(panel: TranscriptionPanelState): TranscriptionViewModel {
  return {
    panel,
    disabled: false,
    request: jest.fn(),
    retry: jest.fn(),
    reupload: jest.fn(),
    recheck: jest.fn(),
  };
}

async function renderPanel(panel: TranscriptionPanelState, onPressSegment = jest.fn()) {
  const viewModel = buildViewModel(panel);

  await render(
    <ThemeProvider mode="light">
      <TranscriptionPanel onPressSegment={onPressSegment} viewModel={viewModel} />
    </ThemeProvider>,
  );

  return viewModel;
}

describe('TranscriptionPanel', () => {
  it.each<[TranscriptionPanelState, string, string[], string | null]>([
    [
      { kind: 'none', notice: 'start-failed' },
      '텍스트 변환을 시작하지 못했습니다',
      ['서버에 요청을 보내지 못했습니다.', '잠시 뒤 다시 시도해 주세요.'],
      '텍스트로 변환',
    ],
    [
      { kind: 'none', notice: 'recording-rejected' },
      '녹음 파일을 확인할 수 없습니다',
      ['녹음 파일이 손상되어 텍스트로 변환할 수 없습니다.'],
      '텍스트로 변환',
    ],
    [
      { kind: 'rejected' },
      '텍스트로 변환할 수 없는 녹음입니다',
      ['512MB 이하 녹음만 변환할 수 있습니다.', 'm4a 형식 녹음만 변환할 수 있습니다.'],
      null,
    ],
    [
      { kind: 'created', reason: 'desktop-offline' },
      '데스크탑에 연결할 수 없습니다',
      ['PC가 켜져 있는지 확인해 주세요.', '이 기기의 Tailscale이 연결됐는지 확인해 주세요.'],
      '다시 요청',
    ],
    [
      { kind: 'created', reason: 'send-failed' },
      '텍스트 변환 요청 실패',
      ['변환 요청을 보내지 못했습니다.'],
      '다시 요청',
    ],
    [
      { kind: 'created', reason: 'interrupted' },
      '텍스트 변환 요청이 끝나지 않았습니다',
      ['요청 도중 앱이 닫혀 중단됐습니다.'],
      '다시 요청',
    ],
    [
      { kind: 'unreadable', status: 'completed' },
      '결과를 읽을 수 없습니다',
      ['변환은 끝났지만 결과를 불러오지 못했습니다.'],
      '다시 확인',
    ],
    [
      { kind: 'unreadable', status: 'processing' },
      '결과를 읽을 수 없습니다',
      ['변환 상태를 확인하지 못했습니다.'],
      '다시 확인',
    ],
    [
      { kind: 'unreadable', status: null },
      '결과를 읽을 수 없습니다',
      ['변환 상태를 확인하지 못했습니다.'],
      '다시 확인',
    ],
  ])('%o는 실패 상자에 제목과 불릿 이유를 그린다', async (panel, title, details, button) => {
    await renderPanel(panel);

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(title)).toBeTruthy();

    for (const detail of details) expect(screen.getByText(`• ${detail}`)).toBeTruthy();

    if (button === null) expect(screen.queryByRole('button')).toBeNull();
    else expect(screen.getByRole('button', { name: button })).toBeTruthy();
  });

  it('failed는 errorCode 문구를 불릿 하나로 그리고 [다시 시도]가 retry를 부른다', async () => {
    const viewModel = await renderPanel({ kind: 'failed', errorCode: null });

    expect(screen.getByText('텍스트 변환 실패')).toBeTruthy();
    expect(screen.getAllByText(/^• /)).toHaveLength(1);

    await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));

    expect(viewModel.retry).toHaveBeenCalledTimes(1);
  });

  it('notice가 없는 none은 상자 없이 [텍스트로 변환]만 그린다', async () => {
    const viewModel = await renderPanel({ kind: 'none', notice: null });

    expect(screen.queryByRole('alert')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: '텍스트로 변환' }));

    expect(viewModel.request).toHaveBeenCalledTimes(1);
  });

  it.each<[TranscriptionPanelState, string]>([
    [{ kind: 'sending', progress: null }, '텍스트 변환 준비 중'],
    [{ kind: 'sending', progress: 40 }, '텍스트 변환 요청 중 40%'],
    [{ kind: 'queued' }, '텍스트 변환 대기 중'],
    [{ kind: 'processing' }, '텍스트 변환 중'],
  ])('%o는 상태 문구와 스피너를 그리고 버튼이 없다', async (panel, label) => {
    await renderPanel(panel);

    expect(screen.getByText(label)).toBeTruthy();
    // 스피너는 접근성 트리에서 숨겨 role로 찾을 수 없다. 렌더 트리에서 요소 타입으로 확인한다.
    expect(JSON.stringify(screen.toJSON())).toContain('"type":"ActivityIndicator"');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('completed는 전사 행을 그리고 행을 누르면 그 시작 시각을 넘긴다', async () => {
    const onPressSegment = jest.fn();

    await renderPanel(
      {
        kind: 'completed',
        content: {
          durationMs: 120_000,
          segments: [
            { startMs: 0, endMs: 5_000, text: '첫 문장' },
            { startMs: 65_000, endMs: 70_000, text: '둘째 문장' },
          ],
        },
      },
      onPressSegment,
    );

    expect(screen.getByText('01:05')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: '1:05부터 재생' }));

    expect(onPressSegment).toHaveBeenCalledWith(65_000);
  });

  it('segment가 없는 completed는 빈 결과 문구를 그린다', async () => {
    await renderPanel({ kind: 'completed', content: { durationMs: 1_000, segments: [] } });

    expect(screen.getByText('변환된 문장이 없습니다.')).toBeTruthy();
  });

  it('loading은 비활성 버튼을 그리고 눌러도 request를 부르지 않는다', async () => {
    const viewModel = await renderPanel({ kind: 'loading' });
    const button = screen.getByRole('button', { name: UI_STRINGS.transcription.request });

    expect(button).toBeDisabled();

    await fireEvent.press(button);

    expect(viewModel.request).not.toHaveBeenCalled();
  });
});
