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
  created_at: Date;
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
    placedAt: row.created_at,
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
        // The publish time is bounded like a hold's time, so a publish cannot be backdated to change a past decision.
        // The lock is taken before any clock is read, so a publish that waited for it checks the clock as it is now.
        // A time outside the window is a typed refusal, not an error, so a long wait is never reported as a crash.
        await sql`select pg_advisory_xact_lock(hashtext(${`payout_policy:${policy.currency}`}))`.execute(tx);
        if (await writeClockViolation(tx, occurredAt)) return { outcome: "rejected", reason: "outside_write_clock" };
        const latest = await sql<PolicyRow>`select currency, version, minimum_minor, effective_from from payout_policies
          where currency = ${policy.currency} order by version desc limit 1`.execute(tx);
        const top = latest.rows[0];

        if (top && policy.version <= top.version) return { outcome: "rejected", reason: "version_taken" };
        if (policy.version !== (top?.version ?? 0) + 1) return { outcome: "rejected", reason: "version_gap" };
        if (top && policy.effectiveFrom.getTime() < top.effective_from.getTime()) {
          return { outcome: "rejected", reason: "effective_before_latest" };
        }
        // Once a version exists, a decision may already rest on it. A new version cannot take effect before the write clock,
        // so the policy in effect at an instant that was already decided never changes. The first version has no such history.
        const clock = await sql<{ db_now: Date }>`select clock_timestamp() as db_now`.execute(tx);
        if (top && policy.effectiveFrom.getTime() < (clock.rows[0]?.db_now.getTime() ?? 0)) {
          return { outcome: "rejected", reason: "effective_in_past" };
        }

        await sql`insert into payout_policies (currency, version, minimum_minor, effective_from, created_at, published_by_organization_id)
          values (${policy.currency}, ${policy.version}, ${policy.minimumMinor.toString()}, ${policy.effectiveFrom}, ${occurredAt}, ${organizationId})`.execute(
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

// A hold's placement and release times come from the caller, so the adapter bounds them against the database clock. A time
// earlier than the write clock minus the tolerance is refused, so a hold cannot be placed or released retroactively.
// One second covers the gap between a caller reading its clock and the transaction starting (WP-7.6 review).
const WRITE_CLOCK_TOLERANCE_MS = 1000;

// The window is closed at both ends. A time later than the write clock plus the tolerance would hide a hold or a publish
// until that time arrives, so it is refused too.
// Reads the clock now and names the side of the window a time falls outside, or null when it is inside.
async function writeClockViolation(tx: Transaction<unknown>, at: Date): Promise<"earlier" | "later" | null> {
  const clock = await sql<{ db_now: Date }>`select clock_timestamp() as db_now`.execute(tx);
  const now = clock.rows[0]?.db_now.getTime() ?? 0;
  if (at.getTime() < now - WRITE_CLOCK_TOLERANCE_MS) return "earlier";
  if (at.getTime() > now + WRITE_CLOCK_TOLERANCE_MS) return "later";
  return null;
}

async function refuseOutsideWriteClock(tx: Transaction<unknown>, at: Date): Promise<void> {
  const violation = await writeClockViolation(tx, at);
  if (violation === "earlier") throw new Error("payout_holds: timestamp is earlier than the write clock");
  if (violation === "later") throw new Error("payout_holds: timestamp is later than the write clock");
}

// A hold belongs to a publisher of the organization it is written for. Placing or releasing one for another organization
// is refused, and the release reports false, so a hold outside the tenant is never changed.
export function createPayoutHoldStore(db: Kysely<unknown>): PayoutHoldStore {
  return {
    async place({ hold, organizationId, auditId, actor, occurredAt }) {
      await withTx(db, async (tx) => {
        await refuseOutsideWriteClock(tx, occurredAt);
        const owned = await sql`select 1 from publishers where id = ${hold.publisherId}
          and organization_id = ${organizationId} for share`.execute(tx);
        if (owned.rows.length === 0) throw new Error("payout: publisher is not in the organization");

        await sql`insert into payout_holds (id, publisher_id, currency, amount_minor, reason, expires_at, released_at, created_by, created_at)
          values (${hold.id}, ${hold.publisherId}, ${hold.currency}, ${hold.amountMinor.toString()}, ${hold.reason},
            ${hold.expiresAt}, null, ${actor.id}, ${occurredAt})`.execute(tx);
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
        await refuseOutsideWriteClock(tx, releasedAt);
        // Only an unreleased hold can be released early. A second release is not an error; it returns false below.
        const placed = await sql<{
          created_at: Date;
          released_at: Date | null;
        }>`select created_at, released_at from payout_holds
          where id = ${id} and publisher_id in (select id from publishers where organization_id = ${organizationId})`.execute(
          tx,
        );
        const hold = placed.rows[0];
        if (hold && hold.released_at === null && releasedAt.getTime() < hold.created_at.getTime()) {
          throw new Error("payout_holds: release precedes placement");
        }
        const updated = await sql<{
          id: string;
          publisher_id: string;
          currency: string;
          amount_minor: string;
        }>`update payout_holds
          set released_at = ${releasedAt}
          where id = ${id} and released_at is null
            and publisher_id in (select id from publishers where organization_id = ${organizationId})
          returning id, publisher_id, currency, amount_minor`.execute(tx);
        const released = updated.rows[0];
        if (!released) return false;

        await writeAudit(tx, {
          auditId,
          organizationId,
          actor,
          action: "payout_hold_released",
          entityType: "payout_hold",
          entityId: id,
          metadata: {
            publisherId: released.publisher_id,
            currency: released.currency,
            amountMinor: released.amount_minor,
          },
          occurredAt: releasedAt,
        });
        return true;
      });
    },

    async listForPublisher(organizationId, publisherId, currency) {
      const result =
        await sql<HoldRow>`select h.id, h.publisher_id, h.currency, h.amount_minor, h.reason, h.expires_at, h.released_at, h.created_at
        from payout_holds h join publishers p on p.id = h.publisher_id
        where p.organization_id = ${organizationId} and h.publisher_id = ${publisherId} and h.currency = ${currency}
        order by h.created_at, h.id`.execute(db);
      return result.rows.map(toHold);
    },
  };
}
