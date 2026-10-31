import type {
  PropertyReviewRecord,
  PropertyReviewStore,
  PropertyTransitionAudit,
  PropertyTransitionWrite,
} from "@moneytrap/app/src/ports/property-review-store";
import type { Id } from "@moneytrap/domain";

/** In-memory reference adapter for the property review store. The status and the audit row commit together or not at all. */
export class FakePropertyReviewStore implements PropertyReviewStore {
  records: PropertyReviewRecord[] = [];
  readonly audits: PropertyTransitionAudit[] = [];
  /** Test hook: fail the audit write after the status is staged, to exercise rollback. */
  failAudit = false;

  async find(id: Id<"property">): Promise<PropertyReviewRecord | null> {
    return this.records.find((record) => record.property.id === id) ?? null;
  }

  async recordTransition(write: PropertyTransitionWrite): Promise<boolean> {
    const current = this.records.find((record) => record.property.id === write.property.id);
    if (current?.property.status !== write.expectedStatus) return false;
    const staged = { property: { ...write.property }, audit: { ...write.audit } };
    if (this.failAudit) throw new Error("audit write failed");
    this.records = this.records.map((record) =>
      record.property.id === staged.property.id ? { ...record, property: staged.property } : record,
    );
    this.audits.push(staged.audit);
    return true;
  }
}
