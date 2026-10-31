import type { Id, Publisher, PublisherStatus } from "@moneytrap/domain";

// The KYB record keeps a reference to the compliance vault's document (DM-010). Document bytes never reach this port.
export interface KybRecord {
  id: Id<"kyb">;
  publisherId: Id<"publisher">;
  entityType: string;
  companyReference: string | null;
  providerRef: string;
  state: "in_review";
  createdAt: Date;
}

export interface PublisherSubmittedEvent {
  id: string;
  topic: "publisher.submitted";
  aggregateId: string;
  aggregateVersion: number;
  payload: { publisherId: Id<"publisher">; kybId: Id<"kyb">; state: "in_review" };
}

export interface KybSubmissionWrite {
  // The status the publisher must still hold for the write to apply. A changed status writes nothing.
  expectedStatus: PublisherStatus;
  publisher: Publisher;
  kyb: KybRecord;
  event: PublisherSubmittedEvent;
}

// Adapters write the publisher status, the KYB row, and the outbox event in one transaction, so all three commit or
// none does (ADR-004). recordSubmission returns false, and writes nothing, when the publisher no longer holds
// expectedStatus.
export interface PublisherKybStore {
  findPublisher(id: Id<"publisher">): Promise<Publisher | null>;
  recordSubmission(write: KybSubmissionWrite): Promise<boolean>;
}
