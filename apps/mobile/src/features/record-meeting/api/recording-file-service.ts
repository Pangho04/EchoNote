// 실제 파일 byte에서 확인한 정체성이다. MIME은 확장자나 preset으로 추측하지 않는다.
export type RecordingFileIdentity = {
  byteSize: number;
  mimeType: string;
  sha256: string;
};

// MP4/M4A 컨테이너는 offset 4부터 'mp4' box type(brand) 표기 'ftyp'를 가진다.
// 실제 byte로 MIME을 판별한다. MIME allowlist가 audio/mp4 단독이므로 그 외는
// 허용 목록을 벗어나게 하는 fallback을 돌려준다.
export function detectMimeTypeFromBytes(bytes: Uint8Array): string {
  const boxType = new TextDecoder().decode(bytes.slice(4, 8));

  if (boxType === 'ftyp') {
    return 'audio/mp4';
  }

  return 'application/octet-stream';
}

export interface RecordingFileService {
  // 파일 존재 여부를 확인한다.
  exists(uri: string): Promise<boolean>;
  // 파일 byte를 한 번 읽어 byteSize·MIME·SHA-256을 함께 산출한다.
  inspect(uri: string): Promise<RecordingFileIdentity>;
  // 파일을 영구 위치로 옮긴다.
  move(input: { from: string; to: string }): Promise<void>;
  // 파일을 삭제한다.
  delete(uri: string): Promise<void>;
}
