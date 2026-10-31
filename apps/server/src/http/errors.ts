import { Elysia, NotFound, ParseError, ValidationError } from "elysia";
import { errorResponse } from "./error-map";
import { requestIdOf } from "./request-id";

// Every failure leaves as the §7.1 envelope, with the request ID as correlation_id. Elysia's own
// errors map to the closest §7.1 category. Anything else is INTERNAL and leaks no detail.
export const errorHandler = new Elysia({ name: "error-handler" }).onError("global", ({ error, request, set }) => {
  const id = requestIdOf(request);
  const mapped = mapError(error);
  if (mapped === "INTERNAL") console.error(`request ${id} failed`, error);
  const { status, body } = errorResponse(mapped, id, MESSAGES[mapped]);
  set.status = status;
  return body;
});

type Mapped = "RESOURCE_NOT_FOUND" | "VALIDATION_FAILED" | "INTERNAL";

const MESSAGES: Record<Mapped, string> = {
  RESOURCE_NOT_FOUND: "Resource not found",
  VALIDATION_FAILED: "Request is invalid",
  INTERNAL: "Internal server error",
};

function mapError(error: unknown): Mapped {
  if (error instanceof NotFound) return "RESOURCE_NOT_FOUND";
  if (error instanceof ParseError) return "VALIDATION_FAILED";
  // Response validation (status 500) means the server returned a bad shape, which is our bug, not the caller's.
  if (error instanceof ValidationError && error.status !== 500) return "VALIDATION_FAILED";
  return "INTERNAL";
}
