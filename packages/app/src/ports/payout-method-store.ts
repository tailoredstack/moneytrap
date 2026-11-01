import type { CurrencyCode, Id } from "@moneytrap/domain";

// Enrollment is one step. The provider-hosted flow returns a provider account reference, and the method becomes active
// with that reference. The platform stores the reference and nothing about the account behind it (DM-046, TP-W7-007).
export type PayoutMethodState = "active" | "disabled";

export interface PayoutMethodRecord {
  id: Id<"payoutMethod">;
  publisherId: Id<"publisher">;
  provider: string;
  providerAccountRef: string;
  country: string;
  currency: CurrencyCode;
  state: PayoutMethodState;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PayoutMethodAudit {
  id: Id<"audit">;
  actor: { type: string; id: string };
  action: "payout_method.enrolled" | "payout_method.disabled";
  entityId: Id<"payoutMethod">;
  // Identifiers only. The provider account reference never reaches the audit row.
  metadata: { publisherId: string; provider: string } | Record<string, never>;
  occurredAt: Date;
}

export interface PayoutMethodWrite {
  organizationId: Id<"organization">;
  record: PayoutMethodRecord;
  audit: PayoutMethodAudit;
}

// `created` means the method and its audit row committed together. `duplicate` means the provider account reference is
// already enrolled, and `unknown_publisher` means the publisher is not in the organization. Neither writes anything.
export type PayoutMethodInsertOutcome = "created" | "duplicate" | "unknown_publisher";

// `disabled` means an active method was disabled and audited. `already_disabled` and `not_found` write nothing.
export type PayoutMethodDisableOutcome = "disabled" | "already_disabled" | "not_found";

export interface PayoutMethodStore {
  insert(write: PayoutMethodWrite): Promise<PayoutMethodInsertOutcome>;
  listForOrganization(organizationId: Id<"organization">): Promise<PayoutMethodRecord[]>;
  disable(input: {
    organizationId: Id<"organization">;
    id: Id<"payoutMethod">;
    at: Date;
    audit: PayoutMethodAudit;
  }): Promise<PayoutMethodDisableOutcome>;
}
