import type {
  PublisherReviewRecord,
  PublisherReviewStore,
  ReviewDecisionAudit,
  ReviewDecisionWrite,
} from "@moneytrap/app/src/ports/publisher-review-store";
import type { Id } from "@moneytrap/domain";

/** In-memory reference adapter for the publisher review store. The status and the audit row commit together or not at all. */
export class FakePublisherReviewStore implements PublisherReviewStore {
  records: PublisherReviewRecord[] = [];
  readonly audits: ReviewDecisionAudit[] = [];
  /** Test hook: fail the audit write after the status is staged, to exercise rollback. */
  failAudit = false;

  async find(id: Id<"publisher">): Promise<PublisherReviewRecord | null> {
    return this.records.find((record) => record.publisher.id === id) ?? null;
  }

  async recordDecision(write: ReviewDecisionWrite): Promise<void> {
    const staged = { publisher: { ...write.publisher }, audit: { ...write.audit } };
    if (this.failAudit) throw new Error("audit write failed");
    this.records = this.records.map((record) =>
      record.publisher.id === staged.publisher.id ? { ...record, publisher: staged.publisher } : record,
    );
    this.audits.push(staged.audit);
  }
}
