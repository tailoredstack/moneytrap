import type { Id } from "../ids/ids";
import type { CurrencyCode } from "../money/iso4217";

// One conversion that a receipt may clear: approved, and not yet fully allocated. outstandingMinor is what is still open
// on it, in bigint minor units of its own currency.
export interface AllocationCandidate {
  conversionId: Id<"conversion">;
  currency: CurrencyCode;
  outstandingMinor: bigint;
  occurredAt: Date;
}

export interface ReceiptForAllocation {
  grossMinor: bigint;
  currency: CurrencyCode;
}

export interface Allocation {
  conversionId: Id<"conversion">;
  allocatedMinor: bigint;
  currency: CurrencyCode;
}

// partial_conversion: the receipt covered part of one conversion, so the rest of it is open (DM-043, CT-021).
// unallocated_receipt: receipt value that no eligible conversion in its currency could take.
export type ReconciliationException =
  | { kind: "partial_conversion"; conversionId: Id<"conversion">; deltaMinor: bigint }
  | { kind: "unallocated_receipt"; deltaMinor: bigint };

export interface AllocationPlan {
  allocations: Allocation[];
  exceptions: ReconciliationException[];
}

// Spreads one receipt over the eligible conversions in its currency, oldest first (ties go to the smaller conversion ID), so
// the result never depends on the order the candidates arrive in. A conversion the receipt covers exactly is cleared with no
// exception. Only a conversion it covers partly is an exception, for its remainder. Conversions the receipt never reaches stay
// pending, and they are not exceptions. Value left after every candidate is an unallocated exception. The sums use bigint,
// so the allocated total plus the unallocated exception always equals the receipt gross.
export function allocateReceipt(
  receipt: ReceiptForAllocation,
  candidates: readonly AllocationCandidate[],
): AllocationPlan {
  const ordered = candidates
    .filter((candidate) => candidate.currency === receipt.currency && candidate.outstandingMinor > 0n)
    .sort(byAge);

  const allocations: Allocation[] = [];
  const exceptions: ReconciliationException[] = [];
  let remaining = receipt.grossMinor;
  for (const candidate of ordered) {
    if (remaining === 0n) break;

    // Math.min takes numbers, so bigint amounts are compared directly.
    let take = candidate.outstandingMinor;
    if (remaining < take) take = remaining;
    allocations.push({ conversionId: candidate.conversionId, allocatedMinor: take, currency: receipt.currency });
    remaining -= take;

    const open = candidate.outstandingMinor - take;
    if (open > 0n) {
      exceptions.push({ kind: "partial_conversion", conversionId: candidate.conversionId, deltaMinor: open });
    }
  }

  if (remaining > 0n) {
    exceptions.push({ kind: "unallocated_receipt", deltaMinor: remaining });
  }
  return { allocations, exceptions };
}

function byAge(a: AllocationCandidate, b: AllocationCandidate): number {
  const aAt = a.occurredAt.getTime();
  const bAt = b.occurredAt.getTime();
  if (aAt !== bAt) return aAt - bAt;
  return a.conversionId < b.conversionId ? -1 : a.conversionId > b.conversionId ? 1 : 0;
}
