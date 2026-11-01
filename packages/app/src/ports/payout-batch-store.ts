import type { ApprovalRefusal, BatchApprovalState, CurrencyCode, Id, ReservationSkip } from "@moneytrap/domain";

// A batch prepares payouts for many publishers in one currency. Each payout row in state `reserved` holds its amount
// against the publisher's available balance until the batch is cancelled (DM-047, DM-048, CT-022). Approval by a second
// person moves the batch and its payouts to `approved`, which still holds the funds (WP-7.8).
export type PayoutBatchState = BatchApprovalState;
export type PayoutState = "reserved" | "approved" | "cancelled";

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
  // Set together, once, when the batch is approved. The approver is never the preparer (DM-047).
  approvedBy: Id<"user"> | null;
  approvedAt: Date | null;
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
// `approved`: an approved batch is past the point where a cancel frees its funds, so nothing changed.
export type BatchCancelOutcome = "cancelled" | "already_cancelled" | "approved" | "not_found";

// The cleared balance the app read for a publisher in the batch currency, so the store can check it again under the lock.
export interface PublisherAvailability {
  publisherId: Id<"publisher">;
  availableMinor: bigint;
}

export interface BatchApproveInput {
  organizationId: Id<"organization">;
  batchId: Id<"payoutBatch">;
  approver: Id<"user">;
  at: Date;
  // One entry for each publisher with a line in the batch. A publisher without one is treated as having nothing available.
  availability: PublisherAvailability[];
  // The audit actor is the approver. The row also records the preparer, so both people are in the one row.
  audit: BatchAudit;
}

// `approved`: the batch and every reserved payout moved to approved and one audit row was written, all together.
// `refused`: the maker-checker rule or the state refused it, and the batch is unchanged (see decideApproval). A refused
// known-batch refusal is audited with its reason. A missing batch has no row to audit.
// `insufficient_funds`: a publisher's available balance no longer covers what is held for it, for example after a
// reversal, so the batch cannot be approved (TP-W7-014). The batch is unchanged, and the blocked attempt is audited; cancel
// the batch and prepare a new one.
export type BatchApproveOutcome =
  | { outcome: "approved"; batch: PayoutBatchRecord }
  | { outcome: "refused"; reason: ApprovalRefusal }
  | { outcome: "insufficient_funds"; publisherIds: Id<"publisher">[] }
  | { outcome: "not_found" };

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
  // Takes the batch row lock, so approving and cancelling the same batch cannot both succeed. It applies decideApproval to the
  // stored state and preparer, then locks the batch's publishers in id order and checks that what is held for each, across all
  // open payouts, is still within the available balance the caller supplied, before it approves the payouts and writes the
  // audit row. That balance was read before the lock, so it is a snapshot (OZE-3285). Approval does not re-check the
  // publisher's status or method, which dispatch must (WP-7.9); reserve checks them because it is the step that selects them.
  approve(input: BatchApproveInput): Promise<BatchApproveOutcome>;
  // Reads are scoped to the organization, so another tenant's batch is never returned.
  find(organizationId: Id<"organization">, batchId: Id<"payoutBatch">): Promise<PayoutBatchRecord | null>;
  // Approved publishers of the organization with an active method in the currency, ordered by publisher id.
  listCandidates(organizationId: Id<"organization">, currency: CurrencyCode): Promise<BatchCandidate[]>;
}
