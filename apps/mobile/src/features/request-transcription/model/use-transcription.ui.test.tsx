import { act, renderHook } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import type { Recording } from '@/entities/recording';
import type { StoredTranscription, TranscriptionRepository } from '@/entities/transcript';
import { UI_STRINGS } from '@/shared/config/ui-strings';
import { type DialogOptions, DialogProvider } from '@/shared/ui/dialog';
import { ThemeProvider } from '@/shared/ui/theme-provider';

import type { GatewayResult, TranscriptionGateway } from '../api/transcription-gateway';
import type { TranscriptionDeps } from './create-transcription-deps';
import {
  createTranscriptionController,
  type TranscriptionController,
  type TranscriptionView,
  useTranscription,
} from './use-transcription';

const MEETING_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '22222222-2222-4222-8222-222222222222';
const NEW_JOB_ID = '33333333-3333-4333-8333-333333333333';

const recording: Recording = {
  meetingId: MEETING_ID,
  uri: 'file:///recording.m4a',
  mimeType: 'audio/mp4',
  sha256: 'a'.repeat(64),
  durationMs: 60_000,
  byteSize: 1_000,
};

const content = {
  durationMs: 60_000,
  segments: [{ startMs: 0, endMs: 1_000, text: '안녕하세요' }],
};

const NETWORK_ERROR = { kind: 'network-error' } as const;

function job(status: string, errorCode: string | null = null) {
  return {
    kind: 'ok',
    data: { id: JOB_ID, meetingId: MEETING_ID, status, errorCode },
  } as unknown as GatewayResult<never>;
}

function httpError(status: number, error = 'error') {
  return { kind: 'http-error', status, error } as const;
}

// 쓰기마다 다른 화면이 끼어든 상황은 nextWriteFails로 만든다.
function createFakeRepository(initial: StoredTranscription) {
  let stored = initial;
  let nextWriteFails = false;

  function write(apply: () => void): boolean {
    if (nextWriteFails) {
      nextWriteFails = false;

      return false;
    }

    apply();

    return true;
  }

  const repository: TranscriptionRepository = {
    get: jest.fn(async () => stored),
    upsertCreated: jest.fn(async (_meetingId, jobId) =>
      write(() => {
        stored = { kind: 'row', transcription: { status: 'created', jobId } };
      }),
    ),
    updateStatus: jest.fn(async (_meetingId, jobId, status, errorCode) =>
      write(() => {
        stored = {
          kind: 'row',
          transcription: status === 'failed' ? { status, jobId, errorCode } : { status, jobId },
        };
      }),
    ),
    saveCompleted: jest.fn(async (_meetingId, jobId, saved) =>
      write(() => {
        stored = { kind: 'row', transcription: { status: 'completed', jobId, content: saved } };
      }),
    ),
    delete: jest.fn(async () =>
      write(() => {
        stored = { kind: 'none' };
      }),
    ),
    deleteCorrupt: jest.fn(async () =>
      write(() => {
        stored = { kind: 'none' };
      }),
    ),
  };

  return {
    repository,
    current: () => stored,
    set: (next: StoredTranscription) => {
      stored = next;
    },
    failNextWrite: () => {
      nextWriteFails = true;
    },
  };
}

type Pending<T> = { resolve: (value: T) => void; signal: AbortSignal };

function setup(
  initial: StoredTranscription,
  appState: AppStateStatus = 'active',
  target: Recording = recording,
) {
  const fake = createFakeRepository(initial);
  const gateway = {
    createJob: jest.fn(),
    issueUploadGrant: jest.fn(),
    getJob: jest.fn(),
    getTranscript: jest.fn(),
  } satisfies Record<keyof TranscriptionGateway, jest.Mock>;
  const deps: TranscriptionDeps = {
    transcriptions: fake.repository,
    gateway,
    checkDesktopLive: jest.fn(async () => true),
    uploadRecording: jest.fn(async () => ({ kind: 'uploaded' }) as const),
    createIdempotencyKey: () => 'idempotency-key',
    uploadingMeetingIds: new Set(),
  };
  const views: TranscriptionView[] = [];
  const dialogs: DialogOptions[] = [];
  const controller: TranscriptionController = createTranscriptionController(
    deps,
    target,
    appState,
    { onChange: (view) => views.push(view), openDialog: (options) => dialogs.push(options) },
  );

  return {
    fake,
    gateway,
    deps,
    controller,
    dialogs,
    views,
    panel: () => views.at(-1)?.panel,
    disabled: () => views.at(-1)?.disabled,
  };
}

function readyForUpload(target: ReturnType<typeof setup>) {
  target.gateway.createJob.mockResolvedValue({
    kind: 'ok',
    data: { id: NEW_JOB_ID, meetingId: MEETING_ID, status: 'created' },
  });
  target.gateway.issueUploadGrant.mockResolvedValue({
    kind: 'ok',
    data: { uploadUrl: 'https://desktop.example/v1/uploads/x', grant: 'grant' },
  });
}

// 응답을 테스트가 정할 때까지 붙잡는 GET. signal로 취소 여부를 읽는다.
function holdNext<T>(mock: jest.Mock): () => Pending<T> {
  let pending: Pending<T> | null = null;

  mock.mockImplementationOnce(
    (...args: unknown[]) =>
      new Promise<T>((resolve) => {
        pending = { resolve, signal: args.at(-1) as AbortSignal };
      }),
  );

  return () => {
    if (pending === null) throw new Error('GET이 아직 호출되지 않았다');

    return pending;
  };
}

