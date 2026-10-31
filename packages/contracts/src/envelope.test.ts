import { describe, expect, test } from "bun:test";
import { Value } from "@sinclair/typebox/value";
import { CommandResultSchema } from "./envelope";

describe("command result envelope", () => {
  test("accepts the canonical §7.1 shape", () => {
    const body = {
      operation_id: "op_example",
      status: "accepted",
      result: { resource_id: "opaque-reference" },
      correlation_id: "traceable-reference",
      as_of: "2026-01-01T00:00:00Z",
    };
    expect(Value.Check(CommandResultSchema, body)).toBe(true);
  });

  test("rejects a result missing its correlation id", () => {
    const body = { operation_id: "op_example", status: "accepted", result: {}, as_of: "2026-01-01T00:00:00Z" };
    expect(Value.Check(CommandResultSchema, body)).toBe(false);
  });
});
