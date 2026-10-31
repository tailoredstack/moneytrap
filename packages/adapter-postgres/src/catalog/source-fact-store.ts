import {
  type AdvertiserFactPayload,
  decideRevision,
  type ProgramFactPayload,
  validateSourceIdentity,
} from "@moneytrap/domain";
import { type Kysely, sql, type Transaction } from "kysely";
import { withTx } from "../transaction";

// Source facts are upserted in one transaction per record. The parent row is locked, the latest revision is compared
// with the incoming payload by the domain's decideRevision, and a new revision is written only when that comparison
// says something changed. Both writes commit together, so a reader never sees a counter that points at no revision.

export type UpsertOutcome = "created" | "revised" | "unchanged";

export interface UpsertResult {
  id: string;
  outcome: UpsertOutcome;
}

export interface SourceFactInput<T> {
  // Platform ID used only when the record is new. An existing record keeps the ID it was created with.
  id: string;
  sourceId: string;
  sourceRevision: string;
  payload: T;
  observedAt: Date;
}

export interface StoredRevision<T> {
  revisionSeq: number;
  sourceRevision: string;
  payload: T;
  observedAt: Date;
}

export interface SourceFactStore {
  upsertNetworkAdvertiser(
    input: SourceFactInput<AdvertiserFactPayload> & { networkId: string },
  ): Promise<UpsertResult | null>;
  upsertProgram(
    input: SourceFactInput<ProgramFactPayload> & { networkAdvertiserId: string },
  ): Promise<UpsertResult | null>;
  listNetworkAdvertiserRevisions(id: string): Promise<StoredRevision<AdvertiserFactPayload>[]>;
  listProgramRevisions(id: string): Promise<StoredRevision<ProgramFactPayload>[]>;
}

interface RevisionRow<T> {
  revision_seq: number;
  source_revision: string;
  payload: T;
  observed_at: Date;
}

interface EntityRow {
  id: string;
  current_revision_seq: number;
}

function toRevision<T>(row: RevisionRow<T>): StoredRevision<T> {
  return {
    revisionSeq: row.revision_seq,
    sourceRevision: row.source_revision,
    payload: row.payload,
    observedAt: row.observed_at,
  };
}

// Reads the latest revision of a locked parent. The parent's current_revision_seq says which row that is.
async function latestRevision<T>(
  tx: Transaction<unknown>,
  revisionTable: "network_advertiser_revisions" | "program_revisions",
  parentColumn: "network_advertiser_id" | "program_id",
  parentId: string,
  revisionSeq: number,
): Promise<{ sourceRevision: string; payload: T } | null> {
  if (revisionSeq === 0) return null;
  const result = await sql<RevisionRow<T>>`select revision_seq, source_revision, payload, observed_at
    from ${sql.table(revisionTable)}
    where ${sql.ref(parentColumn)} = ${parentId} and revision_seq = ${revisionSeq}`.execute(tx);
  const row = result.rows[0];
  return row ? { sourceRevision: row.source_revision, payload: row.payload } : null;
}

// Appends the next revision and moves the parent's pointer to it. Runs inside the caller's locked transaction.
async function appendRevision(
  tx: Transaction<unknown>,
  spec: {
    entityTable: "network_advertisers" | "programs";
    revisionTable: "network_advertiser_revisions" | "program_revisions";
    parentColumn: "network_advertiser_id" | "program_id";
  },
  parentId: string,
  nextSeq: number,
  input: { sourceRevision: string; payload: unknown; observedAt: Date },
): Promise<void> {
  await sql`insert into ${sql.table(spec.revisionTable)}
      (${sql.ref(spec.parentColumn)}, revision_seq, source_revision, payload, observed_at, created_at)
    values (${parentId}, ${nextSeq}, ${input.sourceRevision}, ${JSON.stringify(input.payload)}::jsonb,
      ${input.observedAt}, clock_timestamp())`.execute(tx);
  await sql`update ${sql.table(spec.entityTable)}
    set current_revision_seq = ${nextSeq}, updated_at = clock_timestamp()
    where id = ${parentId}`.execute(tx);
}

