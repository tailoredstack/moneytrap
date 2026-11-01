import { describe, expect, test } from "bun:test";
import { reconcileLedger } from "@moneytrap/app/src/finance/reconciliation";
import { fixtureCtx } from "@moneytrap/test-kit";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { migrate } from "../migrate";
import { createLedgerReconciliationSource } from "./ledger-reconciliation";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

type Side = "debit" | "credit";
type Entry = [id: string, account: string, side: Side, amount: bigint, currency?: string];

// Each test gets a private schema with the migrations applied, one organization, and a few accounts.
async function openPostgres() {
  const schema = `recon_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: databaseUrl });
  await admin.query(`create schema "${schema}"`);
  await admin.end();

  const statements: string[] = [];
  const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({ pool }),
    log: (event) => {
      statements.push(event.query.sql);
    },
  });
  await migrate(db);
  await sql`insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
    values ('usr_recon', 'Recon', 'recon@moneytrap.test', true, now(), now())`.execute(db);
  await sql`insert into organizations (id, name, country, base_currency, status, created_by, created_at, updated_at)
    values ('org_recon', 'Recon', 'US', 'USD', 'active', 'usr_recon', now(), now())`.execute(db);
  for (const [id, currency] of [
    ["cash", "USD"],
    ["revenue", "USD"],
    ["cash_jpy", "JPY"],
    ["revenue_jpy", "JPY"],
    ["cash_kwd", "KWD"],
    ["revenue_kwd", "KWD"],
  ] as const) {
    await sql`insert into accounts (id, organization_id, currency, created_at)
      values (${id}, 'org_recon', ${currency}, now())`.execute(db);
  }
  statements.length = 0;

  return {
    db,
    statements,
    source: createLedgerReconciliationSource(db),
    // One transaction per journal, so the deferred balance trigger checks it at commit like a real write.
    async journal(id: string, entries: Entry[], reversalOf: string | null = null) {
      await db.transaction().execute(async (tx) => {
        await sql`insert into journals (id, reversal_of, created_at) values (${id}, ${reversalOf}, now())`.execute(tx);
        for (const [postingId, account, side, amount, currency = "USD"] of entries) {
          await sql`insert into postings (id, journal_id, account_id, side, amount, currency)
            values (${postingId}, ${id}, ${account}, ${side}, ${amount.toString()}, ${currency})`.execute(tx);
        }
      });
    },
    async withoutBalanceTrigger(run: () => Promise<void>) {
      await sql`alter table postings disable trigger postings_balance_check`.execute(db);
      try {
        await run();
      } finally {
        await sql`alter table postings enable trigger postings_balance_check`.execute(db);
      }
    },
    async close() {
      await db.destroy();
      const cleanup = new Pool({ connectionString: databaseUrl });
      await cleanup.query(`drop schema if exists "${schema}" cascade`);
      await cleanup.end();
    },
  };
}

const ctx = fixtureCtx<Record<string, never>>(undefined as never);

describeWithDatabase("ledger reconciliation against Postgres (WP-X.3)", () => {
  test("a sandbox ledger with sales, a reversal, and three currencies reconciles with zero unexplained variance", async () => {
    const fixture = await openPostgres();
    try {
      await fixture.journal("j1", [
        ["p1", "cash", "debit", 12_345n],
        ["p2", "revenue", "credit", 12_345n],
      ]);
      await fixture.journal("j2", [
        ["p3", "cash_jpy", "debit", 5_000n, "JPY"],
        ["p4", "revenue_jpy", "credit", 5_000n, "JPY"],
      ]);
      await fixture.journal("j3", [
        ["p5", "cash_kwd", "debit", 1_234n, "KWD"],
        ["p6", "revenue_kwd", "credit", 1_234n, "KWD"],
      ]);
      // Past 2^53, so the amount is only exact if it stays a bigint end to end.
      await fixture.journal("j4", [
        ["p7", "cash", "debit", 9_007_199_254_740_993n],
        ["p8", "revenue", "credit", 9_007_199_254_740_993n],
      ]);
      await fixture.journal(
        "j5",
        [
          ["p9", "cash", "credit", 12_345n],
          ["p10", "revenue", "debit", 12_345n],
        ],
        "j1",
      );

      const report = await reconcileLedger(ctx, fixture.source);

      expect(report.findings).toEqual([]);
      expect(report.status).toBe("clean");
      expect(report.unexplainedVariance).toEqual([]);
      expect(report.counts).toEqual({ accounts: 6, journals: 5, postings: 10 });
      expect(report.controlTotals).toEqual([
        { currency: "JPY", debitMinor: 5_000n, creditMinor: 5_000n },
        { currency: "KWD", debitMinor: 1_234n, creditMinor: 1_234n },
        { currency: "USD", debitMinor: 9_007_199_254_765_683n, creditMinor: 9_007_199_254_765_683n },
      ]);
    } finally {
      await fixture.close();
    }
  });

  test("a ledger written while the balance trigger was off shows up as variance in minor units", async () => {
    const fixture = await openPostgres();
    try {
      await fixture.journal("j1", [
        ["p1", "cash", "debit", 1_000n],
        ["p2", "revenue", "credit", 1_000n],
      ]);
      await fixture.withoutBalanceTrigger(async () => {
        await fixture.journal("j2", [
          ["p3", "cash", "debit", 1_000n],
          ["p4", "revenue", "credit", 990n],
        ]);
        await fixture.journal("j3", [["p5", "cash_jpy", "debit", 7n, "JPY"]]);
      });

      const report = await reconcileLedger(ctx, fixture.source);

      expect(report.status).toBe("variance");
      expect(report.findings.map((f) => [f.code, f.journalId, f.currency, f.deltaMinor])).toEqual([
        ["journal_unbalanced", "j2", "USD", 10n],
        ["journal_too_few_postings", "j3", null, null],
        ["journal_unbalanced", "j3", "JPY", 7n],
      ]);
      expect(report.unexplainedVariance).toEqual([
        { currency: "JPY", grossMinor: 7n },
        { currency: "USD", grossMinor: 10n },
      ]);
    } finally {
      await fixture.close();
    }
  });

  test("a reversal that does not undo its original, and a reversal of a reversal, are findings", async () => {
    const fixture = await openPostgres();
    try {
      await fixture.journal("j1", [
        ["p1", "cash", "debit", 1_000n],
        ["p2", "revenue", "credit", 1_000n],
      ]);
      // Balances, so the database accepts it, but it undoes 900 of a 1,000 sale.
      await fixture.journal(
        "j2",
        [
          ["p3", "cash", "credit", 900n],
          ["p4", "revenue", "debit", 900n],
        ],
        "j1",
      );
      await fixture.journal(
        "j3",
        [
          ["p5", "cash", "debit", 900n],
          ["p6", "revenue", "credit", 900n],
        ],
        "j2",
      );

      const report = await reconcileLedger(ctx, fixture.source);

      expect(report.findings.map((f) => [f.code, f.journalId])).toEqual([
        ["reversal_not_mirror", "j2"],
        ["reversal_of_reversal", "j3"],
      ]);
      // Both are structural, so no amount is out of balance.
      expect(report.unexplainedVariance).toEqual([]);
    } finally {
      await fixture.close();
    }
  });

  test("the database refuses a second reversal of one journal, so that finding cannot arise through the schema", async () => {
    const fixture = await openPostgres();
    try {
      await fixture.journal("j1", [
        ["p1", "cash", "debit", 100n],
        ["p2", "revenue", "credit", 100n],
      ]);
      const reversal: Entry[] = [
        ["r1", "cash", "credit", 100n],
        ["r2", "revenue", "debit", 100n],
      ];
      await fixture.journal("j2", reversal, "j1");

      await expect(
        fixture.journal(
          "j3",
          [
            ["r3", "cash", "credit", 100n],
            ["r4", "revenue", "debit", 100n],
          ],
          "j1",
        ),
      ).rejects.toThrow(/unique|duplicate/i);
      expect((await reconcileLedger(ctx, fixture.source)).status).toBe("clean");
    } finally {
      await fixture.close();
    }
  });

  test("a posting with a non-positive amount is a finding", async () => {
    const fixture = await openPostgres();
    try {
      await fixture.journal("j1", [
        ["p1", "cash", "debit", 0n],
        ["p2", "revenue", "credit", 0n],
      ]);

      const report = await reconcileLedger(ctx, fixture.source);

      expect(report.findings.map((f) => [f.code, f.postingId])).toEqual([
        ["posting_non_positive_amount", "p1"],
        ["posting_non_positive_amount", "p2"],
      ]);
    } finally {
      await fixture.close();
    }
  });

  test("the job reads in one read-only transaction and writes nothing", async () => {
    const fixture = await openPostgres();
    try {
      await fixture.journal("j1", [
        ["p1", "cash", "debit", 1_000n],
        ["p2", "revenue", "credit", 1_000n],
      ]);
      const count = async (table: string) =>
        (await sql<{ n: string }>`select count(*)::text as n from ${sql.table(table)}`.execute(fixture.db)).rows[0]?.n;
      const before = [
        await count("journals"),
        await count("postings"),
        await count("accounts"),
        await count("audit_logs"),
      ];
      fixture.statements.length = 0;

      await reconcileLedger(ctx, fixture.source);
      const sent = fixture.statements.map((text) => text.toLowerCase());

      const after = [
        await count("journals"),
        await count("postings"),
        await count("accounts"),
        await count("audit_logs"),
      ];
      expect(after).toEqual(before);
      expect(sent[0]).toBe("start transaction isolation level repeatable read");
      expect(sent[1]).toBe("set transaction read only");
      expect(sent.at(-1)).toBe("commit");
      expect(sent.some((text) => /\b(insert|update|delete|truncate)\b/.test(text))).toBe(false);
    } finally {
      await fixture.close();
    }
  });
});
