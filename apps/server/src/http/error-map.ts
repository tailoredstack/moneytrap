import type { ErrorEnvelope } from "@moneytrap/contracts";
import { type ErrorCode, isErrorCode } from "@moneytrap/domain";

// One HTTP status per §7.1 code. Typed as a full Record so adding a code without a status fails the typecheck.
export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  TOKEN_EXPIRED: 401,
  FORBIDDEN: 403,
  STEP_UP_REQUIRED: 403,
  CONSENT_REQUIRED: 403,
  RESOURCE_NOT_FOUND: 404,
  STATE_CONFLICT: 409,
  ALREADY_PROCESSED: 409,
  SOURCE_STALE: 409,
  PROGRAM_INELIGIBLE: 422,
  RATE_LIMITED: 429,
  PROVIDER_UNAVAILABLE: 503,
  PAYOUT_OUTCOME_UNKNOWN: 502,
};

// Unknown codes never leak their name or a stack trace; they surface as a generic 500 with the
// `INTERNAL` code, which is deliberately outside the closed §7.1 set.
export function errorResponse(
  code: string,
  correlationId: string,
  message: string,
): { status: number; body: ErrorEnvelope } {
  if (!isErrorCode(code)) {
    return {
      status: 500,
      body: { error: { code: "INTERNAL", message: "Internal server error", correlation_id: correlationId } },
    };
  }
  return {
    status: ERROR_HTTP_STATUS[code],
    body: { error: { code, message: message || "Request failed", correlation_id: correlationId } },
  };
}