const queuedRow: StoredTranscription = {
  kind: 'row',
  transcription: { status: 'queued', jobId: JOB_ID },
};

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('polling 상태 전이', () => {
  it.each([
    ['네트워크 실패', NETWORK_ERROR],
    ['401', httpError(401)],
    ['429', httpError(429)],
    ['5xx', httpError(503)],
  ])(
    'C1: 진입 조회가 %s면 로컬 queued로 polling을 시작해 5초 뒤 한 번 더 묻는다',
    async (_name, result) => {
      const { gateway, controller, panel } = setup(queuedRow);

      gateway.getJob.mockResolvedValueOnce(result).mockResolvedValue(job('queued'));

      await controller.load();

      expect(gateway.getJob).toHaveBeenCalledTimes(1);
      expect(panel()).toEqual({ kind: 'queued' });

      await jest.advanceTimersByTimeAsync(4_999);

      expect(gateway.getJob).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(1);

      expect(gateway.getJob).toHaveBeenCalledTimes(2);

      controller.dispose();
    },
  );

  it('m2: 계속 queued·processing이면 5초마다 묻고 panel을 갱신한다', async () => {
    const { gateway, controller, panel } = setup(queuedRow);

    gateway.getJob
      .mockResolvedValueOnce(job('queued'))
      .mockResolvedValueOnce(job('processing'))
      .mockResolvedValue(job('processing'));

    await controller.load();
    await jest.advanceTimersByTimeAsync(5_000);

    expect(panel()).toEqual({ kind: 'processing' });

    await jest.advanceTimersByTimeAsync(5_000);

    expect(gateway.getJob).toHaveBeenCalledTimes(3);

    controller.dispose();
  });

  it('C2: 쓰기가 0행이면 팝업 없이 행을 다시 읽어 그 상태로 맞춘다', async () => {
    const { fake, gateway, controller, dialogs, panel } = setup(queuedRow);

    // GET 도중 다른 화면이 행을 completed로 바꿨다.
    gateway.getJob.mockImplementationOnce(async () => {
      fake.set({ kind: 'row', transcription: { status: 'completed', jobId: JOB_ID, content } });
      fake.failNextWrite();

      return job('failed', 'stt_failed');
    });

    await controller.load();

    expect(dialogs).toHaveLength(0);
    expect(panel()).toEqual({ kind: 'completed', content });

    await jest.advanceTimersByTimeAsync(10_000);

    expect(gateway.getJob).toHaveBeenCalledTimes(1);
  });

  it('m1: 404면 행을 지우고 polling을 멈춘다', async () => {
    const { fake, gateway, controller, panel } = setup(queuedRow);

    gateway.getJob.mockResolvedValueOnce(httpError(404, 'job_not_found'));

    await controller.load();

    expect(fake.current()).toEqual({ kind: 'none' });
    expect(panel()).toEqual({ kind: 'none', notice: null });

    await jest.advanceTimersByTimeAsync(10_000);

    expect(gateway.getJob).toHaveBeenCalledTimes(1);
  });

  it('그 외 4xx·잘못된 응답이면 polling을 멈추고 unreadable에 마지막 status를 둔다', async () => {
    const { gateway, controller, panel } = setup(queuedRow);

    gateway.getJob.mockResolvedValueOnce(httpError(400));

    await controller.load();
    await jest.advanceTimersByTimeAsync(10_000);

    expect(panel()).toEqual({ kind: 'unreadable', status: 'queued' });
    expect(gateway.getJob).toHaveBeenCalledTimes(1);
  });

  it('failed면 행을 바꾸고 실패 팝업을 한 번 띄운 뒤 멈춘다', async () => {
    const { fake, gateway, controller, dialogs, panel } = setup(queuedRow);

    gateway.getJob.mockResolvedValueOnce(job('failed', 'stt_failed'));

    await controller.load();
    await jest.advanceTimersByTimeAsync(10_000);

    expect(fake.current()).toEqual({
      kind: 'row',
      transcription: { status: 'failed', jobId: JOB_ID, errorCode: 'stt_failed' },
    });
    expect(panel()).toEqual({ kind: 'failed', errorCode: 'stt_failed' });
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]!.title).toBe(UI_STRINGS.transcription.failedTitle);
    expect(gateway.getJob).toHaveBeenCalledTimes(1);
  });

  it('getJob이 잘못된 응답이면 unreadable로 멈춘다', async () => {
    const { gateway, controller, panel } = setup(queuedRow);

    gateway.getJob.mockResolvedValueOnce({ kind: 'invalid-response' });

    await controller.load();

    expect(panel()).toEqual({ kind: 'unreadable', status: 'queued' });

    await jest.advanceTimersByTimeAsync(10_000);

    expect(gateway.getJob).toHaveBeenCalledTimes(1);
  });

  it('polling 중 getJob이 created로 돌아오면 중단 상자로 멈춘다', async () => {
    const { gateway, controller, panel } = setup(queuedRow);

    gateway.getJob.mockResolvedValueOnce(job('queued')).mockResolvedValueOnce(job('created'));

    await controller.load();
    await jest.advanceTimersByTimeAsync(5_000);

    expect(panel()).toEqual({ kind: 'created', reason: 'interrupted' });

    const getJobCallsBefore = gateway.getJob.mock.calls.length;

    await jest.advanceTimersByTimeAsync(5_000);

    expect(gateway.getJob.mock.calls.length).toBe(getJobCallsBefore);
  });

  it.each([
    ['잘못된 응답', { kind: 'invalid-response' }],
    ['404', httpError(404)],
    ['400', httpError(400)],
  ])(
    'completed 응답의 전사 조회가 %s면 지우지 않고 unreadable로 멈춘다',
    async (_name, transcriptResult) => {
      const { fake, gateway, controller, panel } = setup(queuedRow);

      gateway.getJob.mockResolvedValueOnce(job('queued')).mockResolvedValueOnce(job('completed'));
      gateway.getTranscript.mockResolvedValueOnce(transcriptResult);

      await controller.load();
      await jest.advanceTimersByTimeAsync(5_000);

      expect(panel()).toEqual({ kind: 'unreadable', status: 'queued' });
      expect(fake.repository.delete).not.toHaveBeenCalled();
      expect(fake.repository.deleteCorrupt).not.toHaveBeenCalled();
    },
  );

  it('completed면 전사를 같은 요청 안에서 받아 저장한다', async () => {
    const { fake, gateway, controller, panel } = setup(queuedRow);

    gateway.getJob.mockResolvedValueOnce(job('completed'));
    gateway.getTranscript.mockResolvedValueOnce({ kind: 'ok', data: content });

    await controller.load();

    expect(fake.current()).toEqual({
      kind: 'row',
      transcription: { status: 'completed', jobId: JOB_ID, content },
    });
    expect(panel()).toEqual({ kind: 'completed', content });
  });

  it('completed인데 전사를 못 받으면 processing으로 두고 5초 뒤 다시 묻는다', async () => {
    const { fake, gateway, controller, panel } = setup(queuedRow);

    gateway.getJob.mockResolvedValueOnce(job('completed')).mockResolvedValue(job('processing'));
    gateway.getTranscript.mockResolvedValueOnce(httpError(503));

    await controller.load();

    expect(panel()).toEqual({ kind: 'processing' });
    expect(fake.current()).toEqual({
      kind: 'row',
      transcription: { status: 'processing', jobId: JOB_ID },
    });

    await jest.advanceTimersByTimeAsync(5_000);

    expect(gateway.getJob).toHaveBeenCalledTimes(2);

    controller.dispose();
  });

  it('진입 조회가 aborted로 응답하면 상태를 쓰지 않고 멈춘다', async () => {
    const { fake, gateway, controller } = setup(queuedRow);

    gateway.getJob.mockResolvedValueOnce({ kind: 'aborted' });

    await controller.load();

    expect(fake.repository.updateStatus).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(5_000);

    expect(gateway.getJob).toHaveBeenCalledTimes(1);

    controller.dispose();
  });

  it('m5·m6: 닫히면 진행 중 GET을 취소하고 응답이 와도 예약하지 않는다', async () => {
    const { gateway, controller } = setup(queuedRow);
    const pending = holdNext<unknown>(gateway.getJob);
    const loading = controller.load();

    await jest.advanceTimersByTimeAsync(0);
    controller.dispose();

    expect(pending().signal.aborted).toBe(true);

    pending().resolve(job('queued'));
    await loading;
    await jest.advanceTimersByTimeAsync(10_000);

    expect(gateway.getJob).toHaveBeenCalledTimes(1);
  });

  it('m5: 닫힌 뒤 도착한 completed는 전사를 받지 않고 processing으로만 적는다', async () => {
    const { fake, gateway, controller } = setup(queuedRow);
    const pending = holdNext<unknown>(gateway.getJob);
    const loading = controller.load();

    await jest.advanceTimersByTimeAsync(0);

    // 취소 신호를 무시하고 응답이 도착한 경우.
    controller.dispose();
    pending().resolve(job('completed'));
    await loading;

    expect(gateway.getTranscript).not.toHaveBeenCalled();
    expect(fake.current()).toEqual({
      kind: 'row',
      transcription: { status: 'processing', jobId: JOB_ID },
    });
  });

  it('background면 예약을 지우고, active로 돌아오면 바로 묻는다', async () => {
    const { gateway, controller } = setup(queuedRow);

    gateway.getJob.mockResolvedValue(job('queued'));

    await controller.load();
    controller.changeAppState('background');
    await jest.advanceTimersByTimeAsync(10_000);

    expect(gateway.getJob).toHaveBeenCalledTimes(1);

    controller.changeAppState('inactive');
    await jest.advanceTimersByTimeAsync(0);

    expect(gateway.getJob).toHaveBeenCalledTimes(1);

    controller.changeAppState('active');
    await jest.advanceTimersByTimeAsync(0);

    expect(gateway.getJob).toHaveBeenCalledTimes(2);

    controller.dispose();
  });

  it('inactive만 거친 active는 예약을 건드리지 않는다', async () => {
    const { gateway, controller } = setup(queuedRow);

    gateway.getJob.mockResolvedValue(job('queued'));

    await controller.load();
    controller.changeAppState('inactive');
    controller.changeAppState('active');
    await jest.advanceTimersByTimeAsync(0);

    expect(gateway.getJob).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(5_000);

    expect(gateway.getJob).toHaveBeenCalledTimes(2);

    controller.dispose();
  });
});

describe('손상 행', () => {
  it('손상 completed+UUID 행은 지우지 않고 [다시 확인]에서 전사를 다시 받는다', async () => {
    const { fake, gateway, controller, panel } = setup({
      kind: 'corrupt',
      status: 'completed',
      jobId: JOB_ID,
    });

    await controller.load();

    expect(fake.repository.deleteCorrupt).not.toHaveBeenCalled();
    expect(panel()).toEqual({ kind: 'unreadable', status: 'completed' });

    gateway.getTranscript.mockResolvedValueOnce({ kind: 'ok', data: content });
    controller.recheck();
    await jest.advanceTimersByTimeAsync(0);

    expect(gateway.getTranscript).toHaveBeenCalledWith(JOB_ID, expect.any(AbortSignal));
    expect(panel()).toEqual({ kind: 'completed', content });
  });

  it('그 외 손상 행은 지우고 none으로 둔다', async () => {
    const { fake, controller, panel } = setup({ kind: 'corrupt', status: 'queued', jobId: 'bad' });

    await controller.load();

    expect(fake.repository.deleteCorrupt).toHaveBeenCalledWith(MEETING_ID, 'bad');
    expect(panel()).toEqual({ kind: 'none', notice: null });
  });

  it.each([
    ['404', httpError(404)],
    ['네트워크 실패', NETWORK_ERROR],
    ['잘못된 응답', { kind: 'invalid-response' }],
  ])(
    '손상 completed 행 다시 확인에서 전사 조회가 %s면 unreadable을 그대로 둔다',
    async (_name, transcriptResult) => {
      const { fake, gateway, controller, panel } = setup({
        kind: 'corrupt',
        status: 'completed',
        jobId: JOB_ID,
      });

      await controller.load();

      expect(panel()).toEqual({ kind: 'unreadable', status: 'completed' });

      gateway.getTranscript.mockResolvedValueOnce(transcriptResult);
      controller.recheck();
      await jest.advanceTimersByTimeAsync(0);

      expect(panel()).toEqual({ kind: 'unreadable', status: 'completed' });
      expect(fake.repository.delete).not.toHaveBeenCalled();
      expect(fake.repository.deleteCorrupt).not.toHaveBeenCalled();
    },
  );

  it('m3: 지우기가 0행이고 다시 읽어도 손상이며 UUID가 아니면 jobId를 비워 [다시 확인]이 행부터 읽는다', async () => {
    const { fake, gateway, controller, panel } = setup({
      kind: 'corrupt',
      status: 'queued',
      jobId: 'bad',
    });

    fake.failNextWrite();
    (fake.repository.get as jest.Mock)
      .mockResolvedValueOnce({ kind: 'corrupt', status: 'queued', jobId: 'bad' })
      .mockResolvedValueOnce({ kind: 'corrupt', status: 'completed', jobId: 'bad' });

    await controller.load();

    expect(panel()).toEqual({ kind: 'unreadable', status: 'completed' });

    controller.recheck();
    await jest.advanceTimersByTimeAsync(0);

    expect(gateway.getTranscript).not.toHaveBeenCalled();
    expect(fake.repository.get).toHaveBeenCalledTimes(3);
  });
});

