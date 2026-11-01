import type { ErrorCode } from "../errors/codes";
import type { CurrencyCode } from "../money/iso4217";
import { parseMoney } from "../money/money";

// Conversion source facts (DM-032, WP-6.5). A network reports each transaction with its own ID and revision. The
// platform keeps what the network said, one revision per content change, and never posts from a batch row directly.
// Posting happens later, from revisions (WP-6.6).

export const CONVERSION_SOURCE_STATUSES = ["pending", "approved", "declined", "reversed"] as const;
export type ConversionSourceStatus = (typeof CONVERSION_SOURCE_STATUSES)[number];

// The normalized content of one reported transaction. The amount is kept as bigint minor units in decimal-string form,
// so the stored JSON and the content comparison never touch a float (ADR-005).
export interface ConversionFactPayload {
  amountMinor: string;
  currency: CurrencyCode;
  status: ConversionSourceStatus;
  // ISO-8601 UTC instant, normalized so two equal instants compare equal.
  occurredAt: string;
  subId: string | null;
}

export interface ParsedConversionRow {
  externalRowRef: string;
  sourceRevision: string;
  payload: ConversionFactPayload;
}

export type ConversionRowParse =
  | { ok: true; value: ParsedConversionRow }
  | { ok: false; code: ErrorCode; reason: string };

// Turns one raw row from a batch into a normalized fact. Any field that does not meet the contract makes the whole row
// malformed, so it is quarantined and never becomes a source fact (TP-W6-020).
export function parseConversionRow(raw: unknown): ConversionRowParse {
  const row = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : null;
  if (!row) return malformed("row must be an object");

  const externalRowRef = stringField(row.externalRowRef);
  const sourceRevision = stringField(row.sourceRevision);
  if (externalRowRef === null || externalRowRef.trim() === "") return malformed("externalRowRef is required");
  if (sourceRevision === null || sourceRevision.trim() === "") return malformed("sourceRevision is required");

  const currency = stringField(row.currency);
  if (currency === null) return malformed("currency is required");
  const money = parseMoney(row.amount, currency);
  if (!money.ok) return malformed(money.error.message);

  const status = row.status;
  if (!CONVERSION_SOURCE_STATUSES.includes(status as ConversionSourceStatus)) {
    return malformed("status is not a known source status");
  }

  const occurredAt = typeof row.occurredAt === "string" ? new Date(row.occurredAt) : null;
  if (!occurredAt || Number.isNaN(occurredAt.getTime())) return malformed("occurredAt must be an ISO-8601 instant");

  const subId = row.subId === undefined || row.subId === null ? null : stringField(row.subId);
  if (row.subId !== undefined && row.subId !== null && subId === null) return malformed("subId must be a string");

  return {
    ok: true,
    value: {
      externalRowRef,
      sourceRevision,
      payload: {
        amountMinor: money.value.amount.toString(),
        currency: money.value.currency,
        status: status as ConversionSourceStatus,
        occurredAt: occurredAt.toISOString(),
        subId,
      },
    },
  };
}

function stringField(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function malformed(reason: string): { ok: false; code: ErrorCode; reason: string } {
  return { ok: false, code: "VALIDATION_FAILED", reason };
}
