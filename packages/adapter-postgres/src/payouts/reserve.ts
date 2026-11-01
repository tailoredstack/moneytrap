import type {
  BatchAudit,
  BatchCancelOutcome,
  BatchCandidate,
  BatchReserveOutcome,
  PayoutBatchRecord,
  PayoutBatchStore,
  PayoutRecord,
  SkippedLine,
} from "@moneytrap/app/src/ports/payout-batch-store";
import { type CurrencyCode, decideReservation, type Id } from "@moneytrap/domain";
import { type Kysely, sql, type Transaction } from "kysely";
import { withTx } from "../transaction";

// Batch preparation and reservation (DM-047, DM-048, CT-022). The reserve transaction locks each publisher row FOR UPDATE, in
// id order so two batches cannot deadlock, then sums the payouts that still hold funds for that publisher and currency and
// reserves no more than the available amount leaves. A second batch waits on the lock and then sees the first one's
// payouts, so reservations never exceed available. The reservation key is unique per organization on the batch, so a
// re-run finds the batch it made instead of reserving again.

interface BatchRow {
  id: string;
  organization_id: string;
  reservation_key: string;
  currency: string;
  period_start: Date;
  period_end: Date;
  state: string;
  cap_minor: string | null;
  policy_version: number;
  created_by: string;
  created_at: Date;
}

interface PayoutRow {
  id: string;
  publisher_id: string;
  method_id: string;
  amount_minor: string;
  state: string;
}

const BATCH_COLUMNS = sql`id, organization_id, reservation_key, currency, period_start, period_end, state, cap_minor,
  policy_version, created_by, created_at`;

// Carries the skipped lines out of the transaction when nothing was reserved. Throwing rolls the batch row back, so the
// reservation key stays free.
class NothingReserved extends Error {
  constructor(readonly skipped: SkippedLine[]) {
    super("payout batch: nothing was reserved");
  }
}

function toPayout(row: PayoutRow): PayoutRecord {
  return {
    id: row.id as Id<"payout">,
    publisherId: row.publisher_id as Id<"publisher">,
    methodId: row.method_id as Id<"payoutMethod">,
    amountMinor: BigInt(row.amount_minor),
    state: row.state as PayoutRecord["state"],
  };
}

function toBatch(row: BatchRow, lines: PayoutRow[]): PayoutBatchRecord {
  return {
    id: row.id as Id<"payoutBatch">,
    organizationId: row.organization_id as Id<"organization">,
    reservationKey: row.reservation_key,
    currency: row.currency as CurrencyCode,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    state: row.state as PayoutBatchRecord["state"],
    capMinor: row.cap_minor === null ? null : BigInt(row.cap_minor),
    policyVersion: row.policy_version,
    createdBy: row.created_by as Id<"user">,
    createdAt: row.created_at,
    lines: lines.map(toPayout),
  };
}

async function loadLines(db: Kysely<unknown> | Transaction<unknown>, batchId: string): Promise<PayoutRow[]> {
  const { rows } = await sql<PayoutRow>`select id, publisher_id, method_id, amount_minor, state from payouts
    where batch_id = ${batchId} order by publisher_id, id`.execute(db);
  return rows;
}

async function writeAudit(
  tx: Transaction<unknown>,
  input: {
    organizationId: string;
    audit: BatchAudit;
    action: string;
    batchId: string;
    metadata: object;
  },
): Promise<void> {
  await sql`insert into audit_logs (id, organization_id, actor_type, actor_id, action, entity_type, entity_id, metadata, occurred_at)
    values (${input.audit.id}, ${input.organizationId}, ${input.audit.actor.type}, ${input.audit.actor.id}, ${input.action},
      'payout_batch', ${input.batchId}, ${JSON.stringify(input.metadata)}::jsonb, ${input.audit.occurredAt})`.execute(
    tx,
  );
}

