import { allowsHost } from "@moneytrap/app/src/links/link-actions";
import type {
  LinkAudit,
  LinkEvent,
  LinkRecord,
  LinkStore,
  LinkWritePrecondition,
} from "@moneytrap/app/src/ports/link-store";
import type { Id, LinkStatus } from "@moneytrap/domain";
import { type Kysely, sql, type Transaction } from "kysely";
import { appendOutboxEvent } from "../outbox/writer";
import { withTx } from "../transaction";

interface LinkRow {
  id: string;
  organization_id: string;
  publisher_id: string;
  property_id: string;
  program_id: string;
  slug: string;
  destination_url: string;
  status: LinkStatus;
  version: number;
}

// The precondition must describe the record it guards: the same property, program, and destination host. The app builds
// both from one checked input, so a mismatch is a caller bug, and the store refuses it rather than check the wrong gate.
function bound(record: LinkRecord, precondition: LinkWritePrecondition | null): boolean {
  if (!precondition) return true;
  return (
    precondition.propertyId === record.link.propertyId &&
    precondition.programId === record.programId &&
    precondition.host === new URL(record.link.destinationUrl).hostname
  );
}

function toRecord(row: LinkRow): LinkRecord {
  return {
    link: {
      id: row.id as Id<"link">,
      publisherId: row.publisher_id as Id<"publisher">,
      propertyId: row.property_id as Id<"property">,
      slug: row.slug,
      destinationUrl: row.destination_url,
      status: row.status,
      version: row.version,
    },
    organizationId: row.organization_id as Id<"organization">,
    programId: row.program_id as Id<"program">,
  };
}

// The gate is read again inside the write's transaction. The property row is locked for share. A suspension's UPDATE and an
// eligibility decision's FOR NO KEY UPDATE both conflict with that lock, so each waits for an in-flight link write (CT-006, CT-010).
// The allow-list is the program's latest revision, under its `allowedHosts` field.
async function holds(
  tx: Transaction<unknown>,
  organizationId: Id<"organization">,
  precondition: LinkWritePrecondition,
): Promise<boolean> {
  const { propertyId, programId, host } = precondition;
  const property = await sql<{ status: string }>`select status from properties
    where id = ${propertyId} and organization_id = ${organizationId} for share`.execute(tx);
  if (property.rows[0]?.status !== "approved") return false;

  const decision = await sql<{ decision: string }>`select decision from eligibility_decisions
    where organization_id = ${organizationId} and property_id = ${propertyId} and program_id = ${programId}
    order by evaluated_at desc, policy_version desc, id desc
    limit 1`.execute(tx);
  if (decision.rows[0]?.decision !== "allow") return false;

  // Catalog sync locks the program row before it moves the revision pointer, so this share lock keeps a host removal
  // from landing between this read and the link commit.
  await sql`select 1 from programs where id = ${programId} for share`.execute(tx);
  const revision = await sql<{ payload: { allowedHosts?: unknown } }>`select payload from program_revisions
    where program_id = ${programId}
    order by revision_seq desc
    limit 1`.execute(tx);
  const hosts = revision.rows[0]?.payload.allowedHosts;
  if (!Array.isArray(hosts)) return false;
  return allowsHost(
    hosts.filter((entry): entry is string => typeof entry === "string"),
    host,
  );
}

async function writeAudit(tx: Transaction<unknown>, audit: LinkAudit): Promise<void> {
  await sql`insert into audit_logs (id, organization_id, actor_type, actor_id, action, entity_type, entity_id, metadata, occurred_at)
    values (${audit.id}, ${audit.organizationId}, ${audit.actor.type}, ${audit.actor.id}, ${audit.action},
      ${audit.entityType}, ${audit.entityId}, ${JSON.stringify(audit.metadata)}::jsonb, ${audit.occurredAt})`.execute(
    tx,
  );
}

// Each write runs in one transaction with its audit row and outbox event. A refused write returns false before it writes
// anything, so the transaction commits nothing.
export function createLinkStore(db: Kysely<unknown>): LinkStore {
  return {
    async find(organizationId, linkId) {
      const result = await sql<LinkRow>`select id, organization_id, publisher_id, property_id, program_id, slug,
          destination_url, status, version
        from links
        where id = ${linkId} and organization_id = ${organizationId}`.execute(db);
      const row = result.rows[0];
      return row ? toRecord(row) : null;
    },

    async insert(write) {
      return withTx(db, async (tx) => {
        const { record, precondition } = write;
        if (precondition && !bound(record, precondition)) return false;
        if (precondition && !(await holds(tx, record.organizationId, precondition))) return false;

        const link = record.link;
        const inserted = await sql`insert into links (id, organization_id, publisher_id, property_id, program_id, slug,
            destination_url, status, version, created_at, updated_at)
          values (${link.id}, ${record.organizationId}, ${link.publisherId}, ${link.propertyId}, ${record.programId},
            ${link.slug}, ${link.destinationUrl}, ${link.status}, ${link.version}, ${write.audit.occurredAt},
            ${write.audit.occurredAt})
          on conflict (id) do nothing`.execute(tx);
        if (Number(inserted.numAffectedRows ?? 0) === 0) return false;

        await writeAudit(tx, write.audit);
        await appendOutboxEvent(tx, write.event satisfies LinkEvent);
        return true;
      });
    },

    async update(write) {
      return withTx(db, async (tx) => {
        const { record, precondition } = write;
        // A record that names another tenant than the write is refused, so an update never crosses organizations.
        if (record.organizationId !== write.organizationId) return false;
        if (precondition && !bound(record, precondition)) return false;
        if (precondition && !(await holds(tx, write.organizationId, precondition))) return false;

        const link = record.link;
        const updated = await sql`update links
          set slug = ${link.slug}, destination_url = ${link.destinationUrl}, status = ${link.status},
            version = ${link.version}, updated_at = ${write.audit.occurredAt}
          where id = ${link.id} and organization_id = ${write.organizationId} and version = ${write.expectedVersion}`.execute(
          tx,
        );
        if (Number(updated.numAffectedRows ?? 0) === 0) return false;

        await writeAudit(tx, write.audit);
        await appendOutboxEvent(tx, write.event satisfies LinkEvent);
        return true;
      });
    },
  };
}
