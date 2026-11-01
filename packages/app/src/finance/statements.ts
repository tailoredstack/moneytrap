import { createHash } from "node:crypto";
import type { CurrencyCode, ErrorCode, Id } from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type { PublisherBalanceSource } from "../ports/publisher-balance-source";
import type { StatementRecord, StatementStore } from "../ports/statement-store";
import { publisherBalances } from "./balances";

// The content of a statement: one publisher, one currency, one period, valued as of the period end. Money is written as
// decimal strings of bigint minor units, so the canonical JSON (and therefore the hash) has no floating-point values.
export interface StatementContent {
  publisherId: Id<"publisher">;
  currency: CurrencyCode;
  periodStart: string;
  periodEnd: string;
  asOf: string;
  totals: { estimatedMinor: string; approvedMinor: string; availableMinor: string };
  lines: { conversionId: Id<"conversion">; bucket: string; publisherMinor: string; roundingVersion: number }[];
}

export interface StatementPeriod {
  publisherId: Id<"publisher">;
  currency: CurrencyCode;
  periodStart: Date;
  periodEnd: Date;
}

export type StatementResult =
  | { ok: true; value: { record: StatementRecord; created: boolean } }
  | { ok: false; code: ErrorCode };

export type StatementListResult = { ok: true; value: StatementRecord[] } | { ok: false; code: ErrorCode };

// Object keys are sorted at every depth, so the same content always serializes to the same bytes.
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested: unknown) => {
    if (nested === null || typeof nested !== "object" || Array.isArray(nested)) return nested;
    return Object.fromEntries(Object.entries(nested).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  });
}

// The sha256 of the canonical content. It covers the totals and every line, so any change to a closed statement's content
// shows up as a different hash.
export function statementHash(content: StatementContent): string {
  return createHash("sha256").update(canonicalJson(content)).digest("hex");
}

// Closes a period for one publisher and currency. A period that already has a closed statement is returned unchanged:
// regenerating it neither rewrites the content nor adds a revision, so later source changes land in the next period.
// Otherwise the balance view is read as of periodEnd, and the result is hashed and recorded once.
export async function closeStatement(
  ctx: Ctx,
  deps: { source: PublisherBalanceSource; store: StatementStore },
  period: StatementPeriod,
): Promise<StatementResult> {
  if (period.periodEnd.getTime() <= period.periodStart.getTime()) return { ok: false, code: "VALIDATION_FAILED" };

  const existing = await deps.store.findClosed(
    period.publisherId,
    period.currency,
    period.periodStart,
    period.periodEnd,
  );
  if (existing) return { ok: true, value: { record: existing, created: false } };

  const asOfEnd: Ctx = { ...ctx, clock: { now: () => period.periodEnd } };
  const view = await publisherBalances(asOfEnd, deps.source, { publisherId: period.publisherId });
  const balance = view.balances.find((row) => row.currency === period.currency);
  const content: StatementContent = {
    publisherId: period.publisherId,
    currency: period.currency,
    periodStart: period.periodStart.toISOString(),
    periodEnd: period.periodEnd.toISOString(),
    asOf: period.periodEnd.toISOString(),
    totals: {
      estimatedMinor: (balance?.estimatedMinor ?? 0n).toString(),
      approvedMinor: (balance?.approvedMinor ?? 0n).toString(),
      availableMinor: (balance?.availableMinor ?? 0n).toString(),
    },
    lines: view.lines
      .filter((line) => line.currency === period.currency)
      .map((line) => ({
        conversionId: line.conversionId,
        bucket: line.bucket,
        publisherMinor: line.publisherMinor.toString(),
        roundingVersion: line.roundingVersion,
      }))
      .sort((a, b) => (a.conversionId < b.conversionId ? -1 : a.conversionId > b.conversionId ? 1 : 0)),
  };

  const id = ctx.ids.next("statement");
  const record: StatementRecord = {
    id,
    publisherId: period.publisherId,
    currency: period.currency,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    revision: 1,
    contentHash: statementHash(content),
    objectRef: `statements/${id}.json`,
    content,
    createdAt: ctx.clock.now(),
  };

  if (await deps.store.recordClosed(record)) return { ok: true, value: { record, created: true } };

  // A concurrent close recorded the period first. Its statement is the closed one.
  const winner = await deps.store.findClosed(period.publisherId, period.currency, period.periodStart, period.periodEnd);
  if (!winner) return { ok: false, code: "STATE_CONFLICT" };
  return { ok: true, value: { record: winner, created: false } };
}

// Lists one publisher's statements (API-052). year and month filter on the period start, in UTC.
export async function listStatements(
  deps: { store: StatementStore },
  filter: { publisherId: Id<"publisher">; year?: number; month?: number; currency?: CurrencyCode },
): Promise<StatementListResult> {
  if (filter.month !== undefined && (!Number.isInteger(filter.month) || filter.month < 1 || filter.month > 12)) {
    return { ok: false, code: "VALIDATION_FAILED" };
  }
  const records = await deps.store.list(filter.publisherId);
  const matching = records.filter(
    (record) =>
      (filter.year === undefined || record.periodStart.getUTCFullYear() === filter.year) &&
      (filter.month === undefined || record.periodStart.getUTCMonth() + 1 === filter.month) &&
      (filter.currency === undefined || record.currency === filter.currency),
  );
  return { ok: true, value: matching };
}
