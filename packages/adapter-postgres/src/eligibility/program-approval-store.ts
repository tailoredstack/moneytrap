import type { ProgramApprovalState } from "@moneytrap/app/src/ports/network-connector";
import type {
  ProgramApprovalRecord,
  ProgramApprovalStore,
  ProgramApprovalWrite,
  ProgramApprovalWriteOutcome,
} from "@moneytrap/app/src/ports/program-approval-store";
import type { Id } from "@moneytrap/domain";
import { type Kysely, type RawBuilder, sql, type Transaction } from "kysely";
import { appendOutboxEvent } from "../outbox/writer";
import { withTx } from "../transaction";

interface RequestRow {
  property_id: string;
  program_id: string;
  requested_at: Date;
  network_approval: string | null;
}

const NETWORK_APPROVALS = new Set<string>(["approved", "pending", "rejected"]);

// The approval is read from the program's latest synced revision. A value outside the known states reads as null, so it
// cannot pass as approved.
function toRecord(row: RequestRow): ProgramApprovalRecord {
  const approval =
    row.network_approval !== null && NETWORK_APPROVALS.has(row.network_approval)
      ? (row.network_approval as ProgramApprovalState)
      : null;
  return {
    propertyId: row.property_id as Id<"property">,
    programId: row.program_id,
    requestedAt: row.requested_at,
    networkApproval: approval,
  };
}

async function selectOne(
  db: Kysely<unknown> | Transaction<unknown>,
  where: RawBuilder<unknown>,
): Promise<ProgramApprovalRecord | null> {
  const result = await sql<RequestRow>`select a.property_id, a.program_id, a.requested_at,
      r.payload->>'approval' as network_approval
    from publisher_program_approvals a
    join programs p on p.id = a.program_id
    left join program_revisions r on r.program_id = p.id and r.revision_seq = p.current_revision_seq
    where ${where}`.execute(db);
  const row = result.rows[0];
  return row ? toRecord(row) : null;
}

// Stores approval requests (DM-024, WP-4.10). The table never holds an approval: a request is a row, and the status is
// read from the network-reported state through the program's current revision. Nothing here writes approval.
export function createProgramApprovalStore(db: Kysely<unknown>): ProgramApprovalStore {
  return {
    async request(write: ProgramApprovalWrite): Promise<ProgramApprovalWriteOutcome> {
      return withTx(db, async (tx) => {
        // The property must belong to the organization. Foreign keys check only existence.
        const owned = await sql`select 1 from properties where id = ${write.propertyId}
          and organization_id = ${write.organizationId}`.execute(tx);
        if (owned.rows.length === 0) return { kind: "unknown_property" };

        const known = await sql`select 1 from programs where id = ${write.programId}`.execute(tx);
        if (known.rows.length === 0) return { kind: "unknown_program" };

        // One request per property and program. A repeat hits the key and writes no audit row and no event.
        const inserted = await sql<{ property_id: string }>`insert into publisher_program_approvals
            (organization_id, property_id, program_id, requested_at, requested_by_type, requested_by_id)
          values (${write.organizationId}, ${write.propertyId}, ${write.programId}, ${write.requestedAt},
            ${write.actor.type}, ${write.actor.id})
          on conflict (property_id, program_id) do nothing
          returning property_id`.execute(tx);

        const record = await selectOne(
          tx,
          sql`a.property_id = ${write.propertyId} and a.program_id = ${write.programId}`,
        );
        if (!record) throw new Error("program approval: request row missing after insert");
        if (inserted.rows.length === 0) return { kind: "existing", record };

        await sql`insert into audit_logs (id, organization_id, actor_type, actor_id, action, entity_type, entity_id, metadata, occurred_at)
          values (${write.audit.id}, ${write.organizationId}, ${write.actor.type}, ${write.actor.id},
            'program_approval.requested', 'program_approval', ${`${write.propertyId}|${write.programId}`},
            ${JSON.stringify(write.audit.metadata)}::jsonb, ${write.requestedAt})`.execute(tx);
        await appendOutboxEvent(tx, {
          id: write.event.id,
          topic: "program.approval_requested",
          // Outbox uniqueness is (topic, aggregate, version). Keying on the program alone would reject the second property
          // that requests it, so the aggregate is the property-program pair.
          aggregateId: `${write.propertyId}|${write.programId}`,
          aggregateVersion: 0,
          payload: write.event.payload,
        });
        return { kind: "recorded", record };
      });
    },

    async find(organizationId, propertyId, programId) {
      return selectOne(
        db,
        sql`a.organization_id = ${organizationId} and a.property_id = ${propertyId} and a.program_id = ${programId}`,
      );
    },
  };
}
