import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';

import { detectMimeTypeFromBytes, type RecordingFileService } from './recording-file-service';

function toHex(arrayBuffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(arrayBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function sha256Bytes(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);

  return toHex(digest);
}

// expo-file-system의 새 File 클래스 API를 expo-crypto와 함께 조립해
// RecordingFileService port를 구현한다.
export function createNativeRecordingFileService(): RecordingFileService {
  return {
    async exists(uri) {
      return new File(uri).exists;
    },

    // byte를 한 번만 읽어 정체성을 모두 산출한다. 1시간 녹음처럼 큰 파일을
    // 여러 번 메모리에 적재하지 않는다.
    async inspect(uri) {
      const bytes = await new File(uri).bytes();

      return {
        byteSize: bytes.byteLength,
        mimeType: detectMimeTypeFromBytes(bytes),
        sha256: await sha256Bytes(bytes),
      };
    },

    async move(input) {
      await new File(input.from).move(new File(input.to));
    },

    async delete(uri) {
      new File(uri).delete();
    },
  };
}

// meetingId를 기반으로 한 deterministic 최종 URI다. 같은 meetingId는 항상 같은
// final 위치로 수렴하므로 재시도해도 원본이 흩어지지 않는다.
export function createFinalRecordingUri(meetingId: string): string {
  new Directory(Paths.document, 'recordings').create({ intermediates: true, idempotent: true });

  return new File(Paths.document, 'recordings', `${meetingId}.m4a`).uri;
}
