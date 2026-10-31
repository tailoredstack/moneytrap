import { type Static, Type } from "@sinclair/typebox";

// §7.1 error categories. Clients branch on these codes; they never infer meaning from the HTTP status alone.
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

export const ErrorEnvelopeSchema = Type.Object(
  {
    error: Type.Object({
      code: Type.Union([...ERROR_CODES.map((code) => Type.Literal(code)), Type.Literal("INTERNAL")]),
      message: Type.String({ minLength: 1 }),
      correlation_id: Type.String({ minLength: 1 }),
    }),
  },
  { $id: "ErrorEnvelope" },
);

export type ErrorEnvelope = Static<typeof ErrorEnvelopeSchema>;
