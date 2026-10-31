import { describe, expect, test } from "bun:test";
import { safeReturnTo } from "./return-to";

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
