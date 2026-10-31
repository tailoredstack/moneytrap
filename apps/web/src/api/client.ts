import { type ErrorCode, ErrorEnvelopeSchema } from "@moneytrap/contracts";
import type { Static, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

// A failed request. `code` is the contract error code; clients branch on it, not on the HTTP status.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | "INTERNAL",
    readonly correlationId: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// Calls the API under /api with the Better Auth cookie session. Responses are checked against the
// contracts schema before they reach screens, so a drifted server fails here rather than in the UI.
export async function apiRequest<T extends TSchema>(
  schema: T,
  path: string,
  init: RequestInit = {},
): Promise<Static<T>> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: "include",
    headers: {
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    if (Value.Check(ErrorEnvelopeSchema, body)) {
      throw new ApiError(response.status, body.error.code, body.error.correlation_id, body.error.message);
    }
    throw new ApiError(response.status, "INTERNAL", "", `request failed with status ${response.status}`);
  }
  if (!Value.Check(schema, body)) throw new Error(`response from ${path} did not match its contract`);
  return body;
}
