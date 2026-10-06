import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// 봉투 암호화: 전사문은 행마다 새로 만든 DEK로, DEK는 KEK로 잠근다. KEK는 Gateway 환경변수에만 있다.
// 저장 형식: base64(iv 12바이트 | tag 16바이트 | 암호문). aad는 job_id와 용도를 묶어 행 바꿔치기를 막는다.

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_VERSION = 1;
// DEK 32바이트를 잠근 blob은 iv·tag를 더해 정확히 60바이트다.
const SEALED_DEK_BYTES = IV_BYTES + TAG_BYTES + KEY_BYTES;
const MIN_SEALED_BYTES = IV_BYTES + TAG_BYTES + 1;

export type TranscriptCipherReason =
  'invalid_key_version' | 'invalid_base64' | 'invalid_length' | 'auth_failed' | 'malformed';

// reason 코드만 담는다. message·cause에 평문·키·암호문 조각을 넣지 않는다.
export class TranscriptCipherError extends Error {
  readonly reason: TranscriptCipherReason;

  constructor(reason: TranscriptCipherReason) {
    super(`transcript cipher ${reason}`);
    this.name = 'TranscriptCipherError';
    this.reason = reason;
  }
}

export type SealedTranscript = {
  segmentsSealed: string;
  dekSealed: string;
  keyVersion: number;
};

export type TranscriptCipher = {
  seal(input: { jobId: string; segments: unknown }): SealedTranscript;
  // 복호화한 segments를 돌려준다. 계약 검사는 호출자가 한다.
  open(input: { jobId: string } & SealedTranscript): unknown;
};

const aadFor = (purpose: 'segments' | 'dek', jobId: string) =>
  Buffer.from(`echonote/transcript/${KEY_VERSION}/${purpose}/${jobId.toLowerCase()}`);

const encrypt = (plain: Buffer, key: Uint8Array, aad: Buffer) => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });

  cipher.setAAD(aad);

  const body = Buffer.concat([cipher.update(plain), cipher.final()]);

  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
};

// Buffer.from은 alphabet 밖 문자를 버리므로 다시 encode한 결과가 입력과 같아야 한다.
const decodeStrictBase64 = (encoded: string) => {
  const decoded = Buffer.from(encoded, 'base64');

  if (decoded.toString('base64') !== encoded) throw new TranscriptCipherError('invalid_base64');

  return decoded;
};

const decrypt = (sealed: Buffer, key: Uint8Array, aad: Buffer) => {
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, IV_BYTES), {
    authTagLength: TAG_BYTES,
  });

  decipher.setAAD(aad);
  decipher.setAuthTag(sealed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));

  // GCM의 final()은 빈 Buffer라 update 결과를 그대로 쓴다. concat으로 복사하면 호출자의 fill(0)이 복사본만 지운다.
  const plain = decipher.update(sealed.subarray(IV_BYTES + TAG_BYTES));

  try {
    decipher.final();
  } catch {
    plain.fill(0);

    throw new TranscriptCipherError('auth_failed');
  }

  return plain;
};

export const createTranscriptCipher = ({ kek }: { kek: Uint8Array }): TranscriptCipher => {
  if (kek.length !== KEY_BYTES) throw new Error(`transcript KEK must be ${KEY_BYTES} bytes`);

  return {
    seal({ jobId, segments }) {
      const dek = randomBytes(KEY_BYTES);

      try {
        return {
          segmentsSealed: encrypt(
            Buffer.from(JSON.stringify(segments)),
            dek,
            aadFor('segments', jobId),
          ),
          dekSealed: encrypt(dek, kek, aadFor('dek', jobId)),
          keyVersion: KEY_VERSION,
        };
      } finally {
        dek.fill(0);
      }
    },

    open({ dekSealed, jobId, keyVersion, segmentsSealed }) {
      if (keyVersion !== KEY_VERSION) throw new TranscriptCipherError('invalid_key_version');

      const sealedDek = decodeStrictBase64(dekSealed);
      const sealedSegments = decodeStrictBase64(segmentsSealed);

      if (sealedDek.length !== SEALED_DEK_BYTES || sealedSegments.length < MIN_SEALED_BYTES) {
        throw new TranscriptCipherError('invalid_length');
      }

      const dek = decrypt(sealedDek, kek, aadFor('dek', jobId));

      try {
        const plain = decrypt(sealedSegments, dek, aadFor('segments', jobId));

        // JSON.parse 오류 message는 입력 조각을 담으므로 reason 코드로 바꾼다.
        try {
          return JSON.parse(plain.toString('utf8')) as unknown;
        } catch {
          throw new TranscriptCipherError('malformed');
        }
      } finally {
        dek.fill(0);
      }
    },
  };
};
