import { describe, expect, test } from "bun:test";
import { ERROR_CODES } from "@moneytrap/domain";
import { ERROR_HTTP_STATUS, errorResponse } from "./error-map";

describe("error HTTP map", () => {
  test("every §7.1 code maps to an integer 4xx or 5xx status", () => {
    for (const code of ERROR_CODES) {
      const status = ERROR_HTTP_STATUS[code];
      expect(Number.isInteger(status)).toBe(true);
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThanOrEqual(599);
    }
  });

  test("the map has no gaps and no extra keys", () => {
    expect(Object.keys(ERROR_HTTP_STATUS).sort()).toEqual([...ERROR_CODES].sort());
  });

  test("each code maps to its pinned status", () => {
    expect(ERROR_HTTP_STATUS).toEqual({
      VALIDATION_FAILED: 400,
      UNAUTHENTICATED: 401,
      TOKEN_EXPIRED: 401,
      FORBIDDEN: 403,
      CONSENT_REQUIRED: 403,
      RESOURCE_NOT_FOUND: 404,
      STATE_CONFLICT: 409,
      ALREADY_PROCESSED: 409,
      SOURCE_STALE: 409,
      PROGRAM_INELIGIBLE: 422,
      RATE_LIMITED: 429,
      PAYOUT_OUTCOME_UNKNOWN: 502,
      PROVIDER_UNAVAILABLE: 503,
    });
  });

  test("unknown codes fall back to 500 with a generic body and no stack", () => {
    const { status, body } = errorResponse("NOT_A_CODE");
    expect(status).toBe(500);
    expect(body).toEqual({ error: { code: "INTERNAL" } });
    expect(JSON.stringify(body)).not.toContain("stack");
  });

  test("known codes return their status and the code string", () => {
    const { status, body } = errorResponse("RESOURCE_NOT_FOUND");
    expect(status).toBe(404);
    expect(body).toEqual({ error: { code: "RESOURCE_NOT_FOUND" } });
  });
});
