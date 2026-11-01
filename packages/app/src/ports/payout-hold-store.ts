import type { CurrencyCode, PayoutHold } from "@moneytrap/domain";

export interface HoldActor {
  type: string;
  id: string;
}

// Holds are added and released, never edited or deleted (DM-045). Release sets releasedAt once; a second release, or a
// release of an unknown hold, changes nothing and returns false. The write-clock window is checked first, so a release
// time outside the window throws even for an unknown hold.
export interface PayoutHoldStore {
  place(input: {
    // placedAt is the occurredAt of the write, so the stored hold always carries its placement time.
    // A hold is always placed unreleased. Only release sets releasedAt, so every release has its own audit row.
    hold: Omit<PayoutHold, "placedAt" | "releasedAt">;
    organizationId: string;
    auditId: string;
    actor: HoldActor;
    occurredAt: Date;
  }): Promise<void>;
  release(input: {
    id: string;
    organizationId: string;
    auditId: string;
    actor: HoldActor;
    releasedAt: Date;
  }): Promise<boolean>;
  // Reads are scoped to the organization, like writes, so another tenant's holds are never returned.
  listForPublisher(organizationId: string, publisherId: string, currency: CurrencyCode): Promise<PayoutHold[]>;
}
