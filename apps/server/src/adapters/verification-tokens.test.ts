import { describe, expect, test } from "bun:test";
import { createVerificationTokens } from "./verification-tokens";

describe("TP-W3-009 verification tokens", () => {
  test("issues unguessable, distinct tokens", () => {
    const tokens = createVerificationTokens();
    const first = tokens.issue();
    const second = tokens.issue();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).not.toBe(second);
  });

  test("digests are stable, hex, and differ from the token", () => {
    const tokens = createVerificationTokens();
    expect(tokens.digest("abc")).toBe(tokens.digest("abc"));
    expect(tokens.digest("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(tokens.digest("abc")).not.toBe("abc");
  });
});
