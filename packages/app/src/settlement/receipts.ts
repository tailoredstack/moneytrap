import { type CurrencyCode, isCurrencyCode } from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type { ReceiptRecord, SettlementReceiptStore } from "../ports/settlement-receipt-store";

// One receipt row from a file, with money as bigint minor units. The source identity is (networkId, externalRef).
export interface ReceiptRow {
  externalRef: string;
  grossMinor: bigint;
  currency: CurrencyCode;
  receivedAt: Date;
  state: string;
}

// line is the 1-based line in the uploaded file. Line 0 means the request itself (network or object reference) is wrong.
export interface ReceiptFileError {
  line: number;
  reason: string;
}

export type ParseReceiptFileResult = { ok: true; value: ReceiptRow[] } | { ok: false; errors: ReceiptFileError[] };

export interface ReceiptCounts {
  created: number;
  duplicate: number;
  conflict: number;
}

export interface ImportReceiptsInput {
  networkId: string;
  // The stored file the rows came from, for example "upload:<digest>".
  objectRef: string;
  rows: readonly ReceiptRow[];
}

export type ImportReceiptsResult =
  | { ok: true; value: { counts: ReceiptCounts } }
  | { ok: false; code: "VALIDATION_FAILED"; errors: ReceiptFileError[] };

export interface UploadReceiptFileInput {
  networkId: string;
  objectRef: string;
  // The whole CSV file as text. Its first line is the header.
  text: string;
}

const requiredColumns = ["external_ref", "gross_minor", "currency", "received_at", "state"] as const;
const isoInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

// Parses a manual upload: a CSV with a header row and the five required columns, in any order. Every row is checked, so one
// upload reports all of its problems at once. A file with any invalid row is rejected whole, and nothing is imported. Fields
// are split on commas with no quoting, so a value cannot contain a comma.
export function parseReceiptFile(text: string): ParseReceiptFileResult {
  const lines = text
    .split(/\r?\n/)
    .map((raw, index) => ({ raw: raw.trim(), line: index + 1 }))
    .filter((entry) => entry.raw !== "");
  const [headerEntry, ...dataEntries] = lines;
  if (!headerEntry) return { ok: false, errors: [{ line: 1, reason: "file is empty" }] };

  const columns = headerEntry.raw.split(",").map((name) => name.trim());
  const columnIndex = new Map(columns.map((name, index) => [name, index]));
  const missing = requiredColumns.filter((name) => !columnIndex.has(name));
  if (missing.length > 0) {
    return { ok: false, errors: [{ line: headerEntry.line, reason: `missing column ${missing.join(", ")}` }] };
  }
  if (dataEntries.length === 0) {
    return { ok: false, errors: [{ line: headerEntry.line, reason: "file has no receipt rows" }] };
  }

  const errors: ReceiptFileError[] = [];
  const rows: ReceiptRow[] = [];
  const seenRefs = new Set<string>();
  for (const entry of dataEntries) {
    const fields = entry.raw.split(",").map((field) => field.trim());
    if (fields.length !== columns.length) {
      errors.push({ line: entry.line, reason: `expected ${columns.length} fields, found ${fields.length}` });
      continue;
    }
    const field = (name: (typeof requiredColumns)[number]) => fields[columnIndex.get(name) ?? -1] ?? "";
    const parsed = parseReceiptRow(field);
    if (typeof parsed === "string") {
      errors.push({ line: entry.line, reason: parsed });
      continue;
    }
    if (seenRefs.has(parsed.externalRef)) {
      errors.push({ line: entry.line, reason: `duplicate external_ref ${parsed.externalRef}` });
      continue;
    }
    seenRefs.add(parsed.externalRef);
    rows.push(parsed);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: rows };
}

// Returns the row, or the reason its first invalid field was refused.
function parseReceiptRow(field: (name: (typeof requiredColumns)[number]) => string): ReceiptRow | string {
  const externalRef = field("external_ref");
  if (externalRef === "") return "external_ref is required";

  const gross = field("gross_minor");
  if (!/^\d+$/.test(gross)) return "gross_minor must be a whole number of minor units";

  const currency = field("currency");
  if (!isCurrencyCode(currency)) return `currency ${currency} is not an ISO 4217 code`;

  const receivedAt = field("received_at");
  if (!isoInstant.test(receivedAt) || Number.isNaN(Date.parse(receivedAt))) {
    return "received_at must be an ISO 8601 instant";
  }

  const state = field("state");
  if (state === "") return "state is required";

  return {
    externalRef,
    grossMinor: BigInt(gross),
    currency,
    receivedAt: new Date(receivedAt),
    state,
  };
}

// Stores each receipt under its source identity. A receipt already stored is not written again: when its content matches it
// counts as a duplicate, and when it differs it counts as a conflict and the stored receipt is kept. A conflict is reported
// rather than overwritten, because the stored amount may already be in use.
export async function importReceipts(
  ctx: Ctx,
  store: SettlementReceiptStore,
  input: ImportReceiptsInput,
): Promise<ImportReceiptsResult> {
  const invalid = validateRequest(input.networkId, input.objectRef);
  if (invalid) return { ok: false, code: "VALIDATION_FAILED", errors: [{ line: 0, reason: invalid }] };

  const counts: ReceiptCounts = { created: 0, duplicate: 0, conflict: 0 };
  for (const row of input.rows) {
    const outcome = await store.record({
      id: ctx.ids.next("settlementReceipt"),
      networkId: input.networkId,
      externalRef: row.externalRef,
      grossMinor: row.grossMinor,
      currency: row.currency,
      receivedAt: row.receivedAt,
      state: row.state,
      objectRef: input.objectRef,
    });
    if (outcome.kind === "created") {
      counts.created += 1;
    } else {
      counts[sameContent(outcome.existing, row) ? "duplicate" : "conflict"] += 1;
    }
  }
  return { ok: true, value: { counts } };
}

// The manual upload path: parse the whole file, then import it only if every row is valid.
export async function uploadReceiptFile(
  ctx: Ctx,
  store: SettlementReceiptStore,
  input: UploadReceiptFileInput,
): Promise<ImportReceiptsResult> {
  const invalid = validateRequest(input.networkId, input.objectRef);
  if (invalid) return { ok: false, code: "VALIDATION_FAILED", errors: [{ line: 0, reason: invalid }] };

  const parsed = parseReceiptFile(input.text);
  if (!parsed.ok) return { ok: false, code: "VALIDATION_FAILED", errors: parsed.errors };
  return importReceipts(ctx, store, { networkId: input.networkId, objectRef: input.objectRef, rows: parsed.value });
}

function validateRequest(networkId: string, objectRef: string): string | null {
  if (networkId.trim() === "") return "networkId is required";
  if (objectRef.trim() === "") return "objectRef is required";
  return null;
}

function sameContent(stored: ReceiptRecord, row: ReceiptRow): boolean {
  return (
    stored.grossMinor === row.grossMinor &&
    stored.currency === row.currency &&
    stored.receivedAt.getTime() === row.receivedAt.getTime() &&
    stored.state === row.state
  );
}
