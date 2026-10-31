import type {
  AuditWrite,
  PropertyEvent,
  PropertyRecord,
  PropertyStore,
  VerificationChallenge,
} from "@moneytrap/app/src/ports/property-store";
import type { Id, PropertyStatus } from "@moneytrap/domain";
import { type Kysely, sql, type Transaction } from "kysely";
import { appendOutboxEvent } from "../outbox/writer";
import { withTx } from "../transaction";

interface PropertyRow {
  id: string;
  organization_id: string;
  publisher_id: string;
  type: "website";
  canonical_identifier: string;
  normalized_identifier: string;
  status: PropertyStatus;
  rejection_reason: string | null;
  version: number;
}

interface ChallengeRow {
  id: string;
  property_id: string;
  method: "dns";
  challenge_hash: string;
  expires_at: Date;
  verified_at: Date | null;
  attempts: number;
  created_at: Date;
}

function toProperty(row: PropertyRow): PropertyRecord {
  return {
    id: row.id as Id<"property">,
    organizationId: row.organization_id as Id<"organization">,
    publisherId: row.publisher_id as Id<"publisher">,
    type: row.type,
    canonicalIdentifier: row.canonical_identifier,
    normalizedIdentifier: row.normalized_identifier,
    status: row.status,
    version: row.version,
    ...(row.rejection_reason !== null ? { rejectionReason: row.rejection_reason } : {}),
  };
}

function toChallenge(row: ChallengeRow): VerificationChallenge {
  return {
    id: row.id as Id<"verification">,
    propertyId: row.property_id as Id<"property">,
    method: row.method,
    challengeHash: row.challenge_hash,
    expiresAt: row.expires_at,
    verifiedAt: row.verified_at,
    attempts: row.attempts,
    createdAt: row.created_at,
  };
}

// The status change only applies to the version the caller read. Zero rows means another write got there first.
async function advance(
  tx: Transaction<unknown>,
  property: PropertyRecord,
  nextStatus: PropertyStatus,
): Promise<boolean> {
  const result = await sql`update properties
    set status = ${nextStatus}, version = version + 1, updated_at = clock_timestamp()
    where id = ${property.id} and version = ${property.version}`.execute(tx);
  return Number(result.numAffectedRows ?? 0) === 1;
}

async function writeAudit(tx: Transaction<unknown>, audit: AuditWrite): Promise<void> {
  await sql`insert into audit_logs (id, organization_id, actor_type, actor_id, action, entity_type, entity_id, metadata, occurred_at)
    values (${audit.id}, ${audit.organizationId}, ${audit.actor.type}, ${audit.actor.id}, ${audit.action},
      ${audit.entityType}, ${audit.entityId}, ${JSON.stringify(audit.metadata)}::jsonb, ${audit.occurredAt})`.execute(
    tx,
  );
}

// Each write runs in one transaction with its audit row and outbox event, so the state change and its record commit together.
export function createPropertyStore(db: Kysely<unknown>): PropertyStore {
  return {
    async find(scope, propertyId) {
      const result = await sql<PropertyRow>`select id, organization_id, publisher_id, type, canonical_identifier,
          normalized_identifier, status, rejection_reason, version
        from properties
        where id = ${propertyId} and organization_id = ${scope.organizationId}`.execute(db);
      const row = result.rows[0];
      return row ? toProperty(row) : null;
    },

    async latestChallenge(propertyId) {
      const result = await sql<ChallengeRow>`select id, property_id, method, challenge_hash, expires_at, verified_at,
          attempts, created_at
        from property_verifications
        where property_id = ${propertyId}
        order by issue_seq desc
        limit 1`.execute(db);
      const row = result.rows[0];
      return row ? toChallenge(row) : null;
    },

    async issueChallenge(write) {
      return withTx(db, async (tx) => {
        if (!(await advance(tx, write.property, write.nextStatus))) return false;
        const c = write.challenge;
        await sql`insert into property_verifications (id, property_id, method, challenge_hash, expires_at, verified_at,
            attempts, created_at)
          values (${c.id}, ${c.propertyId}, ${c.method}, ${c.challengeHash}, ${c.expiresAt}, null, ${c.attempts},
            ${c.createdAt})`.execute(tx);
        await writeAudit(tx, write.audit);
        await appendOutboxEvent(tx, write.event satisfies PropertyEvent);
        return true;
      });
    },

    async recordAttempt(challengeId) {
      await sql`update property_verifications set attempts = attempts + 1 where id = ${challengeId}`.execute(db);
    },

    async completeVerification(write) {
      return withTx(db, async (tx) => {
        if (!(await advance(tx, write.property, write.nextStatus))) return false;
        await sql`update property_verifications set verified_at = ${write.verifiedAt} where id = ${write.challengeId}`.execute(
          tx,
        );
        await writeAudit(tx, write.audit);
        await appendOutboxEvent(tx, write.event satisfies PropertyEvent);
        return true;
      });
    },
  };
}
