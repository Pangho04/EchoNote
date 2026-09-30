import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createClaimedJobProcessor } from './process-claimed-job.js';

const job = {
  createdAt: '2026-09-29T12:00:00.123Z',
  id: '00000000-0000-4000-8000-0000000000f1',
  meetingId: '00000000-0000-4000-8000-00000000000c',
  mimeType: 'audio/mp4' as const,
  sha256: 'e'.repeat(64),
  sizeBytes: 100,
  status: 'processing' as const,
};

const transcript = {
  durationMs: 2_000,
  schemaVersion: 1 as const,
  segments: [{ endMs: 1_000, startMs: 0, text: '회의 본문' }],
};

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'echonote-process-'));
  await mkdir(join(dataDir, 'final'));
});

afterEach(async () => {
  await rm(dataDir, { force: true, recursive: true });
});

const setup = () => {
  const logger = { info: vi.fn() };
  const transcribe = vi.fn(async () => transcript);

  return {
    logger,
    process: createClaimedJobProcessor({ dataDir, logger, transcribe }),
    transcribe,
  };
};

describe('createClaimedJobProcessor', () => {
  it('final/<jobId>.m4a를 signal과 함께 전사하고 본문 없이 개수·길이만 로그로 남긴다', async () => {
    await writeFile(join(dataDir, 'final', `${job.id}.m4a`), 'audio');

    const { logger, process, transcribe } = setup();
    const signal = new AbortController().signal;

    await process(job, signal);

    expect(transcribe).toHaveBeenCalledWith(job.id, signal);
    expect(logger.info).toHaveBeenCalledWith(
      { durationMs: 2_000, jobId: job.id, segmentCount: 1 },
      'job transcribed',
    );
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('회의 본문');
  });

  it('이 프로세스에서 전사한 job이 다시 오면 전사하지 않는다', async () => {
    await writeFile(join(dataDir, 'final', `${job.id}.m4a`), 'audio');

    const { logger, process, transcribe } = setup();

    await process(job, new AbortController().signal);
    await process(job, new AbortController().signal);

    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenLastCalledWith({ jobId: job.id }, 'job transcription skipped');
  });

  it('파일이 없으면 전사하지 않고 fs 오류를 그대로 던진다', async () => {
    const { process, transcribe } = setup();

    await expect(process(job, new AbortController().signal)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('전사가 실패하면 오류를 그대로 던지고 다음 claim에서 다시 전사한다', async () => {
    await writeFile(join(dataDir, 'final', `${job.id}.m4a`), 'audio');

    const { process, transcribe } = setup();
    const failure = Object.assign(new Error('STT_EXIT'), { code: 'STT_EXIT' });

    transcribe.mockRejectedValueOnce(failure);

    await expect(process(job, new AbortController().signal)).rejects.toBe(failure);
    await process(job, new AbortController().signal);

    expect(transcribe).toHaveBeenCalledTimes(2);
  });
});
