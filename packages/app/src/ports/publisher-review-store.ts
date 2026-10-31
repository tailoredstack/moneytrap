import type { Id, Publisher, PublisherStatus } from "@moneytrap/domain";

export interface PublisherReviewRecord {
  publisher: Publisher;
  organizationId: Id<"organization">;
}

// One row in audit_logs for a review decision. The reason sits in metadata, where the audit viewer reads it.
export interface ReviewDecisionAudit {
  id: Id<"audit">;
  organizationId: Id<"organization">;
  actor: { type: string; id: string };
  action: "approve" | "reject";
  entityType: "publisher";
  entityId: Id<"publisher">;
  metadata: { reason: string };
  occurredAt: Date;
}

export interface ReviewDecisionWrite {
  // The status the publisher must still hold for the write to apply. A changed status writes nothing.
  expectedStatus: PublisherStatus;
  publisher: Publisher;
  audit: ReviewDecisionAudit;
}

// The adapter writes the publisher status and the audit row in one transaction: either both exist afterwards or
// neither does (TP-W3-006). recordDecision returns false, and writes nothing, when the publisher no longer holds
// expectedStatus.
export interface PublisherReviewStore {
  find(id: Id<"publisher">): Promise<PublisherReviewRecord | null>;
  recordDecision(write: ReviewDecisionWrite): Promise<boolean>;
}
