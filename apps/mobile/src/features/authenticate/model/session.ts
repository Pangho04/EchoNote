export type SessionState = { kind: 'signedOut' } | { kind: 'signedIn'; userId: string };