describe('업로드 버튼', () => {
  it('m4: 업로드가 끝나면 5초를 기다리지 않고 바로 묻는다', async () => {
    const target = setup({ kind: 'none' });

    readyForUpload(target);
    target.gateway.getJob.mockResolvedValue({
      kind: 'ok',
      data: { id: NEW_JOB_ID, meetingId: MEETING_ID, status: 'queued', errorCode: null },
    });

    await target.controller.load();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.gateway.getJob).toHaveBeenCalledTimes(1);
    expect(target.panel()).toEqual({ kind: 'queued' });

    await jest.advanceTimersByTimeAsync(5_000);

    expect(target.gateway.getJob).toHaveBeenCalledTimes(2);

    target.controller.dispose();
  });

  it('같은 회의 업로드가 앱 어딘가에서 진행 중이면 이미 요청 팝업만 띄운다', async () => {
    const target = setup({ kind: 'none' });

    target.deps.uploadingMeetingIds.add(MEETING_ID);

    await target.controller.load();
    target.controller.request();

    expect(target.dialogs).toHaveLength(1);
    expect(target.gateway.createJob).not.toHaveBeenCalled();
  });

  it('업로드가 끝나면 진행 중 목록에서 회의를 뺀다', async () => {
    const target = setup({ kind: 'none' });

    readyForUpload(target);
    target.gateway.getJob.mockResolvedValue(NETWORK_ERROR);

    await target.controller.load();
    target.controller.request();

    expect(target.deps.uploadingMeetingIds.has(MEETING_ID)).toBe(true);

    await jest.advanceTimersByTimeAsync(0);

    expect(target.deps.uploadingMeetingIds.has(MEETING_ID)).toBe(false);

    target.controller.dispose();
  });

  it('행이 기대와 다르면 업로드하지 않고 행에 맞춘다', async () => {
    const target = setup({ kind: 'none' });

    await target.controller.load();
    target.fake.set(queuedRow);
    target.gateway.getJob.mockResolvedValue(job('queued'));
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.gateway.createJob).not.toHaveBeenCalled();
    expect(target.panel()).toEqual({ kind: 'queued' });

    target.controller.dispose();
  });

  it('데스크탑이 꺼져 있으면 깨우기 팝업과 함께 연결 실패 상자로 둔다', async () => {
    const target = setup({ kind: 'none' });

    readyForUpload(target);
    (target.deps.checkDesktopLive as jest.Mock).mockResolvedValueOnce(false);

    await target.controller.load();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.dialogs).toHaveLength(1);
    expect(target.dialogs[0]!.title).toBe(UI_STRINGS.transcription.desktopOfflineTitle);
    expect(target.dialogs[0]!.actions![0]!.label).toBe(UI_STRINGS.common.cancel);
    expect(target.dialogs[0]!.actions![0]!.onPress).toBeUndefined();

    expect(target.panel()).toEqual({ kind: 'created', reason: 'desktop-offline' });
    expect(target.deps.uploadRecording).not.toHaveBeenCalled();
  });

  it('background로 가면 업로드를 끊고 팝업 없이 created로 둔다', async () => {
    const target = setup({ kind: 'none' });

    readyForUpload(target);
    (target.deps.uploadRecording as jest.Mock).mockImplementationOnce(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => resolve({ kind: 'aborted' }));
        }),
    );

    await target.controller.load();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);
    target.controller.changeAppState('background');
    await jest.advanceTimersByTimeAsync(0);

    expect(target.panel()).toEqual({ kind: 'created', reason: 'interrupted' });
    expect(target.dialogs).toHaveLength(0);
  });

  it('background 중단 뒤 active 복귀해서 다시 업로드하면 두 번째 전송이 나간다', async () => {
    const target = setup({ kind: 'none' });

    readyForUpload(target);
    (target.deps.uploadRecording as jest.Mock).mockImplementationOnce(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => resolve({ kind: 'aborted' }));
        }),
    );
    target.gateway.getJob.mockResolvedValue(NETWORK_ERROR);

    await target.controller.load();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);
    target.controller.changeAppState('background');
    await jest.advanceTimersByTimeAsync(0);

    expect(target.panel()).toEqual({ kind: 'created', reason: 'interrupted' });

    target.controller.changeAppState('active');
    target.controller.reupload();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.deps.uploadRecording).toHaveBeenCalledTimes(2);

    target.controller.dispose();
  });

  it('업로드 진행 중 inactive로 가도 업로드를 끊지 않는다', async () => {
    const target = setup({ kind: 'none' });

    readyForUpload(target);

    let capturedSignal: AbortSignal | null = null;

    (target.deps.uploadRecording as jest.Mock).mockImplementationOnce(
      ({ signal }: { signal: AbortSignal }) => {
        capturedSignal = signal;

        return new Promise(() => {});
      },
    );

    await target.controller.load();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);
    target.controller.changeAppState('inactive');

    expect(capturedSignal!.aborted).toBe(false);
    expect(target.panel()).toEqual({ kind: 'sending', progress: 0 });

    target.controller.dispose();
  });
});

