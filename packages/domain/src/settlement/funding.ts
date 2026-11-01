import type { ErrorCode } from "../errors/codes";
import type { Id } from "../ids/ids";

// Funding lifecycle from spec §5 (Funding fact) and TP-W7-005, TP-W7-006. A conversion's funds clear only through a matched
// receipt: `approved` is a conversion status, not a funding state, so an approved conversion with no receipt stays uncleared.
export const FUNDING_STATUSES = ["expected", "reported_settled", "receipt_matched", "cleared"] as const;

export type FundingStatus = (typeof FUNDING_STATUSES)[number];

export interface FundingFact {
  readonly conversionId: Id<"conversion">;
  readonly status: FundingStatus;
  // Set once a receipt is matched. It is the evidence that the funds cleared.
  readonly receiptId?: Id<"settlementReceipt">;
}

export type FundingTransition = { ok: true; value: FundingFact } | { ok: false; code: ErrorCode };

// A new funding fact always starts expected, so nothing is cleared until a settlement is reported and matched.
export function expectFunding(input: { conversionId: Id<"conversion"> }): FundingFact {
  return { conversionId: input.conversionId, status: "expected" };
}

export function reportSettled(fact: FundingFact): FundingTransition {
  return move(fact, "expected", "reported_settled");
}

// Matching a receipt records which receipt is the evidence. The receipt must already be allocated to the conversion (WP-7.2).
export function matchReceipt(fact: FundingFact, receiptId: Id<"settlementReceipt">): FundingTransition {
  if (fact.status !== "reported_settled") return { ok: false, code: "STATE_CONFLICT" };
  return { ok: true, value: { ...fact, status: "receipt_matched", receiptId } };
}

// Clearing needs a matched receipt. A fact that was never matched cannot clear, however its conversion is approved.
export function clearFunding(fact: FundingFact): FundingTransition {
  return move(fact, "receipt_matched", "cleared");
}

export function isCleared(fact: FundingFact): boolean {
  return fact.status === "cleared";
}

// Every transition returns a new value. An illegal move is a STATE_CONFLICT and leaves the input untouched.
function move(fact: FundingFact, from: FundingStatus, to: FundingStatus): FundingTransition {
  if (fact.status !== from) return { ok: false, code: "STATE_CONFLICT" };
  return { ok: true, value: { ...fact, status: to } };
}
