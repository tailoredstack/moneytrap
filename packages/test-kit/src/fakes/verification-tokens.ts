import type { VerificationTokens } from "@moneytrap/app/src/ports/verification-tokens";

/** Deterministic tokens (`token-1`, `token-2`, ...) so tests can build the matching TXT value. */
export class FakeVerificationTokens implements VerificationTokens {
  private count = 0;

  issue(): string {
    this.count += 1;
    return `token-${this.count}`;
  }

  digest(token: string): string {
    return `digest:${token.slice("token-".length)}`;
  }
}
