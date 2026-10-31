import { describe, expect, test } from "bun:test";
import { safeReturnTo, stepUpRedirect } from "./return-to";

describe("safeReturnTo (TP-W2-043)", () => {
  test("falls back to the overview when nothing was requested", () => {
    expect(safeReturnTo(undefined)).toBe("/overview");
  });

  test("keeps a path inside the app", () => {
    expect(safeReturnTo("/account/security")).toBe("/account/security");
  });

  test("refuses another origin, protocol-relative, and backslash forms", () => {
    expect(safeReturnTo("https://evil.example")).toBe("/overview");
    expect(safeReturnTo("//evil.example")).toBe("/overview");
    expect(safeReturnTo("/\\evil.example")).toBe("/overview");
  });
});

describe("step-up guard (TP-W2-043)", () => {
  test("a visit that came from a sign-in with a second factor stays on step-up", () => {
    expect(stepUpRedirect({ challenge: true, mode: "totp" })).toBeNull();
  });

  test("a direct visit to step-up goes to login first and returns to step-up after", () => {
    expect(stepUpRedirect({ challenge: false, mode: "totp" })).toBe("/login?returnTo=%2Fstep-up%3Fmode%3Dtotp");
    expect(stepUpRedirect({ challenge: false, mode: "recovery" })).toBe("/login?returnTo=%2Fstep-up%3Fmode%3Drecovery");
  });

  test("step-up is never a sign-in return target, since it needs a pending challenge", () => {
    expect(safeReturnTo("/step-up?mode=totp")).toBe("/overview");
  });
});
