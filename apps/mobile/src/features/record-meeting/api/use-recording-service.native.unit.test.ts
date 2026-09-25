import type { RecordingStatus as ExpoRecordingStatus } from 'expo-audio';
import { useAudioRecorder } from 'expo-audio';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RecorderState } from './recording-service-contract';
import { useNativeRecordingService } from './use-recording-service.native';

const mocks = vi.hoisted(() => ({
  statusListener: null as ((status: ExpoRecordingStatus) => void) | null,
  cleanups: [] as (() => void)[],
  appStateListener: null as ((state: string) => void) | null,
  removeAppStateListener: vi.fn(),
  recorder: {
    uri: null as string | null,
    prepareToRecordAsync: vi.fn(async () => {}),
    record: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(async () => {}),
    getStatus: vi.fn(() => ({
      canRecord: false,
      isRecording: false,
      durationMillis: 0,
      mediaServicesDidReset: false,
      url: null,
    })),
  },
}));

vi.mock('expo-audio', () => ({
  RecordingPresets: {
    HIGH_QUALITY: { preset: 'high-quality' },
  },
  useAudioRecorder: vi.fn((_options: unknown, listener: (status: ExpoRecordingStatus) => void) => {
    mocks.statusListener = listener;

    return mocks.recorder;
  }),
}));

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: vi.fn((_type: string, listener: (state: string) => void) => {
      mocks.appStateListener = listener;

      return { remove: mocks.removeAppStateListener };
    }),
  },
}));

vi.mock('./recording-permission-service.native', () => ({
  canRecordInBackground: vi.fn(async () => true),
}));

vi.mock('react', () => ({
  useEffect: vi.fn((effect: () => void | (() => void)) => {
    const cleanup = effect();

    if (cleanup) mocks.cleanups.push(cleanup);
  }),
  useMemo: vi.fn((factory: () => unknown) => factory()),
  useRef: vi.fn((initialValue: unknown) => ({ current: initialValue })),
}));

afterEach(() => {
  vi.clearAllMocks();
  mocks.statusListener = null;
  mocks.cleanups = [];
  mocks.appStateListener = null;
});

describe('useNativeRecordingService', () => {
  it('Expo recorder와 status callback을 adapter에 연결하고 cleanup에서 정리한다', async () => {
    const service = useNativeRecordingService();
    const listener = vi.fn();
    service.subscribe(listener);

    expect(useAudioRecorder).toHaveBeenCalledWith({ preset: 'high-quality' }, expect.any(Function));

    mocks.statusListener?.({
      id: 'recorder-1',
      isFinished: false,
      hasError: true,
      error: 'native recorder failure',
      url: null,
    });

    expect(listener).toHaveBeenLastCalledWith({
      state: RecorderState.ERROR,
      durationMs: 0,
      errorMessage: 'native recorder failure',
    });

    expect(mocks.cleanups).toHaveLength(2);

    mocks.cleanups.forEach((cleanup) => cleanup());
    await Promise.resolve();

    expect(() => service.subscribe(vi.fn())).toThrow('녹음기가 정리되었습니다.');
    expect(mocks.removeAppStateListener).toHaveBeenCalledTimes(1);
  });

  it('앱이 active로 돌아오면 native 녹음 상태를 확인한다', () => {
    useNativeRecordingService();
    mocks.recorder.getStatus.mockClear();

    mocks.appStateListener?.('background');
    expect(mocks.recorder.getStatus).not.toHaveBeenCalled();

    mocks.appStateListener?.('active');
    expect(mocks.recorder.getStatus).toHaveBeenCalledTimes(1);
  });
});
