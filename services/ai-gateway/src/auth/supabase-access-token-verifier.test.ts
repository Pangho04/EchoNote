import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CompactSign, exportJWK, generateKeyPair, type JWTPayload, SignJWT } from 'jose';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildServer } from '../server.js';
import { InvalidAccessTokenError, VerifierUnavailableError } from './access-token-verifier.js';
import { createSupabaseAccessTokenVerifier } from './supabase-access-token-verifier.js';

type JwksMode = 'ok' | 'error' | 'hang';
type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

const KID = 'test-key';
const JWKS_PATH = '/auth/v1/.well-known/jwks.json';

let signingKey: PrivateKey;
let otherKey: PrivateKey;
let publicJwk: Record<string, unknown>;

const httpServers: Server[] = [];
const fastifyServers: ReturnType<typeof buildServer>[] = [];

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  const other = await generateKeyPair('ES256');

  signingKey = pair.privateKey;
  otherKey = other.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), alg: 'ES256', kid: KID, use: 'sig' };
});

afterEach(async () => {
  await Promise.all(fastifyServers.splice(0).map(async (server) => server.close()));

  for (const server of httpServers.splice(0)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

const startJwksServer = async (mode: JwksMode) => {
  const server = createServer((request, response) => {
    if (mode === 'hang') return;

    if (mode === 'error' || request.url !== JWKS_PATH) {
      response.writeHead(500).end();

      return;
    }

    response
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ keys: [publicJwk] }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  httpServers.push(server);

  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

const createVerifier = (supabaseUrl: string, jwksTimeoutMs?: number) =>
  createSupabaseAccessTokenVerifier({ algorithms: ['ES256'], jwksTimeoutMs, supabaseUrl });

const signToken = async (
  supabaseUrl: string,
  {
    claims = {},
    expiresAt = Math.floor(Date.now() / 1000) + 3600,
    key = signingKey,
    kid = KID,
  }: { claims?: JWTPayload; expiresAt?: number; key?: PrivateKey; kid?: string } = {},
) =>
  new SignJWT({ aud: 'authenticated', iss: `${supabaseUrl}/auth/v1`, sub: 'user-1', ...claims })
    .setProtectedHeader({ alg: 'ES256', kid })
    .setExpirationTime(expiresAt)
    .sign(key);

describe('createSupabaseAccessTokenVerifier', () => {
  it('서명·iss·aud·exp가 맞으면 sub를 사용자 id로 반환한다', async () => {
    const supabaseUrl = await startJwksServer('ok');

    await expect(createVerifier(supabaseUrl).verify(await signToken(supabaseUrl))).resolves.toEqual(
      {
        id: 'user-1',
      },
    );
  });

  it('만료 후 30초 허용 오차 안이면 통과하고 넘으면 거부한다', async () => {
    const supabaseUrl = await startJwksServer('ok');
    const verifier = createVerifier(supabaseUrl);
    const now = Math.floor(Date.now() / 1000);

    await expect(
      verifier.verify(await signToken(supabaseUrl, { expiresAt: now - 25 })),
    ).resolves.toEqual({
      id: 'user-1',
    });
    await expect(
      verifier.verify(await signToken(supabaseUrl, { expiresAt: now - 35 })),
    ).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it.each<[string, (supabaseUrl: string) => Promise<string>]>([
    ['다른 키로 서명', async (url) => signToken(url, { key: otherKey })],
    ['JWKS에 없는 kid', async (url) => signToken(url, { kid: 'unknown-key' })],
    [
      'iss 불일치',
      async (url) => signToken(url, { claims: { iss: 'https://other.example/auth/v1' } }),
    ],
    ['aud 불일치', async (url) => signToken(url, { claims: { aud: 'anon' } })],
    ['sub 없음', async (url) => signToken(url, { claims: { sub: undefined } })],
    ['빈 sub', async (url) => signToken(url, { claims: { sub: '' } })],
    ['익명 사용자', async (url) => signToken(url, { claims: { is_anonymous: true } })],
    [
      'HS256',
      async (url) =>
        new SignJWT({ aud: 'authenticated', iss: `${url}/auth/v1`, sub: 'user-1' })
          .setProtectedHeader({ alg: 'HS256' })
          .setExpirationTime('1h')
          .sign(new TextEncoder().encode('shared-secret-shared-secret-32by')),
    ],
    [
      'alg none',
      async (url) =>
        [
          Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
          Buffer.from(
            JSON.stringify({ aud: 'authenticated', iss: `${url}/auth/v1`, sub: 'user-1' }),
          ).toString('base64url'),
          '',
        ].join('.'),
    ],
    [
      '알 수 없는 crit header',
      async (url) =>
        new SignJWT({ aud: 'authenticated', iss: `${url}/auth/v1`, sub: 'user-1' })
          .setProtectedHeader({ alg: 'ES256', crit: ['x-unknown'], kid: KID, 'x-unknown': true })
          .setExpirationTime('1h')
          .sign(signingKey, { crit: { 'x-unknown': true } }),
    ],
    ['세 부분이 아닌 토큰', async () => 'abc.def'],
    ['base64url이 아닌 header', async () => '%%%.%%%.%%%'],
    [
      'JSON이 아닌 payload',
      async () =>
        new CompactSign(new TextEncoder().encode('not-json'))
          .setProtectedHeader({ alg: 'ES256', kid: KID })
          .sign(signingKey),
    ],
  ])('%s 토큰은 InvalidAccessTokenError로 거부한다', async (_label, createToken) => {
    const supabaseUrl = await startJwksServer('ok');

    await expect(
      createVerifier(supabaseUrl).verify(await createToken(supabaseUrl)),
    ).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it('JSON이 아닌 payload 케이스와 같은 키·header로 서명한 JSON payload는 통과한다', async () => {
    const supabaseUrl = await startJwksServer('ok');
    const token = await new CompactSign(
      new TextEncoder().encode(
        JSON.stringify({
          aud: 'authenticated',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iss: `${supabaseUrl}/auth/v1`,
          sub: 'user-1',
        }),
      ),
    )
      .setProtectedHeader({ alg: 'ES256', kid: KID })
      .sign(signingKey);

    await expect(createVerifier(supabaseUrl).verify(token)).resolves.toEqual({ id: 'user-1' });
  });

  it.each<[string, () => Promise<{ supabaseUrl: string; jwksTimeoutMs?: number }>, string]>([
    [
      'JWKS 500 응답',
      async () => ({ supabaseUrl: await startJwksServer('error') }),
      'ERR_JOSE_GENERIC',
    ],
    [
      'JWKS 응답 지연',
      async () => ({ jwksTimeoutMs: 200, supabaseUrl: await startJwksServer('hang') }),
      'ERR_JWKS_TIMEOUT',
    ],
    [
      'JWKS 연결 거부',
      async () => {
        const supabaseUrl = await startJwksServer('ok');
        const server = httpServers.pop();

        await new Promise((resolve) => server?.close(resolve));

        return { supabaseUrl };
      },
      'TypeError',
    ],
  ])('%s이면 VerifierUnavailableError로 구분한다', async (_label, setup, reason) => {
    const { jwksTimeoutMs, supabaseUrl } = await setup();
    const error = await createVerifier(supabaseUrl, jwksTimeoutMs)
      .verify(await signToken(supabaseUrl))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(VerifierUnavailableError);
    expect((error as VerifierUnavailableError).reason).toBe(reason);
  });
});

describe('Gateway 인증 로그', () => {
  const buildLoggedServer = (supabaseUrl: string) => {
    const logLines: string[] = [];
    const server = buildServer({
      issueUploadGrant: vi.fn(),
      jobRepository: { createJob: vi.fn(), findOwnedJob: vi.fn() },
      logger: { level: 'info', stream: { write: (line: string) => logLines.push(line) } },
      verifier: createVerifier(supabaseUrl),
    });

    fastifyServers.push(server);

    return { logLines, server };
  };

  const leakProbe = { email: 'leak-probe@example.com', sub: 'leak-probe-sub-7f3a' };

  it('인증 성공 요청의 로그에 토큰·sub·email이 남지 않는다', async () => {
    const supabaseUrl = await startJwksServer('ok');
    const { logLines, server } = buildLoggedServer(supabaseUrl);
    const token = await signToken(supabaseUrl, { claims: leakProbe });

    const response = await server.inject({
      headers: { authorization: `Bearer ${token}` },
      method: 'GET',
      url: '/v1/auth-check',
    });
    const log = logLines.join('');

    expect(response.statusCode).toBe(200);
    expect(logLines.length).toBeGreaterThan(0);
    expect(log).not.toContain(token);
    expect(log).not.toContain(leakProbe.sub);
    expect(log).not.toContain(leakProbe.email);
  });

  it('JWKS 장애 시 reason만 담은 warn 1건을 남기고 토큰은 남기지 않는다', async () => {
    const supabaseUrl = await startJwksServer('error');
    const { logLines, server } = buildLoggedServer(supabaseUrl);
    const token = await signToken(supabaseUrl, { claims: leakProbe });

    const response = await server.inject({
      headers: { authorization: `Bearer ${token}` },
      method: 'GET',
      url: '/v1/auth-check',
    });
    const warnings = logLines.map((line) => JSON.parse(line)).filter((entry) => entry.level === 40);

    expect(response.statusCode).toBe(503);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].reason).toBe('ERR_JOSE_GENERIC');
    expect(logLines.join('')).not.toContain(token);
  });
});
