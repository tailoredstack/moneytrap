// DNS challenge rules for website verification (UC07, DM-012). Pure: the caller supplies the times.
import type { PropertyStatus } from "./property";

// Statuses that prove ownership already happened. A recheck in any of these returns verified and changes nothing.
export const POST_VERIFICATION_STATUSES: readonly PropertyStatus[] = [
  "verified",
  "review_pending",
  "approved",
  "rejected",
  "suspended",
];

// A challenge is good for one day. After that the publisher must request a new one.
export const CHALLENGE_TTL_MS = 24 * 60 * 60 * 1000;

// The TXT value is `moneytrap-verification=<token>`. The prefix is stable so records can be found and parsed.
export const VERIFICATION_TXT_PREFIX = "moneytrap-verification=";

export function challengeExpiresAt(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + CHALLENGE_TTL_MS);
}

// The expiry instant itself counts as expired, so a challenge is never valid for zero time.
export function isChallengeExpired(expiresAt: Date, now: Date): boolean {
  return now.getTime() >= expiresAt.getTime();
}

// The TXT record lives under a verification label on the property's host.
export function verificationRecordName(host: string): string {
  return `_moneytrap-verification.${host}`;
}
