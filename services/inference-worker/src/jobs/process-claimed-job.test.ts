import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'echonote-process-'));
  await mkdir(join(dataDir, 'final'));
});

afterEach(async () => {
  await rm(dataDir, { force: true, recursive: true });
});

describe('createClaimedJobProcessor', () => {
  it('final/<jobId>.m4a가 있으면 끝난다', async () => {
    await writeFile(join(dataDir, 'final', `${job.id}.m4a`), 'audio');

    await expect(createClaimedJobProcessor(dataDir)(job)).resolves.toBeUndefined();
  });

  it('파일이 없으면 fs 오류를 그대로 던진다', async () => {
    await expect(createClaimedJobProcessor(dataDir)(job)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
