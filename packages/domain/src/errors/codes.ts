// Closed set of semantic error codes from spec §7.1. Transport details (HTTP status) live in the server, not here.
export const ERROR_CODES = [
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "RESOURCE_NOT_FOUND",
  "STATE_CONFLICT",
  "ALREADY_PROCESSED",
  "TOKEN_EXPIRED",
  "RATE_LIMITED",
  "SOURCE_STALE",
  "PROVIDER_UNAVAILABLE",
  "PAYOUT_OUTCOME_UNKNOWN",
  "CONSENT_REQUIRED",
  "PROGRAM_INELIGIBLE",
  "STEP_UP_REQUIRED",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const CODE_SET: ReadonlySet<string> = new Set(ERROR_CODES);

export function isErrorCode(value: string): value is ErrorCode {
  return CODE_SET.has(value);
}
