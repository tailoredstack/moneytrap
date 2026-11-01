import type { HoldActor, PayoutHoldStore } from "@moneytrap/app/src/ports/payout-hold-store";
import type { CurrencyCode, PayoutHold } from "@moneytrap/domain";

/** In-memory reference adapter for the payout hold store. Holds are never edited; release sets releasedAt once. */
export class FakePayoutHoldStore implements PayoutHoldStore {
  readonly holds: PayoutHold[] = [];
  readonly audit: { action: string; entityId: string; actor: HoldActor }[] = [];

  async place({
    hold,
    actor,
  }: {
    hold: PayoutHold;
    actor: HoldActor;
    organizationId: string;
    auditId: string;
    occurredAt: Date;
  }) {
    this.holds.push({ ...hold });
    this.audit.push({ action: "payout_hold_placed", entityId: hold.id, actor });
  }

  async release({
    id,
    actor,
    releasedAt,
  }: {
    id: string;
    actor: HoldActor;
    releasedAt: Date;
    organizationId: string;
    auditId: string;
  }) {
    const hold = this.holds.find((existing) => existing.id === id);
    if (!hold || hold.releasedAt !== null) return false;
    hold.releasedAt = releasedAt;
    this.audit.push({ action: "payout_hold_released", entityId: id, actor });
    return true;
  }

  async listForPublisher(publisherId: string, currency: CurrencyCode): Promise<PayoutHold[]> {
    return this.holds
      .filter((hold) => hold.publisherId === publisherId && hold.currency === currency)
      .map((hold) => ({ ...hold }));
  }
}
