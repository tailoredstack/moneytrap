import { describe, expect, test } from "bun:test";
import type { Id } from "../ids/ids";
import { clearFunding, expectFunding, type FundingFact, isCleared, matchReceipt, reportSettled } from "./funding";

const conversion = `cnv_${"0".repeat(26)}` as Id<"conversion">;
const receipt = `str_${"0".repeat(26)}` as Id<"settlementReceipt">;

function expected(): FundingFact {
  return expectFunding({ conversionId: conversion });
}

describe("funding state machine (TP-W7-005, TP-W7-006; WP-7.3)", () => {
  test("a funding fact starts expected and is not cleared", () => {
    const fact = expected();

    expect(fact.status).toBe("expected");
    expect(isCleared(fact)).toBe(false);
  });

  test("expected → reported settled → receipt matched → cleared follows the full path (TP-W7-006)", () => {
    const reported = reportSettled(expected());
    expect(reported.ok).toBe(true);
    if (!reported.ok) return;
    expect(reported.value.status).toBe("reported_settled");

    const matched = matchReceipt(reported.value, receipt);
    expect(matched.ok).toBe(true);
    if (!matched.ok) return;
    expect(matched.value.status).toBe("receipt_matched");
    expect(matched.value.receiptId).toBe(receipt);

    const cleared = clearFunding(matched.value);
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.value.status).toBe("cleared");
    expect(isCleared(cleared.value)).toBe(true);
  });

  test("a reported-settled fact with no receipt is not cleared (TP-W7-005)", () => {
    const reported = reportSettled(expected());
    if (!reported.ok) throw new Error("reportSettled should succeed from expected");

    expect(clearFunding(reported.value)).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(isCleared(reported.value)).toBe(false);
  });

  test("an expected fact cannot skip ahead to receipt matched or cleared (TP-W7-006)", () => {
    expect(matchReceipt(expected(), receipt)).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(clearFunding(expected())).toEqual({ ok: false, code: "STATE_CONFLICT" });
  });

  test("a receipt cannot match before the settlement is reported", () => {
    const reported = reportSettled(expected());
    if (!reported.ok) throw new Error("reportSettled should succeed from expected");
    const matched = matchReceipt(reported.value, receipt);
    if (!matched.ok) throw new Error("matchReceipt should succeed from reported_settled");

    // Matching twice, or reporting again after a match, is a jump the path does not allow.
    expect(matchReceipt(matched.value, receipt)).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(reportSettled(matched.value)).toEqual({ ok: false, code: "STATE_CONFLICT" });
  });

  test("a cleared fact is terminal", () => {
    const reported = reportSettled(expected());
    if (!reported.ok) throw new Error("reportSettled should succeed from expected");
    const matched = matchReceipt(reported.value, receipt);
    if (!matched.ok) throw new Error("matchReceipt should succeed from reported_settled");
    const cleared = clearFunding(matched.value);
    if (!cleared.ok) throw new Error("clearFunding should succeed from receipt_matched");

    expect(clearFunding(cleared.value)).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(reportSettled(cleared.value)).toEqual({ ok: false, code: "STATE_CONFLICT" });
  });

  test("every transition returns a new value and leaves its input untouched", () => {
    const start = expected();
    const reported = reportSettled(start);

    expect(start.status).toBe("expected");
    if (!reported.ok) throw new Error("reportSettled should succeed from expected");
    expect(reported.value).not.toBe(start);
    expect(reported.value.status).toBe("reported_settled");
  });
});
