export type JobLeaseFailureReason =
  'timeout' | 'network' | 'invalid_response' | `gateway_${number}`;

// Gateway와 lease 요청을 주고받지 못했다. reason에는 분류 코드만 담는다.
export class JobLeaseClientError extends Error {
  readonly reason: JobLeaseFailureReason;

  constructor(reason: JobLeaseFailureReason) {
    super('job lease request failed');
    this.name = 'JobLeaseClientError';
    this.reason = reason;
  }
}
