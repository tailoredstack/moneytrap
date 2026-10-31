import { describe, expect, test } from "bun:test";
import { Value } from "@sinclair/typebox/value";
import { ERROR_CODES, ErrorEnvelopeSchema } from "./error";

describe("error envelope", () => {
  test("accepts every documented §7.1 error category", () => {
    for (const code of ERROR_CODES) {
      const body = { error: { code, message: "something went wrong", correlation_id: "req_1" } };
      expect(Value.Check(ErrorEnvelopeSchema, body)).toBe(true);
    }
  });

  test("rejects a code outside the documented list", () => {
    const body = { error: { code: "SOMETHING_ELSE", message: "nope", correlation_id: "req_1" } };
    expect(Value.Check(ErrorEnvelopeSchema, body)).toBe(false);
  });

  test("requires a message", () => {
    const body = { error: { code: "VALIDATION_FAILED", correlation_id: "req_1" } };
    expect(Value.Check(ErrorEnvelopeSchema, body)).toBe(false);
  });
});
