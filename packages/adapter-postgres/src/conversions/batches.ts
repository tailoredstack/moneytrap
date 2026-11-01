import { createHash } from "node:crypto";
import type {
  ApplyRowInput,
  ConversionImportStore,
  OpenBatchInput,
  OpenBatchResult,
  RecordQuarantineInput,
  RowOutcome,
} from "@moneytrap/app/src/ports/conversion-import-store";
import { type ConversionFactPayload, canonicalJson, decideRevision, type Id } from "@moneytrap/domain";
import { type Kysely, sql, type Transaction } from "kysely";
import { withTx } from "../transaction";

// Batches and conversion source facts (WP-6.5). A batch is opened by its file identity, so a replay finds the batch that
// already exists. Each row runs in its own transaction, and the source fact is locked while the row is applied. That
// lock serializes two batches that report the same transaction, and the revision number is always the next one.
export function createConversionImportStore(db: Kysely<unknown>): ConversionImportStore {
  return {
    async openBatch(input: OpenBatchInput): Promise<OpenBatchResult> {
      const inserted = await sql<{ id: string }>`insert into network_import_batches
          (id, network_id, resource, sha256_digest, object_ref, parser_version, source_from, source_to, state, started_at)
        values (${input.id}, ${input.networkId}, ${input.resource}, ${input.sha256Digest}, ${input.objectRef},
          ${input.parserVersion}, ${input.sourceFrom}, ${input.sourceTo}, 'running', ${input.startedAt})
        on conflict (network_id, resource, sha256_digest) do nothing
        returning id`.execute(db);
      if (inserted.rows[0]) return { kind: "created", batchId: input.id };

      const existing = await sql<{ id: string; state: string }>`select id, state from network_import_batches
        where network_id = ${input.networkId} and resource = ${input.resource} and sha256_digest = ${input.sha256Digest}`.execute(
        db,
      );
      const row = existing.rows[0];
      if (!row) throw new Error("openBatch: batch missing after conflict");
      return {
        kind: row.state === "completed" ? "replayed" : "resumed",
        batchId: row.id as Id<"importBatch">,
      };
    },

    async applyRow(input: ApplyRowInput): Promise<RowOutcome> {
      return withTx(db, async (tx) => {
        const factId = await lockSourceFact(tx, input);
        // A row this batch already recorded is not applied again. This is what a resumed import relies on.
        const stored = await storedOutcome(tx, input.batchId, input.externalRowRef);
        if (stored) return stored;

        const latest = await latestRevision(tx, factId);
        const decision = decideRevision(latest, { sourceRevision: input.sourceRevision, payload: input.payload });
        const payloadDigest = sha256(canonicalJson(input.payload));

        if (decision.kind === "unchanged") {
          await insertRow(tx, input, { outcome: "unchanged", factId, revisionSeq: latest?.seq ?? null, payloadDigest });
          return "unchanged";
        }

        const nextSeq = (latest?.seq ?? 0) + 1;
        await sql`insert into conversion_source_revisions
            (source_fact_id, revision_seq, source_revision, payload, batch_id, observed_at, created_at)
          values (${factId}, ${nextSeq}, ${input.sourceRevision}, ${JSON.stringify(input.payload)}::jsonb,
            ${input.batchId}, ${input.observedAt}, clock_timestamp())`.execute(tx);
        await sql`update conversion_source_facts
          set current_revision_seq = ${nextSeq}, updated_at = clock_timestamp()
          where id = ${factId}`.execute(tx);

        const outcome: RowOutcome = decision.kind === "create" ? "created" : "revised";
        await insertRow(tx, input, { outcome, factId, revisionSeq: nextSeq, payloadDigest });
        return outcome;
      });
    },

    async recordQuarantine(input: RecordQuarantineInput): Promise<RowOutcome> {
      return withTx(db, async (tx) => {
        const stored = await storedOutcome(tx, input.batchId, input.externalRowRef);
        if (stored) return stored;
        await sql`insert into conversion_import_rows
            (id, batch_id, external_row_ref, payload_digest, outcome, source_fact_id, revision_seq, error_code, created_at)
          values (${input.rowId}, ${input.batchId}, ${input.externalRowRef}, null, 'quarantined', null, null,
            'VALIDATION_FAILED', clock_timestamp())`.execute(tx);
        return "quarantined";
      });
    },

    async completeBatch(input) {
      await sql`update network_import_batches
        set state = 'completed', finished_at = ${input.finishedAt}
        where id = ${input.batchId}`.execute(db);
    },
  };
}

// Inserts the source fact if it is new, then locks it. Returns the fact's ID, which is the one already stored when it exists.
async function lockSourceFact(tx: Transaction<unknown>, input: ApplyRowInput): Promise<string> {
  await sql`insert into conversion_source_facts (id, network_id, source_ref, created_at, updated_at)
    values (${input.sourceFactId}, ${input.networkId}, ${input.externalRowRef}, clock_timestamp(), clock_timestamp())
    on conflict (network_id, source_ref) do nothing`.execute(tx);
  const result = await sql<{ id: string }>`select id from conversion_source_facts
    where network_id = ${input.networkId} and source_ref = ${input.externalRowRef} for update`.execute(tx);
  const row = result.rows[0];
  if (!row) throw new Error("applyRow: source fact missing after insert");
  return row.id;
}

// Reads the latest revision of a locked fact, or null before its first revision.
async function latestRevision(
  tx: Transaction<unknown>,
  factId: string,
): Promise<{ sourceRevision: string; payload: ConversionFactPayload; seq: number } | null> {
  const result = await sql<{ revision_seq: number; source_revision: string; payload: ConversionFactPayload }>`
    select revision_seq, source_revision, payload from conversion_source_revisions
    where source_fact_id = ${factId}
    order by revision_seq desc limit 1`.execute(tx);
  const row = result.rows[0];
  return row ? { sourceRevision: row.source_revision, payload: row.payload, seq: row.revision_seq } : null;
}

async function storedOutcome(
  tx: Transaction<unknown>,
  batchId: string,
  externalRowRef: string,
): Promise<RowOutcome | null> {
  const result = await sql<{ outcome: RowOutcome }>`select outcome from conversion_import_rows
    where batch_id = ${batchId} and external_row_ref = ${externalRowRef}`.execute(tx);
  return result.rows[0]?.outcome ?? null;
}

async function insertRow(
  tx: Transaction<unknown>,
  input: ApplyRowInput,
  row: { outcome: RowOutcome; factId: string; revisionSeq: number | null; payloadDigest: string },
): Promise<void> {
  await sql`insert into conversion_import_rows
      (id, batch_id, external_row_ref, payload_digest, outcome, source_fact_id, revision_seq, error_code, created_at)
    values (${input.rowId}, ${input.batchId}, ${input.externalRowRef}, ${row.payloadDigest}, ${row.outcome},
      ${row.factId}, ${row.revisionSeq}, null, clock_timestamp())`.execute(tx);
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
