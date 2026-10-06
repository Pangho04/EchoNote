import { describe, expect, it, vi } from 'vitest';

import type { StoredTranscription, TranscriptionRepository } from '@/entities/transcript';

import { syncPendingTranscriptions } from './sync-pending-transcriptions';

const MEETING_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_MEETING_ID = '33333333-3333-4333-8333-333333333333';
const JOB_ID = '22222222-2222-4222-8222-222222222222';
const CONTENT = { durationMs: 1_000, segments: [{ startMs: 0, endMs: 1_000, text: '안녕' }] };

function setup(stored: StoredTranscription = row('queued')) {
  const transcriptions = {
    get: vi.fn(async () => stored),
    upsertCreated: vi.fn(),
    updateStatus: vi.fn(async () => true),
    saveCompleted: vi.fn(async () => true),
    delete: vi.fn(async () => true),
    deleteCorrupt: vi.fn(),
  } satisfies Record<keyof TranscriptionRepository, unknown>;
  const gateway = { getJob: vi.fn(), getTranscript: vi.fn() };

  return { deps: { transcriptions, gateway }, transcriptions, gateway };
}

function row(status: 'queued' | 'processing' | 'created'): StoredTranscription {
  return { kind: 'row', transcription: { status, jobId: JOB_ID } };
}

function job(status: string, errorCode: string | null = null) {
  return { kind: 'ok', data: { id: JOB_ID, meetingId: MEETING_ID, status, errorCode } };
}

const sync = (deps: ReturnType<typeof setup>['deps'], ids = [MEETING_ID]) =>
  syncPendingTranscriptions(deps, ids, new AbortController().signal);

describe('syncPendingTranscriptions', () => {
  it.each<[string, StoredTranscription]>([
    ['행 없음', { kind: 'none' }],
    ['요청 미완료', row('created')],
    [
      '완료',
      { kind: 'row', transcription: { status: 'completed', jobId: JOB_ID, content: CONTENT } },
    ],
    ['실패', { kind: 'row', transcription: { status: 'failed', jobId: JOB_ID, errorCode: null } }],
    ['손상', { kind: 'corrupt', status: 'queued', jobId: JOB_ID }],
  ])('%s 행은 서버에 묻지 않는다', async (_, stored) => {
    const { deps, gateway } = setup(stored);

    expect(await sync(deps)).toBe(false);
    expect(gateway.getJob).not.toHaveBeenCalled();
  });

  it('서버 상태가 행과 같으면 쓰지 않는다', async () => {
    const { deps, gateway, transcriptions } = setup(row('queued'));

    gateway.getJob.mockResolvedValue(job('queued'));

    expect(await sync(deps)).toBe(false);
    expect(transcriptions.updateStatus).not.toHaveBeenCalled();
  });

  it.each([
    ['queued', 'processing', null],
    ['processing', 'created', null],
    ['processing', 'failed', 'stt_failed'],
  ] as const)('%s 행이 서버에서 %s면 그 상태로 쓴다', async (from, to, errorCode) => {
    const { deps, gateway, transcriptions } = setup(row(from));

    gateway.getJob.mockResolvedValue(job(to, errorCode));

    expect(await sync(deps)).toBe(true);
    expect(transcriptions.updateStatus).toHaveBeenCalledWith(MEETING_ID, JOB_ID, to, errorCode);
  });

  it('서버가 completed면 본문을 받아 완료로 저장한다', async () => {
    const { deps, gateway, transcriptions } = setup(row('processing'));

    gateway.getJob.mockResolvedValue(job('completed'));
    gateway.getTranscript.mockResolvedValue({ kind: 'ok', data: CONTENT });

    expect(await sync(deps)).toBe(true);
    expect(transcriptions.saveCompleted).toHaveBeenCalledWith(MEETING_ID, JOB_ID, CONTENT);
  });

  it('completed인데 본문을 받지 못하면 행을 그대로 둔다', async () => {
    const { deps, gateway, transcriptions } = setup(row('processing'));

    gateway.getJob.mockResolvedValue(job('completed'));
    gateway.getTranscript.mockResolvedValue({ kind: 'network-error' });

    expect(await sync(deps)).toBe(false);
    expect(transcriptions.saveCompleted).not.toHaveBeenCalled();
    expect(transcriptions.updateStatus).not.toHaveBeenCalled();
  });

  it('서버에 작업이 없으면(404) 행을 지운다', async () => {
    const { deps, gateway, transcriptions } = setup();

    gateway.getJob.mockResolvedValue({ kind: 'http-error', status: 404, error: null });

    expect(await sync(deps)).toBe(true);
    expect(transcriptions.delete).toHaveBeenCalledWith(MEETING_ID, JOB_ID);
  });

  it.each([
    ['401', { kind: 'http-error', status: 401, error: null }],
    ['500', { kind: 'http-error', status: 500, error: null }],
    ['네트워크 실패', { kind: 'network-error' }],
    ['손상 응답', { kind: 'invalid-response' }],
  ])('%s 응답은 행을 바꾸지 않는다', async (_, response) => {
    const { deps, gateway, transcriptions } = setup();

    gateway.getJob.mockResolvedValue(response);

    expect(await sync(deps)).toBe(false);
    expect(transcriptions.updateStatus).not.toHaveBeenCalled();
    expect(transcriptions.delete).not.toHaveBeenCalled();
  });

  it('다른 화면이 행을 먼저 바꿔 쓰기가 0행이어도 목록을 다시 읽게 true다', async () => {
    const { deps, gateway, transcriptions } = setup();

    gateway.getJob.mockResolvedValue(job('processing'));
    transcriptions.updateStatus.mockResolvedValue(false);

    expect(await sync(deps)).toBe(true);
  });

  it('한 회의가 예외로 끝나도 다음 회의를 묻는다', async () => {
    const { deps, gateway, transcriptions } = setup();

    transcriptions.get.mockRejectedValueOnce(new Error('db')).mockResolvedValueOnce(row('queued'));
    gateway.getJob.mockResolvedValue(job('processing'));

    expect(await sync(deps, [MEETING_ID, OTHER_MEETING_ID])).toBe(true);
    expect(gateway.getJob).toHaveBeenCalledWith(OTHER_MEETING_ID, JOB_ID, expect.any(AbortSignal));
  });

  it('끊긴 뒤에는 남은 회의를 묻지 않는다', async () => {
    const { deps, gateway } = setup();
    const controller = new AbortController();

    gateway.getJob.mockImplementation(async () => {
      controller.abort();

      return job('queued');
    });

    await syncPendingTranscriptions(deps, [MEETING_ID, OTHER_MEETING_ID], controller.signal);

    expect(gateway.getJob).toHaveBeenCalledTimes(1);
  });
});
