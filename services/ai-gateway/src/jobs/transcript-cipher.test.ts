import { createCipheriv, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { createTranscriptCipher, TranscriptCipherError } from './transcript-cipher.js';

const KEK = Buffer.alloc(32, 3);
const OTHER_KEK = Buffer.alloc(32, 4);
const JOB_ID = '00000000-0000-4000-8000-0000000000b1';
const SEGMENTS = [{ endMs: 1_000, startMs: 0, text: '안녕하세요 비밀 회의' }];

const cipher = createTranscriptCipher({ kek: KEK });

const flipByte = (encoded: string, offset: number) => {
  const bytes = Buffer.from(encoded, 'base64');

  bytes[offset] = bytes[offset]! ^ 0xff;

  return bytes.toString('base64');
};

const serialize = (error: unknown) =>
  JSON.stringify(error, Object.getOwnPropertyNames(error as object));

const captureError = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error as Error;
  }

  throw new Error('did not throw');
};

// 오류를 직렬화한 문자열에 평문·키 조각이 없어야 한다. pino가 err 객체를 통째로 로그에 남기기 때문이다.
const expectNoLeak = (error: unknown, secrets: string[]) => {
  const text = serialize(error);

  expect(error).toBeInstanceOf(TranscriptCipherError);
  expect((error as { cause?: unknown }).cause).toBeUndefined();

  for (const secret of ['비밀', KEK.toString('hex'), OTHER_KEK.toString('hex'), ...secrets]) {
    expect(text).not.toContain(secret);
  }
};

describe('createTranscriptCipher', () => {
  it.each([31, 33, 48])('KEK가 %i바이트면 throw한다', (length) => {
    expect(() => createTranscriptCipher({ kek: Buffer.alloc(length, 1) })).toThrow(
      'transcript KEK must be 32 bytes',
    );
  });

  it('seal→open 왕복은 같은 segments를 돌려주고 대문자 jobId도 같은 행으로 본다', () => {
    const sealed = cipher.seal({ jobId: JOB_ID.toUpperCase(), segments: SEGMENTS });

    expect(sealed.keyVersion).toBe(1);
    expect(Buffer.from(sealed.dekSealed, 'base64')).toHaveLength(60);
    expect(cipher.open({ ...sealed, jobId: JOB_ID })).toEqual(SEGMENTS);
  });

  it('같은 입력을 두 번 seal하면 DEK·iv가 달라 두 암호문 모두 다르다', () => {
    const first = cipher.seal({ jobId: JOB_ID, segments: SEGMENTS });
    const second = cipher.seal({ jobId: JOB_ID, segments: SEGMENTS });

    expect(first.segmentsSealed).not.toBe(second.segmentsSealed);
    expect(first.dekSealed).not.toBe(second.dekSealed);
  });

  describe('변조한 암호문은 열리지 않는다', () => {
    const sealed = cipher.seal({ jobId: JOB_ID, segments: SEGMENTS });

    it.each([
      ['segments_sealed 본문 1바이트', { segmentsSealed: flipByte(sealed.segmentsSealed, 40) }],
      ['segments_sealed tag', { segmentsSealed: flipByte(sealed.segmentsSealed, 12) }],
      ['dek_sealed 1바이트', { dekSealed: flipByte(sealed.dekSealed, 30) }],
      ['잘린 segments_sealed', { segmentsSealed: sealed.segmentsSealed.slice(0, 36) }],
      ['base64 밖 문자', { segmentsSealed: `${sealed.segmentsSealed.slice(0, -4)}!!!!` }],
      ['dek_sealed 길이 ≠ 60', { dekSealed: randomBytes(59).toString('base64') }],
      ['다른 jobId', { jobId: '00000000-0000-4000-8000-0000000000b2' }],
      ['key_version 2', { keyVersion: 2 }],
    ])('%s → TranscriptCipherError', (_label, patch) => {
      expectNoLeak(
        captureError(() => cipher.open({ ...sealed, jobId: JOB_ID, ...patch })),
        [],
      );
    });

    it('다른 KEK로는 열리지 않는다', () => {
      const error = captureError(() =>
        createTranscriptCipher({ kek: OTHER_KEK }).open({ ...sealed, jobId: JOB_ID }),
      );

      expectNoLeak(error, []);
      expect((error as TranscriptCipherError).reason).toBe('auth_failed');
    });
  });

  it('JSON이 아닌 평문을 잠근 blob은 malformed이고 오류 문자열에 평문이 없다', () => {
    const sealed = cipher.seal({ jobId: JOB_ID, segments: [] });
    // seal이 쓴 DEK를 꺼낼 수 없으므로 DEK를 직접 만들고 같은 KEK·aad로 포장한다.
    const dek = randomBytes(32);
    const wrap = (plain: Buffer, key: Buffer, purpose: string) => {
      const iv = randomBytes(12);
      const gcm = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });

      gcm.setAAD(Buffer.from(`echonote/transcript/1/${purpose}/${JOB_ID}`));

      const body = Buffer.concat([gcm.update(plain), gcm.final()]);

      return Buffer.concat([iv, gcm.getAuthTag(), body]).toString('base64');
    };

    const error = captureError(() =>
      cipher.open({
        ...sealed,
        dekSealed: wrap(dek, KEK, 'dek'),
        jobId: JOB_ID,
        segmentsSealed: wrap(Buffer.from('평문 비밀 텍스트'), dek, 'segments'),
      }),
    );

    expectNoLeak(error, [dek.toString('hex')]);
    expect((error as TranscriptCipherError).reason).toBe('malformed');
  });
});