describe('요청 결과별 panel', () => {
  it('행 없이 job 생성이 실패하면 시작 실패 상자와 요청 실패 팝업을 띄운다', async () => {
    const target = setup({ kind: 'none' });

    target.gateway.createJob.mockResolvedValue(NETWORK_ERROR);

    await target.controller.load();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.panel()).toEqual({ kind: 'none', notice: 'start-failed' });
    expect(target.dialogs.map((dialog) => dialog.title)).toEqual([
      UI_STRINGS.transcription.requestFailedTitle,
    ]);
  });

  it('failed 행에서 [다시 시도]의 job 생성이 실패하면 failed를 그대로 둔다', async () => {
    const target = setup({
      kind: 'row',
      transcription: { status: 'failed', jobId: JOB_ID, errorCode: null },
    });

    target.gateway.createJob.mockResolvedValue(NETWORK_ERROR);

    await target.controller.load();
    target.controller.retry();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.panel()).toEqual({ kind: 'failed', errorCode: null });
    expect(target.dialogs.map((dialog) => dialog.title)).toEqual([
      UI_STRINGS.transcription.requestFailedTitle,
    ]);
  });

  it('재시도마다 idempotency key가 달라지면 createJob에 각각 다른 키를 보낸다', async () => {
    const target = setup({
      kind: 'row',
      transcription: { status: 'failed', jobId: JOB_ID, errorCode: null },
    });

    let keyCount = 0;

    target.deps.createIdempotencyKey = () => `key-${++keyCount}`;
    target.gateway.createJob.mockResolvedValueOnce(NETWORK_ERROR).mockResolvedValue({
      kind: 'ok',
      data: { id: NEW_JOB_ID, meetingId: MEETING_ID, status: 'created' },
    });
    target.gateway.issueUploadGrant.mockResolvedValue({
      kind: 'ok',
      data: { uploadUrl: 'https://desktop.example/v1/uploads/x', grant: 'grant' },
    });
    target.gateway.getJob.mockResolvedValue(NETWORK_ERROR);

    await target.controller.load();
    target.controller.retry();
    await jest.advanceTimersByTimeAsync(0);
    target.controller.retry();
    await jest.advanceTimersByTimeAsync(0);

    const [, firstKey] = target.gateway.createJob.mock.calls[0] as [unknown, string];
    const [, secondKey] = target.gateway.createJob.mock.calls[1] as [unknown, string];

    expect(firstKey).not.toBe(secondKey);

    target.controller.dispose();
  });

  it.each([
    [
      'grant 발급 실패',
      (target: ReturnType<typeof setup>) => {
        target.gateway.issueUploadGrant.mockResolvedValue(NETWORK_ERROR);
      },
    ],
    [
      '파일 전송 실패',
      (target: ReturnType<typeof setup>) => {
        (target.deps.uploadRecording as jest.Mock).mockResolvedValueOnce({ kind: 'failed' });
      },
    ],
  ])('%s면 전송 실패 상자로 두고 요청 실패 팝업을 띄운다', async (_name, fail) => {
    const target = setup({ kind: 'none' });

    readyForUpload(target);
    fail(target);

    await target.controller.load();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.panel()).toEqual({ kind: 'created', reason: 'send-failed' });
    expect(target.dialogs.map((dialog) => dialog.title)).toEqual([
      UI_STRINGS.transcription.requestFailedTitle,
    ]);
  });

  it('데스크탑이 녹음을 거부하면 행을 지우고 녹음 확인 상자와 팝업을 띄운다', async () => {
    const target = setup({ kind: 'none' });

    readyForUpload(target);
    (target.deps.uploadRecording as jest.Mock).mockResolvedValueOnce({
      kind: 'recording-rejected',
    });

    await target.controller.load();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.fake.current()).toEqual({ kind: 'none' });
    expect(target.panel()).toEqual({ kind: 'none', notice: 'recording-rejected' });
    expect(target.dialogs.map((dialog) => dialog.title)).toEqual([
      UI_STRINGS.transcription.recordingRejectedTitle,
    ]);
  });

  it('행이 없고 녹음이 조건을 어기면 진입부터 rejected이고 팝업은 없다', async () => {
    const target = setup({ kind: 'none' }, 'active', { ...recording, mimeType: 'audio/wav' });

    await target.controller.load();

    expect(target.panel()).toEqual({ kind: 'rejected' });
    expect(target.dialogs).toHaveLength(0);
  });

  it('업로드 성공 직후 getJob이 네트워크 오류면 100%로 둔다', async () => {
    const target = setup({ kind: 'none' });

    readyForUpload(target);
    target.gateway.getJob.mockResolvedValueOnce(NETWORK_ERROR);

    await target.controller.load();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.panel()).toEqual({ kind: 'sending', progress: 100 });

    target.controller.dispose();
  });

  it('행 없이 job 생성이 401로 실패해도 시작 실패 상자와 요청 실패 팝업을 띄운다', async () => {
    const target = setup({ kind: 'none' });

    target.gateway.createJob.mockResolvedValue(httpError(401));

    await target.controller.load();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.panel()).toEqual({ kind: 'none', notice: 'start-failed' });
    expect(target.dialogs[0]!.title).toBe(UI_STRINGS.transcription.requestFailedTitle);
  });

  it('grant 발급이 401로 실패하면 전송 실패 상자로 두고 요청 실패 팝업을 띄운다', async () => {
    const target = setup({ kind: 'none' });

    readyForUpload(target);
    target.gateway.issueUploadGrant.mockResolvedValue(httpError(401));

    await target.controller.load();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.panel()).toEqual({ kind: 'created', reason: 'send-failed' });
    expect(target.dialogs[0]!.title).toBe(UI_STRINGS.transcription.requestFailedTitle);
  });

  it('job 생성 뒤 저장이 0행이면 grant 없이 행 기준으로 돌아간다', async () => {
    const target = setup({ kind: 'none' });

    target.gateway.createJob.mockResolvedValue({
      kind: 'ok',
      data: { id: NEW_JOB_ID, meetingId: MEETING_ID, status: 'created' },
    });

    await target.controller.load();
    target.fake.failNextWrite();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.dialogs).toHaveLength(0);
    expect(target.gateway.issueUploadGrant).not.toHaveBeenCalled();
    expect(target.panel()).toEqual({ kind: 'none', notice: null });

    target.controller.dispose();
  });
});

describe('녹음 직후 자동 요청', () => {
  it.each([
    [true, 1],
    [false, 0],
  ])('행이 없을 때 autoRequest=%s면 job 생성을 %d회 보낸다', async (autoRequest, count) => {
    const target = setup({ kind: 'none' });

    readyForUpload(target);
    target.gateway.getJob.mockResolvedValue(NETWORK_ERROR);

    await target.controller.open(autoRequest);
    await jest.advanceTimersByTimeAsync(0);

    expect(target.gateway.createJob).toHaveBeenCalledTimes(count);

    target.controller.dispose();
  });

  it('이미 행이 있으면 autoRequest여도 요청하지 않는다', async () => {
    const target = setup(queuedRow);

    target.gateway.getJob.mockResolvedValue(job('queued'));

    await target.controller.open(true);
    await jest.advanceTimersByTimeAsync(0);

    expect(target.gateway.createJob).not.toHaveBeenCalled();
    expect(target.panel()).toEqual({ kind: 'queued' });

    target.controller.dispose();
  });

  it('닫힌 화면에서는 읽기가 끝나도 요청하지 않는다', async () => {
    const target = setup({ kind: 'none' });

    readyForUpload(target);
    target.controller.dispose();

    await target.controller.open(true);
    await jest.advanceTimersByTimeAsync(0);

    expect(target.gateway.createJob).not.toHaveBeenCalled();
  });

  it('데스크탑이 꺼져 있으면 깨우기 팝업과 함께 연결 실패 상자로 둔다', async () => {
    const target = setup({ kind: 'none' });

    readyForUpload(target);
    (target.deps.checkDesktopLive as jest.Mock).mockResolvedValueOnce(false);

    await target.controller.open(true);
    await jest.advanceTimersByTimeAsync(0);

    expect(target.dialogs.map((dialog) => dialog.title)).toEqual([
      UI_STRINGS.transcription.desktopOfflineTitle,
    ]);
    expect(target.dialogs[0]!.actions![0]!.label).toBe(UI_STRINGS.common.cancel);
    expect(target.dialogs[0]!.actions![0]!.onPress).toBeUndefined();

    expect(target.panel()).toEqual({ kind: 'created', reason: 'desktop-offline' });
  });

  it('녹음이 크기 조건을 어기면 변환 불가 팝업을 띄우고 rejected로 둔다', async () => {
    const target = setup({ kind: 'none' }, 'active', {
      ...recording,
      byteSize: 512 * 1024 * 1024 + 1,
    });

    await target.controller.open(true);
    await jest.advanceTimersByTimeAsync(0);

    expect(target.gateway.createJob).not.toHaveBeenCalled();
    expect(target.panel()).toEqual({ kind: 'rejected' });
    expect(target.dialogs.map((dialog) => dialog.title)).toEqual([
      UI_STRINGS.transcription.invalidRecordingTitle,
    ]);
  });
});

describe('저장소 예외', () => {
  it('텍스트로 변환 때 행 읽기가 실패하면 목록을 비우고 none으로 다시 맞춘 뒤 재요청은 createJob 1회다', async () => {
    const target = setup({ kind: 'none' });

    readyForUpload(target);
    target.gateway.getJob.mockResolvedValue(NETWORK_ERROR);

    await target.controller.load();

    (target.fake.repository.get as jest.Mock).mockRejectedValueOnce(new Error('읽기 실패'));
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.deps.uploadingMeetingIds.has(MEETING_ID)).toBe(false);
    expect(target.panel()).toEqual({ kind: 'none', notice: null });
    expect(target.disabled()).toBe(false);

    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.gateway.createJob).toHaveBeenCalledTimes(1);

    target.controller.dispose();
  });

  it('진입 조회에서 행 읽기가 실패하면 unreadable로 두고 recheck 뒤 행 기준으로 돌아온다', async () => {
    const target = setup(queuedRow);

    (target.fake.repository.get as jest.Mock).mockRejectedValueOnce(new Error('읽기 실패'));
    target.gateway.getJob.mockResolvedValue(job('queued'));

    await target.controller.open(false);

    expect(target.panel()).toEqual({ kind: 'unreadable', status: null });
    expect(target.disabled()).toBe(false);

    target.controller.recheck();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.panel()).toEqual({ kind: 'queued' });

    target.controller.dispose();
  });

  it('polling 중 상태 쓰기가 실패하면 행을 다시 읽어 그리고 queued면 이어서 묻는다', async () => {
    const target = setup(queuedRow);

    target.gateway.getJob
      .mockResolvedValueOnce(job('queued'))
      .mockResolvedValueOnce(job('processing'))
      .mockResolvedValue(job('processing'));

    await target.controller.load();

    (target.fake.repository.updateStatus as jest.Mock).mockRejectedValueOnce(
      new Error('쓰기 실패'),
    );

    const getCallsBefore = (target.fake.repository.get as jest.Mock).mock.calls.length;

    await jest.advanceTimersByTimeAsync(5_000);

    expect(target.panel()).toEqual({ kind: 'queued' });
    expect((target.fake.repository.get as jest.Mock).mock.calls.length).toBe(getCallsBefore + 1);

    await jest.advanceTimersByTimeAsync(5_000);

    expect(target.gateway.getJob).toHaveBeenCalledTimes(3);

    target.controller.dispose();
  });

  it('손상 completed 행 다시 확인에서 저장이 실패하면 행을 다시 읽어 그린다', async () => {
    const target = setup({ kind: 'corrupt', status: 'completed', jobId: JOB_ID });

    await target.controller.load();

    expect(target.panel()).toEqual({ kind: 'unreadable', status: 'completed' });

    target.gateway.getTranscript.mockResolvedValueOnce({ kind: 'ok', data: content });
    (target.fake.repository.saveCompleted as jest.Mock).mockImplementationOnce(async () => {
      target.fake.set({
        kind: 'row',
        transcription: { status: 'completed', jobId: JOB_ID, content },
      });
      throw new Error('저장 실패');
    });

    const getCallsBefore = (target.fake.repository.get as jest.Mock).mock.calls.length;

    target.controller.recheck();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.panel()).toEqual({ kind: 'completed', content });
    expect(target.disabled()).toBe(false);
    expect((target.fake.repository.get as jest.Mock).mock.calls.length).toBe(getCallsBefore + 1);
  });

  it('다시 확인 저장 실패 뒤 다시 맞추기가 끝날 때까지 버튼을 막는다', async () => {
    const target = setup({ kind: 'corrupt', status: 'completed', jobId: JOB_ID });

    await target.controller.load();

    target.gateway.getTranscript.mockResolvedValueOnce({ kind: 'ok', data: content });
    (target.fake.repository.saveCompleted as jest.Mock).mockRejectedValueOnce(
      new Error('저장 실패'),
    );

    const pending = holdNext<unknown>(target.fake.repository.get as jest.Mock);

    target.controller.recheck();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.disabled()).toBe(true);

    pending().resolve({
      kind: 'row',
      transcription: { status: 'completed', jobId: JOB_ID, content },
    });
    await jest.advanceTimersByTimeAsync(0);

    expect(target.disabled()).toBe(false);
  });
});

