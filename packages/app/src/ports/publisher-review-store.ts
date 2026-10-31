import type { Id, Publisher } from "@moneytrap/domain";

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
  publisher: Publisher;
  audit: ReviewDecisionAudit;
}

// The adapter must write the new publisher status and the audit row in one transaction: either both exist
// afterwards or neither does (TP-W3-006). A failed audit insert leaves the publisher in review.
export interface PublisherReviewStore {
  find(id: Id<"publisher">): Promise<PublisherReviewRecord | null>;
  recordDecision(write: ReviewDecisionWrite): Promise<void>;
}
