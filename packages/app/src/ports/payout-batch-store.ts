import type { CurrencyCode, Id, ReservationSkip } from "@moneytrap/domain";

// A batch prepares payouts for many publishers in one currency. Each payout row in state `reserved` holds its amount
// against the publisher's available balance until the batch is cancelled (DM-047, DM-048, CT-022).
export type PayoutBatchState = "prepared" | "cancelled";
export type PayoutState = "reserved" | "cancelled";

export interface PayoutRecord {
  id: Id<"payout">;
  publisherId: Id<"publisher">;
  methodId: Id<"payoutMethod">;
  amountMinor: bigint;
  state: PayoutState;
}

export interface PayoutBatchRecord {
  id: Id<"payoutBatch">;
  organizationId: Id<"organization">;
  reservationKey: string;
  currency: CurrencyCode;
  periodStart: Date;
  periodEnd: Date;
  state: PayoutBatchState;
  // The most the batch may reserve in total, or null when it has no cap.
  capMinor: bigint | null;
  policyVersion: number;
  createdBy: Id<"user">;
  createdAt: Date;
  lines: PayoutRecord[];
}

// A publisher with an active payout method in the batch currency. The app decides, from balance, holds, and policy, how
// much of it each one may be paid.
export interface BatchCandidate {
  publisherId: Id<"publisher">;
  methodId: Id<"payoutMethod">;
}

export interface ReserveLine {
  payoutId: Id<"payout">;
  publisherId: Id<"publisher">;
  methodId: Id<"payoutMethod">;
  // What the policy lets the publisher be paid now, and the balance it was taken from. The adapter subtracts what open
  // payouts already hold, under the publisher lock, before it reserves.
  requestedMinor: bigint;
  availableMinor: bigint;
  minimumMinor: bigint;
}

export interface BatchAudit {
  id: Id<"audit">;
  actor: { type: "user"; id: Id<"user"> };
  occurredAt: Date;
}

export interface BatchReserveWrite {
  organizationId: Id<"organization">;
  batchId: Id<"payoutBatch">;
  reservationKey: string;
  currency: CurrencyCode;
  periodStart: Date;
  periodEnd: Date;
  capMinor: bigint | null;
  policyVersion: number;
  createdBy: Id<"user">;
  createdAt: Date;
  // In the order the cap is spent. The adapter locks the publishers in id order whatever this order is.
  lines: ReserveLine[];
  audit: BatchAudit;
}

export type BatchSkipReason = ReservationSkip | "publisher_unavailable" | "method_unavailable";

export interface SkippedLine {
  publisherId: Id<"publisher">;
  reason: BatchSkipReason;
}

// `reserved`: the batch, its payouts, and its audit row committed together, and `skipped` names the lines that reserved
// nothing. `replayed`: the key already made a batch with the same terms, which is returned as it is and nothing is written.
// `key_conflict`: the key was used for a different currency, period, or cap. `key_cancelled`: the key made a batch that has
// since been cancelled, so it reserves nothing and a new key is needed. `nothing_reserved`: no line reserved
// anything, so no batch was written and the key is still free.
export type BatchReserveOutcome =
  | { outcome: "reserved"; batch: PayoutBatchRecord; skipped: SkippedLine[] }
  | { outcome: "replayed"; batch: PayoutBatchRecord }
  | { outcome: "key_conflict" }
  | { outcome: "key_cancelled" }
  | { outcome: "nothing_reserved"; skipped: SkippedLine[] };

// `cancelled`: the batch and every payout in it were cancelled and audited, which frees the funds they held.
export type BatchCancelOutcome = "cancelled" | "already_cancelled" | "not_found";

export interface PayoutBatchStore {
  // The adapter takes a row lock on each publisher, in id order, then sums the payouts that still hold funds and reserves
  // no more than is left. Concurrent batches over the same funds therefore reserve at most the available amount in total.
  reserve(write: BatchReserveWrite): Promise<BatchReserveOutcome>;
  cancel(input: {
    organizationId: Id<"organization">;
    batchId: Id<"payoutBatch">;
    at: Date;
    audit: BatchAudit;
  }): Promise<BatchCancelOutcome>;
  // Reads are scoped to the organization, so another tenant's batch is never returned.
  find(organizationId: Id<"organization">, batchId: Id<"payoutBatch">): Promise<PayoutBatchRecord | null>;
  // Approved publishers of the organization with an active method in the currency, ordered by publisher id.
  listCandidates(organizationId: Id<"organization">, currency: CurrencyCode): Promise<BatchCandidate[]>;
}
