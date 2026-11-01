import type {
  PayoutMethodAudit,
  PayoutMethodDisableOutcome,
  PayoutMethodInsertOutcome,
  PayoutMethodRecord,
  PayoutMethodStore,
  PayoutMethodWrite,
} from "@moneytrap/app/src/ports/payout-method-store";
import type { CurrencyCode, Id } from "@moneytrap/domain";
import { type Kysely, sql, type Transaction } from "kysely";
import { withTx } from "../transaction";

interface PayoutMethodRow {
  id: string;
  publisher_id: string;
  provider: string;
  provider_account_ref: string;
  country: string;
  currency: string;
  state: string;
  verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// Method rows are read with an explicit column list, and each one is scoped to the organization through its publisher.
export function createPayoutMethodStore(db: Kysely<unknown>): PayoutMethodStore {
  return {
    async insert(write: PayoutMethodWrite): Promise<PayoutMethodInsertOutcome> {
      const { record } = write;
      return withTx(db, async (tx) => {
        // The publisher must belong to the organization. Checked first so a missing publisher is not mistaken for a
        // duplicate reference by the conflict clause below.
        const owned = await sql<{ id: string }>`
          select id from publishers where id = ${record.publisherId} and organization_id = ${write.organizationId}
        `.execute(tx);
        if (owned.rows.length === 0) return "unknown_publisher";

        const inserted = await sql<{ id: string }>`
          insert into payout_methods (id, publisher_id, provider, provider_account_ref, country, currency, state,
            verified_at, created_at, updated_at)
          values (${record.id}, ${record.publisherId}, ${record.provider}, ${record.providerAccountRef}, ${record.country},
            ${record.currency}, ${record.state}, ${record.verifiedAt}, ${record.createdAt}, ${record.updatedAt})
          on conflict (provider, provider_account_ref) do nothing
          returning id
        `.execute(tx);
        if (inserted.rows.length === 0) return "duplicate";

        // Same transaction as the method, so the audit row exists if and only if the method does.
        await insertAudit(tx, write.organizationId, write.audit);
        return "created";
      });
    },

    async listForOrganization(organizationId: Id<"organization">): Promise<PayoutMethodRecord[]> {
      const { rows } = await sql<PayoutMethodRow>`
        select m.id, m.publisher_id, m.provider, m.provider_account_ref, m.country, m.currency, m.state, m.verified_at,
          m.created_at, m.updated_at
        from payout_methods m
        join publishers p on p.id = m.publisher_id
        where p.organization_id = ${organizationId}
        order by m.created_at, m.id
      `.execute(db);
      return rows.map(toRecord);
    },

    async disable(input): Promise<PayoutMethodDisableOutcome> {
      return withTx(db, async (tx) => {
        const updated = await sql<{ id: string }>`
          update payout_methods m set state = 'disabled', updated_at = ${input.at}
          from publishers p
          where m.id = ${input.id} and m.publisher_id = p.id and p.organization_id = ${input.organizationId}
            and m.state = 'active'
          returning m.id
        `.execute(tx);
        if (updated.rows.length > 0) {
          await insertAudit(tx, input.organizationId, input.audit);
          return "disabled";
        }

        // Nothing changed: either the method is already disabled, or it is not in this organization.
        const existing = await sql<{ state: string }>`
          select m.state from payout_methods m
          join publishers p on p.id = m.publisher_id
          where m.id = ${input.id} and p.organization_id = ${input.organizationId}
        `.execute(tx);
        return existing.rows.length === 0 ? "not_found" : "already_disabled";
      });
    },
  };
}

async function insertAudit(
  tx: Transaction<unknown>,
  organizationId: Id<"organization">,
  audit: PayoutMethodAudit,
): Promise<void> {
  await sql`insert into audit_logs (id, organization_id, actor_type, actor_id, action, entity_type, entity_id,
    metadata, occurred_at)
    values (${audit.id}, ${organizationId}, ${audit.actor.type}, ${audit.actor.id}, ${audit.action}, 'payout_method',
      ${audit.entityId}, ${JSON.stringify(audit.metadata)}::jsonb, ${audit.occurredAt})`.execute(tx);
}

function toRecord(row: PayoutMethodRow): PayoutMethodRecord {
  return {
    id: row.id as Id<"payoutMethod">,
    publisherId: row.publisher_id as Id<"publisher">,
    provider: row.provider,
    providerAccountRef: row.provider_account_ref,
    country: row.country,
    currency: row.currency as CurrencyCode,
    state: row.state as PayoutMethodRecord["state"],
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