describe('깨우기 팝업', () => {
  it('깨우기 팝업이 뜨는 순간 panel이 이미 desktop-offline이다', async () => {
    const target = setup({ kind: 'none' });

    readyForUpload(target);
    (target.deps.checkDesktopLive as jest.Mock).mockResolvedValue(false);

    await target.controller.load();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.dialogs).toHaveLength(1);
    expect(target.panel()).toEqual({ kind: 'created', reason: 'desktop-offline' });
  });

  it('깨우기 팝업을 무시해도 reupload는 grant부터 다시 진행한다', async () => {
    const target = setup({ kind: 'none' });

    readyForUpload(target);
    (target.deps.checkDesktopLive as jest.Mock).mockResolvedValueOnce(false);

    await target.controller.load();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.panel()).toEqual({ kind: 'created', reason: 'desktop-offline' });
    expect(target.gateway.issueUploadGrant).toHaveBeenCalledTimes(1);

    (target.deps.checkDesktopLive as jest.Mock).mockResolvedValueOnce(true);
    target.gateway.getJob.mockResolvedValue(NETWORK_ERROR);
    target.controller.reupload();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.gateway.issueUploadGrant).toHaveBeenCalledTimes(2);
    expect(target.gateway.createJob).toHaveBeenCalledTimes(1);
    expect(
      target.dialogs.some(
        (dialog) => dialog.title === UI_STRINGS.transcription.alreadyRequestedTitle,
      ),
    ).toBe(false);

    target.controller.dispose();
  });

  it('깨우기 팝업 [다시 확인]은 0단계를 거쳐 새 grant를 받는다', async () => {
    const target = setup({ kind: 'none' });

    readyForUpload(target);
    (target.deps.checkDesktopLive as jest.Mock).mockResolvedValueOnce(false);
    target.gateway.getJob.mockResolvedValue(NETWORK_ERROR);

    await target.controller.load();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);

    (target.deps.checkDesktopLive as jest.Mock).mockResolvedValueOnce(true);
    target.dialogs[0]!.actions?.[1]!.onPress?.();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.gateway.issueUploadGrant).toHaveBeenCalledTimes(2);
    expect(target.gateway.createJob).toHaveBeenCalledTimes(1);

    target.controller.dispose();
  });

  it('데스크탑 live 확인 중 background로 가면 팝업 없이 panel만 바뀐다', async () => {
    const target = setup({ kind: 'none' });

    readyForUpload(target);

    let resolveLive!: (value: boolean) => void;

    (target.deps.checkDesktopLive as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveLive = resolve;
        }),
    );

    await target.controller.load();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);

    target.controller.changeAppState('background');
    resolveLive(false);
    await jest.advanceTimersByTimeAsync(0);

    expect(target.dialogs).toHaveLength(0);
    expect(target.panel()).toEqual({ kind: 'created', reason: 'desktop-offline' });
  });

  it('다시 확인에서도 꺼져 있으면 팝업이 다시 뜬다', async () => {
    const target = setup({ kind: 'none' });

    readyForUpload(target);
    (target.deps.checkDesktopLive as jest.Mock).mockResolvedValue(false);

    await target.controller.load();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.dialogs).toHaveLength(1);

    target.dialogs[0]!.actions?.[1]!.onPress?.();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.dialogs).toHaveLength(2);
  });

  it('깨우기 팝업이 열려 있는 동안 업로드 진행 목록은 비어 있다', async () => {
    const target = setup({ kind: 'none' });

    readyForUpload(target);
    (target.deps.checkDesktopLive as jest.Mock).mockResolvedValueOnce(false);

    await target.controller.load();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.dialogs).toHaveLength(1);
    expect(target.deps.uploadingMeetingIds.has(MEETING_ID)).toBe(false);
  });

  it('깨우기 팝업이 열린 뒤 다른 화면이 업로드를 시작하면 다시 확인은 이미 팝업만 띄운다', async () => {
    const target = setup({ kind: 'none' });

    readyForUpload(target);
    (target.deps.checkDesktopLive as jest.Mock).mockResolvedValueOnce(false);

    await target.controller.load();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);

    target.deps.uploadingMeetingIds.add(MEETING_ID);

    const grantCallsBefore = target.gateway.issueUploadGrant.mock.calls.length;

    target.dialogs[0]!.actions![1]!.onPress!();

    expect(target.dialogs).toHaveLength(2);
    expect(target.dialogs[1]!.title).toBe(UI_STRINGS.transcription.alreadyRequestedTitle);
    expect(target.gateway.issueUploadGrant.mock.calls.length).toBe(grantCallsBefore);

    target.controller.dispose();
  });

  it('깨우기 팝업을 띄운 뒤 dispose하면 다시 확인을 눌러도 grant를 더 받지 않는다', async () => {
    const target = setup({ kind: 'none' });

    readyForUpload(target);
    (target.deps.checkDesktopLive as jest.Mock).mockResolvedValueOnce(false);

    await target.controller.load();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.gateway.issueUploadGrant).toHaveBeenCalledTimes(1);

    target.controller.dispose();
    target.dialogs[0]!.actions![1]!.onPress!();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.gateway.issueUploadGrant).toHaveBeenCalledTimes(1);
  });

  it('live 확인 중 dispose하면 켜져 있어도 업로드하지 않는다', async () => {
    const target = setup({ kind: 'none' });

    readyForUpload(target);

    let resolveLive!: (value: boolean) => void;

    (target.deps.checkDesktopLive as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveLive = resolve;
        }),
    );

    await target.controller.load();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);
    target.controller.dispose();
    resolveLive(true);
    await jest.advanceTimersByTimeAsync(0);

    expect(target.deps.uploadRecording).not.toHaveBeenCalled();
    expect(target.dialogs).toHaveLength(0);
  });

  it('live 확인 중 background 후 active면 켜져 있으면 업로드를 진행한다', async () => {
    const target = setup({ kind: 'none' });

    readyForUpload(target);

    let resolveLive!: (value: boolean) => void;

    (target.deps.checkDesktopLive as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveLive = resolve;
        }),
    );
    target.gateway.getJob.mockResolvedValue(NETWORK_ERROR);

    await target.controller.load();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);
    target.controller.changeAppState('background');
    target.controller.changeAppState('active');
    resolveLive(true);
    await jest.advanceTimersByTimeAsync(0);

    expect(target.deps.uploadRecording).toHaveBeenCalledTimes(1);

    target.controller.dispose();
  });

  it('live 확인 중 background로 가면 업로드 없이 중단 상자로 둔다', async () => {
    const target = setup({ kind: 'none' });

    readyForUpload(target);

    let resolveLive!: (value: boolean) => void;

    (target.deps.checkDesktopLive as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveLive = resolve;
        }),
    );

    await target.controller.load();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);
    target.controller.changeAppState('background');
    resolveLive(true);
    await jest.advanceTimersByTimeAsync(0);

    expect(target.deps.uploadRecording).not.toHaveBeenCalled();
    expect(target.dialogs).toHaveLength(0);
    expect(target.panel()).toEqual({ kind: 'created', reason: 'interrupted' });

    target.controller.dispose();
  });

  it('깨우기 팝업이 열린 채 background·active를 거쳐도 다시 확인은 정상 진행한다', async () => {
    const target = setup({ kind: 'none' });

    readyForUpload(target);
    (target.deps.checkDesktopLive as jest.Mock).mockResolvedValueOnce(false);
    target.gateway.getJob.mockResolvedValue(NETWORK_ERROR);

    await target.controller.load();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);

    target.controller.changeAppState('background');
    target.controller.changeAppState('active');

    (target.deps.checkDesktopLive as jest.Mock).mockResolvedValueOnce(true);
    target.dialogs[0]!.actions![1]!.onPress!();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.deps.uploadRecording).toHaveBeenCalledTimes(1);

    target.controller.dispose();
  });

  it('깨우기 팝업이 열린 사이 행이 바뀌면 다시 확인은 grant 없이 그 행으로 맞춘다', async () => {
    const target = setup({ kind: 'none' });

    readyForUpload(target);
    (target.deps.checkDesktopLive as jest.Mock).mockResolvedValueOnce(false);
    target.gateway.getJob.mockResolvedValue(NETWORK_ERROR);

    await target.controller.load();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);

    target.fake.set({ kind: 'row', transcription: { status: 'queued', jobId: NEW_JOB_ID } });

    const grantCallsBefore = target.gateway.issueUploadGrant.mock.calls.length;

    target.dialogs[0]!.actions![1]!.onPress!();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.gateway.issueUploadGrant.mock.calls.length).toBe(grantCallsBefore);
    expect(target.panel()).toEqual({ kind: 'queued' });

    target.controller.dispose();
  });

  it('appState가 inactive로 시작해도 데스크탑 확인은 막히지 않는다', async () => {
    const target = setup({ kind: 'none' }, 'inactive');

    readyForUpload(target);
    (target.deps.checkDesktopLive as jest.Mock).mockResolvedValueOnce(false);

    await target.controller.load();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.dialogs).toHaveLength(1);

    (target.deps.checkDesktopLive as jest.Mock).mockResolvedValueOnce(true);
    target.gateway.getJob.mockResolvedValue(NETWORK_ERROR);
    target.dialogs[0]!.actions![1]!.onPress!();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.deps.uploadRecording).toHaveBeenCalledTimes(1);

    target.controller.dispose();
  });
});

