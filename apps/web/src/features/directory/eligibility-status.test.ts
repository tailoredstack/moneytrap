import { describe, expect, test } from "bun:test";
import { statusText } from "./eligibility-status";

// A definitive reason is a final no. It must not read as pending just because approval is also unreported.
describe("statusText", () => {
  test("an allowed decision is Eligible", () => {
    expect(statusText({ decision: "allow" })).toBe("Eligible");
  });

  test("a denial with unknown alone is Unknown, not a final no", () => {
    expect(statusText({ decision: "deny", reasons: ["unknown"] })).toBe("Unknown");
  });

  test("a denial with a definitive reason shows that reason, even when unknown is also present", () => {
    expect(statusText({ decision: "deny", reasons: ["unknown", "geography"] })).toBe(
      "Not eligible: The program does not allow your country",
    );
  });

  test("a denial with no reasons is Not eligible", () => {
    expect(statusText({ decision: "deny", reasons: [] })).toBe("Not eligible");
  });
});
