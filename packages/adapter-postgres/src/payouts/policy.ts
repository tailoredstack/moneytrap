import type { HoldActor, PayoutHoldStore } from "@moneytrap/app/src/ports/payout-hold-store";
import type {
  PayoutPolicyStore,
  PublishActor,
  PublishPolicyResult,
} from "@moneytrap/app/src/ports/payout-policy-store";
import { type CurrencyCode, createPayoutPolicy, type PayoutHold, type PayoutPolicy } from "@moneytrap/domain";
import { type Kysely, sql, type Transaction } from "kysely";
import { withTx } from "../transaction";

// Payout policy versions and holds (DM-045, WP-7.6). Each publish runs under a per-currency advisory lock, so two publishes
// cannot both take the same version. Rows are never updated except that a hold's releasedAt is set once. Every write
// that changes money rules also writes an audit row in the same transaction.

interface PolicyRow {
  currency: CurrencyCode;
  version: number;
  // bigint columns come back from pg as text, so they are converted here.
  minimum_minor: string;
  effective_from: Date;
}

interface HoldRow {
  id: string;
  publisher_id: string;
  currency: CurrencyCode;
  amount_minor: string;
  reason: string;
  expires_at: Date | null;
  released_at: Date | null;
}

function toPolicy(row: PolicyRow): PayoutPolicy {
  return createPayoutPolicy({
    version: row.version,
    currency: row.currency,
    minimumMinor: BigInt(row.minimum_minor),
    effectiveFrom: row.effective_from,
  });
}

function toHold(row: HoldRow): PayoutHold {
  return {
    id: row.id,
    publisherId: row.publisher_id,
    currency: row.currency,
    amountMinor: BigInt(row.amount_minor),
    reason: row.reason,
    expiresAt: row.expires_at,
    releasedAt: row.released_at,
  };
}

async function writeAudit(
  tx: Transaction<unknown>,
  input: {
    auditId: string;
    organizationId: string;
    actor: HoldActor | PublishActor;
    action: string;
    entityType: string;
    entityId: string;
    metadata: object;
    occurredAt: Date;
  },
): Promise<void> {
  await sql`insert into audit_logs (id, organization_id, actor_type, actor_id, action, entity_type, entity_id, metadata, occurred_at)
    values (${input.auditId}, ${input.organizationId}, ${input.actor.type}, ${input.actor.id}, ${input.action},
      ${input.entityType}, ${input.entityId}, ${JSON.stringify(input.metadata)}::jsonb, ${input.occurredAt})`.execute(
    tx,
  );
}

// Versions are published in order. A version that is taken, skips a number, or takes effect before the latest version
// is refused and writes nothing, so a decision made under an earlier version stays reproducible (TP-W7-011).
export function createPayoutPolicyStore(db: Kysely<unknown>): PayoutPolicyStore {
  return {
    async publish({ policy, auditId, organizationId, actor, occurredAt }) {
      return withTx(db, async (tx): Promise<PublishPolicyResult> => {
        await sql`select pg_advisory_xact_lock(hashtext(${`payout_policy:${policy.currency}`}))`.execute(tx);
        const latest = await sql<PolicyRow>`select currency, version, minimum_minor, effective_from from payout_policies
          where currency = ${policy.currency} order by version desc limit 1`.execute(tx);
        const top = latest.rows[0];

        if (top && policy.version <= top.version) return { outcome: "rejected", reason: "version_taken" };
        if (policy.version !== (top?.version ?? 0) + 1) return { outcome: "rejected", reason: "version_gap" };
        if (top && policy.effectiveFrom.getTime() < top.effective_from.getTime()) {
          return { outcome: "rejected", reason: "effective_before_latest" };
        }

        await sql`insert into payout_policies (currency, version, minimum_minor, effective_from, created_at)
          values (${policy.currency}, ${policy.version}, ${policy.minimumMinor.toString()}, ${policy.effectiveFrom}, ${occurredAt})`.execute(
          tx,
        );
        await writeAudit(tx, {
          auditId,
          organizationId,
          actor,
          action: "payout_policy_published",
          entityType: "payout_policy",
          entityId: `${policy.currency}:${policy.version}`,
          metadata: {
            version: policy.version,
            currency: policy.currency,
            minimumMinor: policy.minimumMinor.toString(),
          },
          occurredAt,
        });
        return { outcome: "published" };
      });
    },

    async list(currency) {
      const result = await sql<PolicyRow>`select currency, version, minimum_minor, effective_from from payout_policies
        where currency = ${currency} order by version`.execute(db);
      return result.rows.map(toPolicy);
    },
  };
}

// A hold belongs to a publisher of the organization it is written for. Placing or releasing one for another organization
// is refused, and the release reports false, so a hold outside the tenant is never changed.
export function createPayoutHoldStore(db: Kysely<unknown>): PayoutHoldStore {
  return {
    async place({ hold, organizationId, auditId, actor, occurredAt }) {
      await withTx(db, async (tx) => {
        const owned = await sql`select 1 from publishers where id = ${hold.publisherId}
          and organization_id = ${organizationId} for share`.execute(tx);
        if (owned.rows.length === 0) throw new Error("payout: publisher is not in the organization");

        await sql`insert into payout_holds (id, publisher_id, currency, amount_minor, reason, expires_at, released_at, created_by, created_at)
          values (${hold.id}, ${hold.publisherId}, ${hold.currency}, ${hold.amountMinor.toString()}, ${hold.reason},
            ${hold.expiresAt}, ${hold.releasedAt}, ${actor.id}, ${occurredAt})`.execute(tx);
        await writeAudit(tx, {
          auditId,
          organizationId,
          actor,
          action: "payout_hold_placed",
          entityType: "payout_hold",
          entityId: hold.id,
          metadata: {
            publisherId: hold.publisherId,
            currency: hold.currency,
            amountMinor: hold.amountMinor.toString(),
          },
          occurredAt,
        });
      });
    },

    async release({ id, organizationId, auditId, actor, releasedAt }) {
      return withTx(db, async (tx) => {
        const updated = await sql<{ id: string }>`update payout_holds set released_at = ${releasedAt}
          where id = ${id} and released_at is null
            and publisher_id in (select id from publishers where organization_id = ${organizationId})
          returning id`.execute(tx);
        if (updated.rows.length === 0) return false;

        await writeAudit(tx, {
          auditId,
          organizationId,
          actor,
          action: "payout_hold_released",
          entityType: "payout_hold",
          entityId: id,
          metadata: {},
          occurredAt: releasedAt,
        });
        return true;
      });
    },

    async listForPublisher(publisherId, currency) {
      const result = await sql<HoldRow>`select id, publisher_id, currency, amount_minor, reason, expires_at, released_at
        from payout_holds where publisher_id = ${publisherId} and currency = ${currency} order by created_at, id`.execute(
        db,
      );
      return result.rows.map(toHold);
    },
  };
}
