import type { ConversionFactPayload, Id } from "@moneytrap/domain";

// What the store did with one row. created: a new source fact with revision 1. revised: content changed, a new revision
// was appended. unchanged: same content, nothing appended. quarantined: the row was malformed and no fact changed.
export type RowOutcome = "created" | "revised" | "unchanged" | "quarantined";

export interface OpenBatchInput {
  id: Id<"importBatch">;
  networkId: string;
  resource: string;
  sha256Digest: string;
  objectRef: string;
  parserVersion: string;
  sourceFrom: Date | null;
  sourceTo: Date | null;
  startedAt: Date;
}

// created: a new batch row. resumed: the same file was started before and did not finish. replayed: the same file already
// completed, so the caller must write nothing (CT-012).
export interface OpenBatchResult {
  kind: "created" | "resumed" | "replayed";
  batchId: Id<"importBatch">;
}

export interface ApplyRowInput {
  batchId: Id<"importBatch">;
  rowId: Id<"importRow">;
  sourceFactId: Id<"conversionSource">;
  networkId: string;
  externalRowRef: string;
  sourceRevision: string;
  payload: ConversionFactPayload;
  observedAt: Date;
}

export interface RecordQuarantineInput {
  batchId: Id<"importBatch">;
  rowId: Id<"importRow">;
  externalRowRef: string;
}

// The adapter runs each row in its own transaction, so an interrupted import leaves whole rows behind, never half of one.
// applyRow and recordQuarantine return the stored outcome, and write nothing more, when the row already exists for the
// batch. That is what makes a resumed import finish with no duplicates (TP-W6-019).
export interface ConversionImportStore {
  openBatch(input: OpenBatchInput): Promise<OpenBatchResult>;
  applyRow(input: ApplyRowInput): Promise<RowOutcome>;
  recordQuarantine(input: RecordQuarantineInput): Promise<RowOutcome>;
  completeBatch(input: { batchId: Id<"importBatch">; finishedAt: Date }): Promise<void>;
}
