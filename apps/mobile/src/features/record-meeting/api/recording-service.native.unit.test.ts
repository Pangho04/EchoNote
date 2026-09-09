import type {
  RecorderState as ExpoRecorderState,
  RecordingStatus as ExpoRecordingStatus,
} from 'expo-audio';
import { setAudioModeAsync } from 'expo-audio';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createNativeRecordingAdapter } from './recording-service.native';
import type { ExpoAudioRecorderLike } from './recording-service-contract';
import {
  RecorderDisposedError,
  type RecorderSnapshot,
  RecorderState,
} from './recording-service-contract';

vi.mock('expo-audio', () => ({
  setAudioModeAsync: vi.fn(async () => {}),
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

function createExpoStatus(overrides: Partial<ExpoRecordingStatus> = {}): ExpoRecordingStatus {
  return {
    id: 'recorder-1',
    isFinished: false,
    hasError: false,
    error: null,
    url: null,
    ...overrides,
  };
}

function createFakeRecorder() {
  let uri: string | null = null;
  let state: ExpoRecorderState = {
    canRecord: false,
    isRecording: false,
    durationMillis: 0,
    mediaServicesDidReset: false,
    url: null,
  };
  const recorder: ExpoAudioRecorderLike = {
    get uri() {
      return uri;
    },
    prepareToRecordAsync: vi.fn(async () => {
      state = { ...state, canRecord: true };
    }),
    record: vi.fn(() => {
      state = { ...state, isRecording: true };
    }),
    pause: vi.fn(() => {
      state = { ...state, isRecording: false };
    }),
    stop: vi.fn(async () => {
      state = {
        ...state,
        canRecord: false,
        isRecording: false,
        durationMillis: 12_345,
        url: 'file:///virtual/meeting.m4a',
      };
      uri = 'file:///virtual/meeting.m4a';
    }),
    getStatus: vi.fn(() => ({ ...state })),
  };

  return {
    recorder,
    setState(nextState: Partial<ExpoRecorderState>) {
      state = { ...state, ...nextState };
    },
    setUri(nextUri: string | null) {
      uri = nextUri;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createNativeRecordingAdapter', () => {
  it('prepare는 native 준비 전에 iOS 녹음 허용 audio mode를 먼저 설정한다', async () => {
    const { recorder } = createFakeRecorder();
    const adapter = createNativeRecordingAdapter(recorder);

    await adapter.service.prepare();

    expect(setAudioModeAsync).toHaveBeenCalledWith({
      allowsRecording: true,
      playsInSilentMode: true,
    });
    expect(vi.mocked(setAudioModeAsync).mock.invocationCallOrder[0]!).toBeLessThan(
      vi.mocked(recorder.prepareToRecordAsync).mock.invocationCallOrder[0]!,
    );
  });

  it('현재 snapshot을 구독자에게 보내고 prepare·record·pause·stop을 관찰한다', async () => {
    const { recorder } = createFakeRecorder();
    const adapter = createNativeRecordingAdapter(recorder);
    const snapshots: RecorderSnapshot[] = [];
    const unsubscribe = adapter.service.subscribe((snapshot) => snapshots.push(snapshot));

    await adapter.service.prepare();
    await adapter.service.record();
    await adapter.service.pause();
    await adapter.service.record();
    const candidate = await adapter.service.stop();

    expect(snapshots.map(({ state }) => state)).toEqual([
      RecorderState.UNPREPARED,
      RecorderState.READY,
      RecorderState.RECORDING,
      RecorderState.PAUSED,
      RecorderState.RECORDING,
      RecorderState.STOPPED,
    ]);
    expect(candidate).toEqual({
      tempUri: 'file:///virtual/meeting.m4a',
      durationMs: 12_345,
    });
    expect(candidate).not.toHaveProperty('mimeType');

    unsubscribe();
    adapter.receiveExpoStatus(createExpoStatus({ isFinished: true }));
    expect(snapshots).toHaveLength(6);
  });

  it('동시에 listener 하나만 허용하고 identity가 맞는 unsubscribe만 해제한다', () => {
    const { recorder } = createFakeRecorder();
    const adapter = createNativeRecordingAdapter(recorder);
    const firstListener = vi.fn();
    const unsubscribe = adapter.service.subscribe(firstListener);

    expect(() => adapter.service.subscribe(vi.fn())).toThrow(
      '이미 녹음 상태 listener가 등록되어 있습니다.',
    );

    unsubscribe();
    expect(() => adapter.service.subscribe(vi.fn())).not.toThrow();
  });

  it('같은 명령은 Promise를 공유하고 다른 명령은 busy 오류로 거부한다', async () => {
    const deferred = createDeferred<void>();
    const { recorder, setState } = createFakeRecorder();
    recorder.prepareToRecordAsync = vi.fn(() => deferred.promise);
    const adapter = createNativeRecordingAdapter(recorder);

    const firstPrepare = adapter.service.prepare();
    const secondPrepare = adapter.service.prepare();

    expect(secondPrepare).toBe(firstPrepare);
    await expect(adapter.service.record()).rejects.toMatchObject({
      name: 'RecorderBusyError',
      code: 'RECORDER_BUSY',
    });

    setState({ canRecord: true });
    deferred.resolve();
    await expect(firstPrepare).resolves.toBeUndefined();
    expect(recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1);
  });

  it('10초 안에 끝나지 않은 비동기 명령을 timeout으로 종료한다', async () => {
    vi.useFakeTimers();
    const deferred = createDeferred<void>();
    const { recorder } = createFakeRecorder();
    recorder.prepareToRecordAsync = vi.fn(() => deferred.promise);
    const adapter = createNativeRecordingAdapter(recorder);

    const preparing = adapter.service.prepare();
    const assertion = expect(preparing).rejects.toMatchObject({
      name: 'RecorderTimeoutError',
      code: 'RECORDER_TIMEOUT',
    });

    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });

  it('Expo 오류와 media service reset을 ERROR snapshot과 명령 실패로 변환한다', async () => {
    const deferred = createDeferred<void>();
    const { recorder } = createFakeRecorder();
    recorder.prepareToRecordAsync = vi.fn(() => deferred.promise);
    const adapter = createNativeRecordingAdapter(recorder);
    const listener = vi.fn();
    adapter.service.subscribe(listener);
    const preparing = adapter.service.prepare();

    adapter.receiveExpoStatus(
      createExpoStatus({
        isFinished: true,
        hasError: true,
        error: 'native recorder failure',
        mediaServicesDidReset: true,
      }),
    );

    await expect(preparing).rejects.toThrow('native recorder failure');
    expect(listener).toHaveBeenLastCalledWith({
      state: RecorderState.ERROR,
      durationMs: 0,
      errorMessage: 'native recorder failure',
    });
  });

  it('stop 명령 밖의 예상하지 못한 finish callback을 ERROR로 변환한다', () => {
    const { recorder, setState } = createFakeRecorder();
    const adapter = createNativeRecordingAdapter(recorder);
    const listener = vi.fn();
    adapter.service.subscribe(listener);
    setState({ durationMillis: 3_000, isRecording: false });

    adapter.receiveExpoStatus(createExpoStatus({ isFinished: true }));

    expect(listener).toHaveBeenLastCalledWith({
      state: RecorderState.ERROR,
      durationMs: 3_000,
      errorMessage: '녹음이 예상과 다르게 종료되었습니다.',
    });
  });

  it('stop의 URI가 없으면 ERROR로 종료하고 저장 후보를 만들지 않는다', async () => {
    const { recorder } = createFakeRecorder();
    recorder.stop = vi.fn(async () => {});
    const adapter = createNativeRecordingAdapter(recorder);
    const listener = vi.fn();
    adapter.service.subscribe(listener);

    await adapter.service.prepare();
    await adapter.service.record();

    await expect(adapter.service.stop()).rejects.toThrow('녹음 파일 URI가 없습니다.');
    expect(listener).toHaveBeenLastCalledWith({
      state: RecorderState.ERROR,
      durationMs: 0,
      errorMessage: '녹음 파일 URI가 없습니다.',
    });
  });

  it('진행 중인 stop 재호출은 같은 Promise와 native stop 한 번을 사용한다', async () => {
    const deferred = createDeferred<void>();
    const { recorder, setState, setUri } = createFakeRecorder();
    recorder.stop = vi.fn(() => deferred.promise);
    const adapter = createNativeRecordingAdapter(recorder);

    await adapter.service.prepare();
    await adapter.service.record();
    const firstStop = adapter.service.stop();
    const secondStop = adapter.service.stop();

    expect(secondStop).toBe(firstStop);
    expect(recorder.stop).toHaveBeenCalledTimes(1);

    setState({
      canRecord: false,
      isRecording: false,
      durationMillis: 12_345,
      url: 'file:///virtual/meeting.m4a',
    });
    setUri('file:///virtual/meeting.m4a');
    deferred.resolve();

    await expect(firstStop).resolves.toEqual({
      tempUri: 'file:///virtual/meeting.m4a',
      durationMs: 12_345,
    });
  });

  it('dispose는 Promise를 공유하고 active 명령을 한 번 취소하며 늦은 완료를 무시한다', async () => {
    const deferred = createDeferred<void>();
    const { recorder, setState } = createFakeRecorder();
    recorder.prepareToRecordAsync = vi.fn(() => deferred.promise);
    const adapter = createNativeRecordingAdapter(recorder);
    const listener = vi.fn();
    adapter.service.subscribe(listener);
    const preparing = adapter.service.prepare();
    const preparingAssertion = expect(preparing).rejects.toBeInstanceOf(RecorderDisposedError);

    const firstDispose = adapter.service.dispose();
    const secondDispose = adapter.service.dispose();

    expect(secondDispose).toBe(firstDispose);
    await preparingAssertion;
    await expect(firstDispose).resolves.toBeUndefined();

    setState({ canRecord: true });
    deferred.resolve();
    await Promise.resolve();
    adapter.receiveExpoStatus(createExpoStatus({ isFinished: true }));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(() => adapter.service.subscribe(vi.fn())).toThrow(RecorderDisposedError);
  });

  it('녹음 중 dispose는 native stop을 최대 한 번 호출한다', async () => {
    const { recorder } = createFakeRecorder();
    const adapter = createNativeRecordingAdapter(recorder);

    await adapter.service.prepare();
    await adapter.service.record();
    const firstDispose = adapter.service.dispose();
    const secondDispose = adapter.service.dispose();

    await Promise.all([firstDispose, secondDispose]);
    expect(recorder.stop).toHaveBeenCalledTimes(1);
  });

  it('record가 native에 전달된 직후 dispose해도 native stop을 한 번 호출한다', async () => {
    const { recorder } = createFakeRecorder();
    const adapter = createNativeRecordingAdapter(recorder);

    await adapter.service.prepare();
    const recording = adapter.service.record();
    const recordingAssertion = expect(recording).rejects.toBeInstanceOf(RecorderDisposedError);
    const disposing = adapter.service.dispose();

    await recordingAssertion;
    await disposing;
    expect(recorder.stop).toHaveBeenCalledTimes(1);
  });
});