describe('업로드 결과별 추가 매핑', () => {
  it('grant 404면 행을 지우고 조용히 none으로 돌아간다', async () => {
    const target = setup({ kind: 'none' });

    readyForUpload(target);
    target.gateway.issueUploadGrant.mockResolvedValueOnce(httpError(404, 'job_not_found'));

    await target.controller.load();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.fake.current()).toEqual({ kind: 'none' });
    expect(target.panel()).toEqual({ kind: 'none', notice: null });
    expect(target.dialogs).toHaveLength(0);
  });

  it('grant 409 job_not_uploadable은 업로드 없이 성공 처리하고 바로 getJob을 부른다', async () => {
    const target = setup({ kind: 'none' });

    readyForUpload(target);
    target.gateway.issueUploadGrant.mockResolvedValueOnce(httpError(409, 'job_not_uploadable'));
    target.gateway.getJob.mockResolvedValue(NETWORK_ERROR);

    await target.controller.load();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.deps.uploadRecording).not.toHaveBeenCalled();
    expect(target.gateway.getJob).toHaveBeenCalledTimes(1);

    target.controller.dispose();
  });

  it('업로드 진행 중 dispose하면 전송을 끊고 팝업을 띄우지 않는다', async () => {
    const target = setup({ kind: 'none' });

    readyForUpload(target);

    let aborted = false;

    (target.deps.uploadRecording as jest.Mock).mockImplementationOnce(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => {
            aborted = true;
            resolve({ kind: 'aborted' });
          });
        }),
    );

    await target.controller.load();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);
    target.controller.dispose();
    await jest.advanceTimersByTimeAsync(0);

    expect(aborted).toBe(true);
    expect(target.dialogs).toHaveLength(0);
  });

  it('createJob 응답 전에 dispose하면 저장도 팝업도 없다', async () => {
    const target = setup({ kind: 'none' });

    let resolveCreate!: (value: unknown) => void;

    target.gateway.createJob.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );

    await target.controller.load();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);
    target.controller.dispose();

    resolveCreate({
      kind: 'ok',
      data: { id: NEW_JOB_ID, meetingId: MEETING_ID, status: 'created' },
    });
    await jest.advanceTimersByTimeAsync(0);

    expect(target.fake.repository.upsertCreated).not.toHaveBeenCalled();
    expect(target.dialogs).toHaveLength(0);
  });

  it('조건을 어긴 녹음은 request에서도 sending을 거치지 않고 rejected로 막힌다', async () => {
    const target = setup({ kind: 'none' }, 'active', {
      ...recording,
      byteSize: 512 * 1024 * 1024 + 1,
    });

    await target.controller.load();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);

    const sendingSeen = target.views.some((view) => view.panel.kind === 'sending');

    expect(sendingSeen).toBe(false);
    expect(target.panel()).toEqual({ kind: 'rejected' });
    expect(target.dialogs.map((dialog) => dialog.title)).toEqual([
      UI_STRINGS.transcription.invalidRecordingTitle,
    ]);
  });

  it('녹음 거부 응답에서 삭제가 0행이면 팝업 없이 재조회한 행으로 맞춘다', async () => {
    const target = setup({ kind: 'none' });

    readyForUpload(target);
    (target.deps.uploadRecording as jest.Mock).mockResolvedValueOnce({
      kind: 'recording-rejected',
    });
    (target.fake.repository.delete as jest.Mock).mockResolvedValueOnce(false);
    target.gateway.getJob.mockResolvedValue(NETWORK_ERROR);

    await target.controller.load();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.dialogs).toHaveLength(0);
    expect(target.panel()).toEqual({ kind: 'created', reason: 'interrupted' });
  });
});