export function createPayoutBatchStore(db: Kysely<unknown>): PayoutBatchStore {
  return {
    async reserve(write): Promise<BatchReserveOutcome> {
      try {
        return await withTx(db, async (tx): Promise<BatchReserveOutcome> => {
          // The key is claimed first. A concurrent run with the same key waits on the unique index until this transaction
          // ends, then finds the committed batch below, so one key never makes two batches.
          const claimed = await sql<{ id: string }>`
            insert into payout_batches (id, organization_id, reservation_key, currency, period_start, period_end, state,
              cap_minor, policy_version, created_by, created_at)
            values (${write.batchId}, ${write.organizationId}, ${write.reservationKey}, ${write.currency}, ${write.periodStart},
              ${write.periodEnd}, 'prepared', ${write.capMinor === null ? null : write.capMinor.toString()},
              ${write.policyVersion}, ${write.createdBy}, ${write.createdAt})
            on conflict (organization_id, reservation_key) do nothing
            returning id`.execute(tx);

          if (claimed.rows.length === 0) {
            const existing = await sql<BatchRow>`select ${BATCH_COLUMNS} from payout_batches
              where organization_id = ${write.organizationId} and reservation_key = ${write.reservationKey}`.execute(
              tx,
            );
            const row = existing.rows[0];
            if (!row) throw new Error("payout batch: reservation key vanished after a conflict");
            const same =
              row.currency === write.currency &&
              row.period_start.getTime() === write.periodStart.getTime() &&
              row.period_end.getTime() === write.periodEnd.getTime() &&
              (row.cap_minor === null ? null : BigInt(row.cap_minor)) === write.capMinor;
            if (!same) return { outcome: "key_conflict" };
            if (row.state === "cancelled") return { outcome: "key_cancelled" };
            return { outcome: "replayed", batch: toBatch(row, await loadLines(tx, row.id)) };
          }

          // Locked in id order whatever order the lines come in, so two batches over the same publishers cannot deadlock.
          // Only approved publishers of this organization are locked; any other line is skipped below.
          const publisherIds = [...new Set(write.lines.map((line) => line.publisherId))].sort();
          const locked = new Set<string>();
          if (publisherIds.length > 0) {
            const lockedRows = await sql<{ id: string }>`select id from publishers
              where organization_id = ${write.organizationId} and status = 'approved' and id in (${sql.join(publisherIds)})
              order by id for update`.execute(tx);
            for (const row of lockedRows.rows) locked.add(row.id);
          }

          const skipped: SkippedLine[] = [];
          let capRemaining = write.capMinor;
          let reservedCount = 0;
          let reservedTotal = 0n;
          for (const line of write.lines) {
            if (!locked.has(line.publisherId)) {
              skipped.push({ publisherId: line.publisherId, reason: "publisher_unavailable" });
              continue;
            }
            const method = await sql`select 1 from payout_methods where id = ${line.methodId}
              and publisher_id = ${line.publisherId} and currency = ${write.currency} and state = 'active'`.execute(tx);
            if (method.rows.length === 0) {
              skipped.push({ publisherId: line.publisherId, reason: "method_unavailable" });
              continue;
            }

            // Everything that still holds funds counts, whatever its state, so a later state that keeps the funds
            // (approved, paid, unknown) keeps counting without a change here. Only a cancelled payout frees them.
            const held = await sql<{ committed: string }>`select coalesce(sum(amount_minor), 0)::text as committed
              from payouts where publisher_id = ${line.publisherId} and currency = ${write.currency}
                and state <> 'cancelled'`.execute(tx);
            const decision = decideReservation({
              requestedMinor: line.requestedMinor,
              availableMinor: line.availableMinor,
              committedMinor: BigInt(held.rows[0]?.committed ?? "0"),
              minimumMinor: line.minimumMinor,
              capRemainingMinor: capRemaining,
            });
            if (decision.skipped !== null) {
              skipped.push({ publisherId: line.publisherId, reason: decision.skipped });
              continue;
            }

            await sql`insert into payouts (id, batch_id, publisher_id, method_id, currency, amount_minor, reservation_key,
              idempotency_key, state, created_at)
              values (${line.payoutId}, ${write.batchId}, ${line.publisherId}, ${line.methodId}, ${write.currency},
                ${decision.reservedMinor.toString()}, ${write.reservationKey}, ${`${write.batchId}:${line.publisherId}`},
                'reserved', ${write.createdAt})`.execute(tx);
            if (capRemaining !== null) capRemaining -= decision.reservedMinor;
            reservedCount += 1;
            reservedTotal += decision.reservedMinor;
          }

          if (reservedCount === 0) throw new NothingReserved(skipped);

          await writeAudit(tx, {
            organizationId: write.organizationId,
            audit: write.audit,
            action: "payout_batch.prepared",
            batchId: write.batchId,
            metadata: {
              currency: write.currency,
              reservationKey: write.reservationKey,
              policyVersion: write.policyVersion,
              payoutCount: reservedCount,
              totalMinor: reservedTotal.toString(),
              capMinor: write.capMinor === null ? null : write.capMinor.toString(),
            },
          });

          const row =
            await sql<BatchRow>`select ${BATCH_COLUMNS} from payout_batches where id = ${write.batchId}`.execute(tx);
          const batchRow = row.rows[0];
          if (!batchRow) throw new Error("payout batch: batch missing after insert");
          return { outcome: "reserved", batch: toBatch(batchRow, await loadLines(tx, write.batchId)), skipped };
        });
      } catch (error) {
        if (error instanceof NothingReserved) return { outcome: "nothing_reserved", skipped: error.skipped };
        throw error;
      }
    },

    async cancel({ organizationId, batchId, at, audit }): Promise<BatchCancelOutcome> {
      return withTx(db, async (tx) => {
        // The batch row is locked so two cancels cannot both free the same funds.
        const found = await sql<{ state: string }>`select state from payout_batches
          where id = ${batchId} and organization_id = ${organizationId} for update`.execute(tx);
        const batch = found.rows[0];
        if (!batch) return "not_found";
        if (batch.state === "cancelled") return "already_cancelled";

        const freed = await sql<{ amount_minor: string }>`update payouts set state = 'cancelled', cancelled_at = ${at}
          where batch_id = ${batchId} and state = 'reserved' returning amount_minor`.execute(tx);
        await sql`update payout_batches set state = 'cancelled', cancelled_at = ${at} where id = ${batchId}`.execute(
          tx,
        );
        await writeAudit(tx, {
          organizationId,
          audit,
          action: "payout_batch.cancelled",
          batchId,
          metadata: {
            payoutCount: freed.rows.length,
            freedMinor: freed.rows.reduce((sum, row) => sum + BigInt(row.amount_minor), 0n).toString(),
          },
        });
        return "cancelled";
      });
    },

    async find(organizationId, batchId) {
      const found = await sql<BatchRow>`select ${BATCH_COLUMNS} from payout_batches
        where id = ${batchId} and organization_id = ${organizationId}`.execute(db);
      const row = found.rows[0];
      return row ? toBatch(row, await loadLines(db, row.id)) : null;
    },

    async listCandidates(organizationId, currency): Promise<BatchCandidate[]> {
      // One method per publisher: the earliest active one in the currency, so the choice is the same on every run.
      const { rows } = await sql<{ publisher_id: string; method_id: string }>`
        select distinct on (p.id) p.id as publisher_id, m.id as method_id
        from publishers p join payout_methods m on m.publisher_id = p.id
        where p.organization_id = ${organizationId} and p.status = 'approved'
          and m.currency = ${currency} and m.state = 'active'
        order by p.id, m.created_at, m.id`.execute(db);
      return rows.map((row) => ({
        publisherId: row.publisher_id as Id<"publisher">,
        methodId: row.method_id as Id<"payoutMethod">,
      }));
    },
  };
}
