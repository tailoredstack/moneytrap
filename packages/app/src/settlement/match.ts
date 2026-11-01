import { type AllocationPlan, allocateReceipt, type Id } from "@moneytrap/domain";
import type { SettlementCandidateSource } from "../ports/settlement-candidate-source";
import type { ReceiptRecord } from "../ports/settlement-receipt-store";

export interface ReceiptMatchResult extends AllocationPlan {
  receiptId: Id<"settlementReceipt">;
}

// Matches one stored receipt to the approved conversions on its network (DM-042, WP-7.2). The result says what the receipt
// clears and what becomes an exception (DM-043). Nothing is written here: the caller records the plan, so a plan that fails to
// save clears nothing.
export async function matchReceipt(
  source: SettlementCandidateSource,
  receipt: ReceiptRecord,
): Promise<ReceiptMatchResult> {
  const candidates = await source.listEligibleConversions(receipt.networkId);
  const plan = allocateReceipt({ grossMinor: receipt.grossMinor, currency: receipt.currency }, candidates);
  return { receiptId: receipt.id, ...plan };
}
