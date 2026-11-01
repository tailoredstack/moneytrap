import type {
  ApplyRowInput,
  ConversionImportStore,
  OpenBatchInput,
  OpenBatchResult,
  RecordQuarantineInput,
  RowOutcome,
} from "@moneytrap/app/src/ports/conversion-import-store";
import { type ConversionFactPayload, decideRevision, type Id } from "@moneytrap/domain";

export interface StoredBatch {
  id: Id<"importBatch">;
  networkId: string;
  resource: string;
  sha256Digest: string;
  state: "running" | "completed";
  finishedAt: Date | null;
}

export interface StoredRow {
  batchId: Id<"importBatch">;
  externalRowRef: string;
  outcome: RowOutcome;
  revisionSeq: number | null;
}

export interface StoredRevision {
  sourceFactId: Id<"conversionSource">;
  revisionSeq: number;
  sourceRevision: string;
  payload: ConversionFactPayload;
  batchId: Id<"importBatch">;
}

/** In-memory reference adapter for the conversion import store. Each call is atomic, as the Postgres adapter's transactions are. */
export class FakeConversionImportStore implements ConversionImportStore {
  readonly batches: StoredBatch[] = [];
  readonly rows: StoredRow[] = [];
  readonly revisions: StoredRevision[] = [];
  private readonly factIds = new Map<string, Id<"conversionSource">>();
  private applyCalls = 0;
  /** Test hook: throw on the applyRow call after this many successful calls, to simulate an interrupted import. */
  failAfterRows: number | null = null;

  async openBatch(input: OpenBatchInput): Promise<OpenBatchResult> {
    const existing = this.batches.find(
      (batch) =>
        batch.networkId === input.networkId &&
        batch.resource === input.resource &&
        batch.sha256Digest === input.sha256Digest,
    );
    if (existing) {
      return { kind: existing.state === "completed" ? "replayed" : "resumed", batchId: existing.id };
    }
    this.batches.push({
      id: input.id,
      networkId: input.networkId,
      resource: input.resource,
      sha256Digest: input.sha256Digest,
      state: "running",
      finishedAt: null,
    });
    return { kind: "created", batchId: input.id };
  }

  async applyRow(input: ApplyRowInput): Promise<RowOutcome> {
    this.applyCalls += 1;
    if (this.failAfterRows !== null && this.applyCalls > this.failAfterRows) {
      throw new Error("import interrupted");
    }
    const stored = this.rows.find(
      (row) => row.batchId === input.batchId && row.externalRowRef === input.externalRowRef,
    );
    if (stored) return stored.outcome;

    const factKey = `${input.networkId}|${input.externalRowRef}`;
    const factId = this.factIds.get(factKey) ?? input.sourceFactId;
    this.factIds.set(factKey, factId);
    const latest = this.latestRevision(factId);
    const decision = decideRevision(latest, { sourceRevision: input.sourceRevision, payload: input.payload });

    if (decision.kind === "unchanged") {
      this.rows.push({
        batchId: input.batchId,
        externalRowRef: input.externalRowRef,
        outcome: "unchanged",
        revisionSeq: latest?.revisionSeq ?? null,
      });
      return "unchanged";
    }
    const revisionSeq = (latest?.revisionSeq ?? 0) + 1;
    this.revisions.push({
      sourceFactId: factId,
      revisionSeq,
      sourceRevision: input.sourceRevision,
      payload: input.payload,
      batchId: input.batchId,
    });
    const outcome: RowOutcome = decision.kind === "create" ? "created" : "revised";
    this.rows.push({ batchId: input.batchId, externalRowRef: input.externalRowRef, outcome, revisionSeq });
    return outcome;
  }

  async recordQuarantine(input: RecordQuarantineInput): Promise<RowOutcome> {
    const stored = this.rows.find(
      (row) => row.batchId === input.batchId && row.externalRowRef === input.externalRowRef,
    );
    if (stored) return stored.outcome;
    this.rows.push({
      batchId: input.batchId,
      externalRowRef: input.externalRowRef,
      outcome: "quarantined",
      revisionSeq: null,
    });
    return "quarantined";
  }

  async completeBatch(input: { batchId: Id<"importBatch">; finishedAt: Date }): Promise<void> {
    const batch = this.batches.find((candidate) => candidate.id === input.batchId);
    if (!batch) throw new Error("completeBatch: unknown batch");
    batch.state = "completed";
    batch.finishedAt = input.finishedAt;
  }

  private latestRevision(factId: Id<"conversionSource">) {
    const latest = this.revisions.filter((revision) => revision.sourceFactId === factId).at(-1);
    return latest
      ? { sourceRevision: latest.sourceRevision, payload: latest.payload, revisionSeq: latest.revisionSeq }
      : null;
  }
}
