import type { FastifyInstance, FastifyRequest } from 'fastify';

import {
  type AccessTokenVerifier,
  InvalidAccessTokenError,
  type UserContext,
  VerifierUnavailableError,
} from './access-token-verifier.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: UserContext | null;
  }
}

const BEARER_PATTERN = /^Bearer (\S+)$/i;

// fastify-plugin으로 감싸지 않는다. 호출한 register 캡슐 안의 route에만 hook이 걸린다.
export const installAuth = (instance: FastifyInstance, verifier: AccessTokenVerifier) => {
  instance.decorateRequest('user', null);

  instance.addHook('onRequest', async (request, reply) => {
    const token = BEARER_PATTERN.exec(request.headers.authorization ?? '')?.[1];

    if (token === undefined) {
      return reply.code(401).header('WWW-Authenticate', 'Bearer').send({ error: 'unauthorized' });
    }

    try {
      request.user = await verifier.verify(token);
    } catch (error) {
      if (error instanceof InvalidAccessTokenError) {
        return reply.code(401).header('WWW-Authenticate', 'Bearer').send({ error: 'unauthorized' });
      }

      if (error instanceof VerifierUnavailableError) {
        request.log.warn({ reason: error.reason }, 'access token verifier unavailable');

        return reply.code(503).send({ error: 'auth_unavailable' });
      }

      throw error;
    }
  });
};

export const getUserContext = (request: FastifyRequest): UserContext => {
  // 캡슐 밖 request에는 decorator가 없어 undefined다.
  if (!request.user) throw new Error('getUserContext requires a route inside installAuth');

  return request.user;
};
