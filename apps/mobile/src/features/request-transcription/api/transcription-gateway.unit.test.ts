import axios, { type AxiosAdapter, type AxiosRequestConfig } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import type { Recording } from '@/entities/recording';

import { createTranscriptionGateway } from './transcription-gateway';

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

const snapshot = {
  id: JOB_ID,
  meetingId: MEETING_ID,
  status: 'created',
  sizeBytes: 1_000,
  sha256: 'a'.repeat(64),
  mimeType: 'audio/mp4',
  createdAt: '2026-10-02T00:00:00.000Z',
};

type Reply = { status: number; data: unknown } | Error;

function createClient(reply: Reply) {
  const client = axios.create({ baseURL: 'http://gateway.test', timeout: 10_000 });
  const adapter = vi.fn(async (config: AxiosRequestConfig) => {
    if (reply instanceof Error) throw reply;

    const response = {
      data: reply.data,
      status: reply.status,
      statusText: '',
      headers: {},
      config,
    };

    if (reply.status >= 400) {
      throw new axios.AxiosError(
        'failed',
        'ERR_BAD_RESPONSE',
        config as never,
        null,
        response as never,
      );
    }

    return response;
  });

  client.defaults.adapter = adapter as unknown as AxiosAdapter;

  return { gateway: createTranscriptionGateway(client), adapter };
}

const signal = () => new AbortController().signal;

describe('createTranscriptionGateway', () => {
  it('createJob은 계약 body와 Idempotency-Key를 보낸다', async () => {
    const { gateway, adapter } = createClient({ status: 201, data: snapshot });

    const result = await gateway.createJob(recording, 'key-1');
    const config = adapter.mock.calls[0]![0];

    expect(result).toEqual({ kind: 'ok', data: snapshot });
    expect(config.url).toBe('/v1/jobs');
    expect(JSON.parse(config.data as string)).toEqual({
      meetingId: MEETING_ID,
      sizeBytes: 1_000,
      sha256: 'a'.repeat(64),
      mimeType: 'audio/mp4',
    });
    expect(config.headers?.['Idempotency-Key']).toBe('key-1');
  });

  it('issueUploadGrant는 body 없이 보내고 https가 아닌 주소는 거부한다', async () => {
    const grant = { uploadUrl: 'http://desktop.test/u', grant: 'g', expiresAt: snapshot.createdAt };
    const { gateway, adapter } = createClient({ status: 200, data: grant });

    const result = await gateway.issueUploadGrant(JOB_ID);

    expect(adapter.mock.calls[0]![0].data).toBeUndefined();
    expect(adapter.mock.calls[0]![0].url).toBe(`/v1/jobs/${JOB_ID}/upload-grants`);
    expect(result).toEqual({ kind: 'invalid-response' });
  });

  it('오류 응답은 status와 error 코드를 넘긴다', async () => {
    const { gateway } = createClient({ status: 409, data: { error: 'job_not_uploadable' } });

    expect(await gateway.issueUploadGrant(JOB_ID)).toEqual({
      kind: 'http-error',
      status: 409,
      error: 'job_not_uploadable',
    });
  });

  it('오류 body 모양이 다르면 error는 null이다', async () => {
    const { gateway } = createClient({ status: 500, data: 'oops' });

    expect(await gateway.getJob(MEETING_ID, JOB_ID, signal())).toEqual({
      kind: 'http-error',
      status: 500,
      error: null,
    });
  });

  it('응답이 없으면 network-error다', async () => {
    const { gateway } = createClient(new Error('offline'));

    expect(await gateway.getJob(MEETING_ID, JOB_ID, signal())).toEqual({ kind: 'network-error' });
  });

  it('취소된 요청은 aborted다', async () => {
    const { gateway } = createClient(new axios.CanceledError());

    expect(await gateway.getJob(MEETING_ID, JOB_ID, signal())).toEqual({ kind: 'aborted' });
  });

  it('getJob은 다른 job·회의 응답을 거부한다', async () => {
    const job = { id: JOB_ID, meetingId: MEETING_ID, status: 'queued', errorCode: null };

    expect(
      await createClient({ status: 200, data: job }).gateway.getJob(MEETING_ID, JOB_ID, signal()),
    ).toEqual({ kind: 'ok', data: job });
    expect(
      await createClient({ status: 200, data: { ...job, meetingId: JOB_ID } }).gateway.getJob(
        MEETING_ID,
        JOB_ID,
        signal(),
      ),
    ).toEqual({ kind: 'invalid-response' });
  });

  it('getTranscript는 30초 timeout으로 묻고 부가 필드를 걸러 계약으로 검증한다', async () => {
    const segments = [{ startMs: 0, endMs: 1_000, text: '안녕', speaker: 'A' }];
    const { gateway, adapter } = createClient({
      status: 200,
      data: { jobId: JOB_ID, durationMs: 2_000, segments },
    });

    const result = await gateway.getTranscript(JOB_ID, signal());

    expect(adapter.mock.calls[0]![0].timeout).toBe(30_000);
    expect(result).toEqual({
      kind: 'ok',
      data: { durationMs: 2_000, segments: [{ startMs: 0, endMs: 1_000, text: '안녕' }] },
    });
  });

  it('getTranscript는 구간이 길이를 넘으면 거부한다', async () => {
    const { gateway } = createClient({
      status: 200,
      data: { durationMs: 500, segments: [{ startMs: 0, endMs: 1_000, text: '안녕' }] },
    });

    expect(await gateway.getTranscript(JOB_ID, signal())).toEqual({ kind: 'invalid-response' });
  });
});
