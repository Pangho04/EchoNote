import Fastify, { type FastifyError, type FastifyServerOptions } from 'fastify';

import type { NonceStore } from './uploads/nonce-store.js';
import { UploadVerificationError } from './uploads/receive-upload.js';
import {
  InvalidUploadGrantError,
  type VerifyUploadGrant,
} from './uploads/upload-grant-verifier.js';
import { registerUploadRoutes } from './uploads/upload-routes.js';

type BuildServerOptions = {
  dataDir: string;
  logger?: FastifyServerOptions['logger'];
  nonceStore: NonceStore;
  verifyGrant: VerifyUploadGrant;
};

// 512 MiB를 느린 회선으로 받는 시간을 포함한 요청 전체 상한이다.
const REQUEST_TIMEOUT_MS = 1_800_000;

export const buildServer = ({
  dataDir,
  logger = false,
  nonceStore,
  verifyGrant,
}: BuildServerOptions) => {
  const server = Fastify({ logger, requestTimeout: REQUEST_TIMEOUT_MS });

  // 거절·실패한 요청의 남은 body를 받지 않도록 연결을 닫는다.
  server.addHook('onSend', async (_request, reply) => {
    if (reply.statusCode >= 400) reply.header('connection', 'close');
  });

  server.setErrorHandler((error, request, reply) => {
    if (error instanceof InvalidUploadGrantError) {
      request.log.warn({ reason: error.reason }, 'upload grant rejected');

      return reply.code(401).send({ error: 'invalid_upload_grant' });
    }

    if (error instanceof UploadVerificationError) {
      return reply.code(422).send({ error: 'upload_verification_failed' });
    }

    const { code, statusCode } =
      typeof error === 'object' && error !== null ? (error as Partial<FastifyError>) : {};

    if (code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      return reply.code(415).send({ error: 'unsupported_media_type' });
    }

    // 그 밖의 4xx는 Fastify 기본 처리에 넘긴다.
    if (
      typeof statusCode === 'number' &&
      Number.isInteger(statusCode) &&
      statusCode >= 400 &&
      statusCode <= 499
    ) {
      throw error;
    }

    // fs 오류 message에는 데이터 경로와 jobId가 들어 있으므로 code만 남긴다.
    request.log.error({ code }, 'unhandled upload error');

    return reply.code(500).send({ error: 'internal' });
  });

  registerUploadRoutes(server, { dataDir, nonceStore, verifyGrant });

  return server;
};