async function upsertFact<T>(
  db: Kysely<unknown>,
  spec: {
    entityTable: "network_advertisers" | "programs";
    revisionTable: "network_advertiser_revisions" | "program_revisions";
    parentColumn: "network_advertiser_id" | "program_id";
    insertParent: (tx: Transaction<unknown>) => Promise<void>;
    lockParent: (tx: Transaction<unknown>) => Promise<EntityRow | undefined>;
  },
  input: SourceFactInput<T>,
): Promise<UpsertResult | null> {
  // An identity that fails validation is never written, so a blank source ID cannot become a row.
  const identity = validateSourceIdentity({ sourceId: input.sourceId, revision: input.sourceRevision });
  if (!identity.ok) return null;

  return withTx(db, async (tx) => {
    await spec.insertParent(tx);
    const parent = await spec.lockParent(tx);
    if (!parent) throw new Error("upsert: parent row missing after insert");

    const latest = await latestRevision<T>(
      tx,
      spec.revisionTable,
      spec.parentColumn,
      parent.id,
      parent.current_revision_seq,
    );
    const decision = decideRevision(latest, { sourceRevision: input.sourceRevision, payload: input.payload });
    if (decision.kind === "unchanged") return { id: parent.id, outcome: "unchanged" };

    await appendRevision(tx, spec, parent.id, parent.current_revision_seq + 1, input);
    return { id: parent.id, outcome: decision.kind === "create" ? "created" : "revised" };
  });
}

// The network_advertisers row is keyed by the network's own ID (network_id, external_id), so the same record reported
// twice resolves to one row. The insert uses on-conflict-do-nothing and the select-for-update reads whatever won.
export function createSourceFactStore(db: Kysely<unknown>): SourceFactStore {
  return {
    async upsertNetworkAdvertiser(input) {
      return upsertFact<AdvertiserFactPayload>(
        db,
        {
          entityTable: "network_advertisers",
          revisionTable: "network_advertiser_revisions",
          parentColumn: "network_advertiser_id",
          insertParent: async (tx) => {
            await sql`insert into network_advertisers (id, network_id, external_id, created_at, updated_at)
              values (${input.id}, ${input.networkId}, ${input.sourceId}, clock_timestamp(), clock_timestamp())
              on conflict (network_id, external_id) do nothing`.execute(tx);
          },
          lockParent: async (tx) => {
            const result = await sql<EntityRow>`select id, current_revision_seq from network_advertisers
              where network_id = ${input.networkId} and external_id = ${input.sourceId} for update`.execute(tx);
            return result.rows[0];
          },
        },
        input,
      );
    },

    async upsertProgram(input) {
      return upsertFact<ProgramFactPayload>(
        db,
        {
          entityTable: "programs",
          revisionTable: "program_revisions",
          parentColumn: "program_id",
          insertParent: async (tx) => {
            await sql`insert into programs (id, network_advertiser_id, external_id, created_at, updated_at)
              values (${input.id}, ${input.networkAdvertiserId}, ${input.sourceId}, clock_timestamp(), clock_timestamp())
              on conflict (network_advertiser_id, external_id) do nothing`.execute(tx);
          },
          lockParent: async (tx) => {
            const result = await sql<EntityRow>`select id, current_revision_seq from programs
              where network_advertiser_id = ${input.networkAdvertiserId} and external_id = ${input.sourceId}
              for update`.execute(tx);
            return result.rows[0];
          },
        },
        input,
      );
    },

    async listNetworkAdvertiserRevisions(id) {
      const result = await sql<
        RevisionRow<AdvertiserFactPayload>
      >`select revision_seq, source_revision, payload, observed_at
        from network_advertiser_revisions where network_advertiser_id = ${id} order by revision_seq`.execute(db);
      return result.rows.map(toRevision);
    },

    async listProgramRevisions(id) {
      const result = await sql<
        RevisionRow<ProgramFactPayload>
      >`select revision_seq, source_revision, payload, observed_at
        from program_revisions where program_id = ${id} order by revision_seq`.execute(db);
      return result.rows.map(toRevision);
    },
  };
}
