import type { KybRecord, KybSubmissionWrite, PublisherKybStore } from "@moneytrap/app/src/ports/publisher-kyb-store";
import type { Id, Publisher } from "@moneytrap/domain";

/** In-memory reference adapter for the publisher KYB store. A status that no longer matches writes nothing. */
export class FakePublisherKybStore implements PublisherKybStore {
  readonly publishers = new Map<string, Publisher>();
  readonly kybRecords: KybRecord[] = [];
  readonly events: KybSubmissionWrite["event"][] = [];

  async findPublisher(id: Id<"publisher">): Promise<Publisher | null> {
    return this.publishers.get(id) ?? null;
  }

  async recordSubmission(write: KybSubmissionWrite): Promise<boolean> {
    if (this.publishers.get(write.publisher.id)?.status !== write.expectedStatus) return false;
    this.publishers.set(write.publisher.id, { ...write.publisher });
    this.kybRecords.push({ ...write.kyb });
    this.events.push({ ...write.event });
    return true;
  }
}
