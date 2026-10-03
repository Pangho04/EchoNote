import { MAX_UPLOAD_BYTES } from '@echonote/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { Recording } from '@/entities/recording';
import type { TranscriptionRepository } from '@/entities/transcript';

import type { UploadRecording } from '../api/upload-recording';
import {
  requestTranscription,
  type RequestTranscriptionDeps,
  toFailureMessage,
  type UploadProgressPort,
  uploadToDesktop,
} from './request-transcription';

const MEETING_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '22222222-2222-4222-8222-222222222222';

const recording: Recording = {
  meetingId: MEETING_ID,
  uri: 'file:///recording.m4a',
  mimeType: 'audio/mp4',
  sha256: 'a'.repeat(64),
  durationMs: 60_000,
  byteSize: 1_000,
};

const grant = {
  kind: 'ok',
  data: { uploadUrl: 'https://desktop.test/u', grant: 'g', expiresAt: '2026-10-02T00:00:00.000Z' },
} as const;

function setup() {
  const transcriptions = {
    get: vi.fn(),
    upsertCreated: vi.fn(async () => true),
    updateStatus: vi.fn(),
    saveCompleted: vi.fn(),
    delete: vi.fn(async () => true),
    deleteCorrupt: vi.fn(),
  } satisfies Record<keyof TranscriptionRepository, unknown>;
  const gateway = {
    createJob: vi.fn(async () => ({ kind: 'ok', data: { id: JOB_ID } }) as never),
    issueUploadGrant: vi.fn(async () => grant as never),
    getJob: vi.fn(),
    getTranscript: vi.fn(),
  };
  const deps = {
    transcriptions,
    gateway,
    checkDesktopLive: vi.fn(async () => true),
    uploadRecording: vi.fn<UploadRecording>(async () => ({ kind: 'uploaded' })),
    createIdempotencyKey: () => 'key-1',
  };
  const state = { open: true, background: false };
  const port: UploadProgressPort = {
    isScreenOpen: () => state.open,
    isInBackground: () => state.background,
    onJobCreated: vi.fn(),
    onUploadStarted: vi.fn(),
    onProgress: vi.fn(),
  };

  return { deps: deps as unknown as RequestTranscriptionDeps, raw: deps, port, state };
}

const input = { recording, jobId: JOB_ID };

describe('uploadToDesktop', () => {
  it('grant·live·업로드가 모두 되면 uploaded다', async () => {
    const { deps, raw, port } = setup();

    expect(await uploadToDesktop(deps, port, input)).toEqual({ kind: 'uploaded' });
    expect(raw.checkDesktopLive).toHaveBeenCalledWith('https://desktop.test/u');
    expect(port.onUploadStarted).toHaveBeenCalledTimes(1);
    expect(raw.uploadRecording.mock.calls[0]![0]).toMatchObject({
      fileUri: recording.uri,
      uploadUrl: 'https://desktop.test/u',
      grant: 'g',
    });
  });

  it('grant 409 job_not_uploadable은 이미 올라간 것으로 본다', async () => {
    const { deps, raw, port } = setup();

    raw.gateway.issueUploadGrant.mockResolvedValueOnce({
      kind: 'http-error',
      status: 409,
      error: 'job_not_uploadable',
    } as never);

    expect(await uploadToDesktop(deps, port, input)).toEqual({ kind: 'uploaded' });
    expect(raw.uploadRecording).not.toHaveBeenCalled();
  });

  it('grant 404면 행을 지우고, 지우기가 0행이면 row-changed다', async () => {
    const { deps, raw, port } = setup();
    const notFound = { kind: 'http-error', status: 404, error: 'job_not_found' } as never;

    raw.gateway.issueUploadGrant.mockResolvedValue(notFound);

    expect(await uploadToDesktop(deps, port, input)).toEqual({ kind: 'job-missing' });
    expect(raw.transcriptions.delete).toHaveBeenCalledWith(MEETING_ID, JOB_ID);

    raw.transcriptions.delete.mockResolvedValueOnce(false);

    expect(await uploadToDesktop(deps, port, input)).toEqual({ kind: 'row-changed' });
  });

  it.each([
    [{ kind: 'http-error', status: 500, error: null }],
    [{ kind: 'network-error' }],
    [{ kind: 'invalid-response' }],
    [{ kind: 'aborted' }],
  ])('그 외 grant 결과 %o는 grant-failed다', async (result) => {
    const { deps, raw, port } = setup();

    raw.gateway.issueUploadGrant.mockResolvedValueOnce(result as never);

    expect(await uploadToDesktop(deps, port, input)).toEqual({ kind: 'grant-failed' });
  });

  it('grant 뒤 화면이 닫혔으면 stopped다', async () => {
    const { deps, raw, port, state } = setup();

    raw.gateway.issueUploadGrant.mockImplementationOnce(async () => {
      state.open = false;

      return grant as never;
    });

    expect(await uploadToDesktop(deps, port, input)).toEqual({ kind: 'stopped' });
    expect(raw.checkDesktopLive).not.toHaveBeenCalled();
  });

  it('live 확인 뒤 background면 stopped, 꺼져 있으면 background여도 desktop-offline이다', async () => {
    const { deps, raw, port, state } = setup();

    raw.checkDesktopLive.mockImplementationOnce(async () => {
      state.background = true;

      return true;
    });

    expect(await uploadToDesktop(deps, port, input)).toEqual({ kind: 'stopped' });

    raw.checkDesktopLive.mockResolvedValueOnce(false);

    expect(await uploadToDesktop(deps, port, input)).toEqual({
      kind: 'desktop-offline',
      jobId: JOB_ID,
    });
    expect(raw.uploadRecording).not.toHaveBeenCalled();
  });

  it('422면 행을 지우고 recording-rejected, 지우기가 0행이면 row-changed다', async () => {
    const { deps, raw, port } = setup();

    raw.uploadRecording.mockResolvedValue({ kind: 'recording-rejected' });

    expect(await uploadToDesktop(deps, port, input)).toEqual({ kind: 'recording-rejected' });

    raw.transcriptions.delete.mockResolvedValueOnce(false);

    expect(await uploadToDesktop(deps, port, input)).toEqual({ kind: 'row-changed' });
  });

  it('전송 실패는 upload-failed, 취소는 aborted다', async () => {
    const { deps, raw, port } = setup();

    raw.uploadRecording.mockResolvedValueOnce({ kind: 'failed' });

    expect(await uploadToDesktop(deps, port, input)).toEqual({ kind: 'upload-failed' });

    raw.uploadRecording.mockResolvedValueOnce({ kind: 'aborted' });

    expect(await uploadToDesktop(deps, port, input)).toEqual({ kind: 'aborted' });
  });
});

