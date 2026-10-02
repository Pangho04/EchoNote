export type SessionState =
  | { kind: 'signedOut'; cause: 'restore' | 'user' | 'expired' }
  | { kind: 'signedIn'; userId: string };
