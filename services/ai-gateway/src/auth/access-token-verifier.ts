export type UserContext = {
  id: string;
};

export type AccessTokenVerifier = {
  verify(token: string): Promise<UserContext>;
};

// 토큰 자체가 신뢰할 수 없을 때. 클라이언트 책임이므로 401로 응답한다.
export class InvalidAccessTokenError extends Error {
  constructor() {
    super('invalid access token');
    this.name = 'InvalidAccessTokenError';
  }
}

// 토큰을 판정할 수 없을 때(JWKS 조회 실패 등). 서버 책임이므로 503으로 응답한다.
// reason에는 오류 코드만 담고 토큰·claim 값은 담지 않는다.
export class VerifierUnavailableError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super('access token verifier unavailable');
    this.name = 'VerifierUnavailableError';
    this.reason = reason;
  }
}
