import { describe, expect, test } from "bun:test";
import { checkAdjustment, checkTransition } from "./conversion";

describe("checkTransition", () => {
  test("TP-W6-018 a conversion's first status event must be pending", () => {
    expect(checkTransition(null, "pending")).toEqual({ ok: true, kind: "create" });
    expect(checkTransition(null, "approved")).toMatchObject({ ok: false, code: "STATE_CONFLICT" });
  });

  test("TP-W6-018 pending moves to approved or declined", () => {
    expect(checkTransition("pending", "approved")).toEqual({ ok: true, kind: "move" });
    expect(checkTransition("pending", "declined")).toEqual({ ok: true, kind: "move" });
  });

  test("TP-W6-018 approved can be reversed and nothing else", () => {
    expect(checkTransition("approved", "reversed")).toEqual({ ok: true, kind: "move" });
    expect(checkTransition("approved", "declined")).toMatchObject({ ok: false, code: "STATE_CONFLICT" });
    expect(checkTransition("approved", "pending")).toMatchObject({ ok: false, code: "STATE_CONFLICT" });
  });

  test("TP-W6-018 declined and reversed are terminal", () => {
    expect(checkTransition("declined", "approved")).toMatchObject({ ok: false, code: "STATE_CONFLICT" });
    expect(checkTransition("reversed", "approved")).toMatchObject({ ok: false, code: "STATE_CONFLICT" });
    expect(checkTransition("reversed", "pending")).toMatchObject({ ok: false, code: "STATE_CONFLICT" });
  });

  test("a report that repeats the current state is unchanged, not an illegal move", () => {
    expect(checkTransition("approved", "approved")).toEqual({ ok: true, kind: "unchanged" });
    expect(checkTransition("declined", "declined")).toEqual({ ok: true, kind: "unchanged" });
  });

  test("an unknown target state is rejected", () => {
    expect(checkTransition("pending", "paid" as never)).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
  });
});

describe("checkAdjustment", () => {
  const base = {
    externalAdjustmentId: "adj-1",
    deltaMinor: -250n,
    currency: "USD" as const,
    reason: null,
    reportedAt: new Date("2026-10-01T00:00:00Z"),
  };

  test("TP-W6-017 a downward adjustment in the conversion's currency is accepted", () => {
    expect(checkAdjustment("USD", base)).toEqual({ ok: true });
  });

  test("TP-W6-017 a zero delta is not an adjustment", () => {
    expect(checkAdjustment("USD", { ...base, deltaMinor: 0n })).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
  });

  test("TP-W6-017 an adjustment in another currency is rejected", () => {
    expect(checkAdjustment("EUR", base)).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
  });

  test("TP-W6-017 an adjustment needs the network's own id", () => {
    expect(checkAdjustment("USD", { ...base, externalAdjustmentId: " " })).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
    });
  });
});
