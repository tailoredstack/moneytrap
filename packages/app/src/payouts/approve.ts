import { type ApprovalRefusal, decideApproval, type Principal, parseId, type Scope } from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import { publisherBalances } from "../finance/balances";
import type { PayoutBatchStore, PublisherAvailability } from "../ports/payout-batch-store";
import type { PublisherBalanceSource } from "../ports/publisher-balance-source";
import { authorize, type Failure, type PayoutBatchView, toBatchView } from "./batch";

export type ApproveBatchResult = { ok: true; value: { batch: PayoutBatchView } } | Failure;

export interface ApproveBatchDeps {
  batches: PayoutBatchStore;
  balances: PublisherBalanceSource;
}

const REFUSALS: Record<ApprovalRefusal, Failure> = {
  self_approval: { ok: false, code: "FORBIDDEN", reason: "the person who prepared a batch cannot approve it" },
  cancelled: { ok: false, code: "STATE_CONFLICT", reason: "a cancelled batch cannot be approved" },
  already_approved: { ok: false, code: "ALREADY_PROCESSED", reason: "the batch is already approved" },
};

// Approves a prepared batch (DM-047, spec §4.1, TP-W7-016 to TP-W7-018). The caller needs payouts:write, the same grant that
// prepares a batch, and must be a different person from the one who prepared it: maker-checker is decided by identity, not by
// role, so a finance user cannot approve their own batch. The store applies the same rule to the stored preparer under the
// batch row lock, so it holds when two requests race, and writes the one audit row that records both people.
//
// The balance read here is a snapshot, like the one at preparation. The store checks it against what is held for each
// publisher under the lock, so a reversal since preparation stops the approval instead of paying out money that is gone
// (TP-W7-014). The approval then holds the funds exactly as the reservation did; dispatch is WP-7.9.
// Known gap: the balance is read before the lock, so a reversal that commits in between is not seen. No money moves at
// approval, and preparation has the same window. Reading available inside the transaction needs a Postgres balance source,
// which does not exist yet; it is tracked in OZE-3285 and must land before or with dispatch (WP-7.9).
export async function approveBatch(
  ctx: Ctx,
  deps: ApproveBatchDeps,
  principal: Principal,
  scope: Scope,
  id: string,
): Promise<ApproveBatchResult> {
  const denied = authorize(ctx, principal, scope, "payouts:write");
  if (denied) return denied;
  const batchId = parseId("payoutBatch", id);
  if (batchId === null) return { ok: false, code: "RESOURCE_NOT_FOUND" };

  const batch = await deps.batches.find(scope.organizationId, batchId);
  if (batch === null) return { ok: false, code: "RESOURCE_NOT_FOUND" };

  // Balances are read only when the rule lets the approval go on. A refused one still goes to the store, which records a
  // refused self-approval in the audit log (CT-025).
  const availability: PublisherAvailability[] = [];
  if (decideApproval({ state: batch.state, preparedBy: batch.createdBy, approver: principal.userId }).approved) {
    const publisherIds = [
      ...new Set(batch.lines.filter((line) => line.state !== "cancelled").map((l) => l.publisherId)),
    ];
    for (const publisherId of publisherIds) {
      const view = await publisherBalances(ctx, deps.balances, { publisherId });
      availability.push({
        publisherId,
        availableMinor: view.balances.find((balance) => balance.currency === batch.currency)?.availableMinor ?? 0n,
      });
    }
  }

  const at = ctx.clock.now();
  const outcome = await deps.batches.approve({
    organizationId: scope.organizationId,
    batchId,
    approver: principal.userId,
    at,
    availability,
    audit: { id: ctx.ids.next("audit"), actor: { type: "user", id: principal.userId }, occurredAt: at },
  });

  switch (outcome.outcome) {
    case "not_found":
      return { ok: false, code: "RESOURCE_NOT_FOUND" };
    case "refused":
      return REFUSALS[outcome.reason];
    case "insufficient_funds":
      return {
        ok: false,
        code: "STATE_CONFLICT",
        reason: `available balance no longer covers the batch for ${outcome.publisherIds.length} publisher(s); cancel it and prepare a new one`,
      };
    case "approved":
      return { ok: true, value: { batch: toBatchView(outcome.batch) } };
  }
}
