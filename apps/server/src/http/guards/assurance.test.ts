import { describe, expect, test } from "bun:test";
import { requireRecentSecondFactor } from "./assurance";

const NOW = new Date("2026-10-31T12:00:00Z");
const WINDOW = 900;
const secondsAgo = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

describe("requireRecentSecondFactor (Blueprint §7, TP-W2-016)", () => {
  test("allows a session whose second factor is inside the window", () => {
    expect(requireRecentSecondFactor({ secondFactorAt: secondsAgo(60), now: NOW, windowSeconds: WINDOW })).toEqual({
      ok: true,
    });
  });

  test("allows a second factor exactly at the window edge", () => {
    expect(requireRecentSecondFactor({ secondFactorAt: secondsAgo(WINDOW), now: NOW, windowSeconds: WINDOW })).toEqual({
      ok: true,
    });
  });

  test("returns STEP_UP_REQUIRED when the second factor is older than the window", () => {
    expect(
      requireRecentSecondFactor({ secondFactorAt: secondsAgo(WINDOW + 1), now: NOW, windowSeconds: WINDOW }),
    ).toEqual({ ok: false, code: "STEP_UP_REQUIRED" });
  });

  test("returns STEP_UP_REQUIRED when no second factor is recorded", () => {
    expect(requireRecentSecondFactor({ secondFactorAt: null, now: NOW, windowSeconds: WINDOW })).toEqual({
      ok: false,
      code: "STEP_UP_REQUIRED",
    });
  });

  test("fails closed when the second factor timestamp is an invalid date", () => {
    expect(requireRecentSecondFactor({ secondFactorAt: new Date("invalid"), now: NOW, windowSeconds: WINDOW })).toEqual(
      { ok: false, code: "STEP_UP_REQUIRED" },
    );
  });

  test("fails closed when now is an invalid date", () => {
    expect(
      requireRecentSecondFactor({ secondFactorAt: secondsAgo(60), now: new Date("invalid"), windowSeconds: WINDOW }),
    ).toEqual({ ok: false, code: "STEP_UP_REQUIRED" });
  });

  test("fails closed when the window is not a positive finite number", () => {
    for (const windowSeconds of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(requireRecentSecondFactor({ secondFactorAt: secondsAgo(1), now: NOW, windowSeconds })).toEqual({
        ok: false,
        code: "STEP_UP_REQUIRED",
      });
    }
  });

  test("treats a second factor timestamp in the future as untrusted", () => {
    const future = new Date(NOW.getTime() + 5_000);
    expect(requireRecentSecondFactor({ secondFactorAt: future, now: NOW, windowSeconds: WINDOW })).toEqual({
      ok: false,
      code: "STEP_UP_REQUIRED",
    });
  });
});
