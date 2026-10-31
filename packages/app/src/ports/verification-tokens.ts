// Source of challenge tokens. Randomness lives here, not in app or domain code. Only the digest is stored (DM-012 challenge_hash).
export interface VerificationTokens {
  issue(): string;
  digest(token: string): string;
}
