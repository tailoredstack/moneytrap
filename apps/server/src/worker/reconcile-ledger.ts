// Nightly ledger reconciliation (WP-X.3). Reads the ledger, prints a JSON report, and exits non-zero when any variance
// is found. It never writes to the database: it reports, and a person fixes a finding with a reversal or an adjustment.
//
// Run it against the local dev database after `bun run db:migrate`:
//   DATABASE_URL=postgres://moneytrap:moneytrap@127.0.0.1:5433/moneytrap bun run reconcile:ledger
// The report goes to stdout, so the nightly scheduler can store it: `bun run reconcile:ledger > report.json`. One summary
// line goes to stderr. Exit code: 0 clean, 1 variance found, 2 the job could not run.

import { createLedgerReconciliationSource } from "@moneytrap/adapter-postgres";
import { type LedgerReconciliationReport, reconcileLedger } from "@moneytrap/app/src/finance/reconciliation";
import type { LedgerReconciliationSource } from "@moneytrap/app/src/ports/ledger-reconciliation-source";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { randomIds, systemClock } from "../system";

export interface LedgerReconciliationJobOptions {
  source: LedgerReconciliationSource;
  clock: { now(): Date };
}

export interface LedgerReconciliationJobResult {
  report: LedgerReconciliationReport;
  // The report as JSON. Amounts are strings, because JSON has no bigint and a number would lose digits past 2^53.
  json: string;
  summary: string;
  exitCode: 0 | 1;
}

function serialize(report: LedgerReconciliationReport): string {
  return JSON.stringify(report, (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2);
}

export async function runLedgerReconciliation(
  options: LedgerReconciliationJobOptions,
): Promise<LedgerReconciliationJobResult> {
  const ctx = { db: undefined as never, clock: options.clock, ids: randomIds, actor: { type: "system", id: null } };
  const report = await reconcileLedger(ctx, options.source);
  const { journals, postings, accounts } = report.counts;
  const summary =
    report.status === "clean"
      ? `ledger reconciliation clean: ${journals} journals, ${postings} postings, ${accounts} accounts, zero unexplained variance`
      : `ledger reconciliation found ${report.findings.length} finding(s) in ${journals} journals, ${postings} postings`;
  return { report, json: serialize(report), summary, exitCode: report.status === "clean" ? 0 : 1 };
}

if (import.meta.main) {
  const connectionString = Bun.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is required for reconcile:ledger");
    process.exit(2);
  }

  const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString }) }) });
  try {
    const result = await runLedgerReconciliation({ source: createLedgerReconciliationSource(db), clock: systemClock });
    console.log(result.json);
    console.error(result.summary);
    process.exitCode = result.exitCode;
  } catch (error) {
    console.error(`ledger reconciliation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  } finally {
    await db.destroy();
  }
}
