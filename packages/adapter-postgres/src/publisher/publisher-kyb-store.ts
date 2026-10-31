import type { PublisherKybStore } from "@moneytrap/app/src/ports/publisher-kyb-store";
import type { Id, Publisher, PublisherStatus } from "@moneytrap/domain";
import { type Kysely, sql } from "kysely";
import { appendOutboxEvent } from "../outbox/writer";
import { withTx } from "../transaction";

interface PublisherRow {
  id: string;
  legal_name: string;
  status: string;
}

// Records a KYB submission (DM-010, WP-3.2). The conditional update is the concurrency guard: if another writer
// already moved the publisher off expectedStatus, nothing else is written and the caller gets false.
export function createPublisherKybStore(db: Kysely<unknown>): PublisherKybStore {
  return {
    async findPublisher(id: Id<"publisher">): Promise<Publisher | null> {
      const { rows } = await sql<PublisherRow>`select id, legal_name, status from publishers where id = ${id}`.execute(
        db,
      );
      const row = rows[0];
      if (!row) return null;
      return { id: row.id as Id<"publisher">, legalName: row.legal_name, status: row.status as PublisherStatus };
    },

    async recordSubmission(write): Promise<boolean> {
      return withTx(db, async (tx) => {
        const updated = await sql`
          update publishers set status = ${write.publisher.status}, updated_at = ${write.kyb.createdAt}
          where id = ${write.publisher.id} and status = ${write.expectedStatus}
        `.execute(tx);
        if (Number(updated.numAffectedRows ?? 0) === 0) return false;

        // Only the reference is written. The row has no column that could hold document bytes.
        await sql`
          insert into publisher_kyb (id, publisher_id, entity_type, company_reference, provider_ref, state, created_at)
          values (${write.kyb.id}, ${write.kyb.publisherId}, ${write.kyb.entityType}, ${write.kyb.companyReference},
            ${write.kyb.providerRef}, ${write.kyb.state}, ${write.kyb.createdAt})
        `.execute(tx);

        // Same transaction as the state change, so the event is published if and only if the submission commits.
        await appendOutboxEvent(tx, {
          id: write.event.id,
          topic: write.event.topic,
          aggregateId: write.event.aggregateId,
          aggregateVersion: write.event.aggregateVersion,
          payload: write.event.payload,
        });
        return true;
      });
    },
  };
}
