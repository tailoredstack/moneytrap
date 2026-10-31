import { describe, expect, test } from "bun:test";
import { DEFAULT_STEP_UP_WINDOW_SECONDS, stepUpWindowSeconds } from "./config";

describe("step-up window policy value", () => {
  test("defaults to 15 minutes when the environment does not set it", () => {
    expect(DEFAULT_STEP_UP_WINDOW_SECONDS).toBe(900);
    expect(stepUpWindowSeconds(undefined)).toBe(900);
    expect(stepUpWindowSeconds("")).toBe(900);
  });

  test("reads a positive whole number of seconds", () => {
    expect(stepUpWindowSeconds("300")).toBe(300);
  });

  test("rejects values that are not positive whole seconds", () => {
    for (const bad of ["0", "-1", "1.5", "abc", "10m"]) {
      expect(() => stepUpWindowSeconds(bad)).toThrow(
        "STEP_UP_WINDOW_SECONDS must be a positive whole number of seconds",
      );
    }
  });
});
