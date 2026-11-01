import { type Id, parseConversionRow } from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type { ConversionImportStore, RowOutcome } from "../ports/conversion-import-store";

export interface ImportBatchInput {
  networkId: string;
  // The report or resource the network sent, for example "transactions".
  resource: string;
  // Lower-case hex SHA-256 of the file. Together with networkId and resource it identifies the batch (DM-031).
  sha256Digest: string;
  objectRef: string;
  parserVersion: string;
  sourceFrom: Date | null;
  sourceTo: Date | null;
  rows: readonly unknown[];
}

export interface ImportCounts {
  created: number;
  revised: number;
  unchanged: number;
  quarantined: number;
}

export type ImportBatchResult =
  | { ok: true; value: { batchId: Id<"importBatch">; outcome: "imported" | "replayed"; counts: ImportCounts } }
  | { ok: false; code: "VALIDATION_FAILED"; reason: string };

const emptyCounts = (): ImportCounts => ({ created: 0, revised: 0, unchanged: 0, quarantined: 0 });

// Imports one network batch. A replay of a completed batch writes nothing (CT-012). A row whose content changed becomes a
// new revision, and the earlier revision stays (CT-018). A malformed row is quarantined and the rest still import.
// Journals are not written here: posting from revisions is WP-6.6.
export async function importConversionBatch(
  ctx: Ctx,
  store: ConversionImportStore,
  input: ImportBatchInput,
): Promise<ImportBatchResult> {
  const invalid = validateBatch(input);
  if (invalid) return { ok: false, code: "VALIDATION_FAILED", reason: invalid };

  // Every row gets a key before anything is written. A valid row is keyed by its source reference. A malformed row is keyed
  // by its position. A file that reuses a key is rejected whole, so the batch never has two rows for one reference.
  const keyed = input.rows.map((raw, index) => {
    const parsed = parseConversionRow(raw);
    const key = parsed.ok ? parsed.value.externalRowRef : `position:${index}`;
    return { parsed, key };
  });
  const seen = new Set<string>();
  for (const { key } of keyed) {
    if (seen.has(key)) return { ok: false, code: "VALIDATION_FAILED", reason: `duplicate row reference ${key}` };
    seen.add(key);
  }

  const now = ctx.clock.now();
  const opened = await store.openBatch({
    id: ctx.ids.next("importBatch"),
    networkId: input.networkId,
    resource: input.resource,
    sha256Digest: input.sha256Digest,
    objectRef: input.objectRef,
    parserVersion: input.parserVersion,
    sourceFrom: input.sourceFrom,
    sourceTo: input.sourceTo,
    startedAt: now,
  });
  if (opened.kind === "replayed") {
    return { ok: true, value: { batchId: opened.batchId, outcome: "replayed", counts: emptyCounts() } };
  }

  const counts = emptyCounts();
  for (const { parsed, key } of keyed) {
    const outcome: RowOutcome = parsed.ok
      ? await store.applyRow({
          batchId: opened.batchId,
          rowId: ctx.ids.next("importRow"),
          sourceFactId: ctx.ids.next("conversionSource"),
          networkId: input.networkId,
          externalRowRef: parsed.value.externalRowRef,
          sourceRevision: parsed.value.sourceRevision,
          payload: parsed.value.payload,
          observedAt: now,
        })
      : await store.recordQuarantine({
          batchId: opened.batchId,
          rowId: ctx.ids.next("importRow"),
          externalRowRef: key,
        });
    counts[outcome] += 1;
  }

  await store.completeBatch({ batchId: opened.batchId, finishedAt: ctx.clock.now() });
  return { ok: true, value: { batchId: opened.batchId, outcome: "imported", counts } };
}

function validateBatch(input: ImportBatchInput): string | null {
  if (input.networkId.trim() === "") return "networkId is required";
  if (input.resource.trim() === "") return "resource is required";
  if (!/^[0-9a-f]{64}$/.test(input.sha256Digest)) return "sha256Digest must be lower-case hex SHA-256";
  if (input.objectRef.trim() === "") return "objectRef is required";
  if (input.parserVersion.trim() === "") return "parserVersion is required";
  return null;
}
