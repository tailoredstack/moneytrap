import type { HoldActor, PayoutHoldStore } from "@moneytrap/app/src/ports/payout-hold-store";
import type { CurrencyCode, PayoutHold } from "@moneytrap/domain";

// Same tolerance as the Postgres adapter (WRITE_CLOCK_TOLERANCE_MS).
const WRITE_CLOCK_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * In-memory reference adapter for the payout hold store. Like the Postgres adapter, it refuses a hold on a publisher of
 * another organization and reads only within the caller's organization. Tests seed `publisherOrganization` to set ownership.
 */
export class FakePayoutHoldStore implements PayoutHoldStore {
  // The write clock bounds caller times the way the adapter bounds them against the database clock.
  constructor(private readonly writeClock: () => Date = () => new Date()) {}

  readonly holds: PayoutHold[] = [];
  readonly publisherOrganization = new Map<string, string>();
  readonly audit: { action: string; entityId: string; actor: HoldActor }[] = [];
  private readonly holdOrganization = new Map<string, string>();

  async place({
    hold,
    organizationId,
    actor,
    occurredAt,
  }: {
    hold: Omit<PayoutHold, "placedAt" | "releasedAt">;
    organizationId: string;
    actor: HoldActor;
    auditId: string;
    occurredAt: Date;
  }) {
    if (this.publisherOrganization.get(hold.publisherId) !== organizationId) {
      throw new Error("payout: publisher is not in the organization");
    }
    // The same rules the table enforces: a hold moves a positive amount and states a reason.
    if (hold.amountMinor <= 0n) throw new Error("payout_holds: amount must be positive");
    if (hold.reason.trim().length === 0) throw new Error("payout_holds: reason is required");
    if (occurredAt.getTime() < this.writeClock().getTime() - WRITE_CLOCK_TOLERANCE_MS) {
      throw new Error("payout_holds: timestamp is earlier than the write clock");
    }
    // The same rules the table enforces: a hold id is unique, and an expiry falls after placement.
    if (this.holds.some((existing) => existing.id === hold.id)) throw new Error("payout_holds: duplicate hold id");
    if (hold.expiresAt !== null && hold.expiresAt.getTime() <= occurredAt.getTime()) {
      throw new Error("payout_holds_expiry_ck: expiry must follow placement");
    }
    this.holds.push({ ...hold, placedAt: occurredAt, releasedAt: null });
    this.holdOrganization.set(hold.id, organizationId);
    this.audit.push({ action: "payout_hold_placed", entityId: hold.id, actor });
  }

  async release({
    id,
    organizationId,
    actor,
    releasedAt,
  }: {
    id: string;
    organizationId: string;
    actor: HoldActor;
    releasedAt: Date;
    auditId: string;
  }) {
    const hold = this.holds.find((existing) => existing.id === id);
    if (!hold || hold.releasedAt !== null || this.holdOrganization.get(id) !== organizationId) return false;
    if (releasedAt.getTime() < this.writeClock().getTime() - WRITE_CLOCK_TOLERANCE_MS) {
      throw new Error("payout_holds: timestamp is earlier than the write clock");
    }
    if (releasedAt.getTime() < hold.placedAt.getTime()) throw new Error("payout_holds: release precedes placement");
    hold.releasedAt = releasedAt;
    this.audit.push({ action: "payout_hold_released", entityId: id, actor });
    return true;
  }

  async listForPublisher(organizationId: string, publisherId: string, currency: CurrencyCode): Promise<PayoutHold[]> {
    return this.holds
      .filter(
        (hold) =>
          hold.publisherId === publisherId &&
          hold.currency === currency &&
          this.holdOrganization.get(hold.id) === organizationId,
      )
      .map((hold) => ({ ...hold }));
  }
}
