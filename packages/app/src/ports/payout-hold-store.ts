import type { CurrencyCode, PayoutHold } from "@moneytrap/domain";

export interface HoldActor {
  type: string;
  id: string;
}

// Holds are added and released, never edited or deleted (DM-045). Release sets releasedAt once; a second release, or a
// release of an unknown hold, changes nothing and returns false.
export interface PayoutHoldStore {
  place(input: {
    hold: PayoutHold;
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
  listForPublisher(publisherId: string, currency: CurrencyCode): Promise<PayoutHold[]>;
}