describe('0단계·연타·다른 화면', () => {
  it('request를 연달아 두 번 불러도 createJob은 한 번만 나간다', async () => {
    const target = setup({ kind: 'none' });

    readyForUpload(target);
    target.gateway.getJob.mockResolvedValue(NETWORK_ERROR);

    await target.controller.load();
    target.controller.request();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.gateway.createJob).toHaveBeenCalledTimes(1);

    target.controller.dispose();
  });

  it('업로드 중인 회의를 다른 컨트롤러에서 reupload·retry하면 이미 팝업만 뜨고 요청은 늘지 않는다', async () => {
    const target = setup({ kind: 'none' });

    readyForUpload(target);
    target.gateway.getJob.mockResolvedValue(NETWORK_ERROR);

    const pendingUpload = new Promise<never>(() => {});

    (target.deps.uploadRecording as jest.Mock).mockImplementationOnce(() => pendingUpload);

    await target.controller.load();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.deps.uploadingMeetingIds.has(MEETING_ID)).toBe(true);

    const grantCallsBefore = target.gateway.issueUploadGrant.mock.calls.length;
    const createJobCallsBefore = target.gateway.createJob.mock.calls.length;
    const dialogs2: DialogOptions[] = [];
    const other = createTranscriptionController(target.deps, recording, 'active', {
      onChange: () => {},
      openDialog: (options) => dialogs2.push(options),
    });

    await other.load();
    other.reupload();
    other.retry();

    expect(dialogs2).toHaveLength(2);
    expect(dialogs2.map((dialog) => dialog.title)).toEqual([
      UI_STRINGS.transcription.alreadyRequestedTitle,
      UI_STRINGS.transcription.alreadyRequestedTitle,
    ]);
    expect(target.gateway.issueUploadGrant.mock.calls.length).toBe(grantCallsBefore);
    expect(target.gateway.createJob.mock.calls.length).toBe(createJobCallsBefore);

    target.controller.dispose();
    other.dispose();
  });

  it('createJob 응답을 기다리는 동안 dispose해도 다른 컨트롤러는 이미 팝업만 본다', async () => {
    const target = setup({ kind: 'none' });

    let resolveCreate!: (value: unknown) => void;

    target.gateway.createJob.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );

    await target.controller.load();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);
    target.controller.dispose();

    const dialogs2: DialogOptions[] = [];
    const other = createTranscriptionController(target.deps, recording, 'active', {
      onChange: () => {},
      openDialog: (options) => dialogs2.push(options),
    });

    await other.load();
    other.request();

    expect(dialogs2).toHaveLength(1);
    expect(dialogs2[0]!.title).toBe(UI_STRINGS.transcription.alreadyRequestedTitle);
    expect(target.gateway.createJob).toHaveBeenCalledTimes(1);

    resolveCreate({
      kind: 'ok',
      data: { id: NEW_JOB_ID, meetingId: MEETING_ID, status: 'created' },
    });
    await jest.advanceTimersByTimeAsync(0);

    other.request();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.gateway.createJob).toHaveBeenCalledTimes(2);

    other.dispose();
  });

  it('다시 시도 시점에 행이 다른 job이면 요청을 보내지 않고 그 행으로 맞춘다', async () => {
    const target = setup({
      kind: 'row',
      transcription: { status: 'failed', jobId: JOB_ID, errorCode: null },
    });

    await target.controller.load();

    target.fake.set(queuedRow);
    target.gateway.getJob.mockResolvedValue(job('queued'));
    target.controller.retry();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.gateway.createJob).not.toHaveBeenCalled();
    expect(target.panel()).toEqual({ kind: 'queued' });

    target.controller.dispose();
  });

  it('다시 업로드 시점에 행이 다른 job이면 grant 없이 그 행으로 맞춘다', async () => {
    const target = setup({
      kind: 'row',
      transcription: { status: 'created', jobId: JOB_ID },
    });

    target.gateway.getJob.mockResolvedValue(NETWORK_ERROR);

    await target.controller.load();

    target.fake.set({ kind: 'row', transcription: { status: 'queued', jobId: NEW_JOB_ID } });

    const grantCallsBefore = target.gateway.issueUploadGrant.mock.calls.length;

    target.controller.reupload();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.gateway.issueUploadGrant.mock.calls.length).toBe(grantCallsBefore);
    expect(target.panel()).toEqual({ kind: 'queued' });

    target.controller.dispose();
  });

  it('텍스트로 변환 시점에 행이 이미 queued면 요청 없이 행을 따라가고 polling도 시작한다', async () => {
    const target = setup({ kind: 'none' });

    await target.controller.load();
    target.fake.set(queuedRow);
    target.gateway.getJob.mockResolvedValue(job('queued'));
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.gateway.createJob).not.toHaveBeenCalled();
    expect(target.panel()).toEqual({ kind: 'queued' });
    expect(target.deps.uploadingMeetingIds.size).toBe(0);

    await jest.advanceTimersByTimeAsync(4_999);

    expect(target.gateway.getJob).toHaveBeenCalledTimes(0);

    await jest.advanceTimersByTimeAsync(1);

    expect(target.gateway.getJob).toHaveBeenCalledTimes(1);

    target.controller.dispose();
  });

  it('PUT 성공 뒤 첫 GET 응답 전에도 업로드 진행 목록은 비어 있다', async () => {
    const target = setup({ kind: 'none' });

    readyForUpload(target);

    const pending = holdNext<unknown>(target.gateway.getJob);

    await target.controller.load();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.deps.uploadingMeetingIds.has(MEETING_ID)).toBe(false);

    pending().resolve(job('queued'));
    await jest.advanceTimersByTimeAsync(0);

    target.controller.dispose();
  });

  it.each([
    [
      '데스크탑 꺼짐',
      (target: ReturnType<typeof setup>) => {
        (target.deps.checkDesktopLive as jest.Mock).mockResolvedValueOnce(false);
      },
    ],
    [
      '업로드 실패',
      (target: ReturnType<typeof setup>) => {
        (target.deps.uploadRecording as jest.Mock).mockResolvedValueOnce({ kind: 'failed' });
      },
    ],
  ])('%s는 upsertCreated 이후 행을 더 쓰지 않는다', async (_name, applyFailure) => {
    const target = setup({ kind: 'none' });

    readyForUpload(target);
    applyFailure(target);

    await target.controller.load();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.fake.repository.updateStatus).not.toHaveBeenCalled();
    expect(target.fake.repository.delete).not.toHaveBeenCalled();
    expect(target.fake.repository.saveCompleted).not.toHaveBeenCalled();
    expect(target.fake.repository.upsertCreated).toHaveBeenCalledTimes(1);
  });

  it('background로 인한 중단도 upsertCreated 이후 행을 더 쓰지 않는다', async () => {
    const target = setup({ kind: 'none' });

    readyForUpload(target);
    (target.deps.uploadRecording as jest.Mock).mockImplementationOnce(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => resolve({ kind: 'aborted' }));
        }),
    );

    await target.controller.load();
    target.controller.request();
    await jest.advanceTimersByTimeAsync(0);
    target.controller.changeAppState('background');
    await jest.advanceTimersByTimeAsync(0);

    expect(target.fake.repository.updateStatus).not.toHaveBeenCalled();
    expect(target.fake.repository.delete).not.toHaveBeenCalled();
    expect(target.fake.repository.saveCompleted).not.toHaveBeenCalled();
    expect(target.fake.repository.upsertCreated).toHaveBeenCalledTimes(1);
  });
});

