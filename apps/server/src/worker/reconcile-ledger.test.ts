import { describe, expect, test } from "bun:test";
import { migrate } from "@moneytrap/adapter-postgres";
import { FakeLedgerReconciliationSource } from "@moneytrap/test-kit";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { runLedgerReconciliation } from "./reconcile-ledger";

const clock = { now: () => new Date("2026-11-02T01:00:00.000Z") };

function balanced(credit = 100n) {
  const source = new FakeLedgerReconciliationSource();
  source.addAccount({ id: "cash", currency: "USD" });
  source.addAccount({ id: "revenue", currency: "USD" });
  source.addJournal({
    id: "j1",
    reversalOf: null,
    postings: [
      { id: "p1", accountId: "cash", side: "debit", amountMinor: 100n, currency: "USD" },
      { id: "p2", accountId: "revenue", side: "credit", amountMinor: credit, currency: "USD" },
    ],
  });
  return source;
}

describe("ledger reconciliation job", () => {
  test("a clean ledger gives exit code 0 and a JSON report with string amounts", async () => {
    const result = await runLedgerReconciliation({ source: balanced(), clock });

    expect(result.exitCode).toBe(0);
    expect(result.summary).toContain("zero unexplained variance");
    expect(JSON.parse(result.json)).toEqual({
      asOf: "2026-11-02T01:00:00.000Z",
      status: "clean",
      counts: { accounts: 2, journals: 1, postings: 2 },
      controlTotals: [{ currency: "USD", debitMinor: "100", creditMinor: "100" }],
      grossImbalance: [],
      findingCounts: {},
      findings: [],
    });
  });

  test("a variance gives exit code 1, and the report keeps the amount exact past 2^53", async () => {
    const source = new FakeLedgerReconciliationSource();
    source.addAccount({ id: "cash", currency: "USD" });
    source.addAccount({ id: "revenue", currency: "USD" });
    source.addJournal({
      id: "j1",
      reversalOf: null,
      postings: [
        { id: "p1", accountId: "cash", side: "debit", amountMinor: 9_007_199_254_740_993n, currency: "USD" },
        { id: "p2", accountId: "revenue", side: "credit", amountMinor: 1n, currency: "USD" },
      ],
    });

    const result = await runLedgerReconciliation({ source, clock });

    expect(result.exitCode).toBe(1);
    expect(result.summary).toContain("1 finding(s)");
    const report = JSON.parse(result.json);
    expect(report.status).toBe("variance");
    expect(report.findings[0]).toMatchObject({ code: "journal_unbalanced", deltaMinor: "9007199254740992" });
    expect(report.grossImbalance).toEqual([{ currency: "USD", grossMinor: "9007199254740992" }]);
  });
});

test("without DATABASE_URL the entry point exits 2 and says why", async () => {
  const missing = await run({});

  expect(missing.exitCode).toBe(2);
  expect(missing.stdout).toBe("");
  expect(missing.stderr).toContain("DATABASE_URL is required");
});

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const entry = new URL("./reconcile-ledger.ts", import.meta.url).pathname;

async function run(env: Record<string, string | undefined>) {
  const child = Bun.spawn(["bun", entry], {
    env: { ...process.env, DATABASE_URL: undefined, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describeWithDatabase("ledger reconciliation entry point against Postgres", () => {
  test("runs as a process against a database: clean exit 0, variance exit 1", async () => {
    const schema = `recon_job_${crypto.randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`create schema "${schema}"`);
    await admin.end();
    const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
    // The child process has its own connection, so it gets the schema through the URL.
    const url = new URL(databaseUrl as string);
    url.searchParams.set("options", `-c search_path=${schema}`);

    try {
      await migrate(db);
      await sql`insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
        values ('usr_job', 'Job', 'job@moneytrap.test', true, now(), now())`.execute(db);
      await sql`insert into organizations (id, name, country, base_currency, status, created_by, created_at, updated_at)
        values ('org_job', 'Job', 'US', 'USD', 'active', 'usr_job', now(), now())`.execute(db);
      for (const id of ["cash", "revenue"]) {
        await sql`insert into accounts (id, organization_id, currency, created_at)
          values (${id}, 'org_job', 'USD', now())`.execute(db);
      }
      await db.transaction().execute(async (tx) => {
        await sql`insert into journals (id, created_at) values ('j1', now())`.execute(tx);
        await sql`insert into postings (id, journal_id, account_id, side, amount, currency) values
          ('p1', 'j1', 'cash', 'debit', 500, 'USD'), ('p2', 'j1', 'revenue', 'credit', 500, 'USD')`.execute(tx);
      });

      const clean = await run({ DATABASE_URL: url.toString() });
      expect(clean.exitCode).toBe(0);
      expect(JSON.parse(clean.stdout)).toMatchObject({ status: "clean", counts: { journals: 1, postings: 2 } });
      expect(clean.stderr).toContain("zero unexplained variance");

      await sql`alter table postings disable trigger postings_balance_check`.execute(db);
      await db.transaction().execute(async (tx) => {
        await sql`insert into journals (id, created_at) values ('j2', now())`.execute(tx);
        await sql`insert into postings (id, journal_id, account_id, side, amount, currency) values
          ('p3', 'j2', 'cash', 'debit', 500, 'USD'), ('p4', 'j2', 'revenue', 'credit', 499, 'USD')`.execute(tx);
      });

      const dirty = await run({ DATABASE_URL: url.toString() });
      expect(dirty.exitCode).toBe(1);
      expect(JSON.parse(dirty.stdout).grossImbalance).toEqual([{ currency: "USD", grossMinor: "1" }]);
    } finally {
      await db.destroy();
      const cleanup = new Pool({ connectionString: databaseUrl });
      await cleanup.query(`drop schema if exists "${schema}" cascade`);
      await cleanup.end();
    }
  }, 30_000);
});