describe('requestTranscription', () => {
  it('job을 만들고 created 행을 쓴 뒤 업로드한다', async () => {
    const { deps, raw, port } = setup();

    expect(await requestTranscription(deps, port, recording)).toEqual({ kind: 'uploaded' });
    expect(raw.gateway.createJob).toHaveBeenCalledWith(recording, 'key-1');
    expect(raw.transcriptions.upsertCreated).toHaveBeenCalledWith(MEETING_ID, JOB_ID);
    expect(port.onJobCreated).toHaveBeenCalledWith(JOB_ID);
  });

  it.each([
    [{ ...recording, byteSize: MAX_UPLOAD_BYTES + 1 }],
    [{ ...recording, mimeType: 'audio/wav' }],
  ])('한도 밖 녹음은 job을 만들지 않는다', async (invalid) => {
    const { deps, raw, port } = setup();

    expect(await requestTranscription(deps, port, invalid)).toEqual({
      kind: 'invalid-recording',
    });
    expect(raw.gateway.createJob).not.toHaveBeenCalled();
  });

  it('job 생성 실패는 create-failed, 그 사이 닫혔으면 stopped다', async () => {
    const { deps, raw, port, state } = setup();

    raw.gateway.createJob.mockResolvedValueOnce({ kind: 'network-error' } as never);

    expect(await requestTranscription(deps, port, recording)).toEqual({ kind: 'create-failed' });

    raw.gateway.createJob.mockImplementationOnce(async () => {
      state.open = false;

      return { kind: 'ok', data: { id: JOB_ID } } as never;
    });

    expect(await requestTranscription(deps, port, recording)).toEqual({ kind: 'stopped' });
    expect(raw.transcriptions.upsertCreated).not.toHaveBeenCalled();
  });

  it('created 행 쓰기가 0행이면 row-changed로 멈춘다', async () => {
    const { deps, raw, port } = setup();

    raw.transcriptions.upsertCreated.mockResolvedValueOnce(false);

    expect(await requestTranscription(deps, port, recording)).toEqual({ kind: 'row-changed' });
    expect(port.onJobCreated).not.toHaveBeenCalled();
    expect(raw.gateway.issueUploadGrant).not.toHaveBeenCalled();
  });
});

describe('toFailureMessage', () => {
  it('이유가 없으면 알 수 없는 오류 문구다', () => {
    expect(toFailureMessage(null)).toBe(toFailureMessage('unexpected'));
    expect(toFailureMessage('stt_failed')).not.toBe(toFailureMessage('unexpected'));
  });
});
