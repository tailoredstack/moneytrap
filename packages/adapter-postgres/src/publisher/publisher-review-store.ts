import type { PublisherReviewStore, ReviewDecisionWrite } from "@moneytrap/app/src/ports/publisher-review-store";
import type { Id, PublisherStatus } from "@moneytrap/domain";
import { type Kysely, sql } from "kysely";
import { withTx } from "../transaction";

interface ReviewRow {
  id: string;
  legal_name: string;
  status: string;
  organization_id: string | null;
}

// Records a review decision (WP-3.3, TP-W3-006). The conditional update is the concurrency guard: a publisher that
// no longer holds expectedStatus gets false and no audit row. The audit row lands in the same transaction, so a failed
// insert rolls the status change back.
export function createPublisherReviewStore(db: Kysely<unknown>): PublisherReviewStore {
  return {
    async find(id: Id<"publisher">) {
      const { rows } = await sql<ReviewRow>`
        select id, legal_name, status, organization_id from publishers where id = ${id}
      `.execute(db);
      const row = rows[0];
      // A publisher without an organization is not reachable through any tenant scope, so it reads as missing.
      if (!row?.organization_id) return null;
      return {
        publisher: { id: row.id as Id<"publisher">, legalName: row.legal_name, status: row.status as PublisherStatus },
        organizationId: row.organization_id as Id<"organization">,
      };
    },

    async recordDecision(write: ReviewDecisionWrite): Promise<boolean> {
      return withTx(db, async (tx) => {
        const updated = await sql`
          update publishers set status = ${write.publisher.status}, updated_at = ${write.audit.occurredAt}
          where id = ${write.publisher.id} and status = ${write.expectedStatus}
        `.execute(tx);
        if (Number(updated.numAffectedRows ?? 0) === 0) return false;

        const audit = write.audit;
        await sql`
          insert into audit_logs (id, organization_id, actor_type, actor_id, action, entity_type, entity_id, metadata, occurred_at)
          values (${audit.id}, ${audit.organizationId}, ${audit.actor.type}, ${audit.actor.id}, ${audit.action},
            ${audit.entityType}, ${audit.entityId}, ${JSON.stringify(audit.metadata)}::jsonb, ${audit.occurredAt})
        `.execute(tx);
        return true;
      });
    },
  };
}
