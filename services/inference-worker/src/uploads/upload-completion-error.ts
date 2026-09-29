type UploadCompletionFailureReason =
  'manifest_invalid' | 'manifest_mismatch' | 'timeout' | 'network' | `gateway_${number}`;

// final 파일은 확정했지만 Gateway에 완료를 알리지 못했다. reason에는 분류 코드만 담는다.
export class UploadCompletionError extends Error {
  readonly reason: UploadCompletionFailureReason;

  constructor(reason: UploadCompletionFailureReason) {
    super('upload completion failed');
    this.name = 'UploadCompletionError';
    this.reason = reason;
  }
}
