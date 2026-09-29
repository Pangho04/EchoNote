import type { UploadCompletionRequest } from '@echonote/contracts';

import { UploadCompletionError } from './upload-completion-error.js';

const COMPLETION_PATH = '/v1/worker/upload-completions';
const TIMEOUT_MS = 10_000;

export type NotifyUploadCompletion = (
  command: UploadCompletionRequest,
) => Promise<'created' | 'existing'>;

type UploadCompletionClientOptions = {
  gatewayOrigin: string;
  // loadEnvironment로 검증한 값만 받는다. new Headers의 TypeError 문구가 값을 담는다.
  workerApiToken: string;
};

export const createUploadCompletionClient = ({
  gatewayOrigin,
  workerApiToken,
}: UploadCompletionClientOptions): NotifyUploadCompletion => {
  const url = new URL(COMPLETION_PATH, gatewayOrigin);
  const headers = new Headers({
    authorization: `Bearer ${workerApiToken}`,
    'content-type': 'application/json',
  });

  return async (command) => {
    let response: Response;

    try {
      response = await fetch(url, {
        body: JSON.stringify(command),
        headers,
        method: 'POST',
        // 3xx를 따라가면 token이 다른 origin으로 갈 수 있다. gateway_3xx로 처리한다.
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      // 원본 오류를 cause로 잇지 않는다. 분류 코드만 남긴다.
      // AbortSignal.timeout이 만료되면 fetch는 name이 TimeoutError인 DOMException으로 reject한다.
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new UploadCompletionError('timeout');
      }

      // fetch는 연결 실패를 TypeError로 reject한다. cause에 주소가 들어 있다.
      if (error instanceof TypeError) throw new UploadCompletionError('network');

      throw error;
    }

    // 응답 body는 쓰지 않는다. 연결을 붙잡지 않도록 버린다.
    await response.body?.cancel().catch(() => undefined);

    switch (response.status) {
      case 201:
        return 'created';

      case 200:
        return 'existing';

      default:
        throw new UploadCompletionError(`gateway_${response.status}`);
    }
  };
};
