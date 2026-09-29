import type { FastifyInstance } from 'fastify';

import type { NonceStore } from './nonce-store.js';
import { receiveUpload } from './receive-upload.js';
import type { VerifyUploadGrant } from './upload-grant-verifier.js';

const OCTET_STREAM = 'application/octet-stream';

type UploadRoutesOptions = {
  dataDir: string;
  nonceStore: NonceStore;
  verifyGrant: VerifyUploadGrant;
};

// fastify-plugin으로 감싸지 않는다. content-type parser 교체는 이 캡슐 안에만 적용된다.
export const registerUploadRoutes = (
  server: FastifyInstance,
  { dataDir, nonceStore, verifyGrant }: UploadRoutesOptions,
) =>
  server.register(async (uploads) => {
    // body를 버퍼링하지 않고 stream 그대로 handler에 넘긴다. 다른 content-type은 415다.
    uploads.removeAllContentTypeParsers();
    uploads.addContentTypeParser(OCTET_STREAM, (_request, payload, done) => done(null, payload));

    uploads.put('/uploads', async (request, reply) => {
      // body 없는 요청은 parser를 거치지 않으므로 여기서 content-type을 다시 확인한다.
      if (request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== OCTET_STREAM) {
        return reply.code(415).send({ error: 'unsupported_media_type' });
      }

      const claims = await verifyGrant(request.headers.authorization);

      // 이 시점부터 grant는 소비된다. 뒤 단계가 실패해도 같은 grant는 다시 쓸 수 없다.
      if (!nonceStore.consume(claims.jti, claims.exp)) {
        return reply.code(409).send({ error: 'upload_grant_used' });
      }

      if (request.headers['content-length'] !== String(claims.size_bytes)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }

      const outcome = await receiveUpload({
        body: request.raw,
        claims,
        dataDir,
        logTempCleanupFailure: (code) => request.log.warn({ code }, 'upload temp cleanup failed'),
      });

      switch (outcome) {
        case 'created':
          return reply.code(201).send({ jobId: claims.job_id });

        case 'existing':
          return reply.code(200).send({ jobId: claims.job_id });

        default:
          return outcome satisfies never;
      }
    });
  });
