import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

import { BEARER_PATTERN, sendUnauthorized } from './require-user.js';

const sha256 = (value: string) => createHash('sha256').update(value).digest();

// fastify-plugin으로 감싸지 않는다. 호출한 register 캡슐 안의 route에만 hook이 걸린다.
export const installWorkerAuth = (instance: FastifyInstance, workerApiToken: string) => {
  // 양쪽을 같은 길이의 digest로 바꿔 비교한다. 길이 차이로 비교가 일찍 끝나지 않는다.
  const expectedDigest = sha256(workerApiToken);

  instance.addHook('onRequest', async (request, reply) => {
    const token = BEARER_PATTERN.exec(request.headers.authorization ?? '')?.[1];

    if (token === undefined || !timingSafeEqual(sha256(token), expectedDigest)) {
      return sendUnauthorized(reply);
    }
  });
};
