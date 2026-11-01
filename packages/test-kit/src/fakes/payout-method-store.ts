import type {
  PayoutMethodAudit,
  PayoutMethodDisableOutcome,
  PayoutMethodInsertOutcome,
  PayoutMethodRecord,
  PayoutMethodStore,
  PayoutMethodWrite,
} from "@moneytrap/app/src/ports/payout-method-store";
import type { Id } from "@moneytrap/domain";

/** In-memory reference adapter for the payout method store. It enforces the same publisher scoping and uniqueness as the pg adapter. */
export class FakePayoutMethodStore implements PayoutMethodStore {
  // Publisher ID to the organization that owns it, the same tenant check the pg adapter makes.
  readonly publishers = new Map<string, string>();
  readonly methods: { organizationId: Id<"organization">; record: PayoutMethodRecord }[] = [];
  readonly audits: PayoutMethodAudit[] = [];

  async insert(write: PayoutMethodWrite): Promise<PayoutMethodInsertOutcome> {
    if (this.publishers.get(write.record.publisherId) !== write.organizationId) return "unknown_publisher";
    const taken = this.methods.some(
      ({ record }) =>
        record.provider === write.record.provider && record.providerAccountRef === write.record.providerAccountRef,
    );
    if (taken) return "duplicate";
    this.methods.push({ organizationId: write.organizationId, record: { ...write.record } });
    this.audits.push({ ...write.audit });
    return "created";
  }

  async listForOrganization(organizationId: Id<"organization">): Promise<PayoutMethodRecord[]> {
    return this.methods
      .filter((method) => method.organizationId === organizationId)
      .map(({ record }) => ({ ...record }));
  }

  async disable(input: {
    organizationId: Id<"organization">;
    id: Id<"payoutMethod">;
    at: Date;
    audit: PayoutMethodAudit;
  }): Promise<PayoutMethodDisableOutcome> {
    const method = this.methods.find(
      (candidate) => candidate.record.id === input.id && candidate.organizationId === input.organizationId,
    );
    if (!method) return "not_found";
    if (method.record.state === "disabled") return "already_disabled";
    method.record = { ...method.record, state: "disabled", updatedAt: input.at };
    this.audits.push({ ...input.audit });
    return "disabled";
  }
}
