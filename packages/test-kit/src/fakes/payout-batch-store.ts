import type {
  BatchAudit,
  BatchCandidate,
  BatchReserveOutcome,
  BatchReserveWrite,
  PayoutBatchRecord,
  PayoutBatchStore,
  SkippedLine,
} from "@moneytrap/app/src/ports/payout-batch-store";
import { type CurrencyCode, decideReservation, type Id } from "@moneytrap/domain";

interface MemoryPayout {
  id: Id<"payout">;
  batchId: Id<"payoutBatch">;
  publisherId: Id<"publisher">;
  methodId: Id<"payoutMethod">;
  currency: CurrencyCode;
  amountMinor: bigint;
  state: "reserved" | "cancelled";
}

/**
 * In-memory reference adapter for the payout batch store. It follows the Postgres adapter: one key makes one batch per
 * organization, a reservation never exceeds the available amount net of open payouts, and a cancelled payout frees its funds.
 * Each method runs without awaiting, so it is atomic in the same way the adapter's locked transaction is. Tests seed
 * `publisherOrganization` and `addMethod`; a publisher or method that is not seeded is skipped like an unavailable one.
 */
export class FakePayoutBatchStore implements PayoutBatchStore {
  readonly publisherOrganization = new Map<string, string>();
  readonly audit: { action: string; entityId: string; actor: BatchAudit["actor"] }[] = [];
  private readonly methods: { id: Id<"payoutMethod">; publisherId: Id<"publisher">; currency: CurrencyCode }[] = [];
  private readonly batches = new Map<string, Omit<PayoutBatchRecord, "lines">>();
  private readonly payouts: MemoryPayout[] = [];

  /** Seeds an active payout method for an approved publisher. */
  addMethod(method: { id: Id<"payoutMethod">; publisherId: Id<"publisher">; currency: CurrencyCode }): void {
    this.methods.push(method);
  }

  /** The sum of payouts that still hold funds for a publisher and currency. */
  committed(publisherId: string, currency: CurrencyCode): bigint {
    return this.payouts
      .filter(
        (payout) => payout.publisherId === publisherId && payout.currency === currency && payout.state !== "cancelled",
      )
      .reduce((sum, payout) => sum + payout.amountMinor, 0n);
  }

  async reserve(write: BatchReserveWrite): Promise<BatchReserveOutcome> {
    const existing = [...this.batches.values()].find(
      (batch) => batch.organizationId === write.organizationId && batch.reservationKey === write.reservationKey,
    );
    if (existing) {
      const same =
        existing.currency === write.currency &&
        existing.periodStart.getTime() === write.periodStart.getTime() &&
        existing.periodEnd.getTime() === write.periodEnd.getTime() &&
        existing.capMinor === write.capMinor;
      return same ? { outcome: "replayed", batch: this.record(existing) } : { outcome: "key_conflict" };
    }

    const skipped: SkippedLine[] = [];
    const reserved: MemoryPayout[] = [];
    let capRemaining = write.capMinor;
    for (const line of write.lines) {
      if (this.publisherOrganization.get(line.publisherId) !== write.organizationId) {
        skipped.push({ publisherId: line.publisherId, reason: "publisher_unavailable" });
        continue;
      }
      const hasMethod = this.methods.some(
        (method) =>
          method.id === line.methodId && method.publisherId === line.publisherId && method.currency === write.currency,
      );
      if (!hasMethod) {
        skipped.push({ publisherId: line.publisherId, reason: "method_unavailable" });
        continue;
      }
      const decision = decideReservation({
        requestedMinor: line.requestedMinor,
        availableMinor: line.availableMinor,
        committedMinor: this.committed(line.publisherId, write.currency) + this.sumOf(reserved, line.publisherId),
        minimumMinor: line.minimumMinor,
        capRemainingMinor: capRemaining,
      });
      if (decision.skipped !== null) {
        skipped.push({ publisherId: line.publisherId, reason: decision.skipped });
        continue;
      }
      if (capRemaining !== null) capRemaining -= decision.reservedMinor;
      reserved.push({
        id: line.payoutId,
        batchId: write.batchId,
        publisherId: line.publisherId,
        methodId: line.methodId,
        currency: write.currency,
        amountMinor: decision.reservedMinor,
        state: "reserved",
      });
    }
    if (reserved.length === 0) return { outcome: "nothing_reserved", skipped };

    const { lines: _lines, audit: _audit, batchId, ...terms } = write;
    const batch = { ...terms, id: batchId, state: "prepared" as const };
    this.batches.set(batchId, batch);
    this.payouts.push(...reserved);
    this.audit.push({ action: "payout_batch.prepared", entityId: batchId, actor: write.audit.actor });
    return { outcome: "reserved", batch: this.record(batch), skipped };
  }

  async cancel(input: { organizationId: Id<"organization">; batchId: Id<"payoutBatch">; at: Date; audit: BatchAudit }) {
    const batch = this.batches.get(input.batchId);
    if (!batch || batch.organizationId !== input.organizationId) return "not_found" as const;
    if (batch.state === "cancelled") return "already_cancelled" as const;
    batch.state = "cancelled";
    for (const payout of this.payouts) if (payout.batchId === batch.id) payout.state = "cancelled";
    this.audit.push({ action: "payout_batch.cancelled", entityId: batch.id, actor: input.audit.actor });
    return "cancelled" as const;
  }

  async find(organizationId: Id<"organization">, batchId: Id<"payoutBatch">) {
    const batch = this.batches.get(batchId);
    return batch && batch.organizationId === organizationId ? this.record(batch) : null;
  }

  async listCandidates(organizationId: Id<"organization">, currency: CurrencyCode): Promise<BatchCandidate[]> {
    const byPublisher = new Map<string, BatchCandidate>();
    for (const method of this.methods) {
      if (method.currency !== currency || this.publisherOrganization.get(method.publisherId) !== organizationId)
        continue;
      if (!byPublisher.has(method.publisherId)) {
        byPublisher.set(method.publisherId, { publisherId: method.publisherId, methodId: method.id });
      }
    }
    return [...byPublisher.values()].sort((a, b) => (a.publisherId < b.publisherId ? -1 : 1));
  }

  private sumOf(payouts: readonly MemoryPayout[], publisherId: string): bigint {
    return payouts.filter((payout) => payout.publisherId === publisherId).reduce((sum, p) => sum + p.amountMinor, 0n);
  }

  private record(batch: Omit<PayoutBatchRecord, "lines">): PayoutBatchRecord {
    const lines = this.payouts
      .filter((payout) => payout.batchId === batch.id)
      .sort((a, b) => (a.publisherId < b.publisherId ? -1 : a.publisherId > b.publisherId ? 1 : 0))
      .map((payout) => ({
        id: payout.id,
        publisherId: payout.publisherId,
        methodId: payout.methodId,
        amountMinor: payout.amountMinor,
        state: payout.state,
      }));
    return { ...batch, lines };
  }
}
