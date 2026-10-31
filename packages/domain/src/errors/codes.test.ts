import { describe, expect, test } from "bun:test";
import { ERROR_CODES, isErrorCode } from "./codes";

// Spec §7.1 error category examples, hand-copied. Catches edits to either this list or codes.ts, not spec changes.
const SPEC_SEC_7_1 = [
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
];

describe("error codes", () => {
  test("ERROR_CODES is exactly the spec §7.1 set with no duplicates", () => {
    const actual: string[] = [...ERROR_CODES].sort();
    expect(actual).toEqual([...SPEC_SEC_7_1].sort());
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });

  test("isErrorCode accepts every known code and rejects anything else", () => {
    for (const code of SPEC_SEC_7_1) expect(isErrorCode(code)).toBe(true);
    expect(isErrorCode("NOT_A_CODE")).toBe(false);
    expect(isErrorCode("validation_failed")).toBe(false);
    expect(isErrorCode("")).toBe(false);
  });
});