describe('polling·진입 조회 추가 케이스', () => {
  it('진입 조회 중에는 disabled가 true이고 응답 뒤 false가 된다', async () => {
    const target = setup(queuedRow);
    const pending = holdNext<unknown>(target.gateway.getJob);
    const loading = target.controller.load();

    await jest.advanceTimersByTimeAsync(0);

    expect(target.disabled()).toBe(true);

    pending().resolve(job('queued'));
    await loading;

    expect(target.disabled()).toBe(false);

    target.controller.dispose();
  });

  it('다시 확인을 연달아 눌러도 행 읽기는 한 번만 나간다', async () => {
    const target = setup(queuedRow);

    target.gateway.getJob.mockResolvedValue(job('queued'));

    await target.controller.load();

    const getCallsBefore = (target.fake.repository.get as jest.Mock).mock.calls.length;

    target.controller.recheck();

    expect(target.disabled()).toBe(true);

    target.controller.recheck();
    await jest.advanceTimersByTimeAsync(0);

    expect((target.fake.repository.get as jest.Mock).mock.calls.length).toBe(getCallsBefore + 1);

    target.controller.dispose();
  });

  it('완료 응답을 기다리는 동안 행이 다른 job으로 바뀌면 옛 전사 응답은 버린다', async () => {
    const target = setup(queuedRow);

    target.gateway.getJob
      .mockResolvedValueOnce(job('queued'))
      .mockResolvedValueOnce(job('completed'));

    const pendingTranscript = holdNext<unknown>(target.gateway.getTranscript);

    await target.controller.load();
    await jest.advanceTimersByTimeAsync(5_000);

    const transcript = pendingTranscript();

    target.fake.set({ kind: 'row', transcription: { status: 'queued', jobId: NEW_JOB_ID } });
    target.gateway.getJob.mockResolvedValue(NETWORK_ERROR);
    target.controller.recheck();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.panel()).toEqual({ kind: 'queued' });

    transcript.resolve({ kind: 'ok', data: content });
    await jest.advanceTimersByTimeAsync(0);

    expect(target.fake.repository.saveCompleted).not.toHaveBeenCalled();
    expect(target.panel()).toEqual({ kind: 'queued' });

    target.controller.dispose();
  });

  it.each([
    ['completed', { kind: 'row', transcription: { status: 'completed', jobId: JOB_ID, content } }],
    [
      'failed',
      { kind: 'row', transcription: { status: 'failed', jobId: JOB_ID, errorCode: null } },
    ],
  ])('로컬 행이 %s면 진입 조회에서 getJob을 부르지 않는다', async (_name, row) => {
    const target = setup(row as StoredTranscription);

    await target.controller.load();

    expect(target.gateway.getJob).not.toHaveBeenCalled();
  });

  it('dispose 뒤 도착한 failed는 팝업을 띄우지 않는다', async () => {
    const target = setup(queuedRow);
    const pending = holdNext<unknown>(target.gateway.getJob);
    const loading = target.controller.load();

    await jest.advanceTimersByTimeAsync(0);
    target.controller.dispose();
    pending().resolve(job('failed', 'stt_failed'));
    await loading;

    expect(target.dialogs).toHaveLength(0);
  });

  it('status가 processing인 unreadable은 다시 확인에서 행 읽기와 getJob을 모두 부른다', async () => {
    const target = setup({ kind: 'row', transcription: { status: 'processing', jobId: JOB_ID } });

    target.gateway.getJob
      .mockResolvedValueOnce(httpError(400))
      .mockResolvedValue(job('processing'));

    await target.controller.load();

    expect(target.panel()).toEqual({ kind: 'unreadable', status: 'processing' });

    target.controller.recheck();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.fake.repository.get).toHaveBeenCalledTimes(2);
    expect(target.gateway.getJob).toHaveBeenCalledTimes(2);
    expect(target.panel()).toEqual({ kind: 'processing' });

    target.controller.dispose();
  });

  it('background 중 도착한 응답은 다음 타이머를 잡지 않고, active 복귀 때 즉시 한 번 묻는다', async () => {
    const target = setup(queuedRow);
    const pending = holdNext<unknown>(target.gateway.getJob);
    const loading = target.controller.load();

    await jest.advanceTimersByTimeAsync(0);

    target.controller.changeAppState('background');
    pending().resolve(job('queued'));
    await loading;
    await jest.advanceTimersByTimeAsync(5_000);

    expect(target.gateway.getJob).toHaveBeenCalledTimes(1);

    target.controller.changeAppState('active');
    await jest.advanceTimersByTimeAsync(0);

    expect(target.gateway.getJob).toHaveBeenCalledTimes(2);

    target.controller.dispose();
  });

  it('active 복귀 시점에 이미 요청이 진행 중이면 추가로 묻지 않는다', async () => {
    const target = setup(queuedRow);

    target.gateway.getJob.mockResolvedValueOnce(job('queued')).mockResolvedValue(job('queued'));

    await target.controller.load();

    const pending = holdNext<unknown>(target.gateway.getJob);

    await jest.advanceTimersByTimeAsync(5_000);

    const inFlight = pending();

    target.controller.changeAppState('background');
    target.controller.changeAppState('active');
    await jest.advanceTimersByTimeAsync(0);

    expect(target.gateway.getJob).toHaveBeenCalledTimes(2);

    inFlight.resolve(job('queued'));
    await jest.advanceTimersByTimeAsync(5_000);

    target.controller.dispose();
  });

  it('상태 쓰기가 0행이고 다시 읽은 행이 다른 job이면 그 job으로 polling을 재개한다', async () => {
    const target = setup(queuedRow);

    target.gateway.getJob
      .mockResolvedValueOnce(job('queued'))
      .mockResolvedValueOnce(job('processing'));

    await target.controller.load();

    target.fake.failNextWrite();
    target.fake.set({ kind: 'row', transcription: { status: 'queued', jobId: NEW_JOB_ID } });

    await jest.advanceTimersByTimeAsync(5_000);

    expect(target.panel()).toEqual({ kind: 'queued' });

    target.gateway.getJob.mockResolvedValue(job('queued'));

    await jest.advanceTimersByTimeAsync(5_000);

    expect(target.gateway.getJob).toHaveBeenLastCalledWith(
      MEETING_ID,
      NEW_JOB_ID,
      expect.any(AbortSignal),
    );

    target.controller.dispose();
  });

  it('dispose 뒤 도착한 polling 응답에서 상태 쓰기가 0행이어도 타이머를 잡지 않는다', async () => {
    const target = setup(queuedRow);

    target.gateway.getJob.mockResolvedValueOnce(job('queued'));

    const pending = holdNext<unknown>(target.gateway.getJob);

    await target.controller.load();
    await jest.advanceTimersByTimeAsync(5_000);

    target.controller.dispose();
    target.fake.failNextWrite();
    pending().resolve(job('processing'));
    await jest.advanceTimersByTimeAsync(10_000);

    expect(target.gateway.getJob).toHaveBeenCalledTimes(2);
  });

  it('완료 전사 저장이 0행이면 행을 다시 읽어 맞춘다', async () => {
    const target = setup(queuedRow);

    target.gateway.getJob.mockResolvedValueOnce(job('completed'));
    target.gateway.getTranscript.mockResolvedValueOnce({ kind: 'ok', data: content });
    (target.fake.repository.saveCompleted as jest.Mock).mockResolvedValueOnce(false);

    await target.controller.load();

    expect(target.fake.repository.get).toHaveBeenCalledTimes(2);
    expect(target.panel()).toEqual({ kind: 'queued' });

    target.controller.dispose();
  });

  it('손상 행 삭제가 0행이고 다시 읽어도 손상이면 한 번만 지우고 unreadable로 둔다', async () => {
    const target = setup({ kind: 'corrupt', status: 'queued', jobId: 'bad' });

    (target.fake.repository.deleteCorrupt as jest.Mock).mockResolvedValueOnce(false);

    await target.controller.load();

    expect(target.fake.repository.deleteCorrupt).toHaveBeenCalledTimes(1);
    expect(target.panel()).toEqual({ kind: 'unreadable', status: 'queued' });
  });

  it('진입 조회 404에서 삭제가 0행이면 행을 다시 읽어 그 행을 보여 준다', async () => {
    const target = setup(queuedRow);

    target.gateway.getJob.mockResolvedValueOnce(httpError(404, 'job_not_found'));
    (target.fake.repository.delete as jest.Mock).mockResolvedValueOnce(false);
    (target.fake.repository.get as jest.Mock)
      .mockResolvedValueOnce(queuedRow)
      .mockResolvedValueOnce({
        kind: 'row',
        transcription: { status: 'processing', jobId: JOB_ID },
      });

    await target.controller.load();

    expect(target.fake.repository.get).toHaveBeenCalledTimes(2);
    expect(target.panel()).toEqual({ kind: 'processing' });

    target.controller.dispose();
  });

  it('polling 중 상태 쓰기가 0행이고 다시 읽은 행이 completed면 polling 없이 끝난다', async () => {
    const target = setup(queuedRow);

    target.gateway.getJob
      .mockResolvedValueOnce(job('queued'))
      .mockResolvedValueOnce(job('processing'));

    await target.controller.load();

    target.fake.failNextWrite();
    target.fake.set({
      kind: 'row',
      transcription: { status: 'completed', jobId: JOB_ID, content },
    });

    await jest.advanceTimersByTimeAsync(5_000);

    expect(target.panel()).toEqual({ kind: 'completed', content });

    const getJobCallsBefore = target.gateway.getJob.mock.calls.length;

    target.controller.changeAppState('background');
    target.controller.changeAppState('active');
    await jest.advanceTimersByTimeAsync(5_000);

    expect(target.gateway.getJob.mock.calls.length).toBe(getJobCallsBefore);

    target.controller.dispose();
  });

  it('background 중 응답의 상태 쓰기가 0행이면 그 자리에서 polling을 재개하되 active가 돼야 다시 묻는다', async () => {
    const target = setup(queuedRow);

    target.gateway.getJob.mockResolvedValueOnce(job('queued'));

    await target.controller.load();

    const pending = holdNext<unknown>(target.gateway.getJob);

    await jest.advanceTimersByTimeAsync(5_000);

    target.controller.changeAppState('background');
    target.fake.failNextWrite();
    target.fake.set(queuedRow);
    pending().resolve(job('processing'));
    await jest.advanceTimersByTimeAsync(0);

    const getJobCallsBefore = target.gateway.getJob.mock.calls.length;

    await jest.advanceTimersByTimeAsync(5_000);

    expect(target.gateway.getJob.mock.calls.length).toBe(getJobCallsBefore);

    target.gateway.getJob.mockResolvedValue(job('queued'));
    target.controller.changeAppState('active');
    await jest.advanceTimersByTimeAsync(0);

    expect(target.gateway.getJob.mock.calls.length).toBe(getJobCallsBefore + 1);

    target.controller.dispose();
  });

  it('다시 업로드 성공 뒤 completed인데 전사를 받지 못하면 processing으로 두고 5초 뒤 다시 묻는다', async () => {
    const target = setup({
      kind: 'row',
      transcription: { status: 'created', jobId: JOB_ID },
    });

    target.gateway.issueUploadGrant.mockResolvedValue({
      kind: 'ok',
      data: { uploadUrl: 'https://desktop.example/v1/uploads/x', grant: 'grant' },
    });
    target.gateway.getJob.mockResolvedValueOnce(NETWORK_ERROR);

    await target.controller.load();

    target.gateway.getJob
      .mockResolvedValueOnce(job('completed'))
      .mockResolvedValue(job('processing'));
    target.gateway.getTranscript.mockResolvedValueOnce(httpError(503));

    target.controller.reupload();
    await jest.advanceTimersByTimeAsync(0);

    expect(target.panel()).toEqual({ kind: 'processing' });

    const getJobCallsBefore = target.gateway.getJob.mock.calls.length;

    await jest.advanceTimersByTimeAsync(5_000);

    expect(target.gateway.getJob.mock.calls.length).toBe(getJobCallsBefore + 1);

    target.controller.dispose();
  });
});

describe('useTranscription 훅 배선', () => {
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <ThemeProvider mode="light">
        <DialogProvider>{children}</DialogProvider>
      </ThemeProvider>
    );
  }

  it('AppState 변화 구독을 등록하고 unmount 때 해제와 진행 중 GET 취소를 한다', async () => {
    const addSpy = jest.spyOn(AppState, 'addEventListener');

    try {
      const fake = createFakeRepository(queuedRow);
      const gateway = {
        createJob: jest.fn(),
        issueUploadGrant: jest.fn(),
        getJob: jest.fn((): Promise<never> => new Promise(() => {})),
        getTranscript: jest.fn(),
      } satisfies Record<keyof TranscriptionGateway, jest.Mock>;
      const deps: TranscriptionDeps = {
        transcriptions: fake.repository,
        gateway,
        checkDesktopLive: jest.fn(async () => true),
        uploadRecording: jest.fn(async () => ({ kind: 'uploaded' }) as const),
        createIdempotencyKey: () => 'idempotency-key',
        uploadingMeetingIds: new Set(),
      };

      const { unmount } = await renderHook(() => useTranscription(deps, recording, false), {
        wrapper: Wrapper,
      });

      await act(async () => {
        await jest.advanceTimersByTimeAsync(0);
      });

      expect(addSpy).toHaveBeenCalledWith('change', expect.any(Function));

      const callIndex = addSpy.mock.calls.findIndex(([type]) => type === 'change');
      const subscription = addSpy.mock.results[callIndex]?.value as { remove: () => void };
      const removeSpy = jest.spyOn(subscription, 'remove');
      const [, , signal] = (gateway.getJob as jest.Mock).mock.calls.at(-1) as [
        string,
        string,
        AbortSignal,
      ];

      await unmount();

      expect(signal.aborted).toBe(true);
      expect(removeSpy).toHaveBeenCalled();
    } finally {
      addSpy.mockRestore();
    }
  });
});
